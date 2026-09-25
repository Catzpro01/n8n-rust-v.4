// Shared test harness for the workforce control plane.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlPlane } from '../src/engine.mjs';

export const SHA = (c) => c.repeat(40);
export const M = { type: 'MANAGER', id: 'MANAGER-01' };
export const HUMAN = { type: 'HUMAN', id: 'HUMAN-OWNER' };
export const W = (n) => ({ type: 'WORKER', id: `AGENT-${String(n).padStart(2, '0')}` });
export const SYS = (id) => ({ type: 'SYSTEM', id });

export const ACTORS = [
  { id: 'MANAGER-01', type: 'MANAGER' }, { id: 'HUMAN-OWNER', type: 'HUMAN' },
  { id: 'SYSTEM-CI', type: 'SYSTEM' }, { id: 'SYSTEM-GITHUB-WEBHOOK', type: 'SYSTEM' }, { id: 'SYSTEM-HEARTBEAT', type: 'SYSTEM' },
  { id: 'SYSTEM-RECOVERY', type: 'SYSTEM' }, { id: 'SYSTEM-MERGE-EXECUTOR', type: 'SYSTEM' }, { id: 'SYSTEM-MERGE-CLASSIFIER', type: 'SYSTEM' },
];

export function tempDir(prefix = 'wf-') { return mkdtempSync(join(tmpdir(), prefix)); }

