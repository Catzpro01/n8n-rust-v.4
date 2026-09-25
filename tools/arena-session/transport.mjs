// Arena session transport (#295 §14): a replaceable channel between live worker sessions and the
// Manager-operated workforce runtime. Two implementations share one protocol:
//
//   * http   — localhost/VPS HTTP polling. The server holds the control-plane store; sessions only
//              speak the session protocol and never receive a GitHub, Supabase, webhook or owner
//              credential. The session credential travels in the Authorization header only.
//   * inproc — direct calls (tests, single-process harnesses).
//
// Unknown transport kinds fail closed. The transport is NOT the arena-executor subprocess and has no
// dependency on Supabase, the GitHub webhook or the executor queue (tools/arena-bridge stays separate).
import { createServer } from 'node:http';
import { CommandError } from '../workforce/src/core.mjs';

export const SESSION_OPS = Object.freeze(['register', 'ready', 'heartbeat', 'poll', 'claim', 'reject', 'report', 'drain']);
const MAX_BODY = 64 * 1024;
const STATUS = {
  INVALID_SCHEMA: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, REVISION_CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409,
  DUPLICATE: 409, INVALID_STATE_TRANSITION: 409, LEASE_EXPIRED: 410, LEASE_REVOKED: 410, RESOURCE_UNAVAILABLE: 503,
};

export class TransportError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

/** Server: wraps a WorkforceRuntime. Optional Manager loop runs assign-ready (which reconciles first). */
export function createSessionServer({ runtime, managerLoop = null, log = () => {} }) {
  let timer = null;
  const server = createServer((req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    const url = new URL(req.url, 'http://runtime.local');
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      const st = runtime.status();
      send(200, { ok: true, runtimeVersion: st.runtimeVersion, acceptance: st.acceptance, liveSessions: st.liveSessions });
      return;
    }
    const m = /^\/v1\/session\/([a-z]+)$/.exec(url.pathname);
    if (req.method !== 'POST' || !m || !SESSION_OPS.includes(m[1])) { send(404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown route' } }); return; }
    const op = m[1];
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { send(400, { ok: false, error: { code: 'INVALID_SCHEMA', message: 'body must be JSON' } }); return; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { send(400, { ok: false, error: { code: 'INVALID_SCHEMA', message: 'body must be a JSON object' } }); return; }
      delete body.sessionToken; delete body.transport; // server-determined fields
      const auth = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
      if (op === 'register') body.transport = 'http';
      else body.sessionToken = auth?.[1];
      try {
        const result = runtime[op](body);
        log({ op, ok: true, agentId: body.agentId ?? null });
        send(200, result);
      } catch (e) {
        const known = e instanceof CommandError;
        log({ op, ok: false, agentId: body.agentId ?? null, code: known ? e.code : 'INTERNAL' });
        // Fail closed: unknown failures are 500 without internals; bodies are never echoed or logged.
        send(known ? (STATUS[e.code] ?? 422) : 500, { ok: false, error: known ? { code: e.code, message: e.message, details: e.details } : { code: 'INTERNAL_RECOVERY_REQUIRED', message: 'runtime failure; the Manager must reconcile' } });
      }
    });
  });
  if (managerLoop) {
    const every = Math.max(1000, managerLoop.intervalMs ?? 5000);
    const tick = () => {
      try {
        const r = runtime.assignReady({ fill: managerLoop.fill ?? 10, mainSha: managerLoop.mainSha, runners: managerLoop.runners });
        const offered = r.offered.filter((x) => x.status === 'OFFERED');
        if (offered.length) log({ op: 'manager-loop', offered: offered.map((x) => `${x.slot}:${x.taskId}`) });
      } catch (e) { log({ op: 'manager-loop', ok: false, code: e.code ?? 'INTERNAL', message: e.message }); }
    };
    server.on('listening', () => { timer = setInterval(tick, every); timer.unref?.(); });
  }
  server.on('close', () => { if (timer) clearInterval(timer); });
  return server;
}

/** Client factory: { kind: 'http', url } | { kind: 'inproc', runtime }. Unknown kinds fail closed. */
export function createSessionClient(opts) {
  if (opts?.kind === 'inproc') {
    const rt = opts.runtime;
    const call = (op) => async (req) => {
      const body = { ...req };
      if (op === 'register') body.transport = 'inproc';
      try { return rt[op](body); } catch (e) { throw new TransportError(e.code ?? 'INTERNAL_RECOVERY_REQUIRED', e.message, e.details); }
    };
    return Object.fromEntries(SESSION_OPS.map((op) => [op, call(op)]));
  }
  if (opts?.kind === 'http') {
    const base = new URL(opts.url);
    if (!['http:', 'https:'].includes(base.protocol)) throw new TransportError('INVALID_SCHEMA', `unsupported transport URL scheme ${base.protocol}`);
    const call = (op) => async (req) => {
      const { sessionToken, ...body } = req;
      const headers = { 'content-type': 'application/json' };
      if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
      let res;
      try { res = await fetch(new URL(`/v1/session/${op}`, base), { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(opts.timeoutMs ?? 10000) }); } catch (e) { throw new TransportError('RESOURCE_UNAVAILABLE', `transport unreachable: ${e.message}`); }
      let json;
      try { json = await res.json(); } catch { throw new TransportError('INTERNAL_RECOVERY_REQUIRED', `non-JSON response (HTTP ${res.status})`); }
      if (!res.ok || json.ok === false) throw new TransportError(json.error?.code ?? 'INTERNAL_RECOVERY_REQUIRED', json.error?.message ?? `HTTP ${res.status}`, json.error?.details);
      return json;
    };
    return Object.fromEntries(SESSION_OPS.map((op) => [op, call(op)]));
  }
  throw new TransportError('POLICY_DENIED', `unknown session transport ${JSON.stringify(opts?.kind)} (fail closed)`);
}
