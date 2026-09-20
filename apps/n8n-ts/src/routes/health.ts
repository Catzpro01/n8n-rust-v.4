/**
 * Health endpoints (contract §3 rows 3–4).
 *
 * `/healthz` MUST stay byte-compatible with n8n (`{"status":"ok"}`) because it
 * is the endpoint operators, systemd, docker and the load balancer already use.
 */
import { access, constants } from 'node:fs/promises';
import type { App } from '../app-context.ts';
import type { Router } from '../http/router.ts';
import { sendData, sendJson } from '../http/respond.ts';

export type ReadinessCheck = { name: string; ok: boolean; detail?: string };

export type ReadinessReport = {
  status: 'ok' | 'error';
  checks: Record<string, unknown>;
};

export async function readinessReport(app: App): Promise<ReadinessReport> {
  const checks: Record<string, unknown> = {
    pid: process.pid,
    shuttingDown: app.shuttingDown,
    engine: { package: app.engine.package, version: app.engine.version, registry: app.engine.registryVersion },
    nodeTypes: app.nodeTypes.length,
    executions: app.executions.size,
    workflows: app.workflows.list().length,
    storage: app.config.storage,
    uptimeSec: Number(((Date.now() - app.startedAtMs) / 1000).toFixed(3)),
  };

  const failures: string[] = [];
  if (!app.shuttingDown) {
    if (app.config.storage === 'file') {
      try {
        await access(app.config.dataDir, constants.W_OK);
        checks.dataDirWritable = true;
      } catch (error) {
        checks.dataDirWritable = false;
        failures.push(`data dir not writable: ${(error as Error).message}`);
      }
    } else {
      checks.dataDirWritable = 'skipped (memory storage)';
    }
    if (app.nodeTypes.length === 0) failures.push('no node handlers registered');
  } else {
    failures.push('runtime is shutting down');
  }

  if (failures.length > 0) checks.failures = failures;
  return { status: failures.length === 0 ? 'ok' : 'error', checks };
}

export function registerHealthRoutes(app: App, router: Router): void {
  router.get('/healthz', (context) => {
    sendJson(context.response, 200, { status: 'ok' }, { requestId: context.requestId, config: app.config });
  });

  router.get('/healthz/readiness', async (context) => {
    const report = await readinessReport(app);
    sendJson(
      context.response,
      report.status === 'ok' ? 200 : 503,
      report,
      { requestId: context.requestId, config: app.config },
    );
  });

  // Small convenience for tooling: a single JSON document with everything
  // scripts/doctor.sh needs.
  router.get('/healthz/full', async (context) => {
    const report = await readinessReport(app);
    sendData(
      context.response,
      200,
      {
        ...report.checks,
        status: report.status,
        version: app.config.version,
        env: app.config.env,
        locale: app.config.locale,
        startedAt: app.startedAt,
      },
      { requestId: context.requestId, config: app.config },
    );
  });
}
