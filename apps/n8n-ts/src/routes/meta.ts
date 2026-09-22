/**
 * Metadata endpoints: version + registered node catalogue (contract §3.1).
 */
import { nodeTypes } from '../engine/bridge.ts';
import type { App } from '../app-context.ts';
import type { Router } from '../http/router.ts';
import { sendData } from '../http/respond.ts';

export function registerMetaRoutes(app: App, router: Router): void {
  router.get('/api/v1/version', (context) => {
    sendData(
      context.response,
      200,
      {
        name: 'n8n-ts-runtime',
        version: app.config.version,
        api: 'v1',
        contract: '1.0.0',
        node: process.version,
        startedAt: app.startedAt,
        uptimeSec: Number(((Date.now() - app.startedAtMs) / 1000).toFixed(3)),
        locale: app.config.locale,
        mode: app.config.env,
        engine: app.engine,
      },
      { requestId: context.requestId, config: app.config },
    );
  });

  router.get('/api/v1/nodes', (context) => {
    const locale = context.query.get('locale') ?? undefined;
    const nodes = locale ? nodeTypes(locale) : app.nodeTypes;
    sendData(context.response, 200, { count: nodes.length, nodes }, {
      requestId: context.requestId,
      config: app.config,
    });
  });

  router.get('/api/v1/runtime/config', (context) => {
    // Safe, secret-free view of the effective configuration — the first thing
    // to look at when debugging "why is it behaving like that?".
    sendData(
      context.response,
      200,
      {
        ...app.config,
        apiKey: app.config.apiKey === null ? null : '***set***',
        pidFile: app.config.pidFile,
      },
      { requestId: context.requestId, config: app.config },
    );
  });
}
