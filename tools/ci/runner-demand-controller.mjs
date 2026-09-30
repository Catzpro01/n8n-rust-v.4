#!/usr/bin/env node
/**
 * Demand-Based Self-Hosted Runner Controller
 *
 * Control path:
 *   workflow demand -> GitHub webhook (workflow_job) -> self-hosted runner capacity -> job execution
 *
 * Security & Governance Guarantees:
 * - Fail-closed HMAC-SHA256 webhook authentication: missing secret, missing signature,
 *   malformed signature, or digest mismatch always rejects with 401 Unauthorized.
 * - Zero shell interpolation: Windows runner services are controlled strictly via
 *   `execFile('sc.exe', [action, serviceName], { shell: false, windowsHide: true })`
 *   using a strict service-name allowlist pattern and configured runner pool membership.
 *   Webhook payload fields are never passed to shell commands or process arguments.
 * - Self-hosted-only execution: non-self-hosted jobs are rejected/ignored and never
 *   trigger GitHub-hosted runner fallback, billing/spending-limit routing, or cloud provisioning.
 * - Observable capacity & exhaustion state: `/status` and `getCapacitySnapshot()` expose
 *   `queuedJobsCount`, `runningJobsCount`, `activeWorkersCount`, `desiredWorkers`, and
 *   explicit `WAITING_RUNNER` / `BLOCKED_WITH_EVIDENCE` when self-hosted capacity is exhausted.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const SERVICE_NAME_PATTERN = /^(?:actions\.runner\.[A-Za-z0-9._-]+|ArenaRunner-[A-Za-z0-9._-]+)$/;
const ALLOWED_SC_ACTIONS = new Set(['start', 'stop', 'query']);
const SAFE_JOB_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

export const CONFIG = {
  port: parseInt(process.env.RUNNER_CONTROLLER_PORT || '9876', 10),
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
  idleTimeoutMs: parseInt(process.env.RUNNER_IDLE_TIMEOUT_MS || String(10 * 60 * 1000), 10),
  reconcileIntervalMs: parseInt(process.env.RUNNER_RECONCILE_INTERVAL_MS || '15000', 10),
  minIdleRunners: parseInt(process.env.RUNNER_MIN_IDLE || '0', 10),
  runnerServices: (process.env.RUNNER_SERVICES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  dryRun: process.env.RUNNER_DRY_RUN === 'true' || process.platform !== 'win32',
};

export function createControllerState(now = Date.now()) {
  return {
    queuedJobs: new Set(),
    runningJobs: new Set(),
    activeWorkers: new Set(),
    lastDemandTimestamp: now,
    isReconciling: false,
    rejectedDeliveries: 0,
    ignoredNonSelfHosted: 0,
  };
}

export const STATE = createControllerState();

/**
 * Validate that a Windows service name matches the strict runner service pattern
 * and contains zero shell metacharacters or path separators.
 */
