// Runner webhook/controller contract tests:
//   workflow demand -> GitHub webhook -> self-hosted runner capacity -> job execution
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createControllerState,
  isValidServiceName,
  sanitizeJobId,
  isSelfHostedJob,
  verifyWebhookSignature,
  controlWindowsService,
  calculateDesiredWorkers,
  getCapacitySnapshot,
  reconcileRunners,
  handleWebhookDelivery,
} from '../../ci/runner-demand-controller.mjs';

const TEST_SECRET = 'test-webhook-hmac-secret-for-controller-verification';

function signPayload(rawBody, secret = TEST_SECRET) {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  return `sha256=${crypto.createHmac('sha256', secret).update(buf).digest('hex')}`;
}

test('webhook authentication is fail-closed: missing secret, missing header, or bad HMAC is rejected', async () => {
  const payload = JSON.stringify({
    action: 'queued',
    workflow_job: {
      id: 1001,
      labels: ['self-hosted', 'Windows', 'X64', 'rust-build', 'n8n-rust'],
    },
  });
  const validSig = signPayload(payload, TEST_SECRET);

  // 1. Missing/empty secret must fail closed (never allow unauthenticated webhooks).
  assert.equal(verifyWebhookSignature(Buffer.from(payload), validSig, ''), false);
  assert.equal(verifyWebhookSignature(Buffer.from(payload), validSig, '   '), false);
  assert.equal(verifyWebhookSignature(Buffer.from(payload), validSig, null), false);
  assert.equal(verifyWebhookSignature(Buffer.from(payload), validSig, undefined), false);

  // 2. Missing or malformed signature header must fail closed.
  assert.equal(verifyWebhookSignature(Buffer.from(payload), '', TEST_SECRET), false);
  assert.equal(verifyWebhookSignature(Buffer.from(payload), null, TEST_SECRET), false);
  assert.equal(verifyWebhookSignature(Buffer.from(payload), 'sha1=deadbeef', TEST_SECRET), false);
  assert.equal(verifyWebhookSignature(Buffer.from(payload), 'sha256=not-hex', TEST_SECRET), false);
  assert.equal(verifyWebhookSignature(Buffer.from(payload), 'sha256=1234', TEST_SECRET), false);

  // 3. Wrong secret or tampered body must fail closed.
  assert.equal(verifyWebhookSignature(Buffer.from(payload), signPayload(payload, 'wrong-secret'), TEST_SECRET), false);
  assert.equal(verifyWebhookSignature(Buffer.from(`${payload} `), validSig, TEST_SECRET), false);

  // 4. Exact HMAC-SHA256 match succeeds.
  assert.equal(verifyWebhookSignature(Buffer.from(payload), validSig, TEST_SECRET), true);

  // 5. End-to-end delivery rejects unauthenticated requests without mutating runner state.
  const state = createControllerState(1000);
  const config = {
    webhookSecret: '',
    idleTimeoutMs: 600_000,
    minIdleRunners: 0,
    runnerServices: ['actions.runner.Catzpro01-n8n-rust-v.4.laptop-build-worker-1'],
    dryRun: true,
  };
  const noSecretRes = await handleWebhookDelivery({
    rawBody: payload,
    signatureHeader: validSig,
    eventHeader: 'workflow_job',
    secret: '',
    state,
    config,
  });
  assert.equal(noSecretRes.statusCode, 401);
  assert.equal(noSecretRes.body.ok, false);
  assert.equal(noSecretRes.body.code, 'UNAUTHORIZED_WEBHOOK');
  assert.equal(state.queuedJobs.size, 0);
  assert.equal(state.rejectedDeliveries, 1);
});

