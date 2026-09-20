/** GET /healthz — liveness probe (kontrak §2.2). */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../envelope.js';

export function handleHealth(
  req: IncomingMessage,
  res: ServerResponse,
  version: string,
): void {
  const payload = {
    status: 'ok',
    uptimeSec: Math.max(0, Math.floor(process.uptime())),
    version,
  };
  if (req.method === 'HEAD') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end();
    return;
  }
  sendJson(res, 200, payload);
}
