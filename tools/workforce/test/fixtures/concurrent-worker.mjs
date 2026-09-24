// Child process used by crash-concurrency.test.mjs to race commands against one store.
import { ControlPlane } from '../../src/engine.mjs';

const [stateDir, mode, ...rest] = process.argv.slice(2);
const cp = new ControlPlane({ stateDir, now: () => '2026-09-25T00:00:00Z' });
const env = (commandType, objectType, objectId, expectedRevision, payload, key) => ({
  commandId: `CMD-proc-${process.pid}-${key}`, commandType, schemaVersion: '1.0', actor: { type: 'MANAGER', id: 'MANAGER-01' },
  target: { objectType, objectId }, expectedRevision, idempotencyKey: `proc-${process.pid}-${key}`, requestedAt: '2026-09-25T00:00:00Z', reason: 'race', payload,
});

if (mode === 'assign') {
  const [taskId, agentId, rev] = rest;
  process.stdout.write(JSON.stringify(cp.execute(env('TASK_ASSIGN', 'Task', taskId, Number(rev), { agentId }, 'assign'))));
} else if (mode === 'create') {
  const [worker, count] = rest;
  const out = [];
  for (let i = 0; i < Number(count); i += 1) {
    const r = cp.execute(env('TASK_CREATE', 'Task', 'NEW', 0, { program: 'GOVERNANCE', title: `w${worker}-${i}` }, `c${i}`));
    if (!r.ok) { process.stderr.write(JSON.stringify(r)); process.exit(1); }
    out.push({ objectId: r.objectId });
  }
  process.stdout.write(JSON.stringify(out));
}