test('webhook data can never become shell commands or inject service names', async () => {
  const maliciousInputs = [
    'actions.runner.repo.worker-1; rm -rf /',
    'actions.runner.repo.worker-1 && calc.exe',
    'actions.runner.repo.worker-1 | powershell -enc AAA',
    '$(whoami)',
    '`id`',
    'actions.runner.repo.worker-1\nsc.exe stop other',
    '../actions.runner.repo.worker-1',
    'actions.runner.repo.worker 1',
    '"actions.runner.repo.worker-1"',
    '',
  ];
  for (const bad of maliciousInputs) {
    assert.equal(isValidServiceName(bad), false, `must reject unsafe service name: ${bad}`);
    assert.equal(sanitizeJobId(bad), null, `must reject unsafe job id: ${bad}`);
    await assert.rejects(
      () => controlWindowsService(bad, 'start', { dryRun: false }),
      /Invalid or unsafe service name rejected/,
    );
  }

  // Invalid actions are rejected before execFile is ever reached.
  const validService = 'actions.runner.Catzpro01-n8n-rust-v.4.laptop-build-worker-1';
  assert.equal(isValidServiceName(validService), true);
  await assert.rejects(
    () => controlWindowsService(validService, 'delete; calc.exe', { dryRun: false }),
    /Invalid service action/,
  );

  // Service names outside the configured pool are rejected even if syntactically valid.
  await assert.rejects(
    () => controlWindowsService(
      'actions.runner.Catzpro01-n8n-rust-v.4.unconfigured-worker',
      'start',
      { dryRun: false, allowedServices: [validService] },
    ),
    /not in the configured runnerServices pool/,
  );

  // When invoked with a valid configured service, execFile receives fixed argv and shell: false.
  const calls = [];
  const mockExecFile = async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: 'STATE : 4 RUNNING', stderr: '' };
  };
  const res = await controlWindowsService(validService, 'start', {
    dryRun: false,
    allowedServices: [validService],
    execFileImpl: mockExecFile,
  });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'sc.exe');
  assert.deepEqual(calls[0].args, ['start', validService]);
  assert.equal(calls[0].options.shell, false);

  // Malicious webhook payload fields cannot reach execFile or mutate state when job.id is unsafe.
  const state = createControllerState(1000);
  const config = {
    webhookSecret: TEST_SECRET,
    idleTimeoutMs: 600_000,
    minIdleRunners: 0,
    runnerServices: [validService],
    dryRun: false,
  };
  const maliciousPayload = JSON.stringify({
    action: 'queued',
    workflow_job: {
      id: '1001; calc.exe',
      name: '$( malicious_command )',
      labels: ['self-hosted', 'Windows', '; rm -rf /'],
    },
  });
  const outcome = await handleWebhookDelivery({
    rawBody: maliciousPayload,
    signatureHeader: signPayload(maliciousPayload),
    eventHeader: 'workflow_job',
    secret: TEST_SECRET,
    state,
    config,
    execFileImpl: mockExecFile,
  });
  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.code, 'INVALID_JOB_ID');
  assert.equal(calls.length, 1, 'mockExecFile must not be called for rejected webhook payload');
});

