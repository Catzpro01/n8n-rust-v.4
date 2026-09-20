/** GET / — landing + discovery (kontrak §2.1). */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../envelope.js';

export function handleRoot(
  _req: IncomingMessage,
  res: ServerResponse,
  version: string,
): void {
  sendJson(res, 200, {
    name: 'n8n-ts-baseline',
    version,
    status: 'ok',
    endpoints: ['GET /', 'GET /healthz', 'POST /api/v1/workflows/run'],
  });
}