/** Harness with a controllable clock and a helper that fills in the command envelope. */
export function harness({ stateDir = tempDir(), fault = null, start = '2026-09-25T00:00:00Z', bootstrap = true } = {}) {
  const clock = { t: Date.parse(start) };
  const iso = () => new Date(clock.t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const cp = new ControlPlane({ stateDir, now: iso, fault });
  if (bootstrap) cp.bootstrapActors(ACTORS);
  let n = 0;
  const h = {
    cp, stateDir, clock, iso,
    advance(seconds) { clock.t += seconds * 1000; },
    envelope(actor, commandType, objectType, objectId, payload = {}, opts = {}) {
      n += 1;
      let expectedRevision = opts.expectedRevision;
      if (expectedRevision === undefined) {
        const obj = objectId === 'NEW' ? null : cp.store.get(objectType, objectId);
        expectedRevision = obj ? obj.revision : 0;
      }
      return {
        commandId: opts.commandId ?? `CMD-test-${process.pid}-${n}`, commandType, schemaVersion: '1.0', actor,
        target: { objectType, objectId }, expectedRevision, idempotencyKey: opts.idempotencyKey ?? `key-${process.pid}-${n}`,
        requestedAt: iso(), reason: opts.reason ?? `test ${commandType}`, payload,
      };
    },
    run(actor, commandType, objectType, objectId, payload, opts) {
      return cp.execute(h.envelope(actor, commandType, objectType, objectId, payload, opts));
    },
    ok(...args) {
      const r = h.run(...args);
      if (!r.ok) throw new Error(`${args[1]} failed: ${r.error.code} ${r.error.message} ${JSON.stringify(r.error.details)}`);
      return r;
    },
    get(type, id) { return cp.store.get(type, id); },
    agent(n, payload = {}) { return h.ok(M, 'AGENT_REGISTER', 'AgentState', `AGENT-${String(n).padStart(2, '0')}`, { capabilities: ['node'], ...payload }).objectId; },
    task(payload = {}) { return h.ok(M, 'TASK_CREATE', 'Task', 'NEW', { program: 'GOVERNANCE', title: 'test task', ...payload }).objectId; },
    /** Create + assign + ack + prepare + start. */
    working(agentN = 1, payload = {}) {
      const id = h.task(payload);
      if (!h.get('AgentState', W(agentN).id)) h.agent(agentN);
      h.ok(M, 'TASK_ASSIGN', 'Task', id, { agentId: W(agentN).id });
      for (const c of ['TASK_ACK', 'TASK_PREPARE', 'TASK_START']) h.ok(W(agentN), c, 'Task', id);
      return id;
    },
    evidence(actor, taskId, type, subject, { trust, verifyTrust, status = 'PASS' } = {}) {
      const id = h.ok(actor, 'EVIDENCE_PROPOSE', 'Evidence', 'NEW', { taskId, type, ...(trust ? { trustLevel: trust } : {}), subject, result: { status, summary: `${type} ${status}` } }).objectId;
      h.ok(M, 'EVIDENCE_PUBLISH', 'Evidence', id);
      if (verifyTrust !== null) h.ok(M, 'EVIDENCE_VERIFY', 'Evidence', id, { trustLevel: verifyTrust ?? 'REVIEW_VERIFIED' });
      return id;
    },
    /** DEC-0014: register a Slice (delivery unit) with acceptance criteria. Returns { id, key }. */
    slice(program = 'P7', n = 1, payload = {}) {
      const key = payload.key ?? `${program}-S${String(n).padStart(2, '0')}`;
      const id = h.ok(M, 'SLICE_CREATE', 'Slice', 'NEW', { program, key, title: `slice ${key}`, acceptance: { criteria: [{ id: 'AC-1', text: 'feature works end to end' }] }, ...payload }).objectId;
      return { id, key };
    },
    sliceEvidence(sliceId, type, subject, { trust, verifyTrust = 'REVIEW_VERIFIED', status = 'PASS', actor = M } = {}) {
      const id = h.ok(actor, 'EVIDENCE_PROPOSE', 'Evidence', 'NEW', { sliceId, type, ...(trust ? { trustLevel: trust } : {}), subject, result: { status, summary: `${type} ${status}` } }).objectId;
      h.ok(M, 'EVIDENCE_PUBLISH', 'Evidence', id);
      if (verifyTrust !== null) h.ok(M, 'EVIDENCE_VERIFY', 'Evidence', id, { trustLevel: verifyTrust });
      return id;
    },
    /** Admit the single Slice delivery PR (all tasks READY_FOR_REVIEW) and bring it to READY. */
    readySliceDelivery(sliceId, head = SHA('c'), pr = 30) {
      h.sliceEvidence(sliceId, 'COMMIT', { subjectType: 'COMMIT', subjectId: head });
      h.sliceEvidence(sliceId, 'CI', { subjectType: 'PR_HEAD', subjectId: head, prNumber: pr }, { trust: 'CI_VERIFIED', verifyTrust: 'CI_VERIFIED', actor: SYS('SYSTEM-CI') });
      const mq = h.ok(M, 'MQ_ADMIT', 'MergeQueueItem', 'NEW', { sliceId, pr: { repository: 'Catzpro01/n8n-rust-v.4', number: pr, base: 'main', headSha: head } }).objectId;
      h.ok(SYS('SYSTEM-CI'), 'MQ_UPDATE_CHECKS', 'MergeQueueItem', mq, { headSha: head, checks: { exactHeadCi: 'PASS', architecture: 'PASS', acceptance: 'PASS' } });
      h.ok(M, 'MQ_CLASSIFY', 'MergeQueueItem', mq);
      return mq;
    },
    /** Merge the Slice delivery PR and record fresh-main verification (the Slice is then VERIFYING). */
    mergeSliceDelivery(sliceId, mq, head = SHA('c'), main = SHA('d')) {
      h.ok(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: head });
      h.ok(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_START', 'MergeQueueItem', mq, { observedHeadSha: head });
      h.ok(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_RESULT', 'MergeQueueItem', mq, { mergedHeadSha: head, mergeSha: main });
      h.sliceEvidence(sliceId, 'COMMIT', { subjectType: 'COMMIT', subjectId: main });
      h.sliceEvidence(sliceId, 'MAIN_VERIFICATION', { subjectType: 'MAIN', subjectId: main }, { trust: 'MAIN_VERIFIED', verifyTrust: 'MAIN_VERIFIED' });
      h.ok(M, 'MQ_VERIFY', 'MergeQueueItem', mq);
    },
    /** Bring a working task to a READY merge-queue item on `head`. */
    readyForMerge(taskId, agentN = 1, head = SHA('a'), mqExtra = {}) {
      h.ok(W(agentN), 'TASK_READY_FOR_REVIEW', 'Task', taskId, { headSha: head, prNumber: 7 });
      h.evidence(W(agentN), taskId, 'COMMIT', { subjectType: 'COMMIT', subjectId: head });
      h.evidence(SYS('SYSTEM-CI'), taskId, 'CI', { subjectType: 'PR_HEAD', subjectId: head, prNumber: 7 }, { trust: 'CI_VERIFIED' });
      const mq = h.ok(W(agentN), 'MQ_ADMIT', 'MergeQueueItem', 'NEW', { taskId, pr: { repository: 'Catzpro01/n8n-rust-v.4', number: 7, base: 'main', headSha: head }, ...mqExtra }).objectId;
      h.ok(SYS('SYSTEM-CI'), 'MQ_UPDATE_CHECKS', 'MergeQueueItem', mq, { headSha: head, checks: { exactHeadCi: 'PASS', architecture: 'PASS', acceptance: 'PASS' } });
      h.ok(M, 'MQ_CLASSIFY', 'MergeQueueItem', mq);
      return mq;
    },
    /** Full merge + fresh-main verification + completion. */
    mergeAndVerify(taskId, mq, head = SHA('a'), main = SHA('b')) {
      h.ok(M, 'MQ_AUTHORIZE', 'MergeQueueItem', mq, { observedHeadSha: head });
      h.ok(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_START', 'MergeQueueItem', mq, { observedHeadSha: head });
      h.ok(SYS('SYSTEM-MERGE-EXECUTOR'), 'MQ_MERGE_RESULT', 'MergeQueueItem', mq, { mergedHeadSha: head, mergeSha: main });
      h.evidence(M, taskId, 'MAIN_VERIFICATION', { subjectType: 'MAIN', subjectId: main }, { trust: 'MAIN_VERIFIED', verifyTrust: 'MAIN_VERIFIED' });
      h.ok(M, 'MQ_VERIFY', 'MergeQueueItem', mq);
      return h.ok(M, 'TASK_COMPLETE', 'Task', taskId);
    },
  };
  return h;
}

export function expectError(assert, result, code) {
  assert.equal(result.ok, false, `expected ${code}, got success`);
  assert.equal(result.error.code, code, `expected ${code}, got ${result.error.code}: ${result.error.message}`);
  return result;
}