export function isValidServiceName(serviceName) {
  if (typeof serviceName !== 'string' || !serviceName) return false;
  if (/[;&|`$<>\\/"'\s\r\n\0]/.test(serviceName)) return false;
  return SERVICE_NAME_PATTERN.test(serviceName);
}

/**
 * Sanitize a workflow_job id into a safe primitive key for in-memory Set tracking.
 * Returns null if the id is missing or contains unsafe characters.
 */
export function sanitizeJobId(rawId) {
  if (typeof rawId === 'number' && Number.isInteger(rawId) && rawId > 0) {
    return String(rawId);
  }
  if (typeof rawId === 'string' && SAFE_JOB_ID_PATTERN.test(rawId)) {
    return rawId;
  }
  return null;
}

/**
 * True only when the workflow_job carries the canonical `self-hosted` label.
 * Hosted jobs are never handled or fallen back to by the controller.
 */
export function isSelfHostedJob(job) {
  if (!job || !Array.isArray(job.labels)) return false;
  return job.labels.some((label) => {
    const name = typeof label === 'string' ? label : label?.name ?? '';
    return String(name).trim().toLowerCase() === 'self-hosted';
  });
}

/**
 * Fail-closed HMAC-SHA256 verification for GitHub webhooks.
 * Returns false if secret is unset/empty, signature header is missing/malformed,
 * or HMAC digest does not match in constant time.
 */
export function verifyWebhookSignature(payloadBuffer, signatureHeader, secret) {
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    return false;
  }
  if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const signatureHex = signatureHeader.slice('sha256='.length);
  if (!SHA256_HEX_PATTERN.test(signatureHex)) {
    return false;
  }
  const bodyBuf = Buffer.isBuffer(payloadBuffer)
    ? payloadBuffer
    : Buffer.from(String(payloadBuffer ?? ''), 'utf8');
  const hmac = crypto.createHmac('sha256', secret);
  const expectedHex = hmac.update(bodyBuf).digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const actualBuf = Buffer.from(signatureHex.toLowerCase(), 'hex');
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Control a Windows runner service using `execFile('sc.exe', ...)` with `shell: false`.
 * Rejects any service name not matching `isValidServiceName` or not present in `allowedServices`
 * when an allowlist is supplied.
 */
export async function controlWindowsService(
  serviceName,
  action,
  {
    dryRun = CONFIG.dryRun,
    allowedServices = null,
    execFileImpl = execFileAsync,
  } = {},
) {
  if (!ALLOWED_SC_ACTIONS.has(action)) {
    throw new Error(`Invalid service action: ${String(action)}`);
  }
  if (!isValidServiceName(serviceName)) {
    throw new Error(`Invalid or unsafe service name rejected: ${String(serviceName)}`);
  }
  if (Array.isArray(allowedServices) && !allowedServices.includes(serviceName)) {
    throw new Error(`Service '${serviceName}' is not in the configured runnerServices pool`);
  }

  if (dryRun) {
    return { ok: true, dryRun: true, serviceName, action };
  }

  try {
    const { stdout } = await execFileImpl('sc.exe', [action, serviceName], {
      windowsHide: true,
      shell: false,
    });
    return { ok: true, dryRun: false, serviceName, action, stdout };
  } catch (err) {
    const stdout = err.stdout || '';
    if (action === 'start' && stdout.includes('1056')) {
      return { ok: true, dryRun: false, serviceName, action, alreadyInTargetState: true };
    }
    if (action === 'stop' && stdout.includes('1062')) {
      return { ok: true, dryRun: false, serviceName, action, alreadyInTargetState: true };
    }
    return { ok: false, dryRun: false, serviceName, action, error: err.message };
  }
}

/**
 * Pure calculation of desired self-hosted worker count.
 */
export function calculateDesiredWorkers(state, config, now = Date.now()) {
  const totalDemand = state.queuedJobs.size + state.runningJobs.size;
  const maxWorkers = config.runnerServices.length;

  if (totalDemand > 0) {
    return Math.min(totalDemand, maxWorkers);
  }

  const idleDurationMs = now - state.lastDemandTimestamp;
  if (idleDurationMs >= config.idleTimeoutMs) {
    return Math.min(config.minIdleRunners, maxWorkers);
  }

  return Math.min(state.activeWorkers.size, maxWorkers);
}

/**
 * Observable capacity, allocation, and exhaustion snapshot.
 * Reports explicit `WAITING_RUNNER` and `BLOCKED_WITH_EVIDENCE` when queued self-hosted
 * demand cannot be satisfied by available self-hosted runner capacity.
 */
export function getCapacitySnapshot(state, config, now = Date.now()) {
  const queuedJobsCount = state.queuedJobs.size;
  const runningJobsCount = state.runningJobs.size;
  const activeWorkersCount = state.activeWorkers.size;
  const totalConfiguredWorkers = config.runnerServices.length;
  const desiredWorkers = calculateDesiredWorkers(state, config, now);
  const availableIdleWorkers = Math.max(0, activeWorkersCount - runningJobsCount);

  const isExhausted = queuedJobsCount > 0 && (
    totalConfiguredWorkers === 0
    || activeWorkersCount === 0
    || (runningJobsCount >= activeWorkersCount && activeWorkersCount >= totalConfiguredWorkers)
  );

  const status = isExhausted
    ? 'WAITING_RUNNER'
    : (queuedJobsCount > 0 || runningJobsCount > 0 || activeWorkersCount > 0)
      ? 'ACTIVE'
      : 'IDLE';

  const exhaustionState = isExhausted ? 'BLOCKED_WITH_EVIDENCE' : 'NONE';
  const queuedJobIds = [...state.queuedJobs].sort();
  const runningJobIds = [...state.runningJobs].sort();
  const activeWorkers = [...state.activeWorkers];

  const evidence = isExhausted
    ? `WAITING_RUNNER / BLOCKED_WITH_EVIDENCE: ${queuedJobsCount} self-hosted job(s) queued (${queuedJobIds.join(', ')}) `
      + `with ${activeWorkersCount}/${totalConfiguredWorkers} self-hosted runner(s) active and ${runningJobsCount} busy; `
      + 'GitHub-hosted runner fallback is disabled.'
    : null;

  return {
    controlPlane: 'github-actions-webhook',
    executionModel: 'self-hosted-only',
    hostedFallbackAllowed: false,
    status,
    exhaustionState,
    evidence,
    queuedJobsCount,
    runningJobsCount,
    activeWorkersCount,
    availableIdleWorkers,
    desiredWorkers,
    totalConfiguredWorkers,
    queuedJobIds,
    runningJobIds,
    activeWorkers,
    idleDurationSec: Math.floor((now - state.lastDemandTimestamp) / 1000),
    rejectedDeliveries: state.rejectedDeliveries ?? 0,
    ignoredNonSelfHosted: state.ignoredNonSelfHosted ?? 0,
  };
}

/**
 * Reconcile active Windows runner services with desired capacity.
 */
export async function reconcileRunners(
  state = STATE,
  config = CONFIG,
  { now = Date.now(), execFileImpl = execFileAsync } = {},
) {
  if (state.isReconciling) return getCapacitySnapshot(state, config, now);
  state.isReconciling = true;

  try {
    const desiredCount = calculateDesiredWorkers(state, config, now);
    const currentCount = state.activeWorkers.size;

    if (desiredCount > currentCount) {
      for (const serviceName of config.runnerServices) {
        if (state.activeWorkers.size >= desiredCount) break;
        if (!state.activeWorkers.has(serviceName)) {
          const res = await controlWindowsService(serviceName, 'start', {
            dryRun: config.dryRun,
            allowedServices: config.runnerServices,
            execFileImpl,
          });
          if (res.ok) state.activeWorkers.add(serviceName);
        }
      }
    } else if (desiredCount < currentCount && state.runningJobs.size === 0 && state.queuedJobs.size === 0) {
      const reversedServices = [...config.runnerServices].reverse();
      for (const serviceName of reversedServices) {
        if (state.activeWorkers.size <= desiredCount) break;
        if (state.activeWorkers.has(serviceName)) {
          const res = await controlWindowsService(serviceName, 'stop', {
            dryRun: config.dryRun,
            allowedServices: config.runnerServices,
            execFileImpl,
          });
          if (res.ok) state.activeWorkers.delete(serviceName);
        }
      }
    }
    return getCapacitySnapshot(state, config, now);
  } finally {
    state.isReconciling = false;
  }
}

/**
 * Process a single GitHub webhook delivery end-to-end (authentication -> validation ->
 * demand state transition -> self-hosted runner reconciliation -> observable snapshot).
 */
export async function handleWebhookDelivery({
  rawBody,
  signatureHeader,
  eventHeader,
  secret = CONFIG.webhookSecret,
  state = STATE,
  config = CONFIG,
  now = Date.now(),
  execFileImpl = execFileAsync,
} = {}) {
  const bodyBuffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody ?? ''), 'utf8');

  if (!verifyWebhookSignature(bodyBuffer, signatureHeader, secret)) {
    state.rejectedDeliveries = (state.rejectedDeliveries ?? 0) + 1;
    return {
      statusCode: 401,
      body: {
        ok: false,
        code: 'UNAUTHORIZED_WEBHOOK',
        error: 'Unauthorized: valid HMAC-SHA256 signature and configured webhook secret are required',
      },
    };
  }

  let payload;
  try {
    payload = JSON.parse(bodyBuffer.toString('utf8'));
  } catch {
    return {
      statusCode: 400,
      body: { ok: false, code: 'INVALID_JSON', error: 'Invalid JSON payload' },
    };
  }

  if (eventHeader !== 'workflow_job' || !payload?.workflow_job) {
    return {
      statusCode: 200,
      body: {
        ok: true,
        ignored: true,
        reason: 'unsupported_event',
        capacity: getCapacitySnapshot(state, config, now),
      },
    };
  }

  const job = payload.workflow_job;
  if (!isSelfHostedJob(job)) {
    state.ignoredNonSelfHosted = (state.ignoredNonSelfHosted ?? 0) + 1;
    return {
      statusCode: 200,
      body: {
        ok: true,
        ignored: true,
        reason: 'non_self_hosted_job_rejected',
        hostedFallbackAllowed: false,
        capacity: getCapacitySnapshot(state, config, now),
      },
    };
  }

  const jobId = sanitizeJobId(job.id);
  if (!jobId) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        code: 'INVALID_JOB_ID',
        error: 'Invalid workflow_job.id',
      },
    };
  }

  const action = String(payload.action || '');
  if (action === 'queued') {
    state.queuedJobs.add(jobId);
    state.lastDemandTimestamp = now;
  } else if (action === 'in_progress') {
    state.queuedJobs.delete(jobId);
    state.runningJobs.add(jobId);
    state.lastDemandTimestamp = now;
  } else if (action === 'completed') {
    state.queuedJobs.delete(jobId);
    state.runningJobs.delete(jobId);
    state.lastDemandTimestamp = now;
  } else {
    return {
      statusCode: 200,
      body: {
        ok: true,
        ignored: true,
        reason: 'unsupported_action',
        capacity: getCapacitySnapshot(state, config, now),
      },
    };
  }

  const capacity = await reconcileRunners(state, config, { now, execFileImpl });
  return {
    statusCode: 200,
    body: {
      ok: true,
      action,
      jobId,
      capacity,
    },
  };
}

export function createControllerServer({
  state = STATE,
  config = CONFIG,
  execFileImpl = execFileAsync,
} = {}) {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/status') {
      const snapshot = getCapacitySnapshot(state, config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snapshot, null, 2));
      return;
    }

    if (req.method === 'POST' && req.url === '/webhook') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', async () => {
        const rawBody = Buffer.concat(chunks);
        const signatureHeader = req.headers['x-hub-signature-256'];
        const eventHeader = req.headers['x-github-event'];

        const outcome = await handleWebhookDelivery({
          rawBody,
          signatureHeader,
          eventHeader,
          secret: config.webhookSecret,
          state,
          config,
          execFileImpl,
        });

        res.writeHead(outcome.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(outcome.body));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const service of CONFIG.runnerServices) {
    if (!isValidServiceName(service)) {
      console.error(`[FATAL] Invalid service name in RUNNER_SERVICES: "${service}"`);
      process.exit(1);
    }
    STATE.activeWorkers.add(service);
  }

  const server = createControllerServer({ state: STATE, config: CONFIG });
  server.listen(CONFIG.port, '127.0.0.1', () => {
    console.log(`[Controller] Listening on http://127.0.0.1:${CONFIG.port}`);
  });

  setInterval(() => {
    reconcileRunners(STATE, CONFIG).catch((err) => {
      console.error(`[Controller] Reconcile error: ${err.message}`);
    });
  }, CONFIG.reconcileIntervalMs);
}
