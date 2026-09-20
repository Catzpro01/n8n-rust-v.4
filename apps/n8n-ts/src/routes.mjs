/**
 * Route handlers for n8n-ts baseline.
 * Contract: contracts/ts-runtime-baseline.contract.md §4
 */

import { readBody, sendJson, sendHtml, sendError, nextExecutionId } from './http-util.mjs';
import { runWorkflowViaLego, LEGO_INTEGRATION } from '../lib/engine-adapter.mjs';

/**
 * @param {{ config: object, logger: object, startedAt: number }} ctx
 */
export function createRouter(ctx) {
  const { config, logger, startedAt } = ctx;

  async function handle(req, res, pathname) {
    const method = (req.method || 'GET').toUpperCase();

    if (pathname === '/' && method === 'GET') {
      return handleRoot(res);
    }
    if (pathname === '/healthz' && method === 'GET') {
      return handleHealthz(res);
    }
    if (pathname === '/healthz/readiness' && method === 'GET') {
      return handleReadiness(res);
    }
    if (pathname === '/api/v1/workflows/run') {
      if (method !== 'POST') {
        return sendError(res, 405, 'Method Not Allowed', {
          hint: 'Use POST',
          details: { allow: ['POST'] },
        });
      }
      return handleWorkflowRun(req, res);
    }

    // Known prefixes with wrong method
    if (pathname === '/healthz' || pathname === '/healthz/readiness' || pathname === '/') {
      return sendError(res, 405, 'Method Not Allowed');
    }

    return sendError(res, 404, 'Not Found');
  }

  function handleRoot(res) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>n8n-ts baseline</title>
  <style>
    :root { font-family: system-ui, sans-serif; color: #e8eaed; background: #0f1419; }
    body { max-width: 42rem; margin: 3rem auto; padding: 0 1.25rem; line-height: 1.5; }
    h1 { font-size: 1.5rem; font-weight: 600; }
    code, pre { background: #1a2332; border-radius: 6px; }
    code { padding: 0.15em 0.4em; font-size: 0.9em; }
    pre { padding: 1rem; overflow: auto; }
    a { color: #7cb7ff; }
    .meta { color: #9aa0a6; font-size: 0.9rem; }
    .ok { color: #81c995; }
  </style>
</head>
<body>
  <h1>n8n TypeScript Baseline</h1>
  <p class="meta">service <code>${config.service}</code> · v${config.version} · engine <code>${LEGO_INTEGRATION.engine}</code></p>
  <p class="ok">Runtime is up. This is the pre-Rust LEGO baseline — not the full n8n editor UI.</p>
  <ul>
    <li><a href="${config.basePath}/healthz"><code>GET /healthz</code></a></li>
    <li><code>POST /api/v1/workflows/run</code></li>
  </ul>
  <pre>curl -sS ${config.basePath || ''}/healthz | jq .

curl -sS -X POST ${config.basePath || ''}/api/v1/workflows/run \\
  -H 'content-type: application/json' \\
  -d '{"workflow":{"nodes":[{"name":"Start","type":"n8n-nodes-base.manualTrigger","parameters":{}}],"connections":{}}}'</pre>
  <p class="meta">Contract: <code>contracts/ts-runtime-baseline.contract.md</code></p>
</body>
</html>`;
    sendHtml(res, 200, html);
  }

  function handleHealthz(res) {
    const uptimeSec = Number(process.uptime().toFixed(3));
    sendJson(res, 200, {
      status: 'ok',
      service: config.service,
      version: config.version,
      uptimeSec,
      engine: LEGO_INTEGRATION.engine,
      locale: config.locale,
      startedAt: new Date(startedAt).toISOString(),
    });
  }

  function handleReadiness(res) {
    sendJson(res, 200, { status: 'ok', ready: true });
  }

  async function handleWorkflowRun(req, res) {
    let raw;
    try {
      raw = await readBody(req, config.payloadLimit);
    } catch (err) {
      if (err && err.code === 413) {
        return sendError(res, 413, 'Payload too large', {
          details: { limit: config.payloadLimit },
        });
      }
      logger.error('body read failed', { err: String(err) });
      return sendError(res, 400, 'Invalid JSON body');
    }

    if (!raw || raw.length === 0) {
      return sendError(res, 400, 'Invalid JSON body', { hint: 'Body is empty' });
    }

    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return sendError(res, 400, 'Invalid JSON body');
    }

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return sendError(res, 400, 'Request body must be a JSON object');
    }

    if (!Object.prototype.hasOwnProperty.call(body, 'workflow')) {
      return sendError(res, 400, 'workflow is required');
    }

    const workflow = body.workflow;
    if (workflow === null || typeof workflow !== 'object' || Array.isArray(workflow)) {
      return sendError(res, 400, 'workflow must be an object');
    }

    if (workflow.nodes !== undefined && !Array.isArray(workflow.nodes)) {
      return sendError(res, 400, 'workflow.nodes must be an array');
    }
    if (workflow.connections !== undefined) {
      if (
        workflow.connections === null ||
        typeof workflow.connections !== 'object' ||
        Array.isArray(workflow.connections)
      ) {
        return sendError(res, 400, 'workflow.connections must be an object');
      }
    }

    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    if (nodes.length === 0) {
      return sendError(res, 400, 'workflow has no nodes');
    }

    // Normalize definition for engine
    const definition = {
      id: workflow.id,
      name: workflow.name,
      nodes,
      connections: workflow.connections && typeof workflow.connections === 'object'
        ? workflow.connections
        : {},
      activeLocale: body.locale ?? config.locale,
    };

    const strictTypes =
      body.options && typeof body.options === 'object' && body.options.strictTypes === false
        ? false
        : true;

    const locale = typeof body.locale === 'string' ? body.locale : config.locale;
    const startNode = typeof body.startNode === 'string' ? body.startNode : null;
    const inputData = body.inputData;

    const executionId = nextExecutionId();
    const startedAtIso = new Date().toISOString();
    const t0 = Date.now();

    try {
      const { result, engineMeta } = await runWorkflowViaLego(definition, {
        startNode,
        inputData,
        locale,
        strictTypes,
      });
      const stoppedAtIso = new Date().toISOString();

      logger.info('workflow run ok', {
        executionId,
        ms: Date.now() - t0,
        workflowId: definition.id ?? null,
      });

      return sendJson(res, 200, {
        data: {
          executionId,
          status: 'success',
          finished: true,
          workflowId: definition.id ?? null,
          workflowName: definition.name ?? null,
          startedAt: startedAtIso,
          stoppedAt: stoppedAtIso,
          locale: engineMeta.locale ?? locale,
          engine: engineMeta.engine,
          result,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err && typeof err.code === 'number' ? err.code : 500;
      const details = err && err.details !== undefined ? err.details : undefined;
      const includeStack = config.nodeEnv !== 'production';

      logger.error('workflow run failed', { executionId, message, code });

      if (code === 422 || message.startsWith('Unknown node type:')) {
        return sendError(res, 422, message.startsWith('Unknown node type:')
          ? message
          : `Unknown node type: ${message}`, {
          details,
          stack: includeStack && err instanceof Error ? err.stack : undefined,
        });
      }

      if (message.startsWith('No nodes found')) {
        return sendError(res, 400, 'workflow has no nodes');
      }

      if (message.startsWith('Node execution failed:')) {
        return sendError(res, 500, message, {
          details,
          stack: includeStack && err instanceof Error ? err.stack : undefined,
        });
      }

      return sendError(res, 500, message || 'Internal execution error', {
        details,
        stack: includeStack && err instanceof Error ? err.stack : undefined,
      });
    }
  }

  return { handle };
}
