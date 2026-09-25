// DEC-0018 pipeline mode on real git repos: task pool → next → result → next →
// result → queue → batch integration → merge → complete → cross-agent unlock,
// plus rework, reassignment, agent-side guards and the AGENT-01 exception.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assign as legacyAssign, parseTask, readTaskAt, serializeTask } from '../src/git-tasks.mjs';
import {
  block, lintPool, next, poolAssign, poolComplete, poolInit, poolIntegrate, poolOverview, poolReassign, poolRework, queue, readPool,
  result, writeQueueIndex, POOL_STATUSES,
} from '../src/git-pool.mjs';
import { main as cli } from '../src/tasks-cli.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const M = { name: 'arena-manager', email: 'arena-manager@arena.local' };
const T0 = '2026-09-25T00:00:00Z';

function sh(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function world() {
  const root = mkdtempSync(join(tmpdir(), 'git-pool-'));
  const origin = join(root, 'origin.git');
  sh(root, 'init', '--quiet', '--bare', origin);
  const seed = join(root, 'seed');
  sh(root, 'clone', '--quiet', origin, seed);
  mkdirSync(join(seed, '.arena'), { recursive: true });
  for (const f of ['RULES.md', 'AGENT_RULES.md', 'MANAGER_RULES.md', 'WORKFLOW.md']) cpSync(join(REPO_ROOT, '.arena', f), join(seed, '.arena', f));
  mkdirSync(join(seed, 'src'));
  writeFileSync(join(seed, 'src', 'base.txt'), 'base\n');
  sh(seed, 'add', '-A'); sh(seed, 'commit', '--quiet', '-m', 'seed'); sh(seed, 'push', '--quiet', 'origin', 'HEAD:main');
  sh(seed, 'push', '--quiet', 'origin', 'HEAD:refs/heads/arena-manager');
  const manager = join(root, 'manager');
  sh(root, 'clone', '--quiet', origin, manager);
  return { root, origin, manager, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const draft = (id, extra = {}) => ({ fields: { id, title: `do ${id}`, slice: id.split('-').slice(0, 2).join('-'), status: 'READY', depends_on: [], scope: ['src/**'], tests: ['true'], acceptance: ['works'], ...extra }, body: `\n${id} context\n` });
const clone = (w, n) => { const d = join(w.root, `a${n}-${Math.random().toString(36).slice(2, 7)}`); sh(w.root, 'clone', '--quiet', '--branch', `arena/agent-${n}`, w.origin, d); return d; };
const fetchAll = (w) => sh(w.manager, 'fetch', '--quiet', 'origin', '+refs/heads/*:refs/remotes/origin/*');
const AG = { name: 'agent', email: 'agent@arena.local' };
function work(dir, id, file, text) {
  writeFileSync(join(dir, 'src', file), text);
  mkdirSync(join(dir, '.arena/evidence'), { recursive: true });
  writeFileSync(join(dir, `.arena/evidence/${id}.md`), `# ${id} evidence\n\nCommit: see result\nTests:\n- true → 1/1 (observed)\n`);
  sh(dir, 'add', '-A'); sh(dir, 'commit', '--quiet', '-m', `${id}: work`);
}
const statusOf = (w, agent, id) => readPool({ cwd: w.manager, ref: `origin/arena/agent-${agent.slice(-2)}` }).tasks.find((x) => x.task.fields.id === id).task.fields.status;

test('status vocabulary for pipeline pools', () => {
  assert.deepEqual(POOL_STATUSES, ['UNASSIGNED', 'ASSIGNED', 'READY', 'WORKING', 'BLOCKED', 'READY_FOR_REVIEW', 'COMPLETED']);
});

test('pilot: pool → Task A → Result A → Task B → Result B (no Manager in between) → queue → ONE Slice batch → merge → complete → cross-agent unlock', () => {
  const w = world();
  try {
    const m = w.manager;
    const o = { cwd: m, identity: M, push: true, now: T0 };
    // AGENT-01 keeps the DEC-0017 single-task model and is never touched by pipeline commands.
    legacyAssign({ ...o, agent: 'AGENT-01', task: { fields: { ...draft('TASK-0018').fields, slice: 'GOVERNANCE', status: 'ASSIGNED' }, body: '' } });
    const a1Before = sh(m, 'rev-parse', 'origin/arena/agent-01');
    assert.throws(() => poolInit({ ...o, agent: 'AGENT-01' }), /PIPELINE_EXCLUDED/);

    poolInit({ ...o, agent: 'AGENT-02' });
    poolInit({ ...o, agent: 'AGENT-03' });
    assert.equal(poolInit({ ...o, agent: 'AGENT-02' }).changed, false, 'idempotent');
    // The Manager fills the pools ahead of time: A ready, B waits on A (same agent), C waits on A (other agent).
    assert.equal(poolAssign({ ...o, agent: 'AGENT-02', task: draft('P5-M08-01', { order: '1' }) }).changed, true);
    poolAssign({ ...o, agent: 'AGENT-02', task: draft('P5-M08-02', { order: '2', depends_on: ['P5-M08-01'] }) });
    poolAssign({ ...o, agent: 'AGENT-03', task: draft('P5-M08-03', { depends_on: ['P5-M08-01'] }) });
    poolAssign({ ...o, agent: 'AGENT-03', task: draft('P5-M08-04') });
    assert.deepEqual([statusOf(w, 'AGENT-02', 'P5-M08-01'), statusOf(w, 'AGENT-02', 'P5-M08-02'), statusOf(w, 'AGENT-03', 'P5-M08-03')], ['READY', 'ASSIGNED', 'ASSIGNED']);
    assert.throws(() => poolAssign({ ...o, agent: 'AGENT-04', task: draft('P5-M08-01') }), /TASK_HELD/);
    assert.throws(() => poolAssign({ ...o, agent: 'AGENT-02', task: draft('P5-M08-01') }), /DUPLICATE/);

    // AGENT-02 works through its pool without asking the Manager.
    const g2 = clone(w, '02');
    const s1 = next({ cwd: g2, identity: AG, push: true, now: T0 });
    assert.equal(s1.started, 'P5-M08-01');
    assert.deepEqual(lintPool({ cwd: g2 }), []);
    assert.throws(() => next({ cwd: g2, identity: AG }), /BUSY/);
    work(g2, 'P5-M08-01', 'a.txt', 'A\n');
    assert.throws(() => result({ cwd: g2, identity: AG }), /SUMMARY_REQUIRED/);
    const r1 = result({ cwd: g2, summary: 'did A', identity: AG, push: true, now: T0 });
    assert.equal(r1.ranges.length, 1);
    const s2 = next({ cwd: g2, identity: AG, push: true, now: T0 });
    assert.equal(s2.started, 'P5-M08-02', 'B unlocks from A delivered on the same branch');
    work(g2, 'P5-M08-02', 'b.txt', 'B\n');
    result({ cwd: g2, summary: 'did B', identity: AG, push: true, now: T0 });
    assert.equal(next({ cwd: g2, identity: AG, push: true }).idle, true);

    // AGENT-03 works in parallel; C must wait for A to be COMPLETED (different agent).
    const g3 = clone(w, '03');
    const s3 = next({ cwd: g3, identity: AG, push: true, now: T0 });
    assert.equal(s3.started, 'P5-M08-04');
    assert.deepEqual(s3.waiting, [{ id: 'P5-M08-03', waitsOn: ['P5-M08-01'] }]);
    fetchAll(w);
    const ov = poolOverview({ cwd: m });
    assert.deepEqual(ov.agents.map((x) => [x.agent, x.current.status]), [['AGENT-02', 'IDLE'], ['AGENT-03', 'WORKING']]);

    // Result pool → integration queue.
    let q = queue({ cwd: m });
    assert.deepEqual(q.slices['P5-M08'].ready.map((r) => [r.task, r.result]), [['P5-M08-01', 'RESULT-P5-M08-01.md'], ['P5-M08-02', 'RESULT-P5-M08-02.md']]);
    assert.deepEqual(q.slices['P5-M08'].waiting.map((r) => r.task).sort(), ['P5-M08-03', 'P5-M08-04']);
    const idx = writeQueueIndex({ ...o });
    assert.ok(idx.changed);
    assert.match(sh(m, 'show', 'origin/arena-manager:.arena/integration/QUEUE.md'), /RESULT-P5-M08-01\.md/);

    // Rework B: the task returns READY with a note; the agent picks rework first; the result keeps both ranges.
    poolRework({ ...o, agent: 'AGENT-02', id: 'P5-M08-02', note: 'B needs a second line' });
    sh(g2, 'pull', '--quiet', '--no-rebase');
    assert.equal(next({ cwd: g2, identity: AG, push: true }).rework, true);
    writeFileSync(join(g2, 'src', 'b.txt'), 'B\nsecond\n');
    sh(g2, 'commit', '--quiet', '-am', 'B rework');
    const rb = result({ cwd: g2, summary: 'did B again', identity: AG, push: true });
    assert.equal(rb.ranges.length, 2);
    fetchAll(w);

    // ONE Slice branch from several results; pool files never reach it.
    const it = poolIntegrate({ ...o, slice: 'P5-M08' });
    assert.deepEqual(it.applied, ['P5-M08-01', 'P5-M08-02']);
    const files = sh(m, 'ls-tree', '-r', '--name-only', 'origin/arena/manager/P5-M08').split('\n');
    for (const f of ['src/a.txt', 'src/b.txt', '.arena/evidence/P5-M08-01.md', '.arena/evidence/P5-M08-02.md']) assert.ok(files.includes(f), f);
    assert.ok(!files.some((f) => /task-pool|result-pool|current-task|progress\.md/.test(f)));
    assert.equal(sh(m, 'show', 'origin/arena/manager/P5-M08:src/b.txt'), 'B\nsecond');
    assert.equal(poolIntegrate({ ...o, slice: 'P5-M08' }).applied.length, 0, 'idempotent');
    // Rework after integration: only the new range is applied on top.
    poolRework({ ...o, agent: 'AGENT-02', id: 'P5-M08-02', note: 'third line' });
    sh(g2, 'pull', '--quiet', '--no-rebase');
    next({ cwd: g2, identity: AG, push: true });
    writeFileSync(join(g2, 'src', 'b.txt'), 'B\nsecond\nthird\n');
    sh(g2, 'commit', '--quiet', '-am', 'B rework 2');
    result({ cwd: g2, summary: 'did B a third time', identity: AG, push: true });
    fetchAll(w);
    assert.deepEqual(poolIntegrate({ ...o, slice: 'P5-M08' }).applied, ['P5-M08-02']);
    assert.equal(sh(m, 'show', 'origin/arena/manager/P5-M08:src/b.txt'), 'B\nsecond\nthird');

    // Merge the Slice PR (simulated), complete, and the cross-agent dependency unlocks.
    sh(m, 'checkout', '--quiet', '-B', 'main', 'origin/main');
    sh(m, 'merge', '--quiet', '--no-ff', '-m', 'Merge Slice P5-M08 (batch)', 'origin/arena/manager/P5-M08');
    sh(m, 'push', '--quiet', 'origin', 'main');
    fetchAll(w);
    const mergeSha = sh(m, 'rev-parse', 'origin/main');
    poolComplete({ ...o, agent: 'AGENT-02', id: 'P5-M08-01', mergeSha });
    poolComplete({ ...o, agent: 'AGENT-02', id: 'P5-M08-02', mergeSha });
    assert.equal(statusOf(w, 'AGENT-02', 'P5-M08-01'), 'COMPLETED');
    q = queue({ cwd: m });
    assert.equal(q.slices['P5-M08'].completed.length, 2);

    work(g3, 'P5-M08-04', 'd.txt', 'D\n');
    result({ cwd: g3, summary: 'did D', identity: AG, push: true });
    sh(g3, 'fetch', '--quiet', 'origin');
    const s4 = next({ cwd: g3, identity: AG, push: true });
    assert.equal(s4.started, 'P5-M08-03', 'C unlocks once A is merged to main');
    assert.equal(readFileSync(join(g3, 'src', 'a.txt'), 'utf8'), 'A\n', 'next brought main into the branch');

    fetchAll(w);
    assert.equal(sh(m, 'rev-parse', 'origin/arena/agent-01'), a1Before, 'AGENT-01 branch untouched');
    assert.equal(readTaskAt(m, 'origin/arena/agent-01').fields.id, 'TASK-0018');
  } finally { w.cleanup(); }
});

test('reassignment keeps history (previous_owner, new_owner, reason, timestamp) and carries in-progress work', () => {
  const w = world();
  try {
    const m = w.manager;
    const o = { cwd: m, identity: M, push: true, now: T0 };
    poolInit({ ...o, agent: 'AGENT-05' });
    poolInit({ ...o, agent: 'AGENT-07' });
    poolAssign({ ...o, agent: 'AGENT-05', task: draft('P6-S01-01') });
    const g5 = clone(w, '05');
    next({ cwd: g5, identity: AG, push: true });
    writeFileSync(join(g5, 'src', 'half.txt'), 'half\n');
    sh(g5, 'add', '-A'); sh(g5, 'commit', '--quiet', '-m', 'half'); sh(g5, 'push', '--quiet');
    fetchAll(w);
    assert.throws(() => poolReassign({ ...o, from: 'AGENT-05', to: 'AGENT-07', id: 'P6-S01-01' }), /REASON_REQUIRED/);
    const r = poolReassign({ ...o, from: 'AGENT-05', to: 'AGENT-07', id: 'P6-S01-01', reason: 'stale 48h', now: '2026-09-27T00:00:00Z' });
    assert.equal(r.carriedRanges, 1);
    const old = readPool({ cwd: m, ref: 'origin/arena/agent-05' });
    const ot = old.tasks[0].task.fields;
    assert.deepEqual([ot.status, ot.reassigned_to, ot.reason, ot.reassigned_at, old.current.fields.status], ['UNASSIGNED', 'AGENT-07', 'stale 48h', '2026-09-27T00:00:00Z', 'IDLE']);
    const nt = readPool({ cwd: m, ref: 'origin/arena/agent-07' }).tasks[0].task.fields;
    assert.deepEqual([nt.status, nt.owner, nt.previous_owner, nt.reason, nt.reassigned_at], ['READY', 'AGENT-07', 'AGENT-05', 'stale 48h', '2026-09-27T00:00:00Z']);
    assert.equal(sh(m, 'show', 'origin/arena/agent-07:src/half.txt'), 'half', 'work carried');
    assert.match(sh(m, 'log', '--format=%s', 'origin/arena/agent-05'), /half/, 'old branch keeps its history');
    // The old owner can no longer pick it up; the new owner can.
    sh(g5, 'pull', '--quiet', '--no-rebase');
    assert.equal(next({ cwd: g5, identity: AG }).idle, true);
    assert.equal(next({ cwd: clone(w, '07'), identity: AG }).started, 'P6-S01-01');
  } finally { w.cleanup(); }
});

test('agent-side guards: no self-assigned tasks, no Manager fields, no skipping dependencies, blocked needs a reason, results need committed work', () => {
  const w = world();
  try {
    const m = w.manager;
    const o = { cwd: m, identity: M, push: true, now: T0 };
    poolInit({ ...o, agent: 'AGENT-04' });
    poolAssign({ ...o, agent: 'AGENT-04', task: draft('P9-S01-01') });
    poolAssign({ ...o, agent: 'AGENT-04', task: draft('P9-S01-02', { depends_on: ['P9-S01-01'] }) });
    const g = clone(w, '04');
    // Self-assigning a task is refused.
    const extra = draft('P9-S01-09');
    Object.assign(extra.fields, { owner: 'AGENT-04', branch: 'arena/agent-04', assigned_by: 'MANAGER', assigned_at: T0 });
    writeFileSync(join(g, '.arena/task-pool/P9-S01-09.md'), serializeTask(extra));
    assert.match(lintPool({ cwd: g }).join(), /only the Manager adds tasks/);
    rmSync(join(g, '.arena/task-pool/P9-S01-09.md'));
    // Starting a task whose dependency is not delivered is refused.
    const p = join(g, '.arena/task-pool/P9-S01-02.md');
    const t = parseTask(readFileSync(p, 'utf8'));
    t.fields.status = 'WORKING';
    writeFileSync(p, serializeTask(t));
    assert.match(lintPool({ cwd: g }).join(), /started before its dependencies|current-task/);
    sh(g, 'checkout', '--quiet', '--', '.');
    // Changing scope is a Manager field.
    const t1p = join(g, '.arena/task-pool/P9-S01-01.md');
    const t1 = parseTask(readFileSync(t1p, 'utf8'));
    t1.fields.scope = ['**'];
    writeFileSync(t1p, serializeTask(t1));
    assert.match(lintPool({ cwd: g }).join(), /may not change scope/);
    sh(g, 'checkout', '--quiet', '--', '.');

    next({ cwd: g, identity: AG, push: true });
    assert.throws(() => block({ cwd: g, identity: AG }), /REASON_REQUIRED/);
    block({ cwd: g, reason: 'waiting for a decision', identity: AG });
    assert.deepEqual(lintPool({ cwd: g }), []);
    assert.throws(() => result({ cwd: g, summary: 'x', identity: AG }), /NOT_WORKING/);
    block({ cwd: g, unblock: true, identity: AG });
    assert.throws(() => result({ cwd: g, summary: 'x', identity: AG }), /NO_EVIDENCE/);
    mkdirSync(join(g, '.arena/evidence'), { recursive: true });
    writeFileSync(join(g, '.arena/evidence/P9-S01-01.md'), 'Commit: x\nTests:\n- t\n');
    assert.throws(() => result({ cwd: g, summary: 'x', identity: AG }), /DIRTY/);
    sh(g, 'add', '-A'); sh(g, 'commit', '--quiet', '-m', 'evidence only');
    // Evidence alone is a change; a result needs at least one committed file.
    assert.equal(result({ cwd: g, summary: 'x', identity: AG }).delivered, 'P9-S01-01');
    assert.deepEqual(lintPool({ cwd: g }), []);
  } finally { w.cleanup(); }
});

test('CLI: pool commands route by branch mode; AGENT-01 stays legacy', () => {
  const w = world();
  try {
    const m = w.manager;
    const out = [];
    const io = { out: (x) => out.push(x), err: (x) => out.push(x) };
    assert.equal(cli(['pool-init', '--agent', 'AGENT-02', '--push'], io, m), 0);
    assert.equal(cli(['pool-init', '--agent', 'AGENT-01', '--push'], io, m), 1);
    assert.match(out.join(''), /PIPELINE_EXCLUDED/);
    const d = join(w.root, 'draft.md');
    writeFileSync(d, serializeTask(draft('P5-M08-05')));
    assert.equal(cli(['assign', '--agent', 'AGENT-02', '--task', d, '--push'], io, m), 0);
    assert.equal(cli(['status'], io, m), 0);
    assert.match(out.join(''), /PIPELINE \(DEC-0018\)[\s\S]*AGENT-02 +IDLE +ready 1/);
    assert.equal(cli(['queue'], io, m), 0);
    assert.match(out.join(''), /P5-M08 +\(ready 0 \/ waiting 1/);
    const g = clone(w, '02');
    assert.equal(cli(['next'], io, g), 0);
    assert.match(out.join(''), /STARTED P5-M08-05/);
    assert.equal(cli(['lint'], io, g), 0);
    assert.match(out.join(''), /OK pipeline workspace/);
  } finally { w.cleanup(); }
});
