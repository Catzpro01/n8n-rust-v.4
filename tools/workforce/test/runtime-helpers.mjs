// Shared rig for the live worker session runtime tests (#295).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness, SHA } from './helpers.mjs';
import { WorkforceRuntime } from '../src/assignment-runtime.mjs';

export const MAIN = SHA('a');
let seq = 0;
export const k = (p = 'k') => `${p}-${process.pid}-${++seq}`;

/**
 * Harness + runtime + bootstrap. heartbeatIntervalSeconds 10, sessionLostSeconds 60 keep the loss
 * scenarios short; the policy defaults are tested separately.
 */
export function rig({ config = {}, capabilities = ['node'] } = {}) {
  const h = harness();
  const dir = mkdtempSync(join(tmpdir(), 'wf-rt-'));
  const rt = new WorkforceRuntime({ cp: h.cp, dir, now: h.iso });
  const boot = rt.bootstrap({ config: { heartbeatIntervalSeconds: 10, sessionLostSeconds: 60, ...config }, capabilities });
  const bundles = Object.fromEntries(boot.bundles.map((b) => [b.agentId, b]));
  const sessions = {};
  const r = {
    h, rt, dir, boot, bundles, sessions,
    regReq(agentId, over = {}) {
      const b = bundles[agentId];
      return { agentId, sessionId: `sess-${agentId}-${k('g')}`, enrollmentToken: b.enrollment.token, protocolVersion: '1', capabilities: b.capabilities, runnerClass: 'ANY', workspace: b.workspace, branch: b.branch, sessionKind: 'local-harness', idempotencyKey: k('reg'), ...over };
    },
    /** Register + ready a session for a slot; returns the session handle { sessionId, agentId, sessionToken }. */
    attach(agentId, over = {}) {
      const res = rt.register(r.regReq(agentId, over));
      const me = { sessionId: res.session.sessionId, agentId, sessionToken: res.sessionToken };
      rt.ready({ ...me, idempotencyKey: k('ready') });
      sessions[agentId] = me;
      return me;
    },
    attachAll(n = 10) { for (const a of h.cp.policy.workerSlots.slice(0, n)) r.attach(a); },
    task(i, payload = {}) { return h.task({ title: `runtime task ${i}`, scope: { paths: [`area-${i}/`] }, ...payload }); },
    envelope(agentId) { return rt.poll(sessions[agentId]).assignment; },
    ack(agentId, over = {}) {
      const env = r.envelope(agentId);
      return rt.claim({ ...sessions[agentId], assignmentId: env.assignmentId, leaseId: env.leaseId, taskRevision: env.taskRevision, idempotencyKey: k('ack'), ...over });
    },
    run(agentId) { const env = r.envelope(agentId); return rt.report({ ...sessions[agentId], assignmentId: env.assignmentId, status: 'RUNNING', idempotencyKey: k('run') }); },
    heartbeat(agentId, over = {}) {
      const env = r.envelope(agentId);
      return rt.heartbeat({ ...sessions[agentId], assignmentId: env?.assignmentId, leaseId: env?.leaseId, timestamp: h.iso(), sessionState: env ? 'WORKING' : 'IDLE', idempotencyKey: k('hb'), ...over });
    },
    /** Heartbeat every attached session except `skip`. */
    beatAll(skip = []) { for (const a of Object.keys(sessions)) if (!skip.includes(a) && ['IDLE', 'ASSIGNED', 'WORKING', 'ONLINE', 'DRAINING'].includes(rt.store.read().sessions[sessions[a].sessionId].sessionState)) r.heartbeat(a); },
    deliver(agentId, head = SHA('b')) { const env = r.envelope(agentId); return rt.report({ ...sessions[agentId], assignmentId: env.assignmentId, status: 'READY_FOR_REVIEW', headSha: head, idempotencyKey: k('rfr') }); },
    state() { return rt.store.read(); },
    session(agentId) { return r.state().sessions[sessions[agentId].sessionId]; },
  };
  return r;
}

export function throwsCode(assert, fn, code) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err, `expected ${code} but the call succeeded`);
  assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
  return err;
}