test('workflow demand -> GitHub webhook -> self-hosted runner capacity -> job execution lifecycle', async () => {
  const services = [
    'actions.runner.Catzpro01-n8n-rust-v.4.laptop-build-worker-1',
    'actions.runner.Catzpro01-n8n-rust-v.4.laptop-build-worker-2',
    'actions.runner.Catzpro01-n8n-rust-v.4.laptop-build-worker-3',
  ];
  const state = createControllerState(10_000);
  const config = {
    webhookSecret: TEST_SECRET,
    idleTimeoutMs: 600_000,
    minIdleRunners: 0,
    runnerServices: services,
    dryRun: false,
  };
  const scCalls = [];
  const mockExecFile = async (file, args, options) => {
    scCalls.push({ file, args, shell: options.shell });
    return { stdout: 'OK', stderr: '' };
  };

  // Initial state: IDLE, 0 active workers.
  let snap = getCapacitySnapshot(state, config, 10_000);
  assert.equal(snap.status, 'IDLE');
  assert.equal(snap.exhaustionState, 'NONE');
  assert.equal(snap.hostedFallbackAllowed, false);
  assert.equal(snap.activeWorkersCount, 0);

  // Step 1: Two self-hosted jobs are queued via GitHub webhook.
  for (const [idx, jobId] of [5001, 5002].entries()) {
    const body = JSON.stringify({
      action: 'queued',
      workflow_job: {
        id: jobId,
        labels: ['self-hosted', 'Windows', 'X64', 'rust-build', 'n8n-rust'],
      },
    });
    const res = await handleWebhookDelivery({
      rawBody: body,
      signatureHeader: signPayload(body),
      eventHeader: 'workflow_job',
      secret: TEST_SECRET,
      state,
      config,
      now: 11_000 + idx,
      execFileImpl: mockExecFile,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  }

  snap = getCapacitySnapshot(state, config, 12_000);
  assert.equal(snap.status, 'ACTIVE');
  assert.equal(snap.exhaustionState, 'NONE');
  assert.equal(snap.queuedJobsCount, 2);
  assert.equal(snap.activeWorkersCount, 2);
  assert.equal(snap.desiredWorkers, 2);
  assert.deepEqual(snap.activeWorkers, services.slice(0, 2));

  // Step 2: Both jobs transition to in_progress -> running on self-hosted workers.
  for (const jobId of [5001, 5002]) {
    const body = JSON.stringify({
      action: 'in_progress',
      workflow_job: {
        id: jobId,
        labels: ['self-hosted', 'Windows', 'X64', 'rust-build', 'n8n-rust'],
      },
    });
    const res = await handleWebhookDelivery({
      rawBody: body,
      signatureHeader: signPayload(body),
      eventHeader: 'workflow_job',
      secret: TEST_SECRET,
      state,
      config,
      now: 15_000,
      execFileImpl: mockExecFile,
    });
    assert.equal(res.statusCode, 200);
  }
  snap = getCapacitySnapshot(state, config, 15_000);
  assert.equal(snap.queuedJobsCount, 0);
  assert.equal(snap.runningJobsCount, 2);
  assert.equal(snap.activeWorkersCount, 2);
  assert.equal(snap.status, 'ACTIVE');

  // Step 3: Both jobs complete -> workers remain warm during idle window, then scale down after timeout.
  for (const jobId of [5001, 5002]) {
    const body = JSON.stringify({
      action: 'completed',
      workflow_job: {
        id: jobId,
        labels: ['self-hosted', 'Windows', 'X64', 'rust-build', 'n8n-rust'],
      },
    });
    await handleWebhookDelivery({
      rawBody: body,
      signatureHeader: signPayload(body),
      eventHeader: 'workflow_job',
      secret: TEST_SECRET,
      state,
      config,
      now: 20_000,
      execFileImpl: mockExecFile,
    });
  }
  assert.equal(calculateDesiredWorkers(state, config, 25_000), 2, 'workers stay warm before idleTimeoutMs');

  // After idleTimeoutMs (20_000 + 600_000 = 620_000), reconcile stops idle workers.
  snap = await reconcileRunners(state, config, { now: 625_000, execFileImpl: mockExecFile });
  assert.equal(snap.activeWorkersCount, 0);
  assert.equal(snap.status, 'IDLE');
  assert.ok(scCalls.every((c) => c.shell === false), 'every sc.exe call used shell: false');
});

test('self-hosted capacity exhaustion reports WAITING_RUNNER / BLOCKED_WITH_EVIDENCE and never falls back to hosted runners', async () => {
  const state = createControllerState(1_000);
  const singleRunnerConfig = {
    webhookSecret: TEST_SECRET,
    idleTimeoutMs: 600_000,
    minIdleRunners: 0,
    runnerServices: ['actions.runner.Catzpro01-n8n-rust-v.4.laptop-build-worker-1'],
    dryRun: true,
  };

  // Job 1 starts running on the single available self-hosted worker.
  for (const action of ['queued', 'in_progress']) {
    const body = JSON.stringify({
      action,
      workflow_job: { id: 9001, labels: ['self-hosted', 'Windows', 'X64', 'rust-build', 'n8n-rust'] },
    });
    await handleWebhookDelivery({
      rawBody: body,
      signatureHeader: signPayload(body),
      eventHeader: 'workflow_job',
      secret: TEST_SECRET,
      state,
      config: singleRunnerConfig,
      now: 2_000,
    });
  }

  // Job 2 arrives while the entire self-hosted pool (1/1) is busy -> WAITING_RUNNER / BLOCKED_WITH_EVIDENCE.
  const queuedBody = JSON.stringify({
    action: 'queued',
    workflow_job: { id: 9002, labels: ['self-hosted', 'Windows', 'X64', 'rust-build', 'n8n-rust'] },
  });
  const exhaustedRes = await handleWebhookDelivery({
    rawBody: queuedBody,
    signatureHeader: signPayload(queuedBody),
    eventHeader: 'workflow_job',
    secret: TEST_SECRET,
    state,
    config: singleRunnerConfig,
    now: 3_000,
  });
  assert.equal(exhaustedRes.statusCode, 200);
  assert.equal(exhaustedRes.body.capacity.status, 'WAITING_RUNNER');
  assert.equal(exhaustedRes.body.capacity.exhaustionState, 'BLOCKED_WITH_EVIDENCE');
  assert.equal(exhaustedRes.body.capacity.hostedFallbackAllowed, false);
  assert.match(exhaustedRes.body.capacity.evidence, /WAITING_RUNNER \/ BLOCKED_WITH_EVIDENCE/);
  assert.match(exhaustedRes.body.capacity.evidence, /GitHub-hosted runner fallback is disabled/);

  // Non-self-hosted jobs are rejected/ignored and never allocate capacity or trigger fallback.
  const hostedBody = JSON.stringify({
    action: 'queued',
    workflow_job: { id: 9999, labels: ['ubuntu-latest'] },
  });
  assert.equal(isSelfHostedJob({ labels: ['ubuntu-latest'] }), false);
  const hostedRes = await handleWebhookDelivery({
    rawBody: hostedBody,
    signatureHeader: signPayload(hostedBody),
    eventHeader: 'workflow_job',
    secret: TEST_SECRET,
    state,
    config: singleRunnerConfig,
    now: 4_000,
  });
  assert.equal(hostedRes.statusCode, 200);
  assert.equal(hostedRes.body.ignored, true);
  assert.equal(hostedRes.body.reason, 'non_self_hosted_job_rejected');
  assert.equal(hostedRes.body.hostedFallbackAllowed, false);
  assert.equal(state.queuedJobs.has('9999'), false);
  assert.equal(state.ignoredNonSelfHosted, 1);
});
