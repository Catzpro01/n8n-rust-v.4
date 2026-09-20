/**
 * Pembaca body request dengan limit — aman untuk keep-alive (tetap drain saat over-limit).
 */
import type { IncomingMessage } from 'node:http';

export type BodyResult =
  | { ok: true; raw: string }
  | { ok: false; reason: 'too-large' | 'read-error' };

export function readBody(req: IncomingMessage, limitBytes: number): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;

    req.on('data', (chunk: Buffer) => {
      if (over) return; // tetap drain, buang isinya
      size += chunk.length;
      if (size > limitBytes) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (over) resolve({ ok: false, reason: 'too-large' });
      else resolve({ ok: true, raw: Buffer.concat(chunks).toString('utf8') });
    });
    req.on('error', () => resolve({ ok: false, reason: 'read-error' }));
  });
}
