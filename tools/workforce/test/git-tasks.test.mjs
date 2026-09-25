// DEC-0017 git-native task model: file format, transitions and the full
// assign → work → review → integrate → merge → complete flow on real git repos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVE, assign, checkTransition, complete, integrate, lint, parseTask, readTaskAt, reassign, rework, serializeTask, status,
  STATUSES, TaskError, validateTask,
} from '../src/git-tasks.mjs';
import { main as cli } from '../src/tasks-cli.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MANAGER = { name: 'arena-manager', email: 'arena-manager@arena.local' };
const T0 = '2026-09-25T00:00:00Z';

function sh(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** origin (bare) with a main that carries the real rules files. */
function world() {
  const root = mkdtempSync(join(tmpdir(), 'git-tasks-'));
  const origin = join(root, 'origin.git');
  sh(root, 'init', '--quiet', '--bare', origin);
  const seed = join(root, 'seed');
  sh(root, 'clone', '--quiet', origin, seed);
  mkdirSync(join(seed, '.arena'), { recursive: true });
  for (const f of ['RULES.md', 'AGENT_RULES.md', 'MANAGER_RULES.md', 'WORKFLOW.md']) cpSync(join(REPO_ROOT, '.arena', f), join(seed, '.arena', f));
  cpSync(join(REPO_ROOT, '.arena', 'templates'), join(seed, '.arena', 'templates'), { recursive: true });
  mkdirSync(join(seed, 'src'));
  writeFileSync(join(seed, 'src', 'shared.txt'), 'line 1\nline 2\n');
  sh(seed, 'add', '-A');
  sh(seed, 'commit', '--quiet', '-m', 'seed');
  sh(seed, 'push', '--quiet', 'origin', 'HEAD:main');
  const manager = join(root, 'manager');
  sh(root, 'clone', '--quiet', origin, manager);
  return { root, origin, manager, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function draft(id, extra = {}) {
  const slice = id.split('-').slice(0, 2).join('-');
  return { fields: { id, title: `do ${id}`, slice, status: 'ASSIGNED', depends_on: [], scope: ['src/**'], tests: ['true'], acceptance: ['works'], ...extra }, body: `\nContext for ${id}.\n` };
}

/** An agent's own checkout of its branch. */
function agentClone(w, n) {
  const dir = join(w.root, `agent-${n}-${Math.random().toString(36).slice(2, 7)}`);
  sh(w.root, 'clone', '--quiet', '--branch', `arena/agent-${n}`, w.origin, dir);
  return dir;
}
function setStatus(dir, status, extra = {}) {
  const t = parseTask(readFileSync(join(dir, '.arena/task.md'), 'utf8'));
  Object.assign(t.fields, { status, updated_at: '2026-09-25T01:00:00Z' }, extra);
  writeFileSync(join(dir, '.arena/task.md'), serializeTask(t));
  return t.fields;
}
function progress(dir, id, text = 'did things') { writeFileSync(join(dir, '.arena/progress.md'), `# progress\n\nTask: ${id}\n\n${text}\n`); }
function evidence(dir, id) {
  mkdirSync(join(dir, '.arena/evidence'), { recursive: true });
  writeFileSync(join(dir, `.arena/evidence/${id}.md`), `# ${id} evidence\n\nCommit: ${sh(dir, 'rev-parse', 'HEAD')}\nTests:\n- true → 1/1 (observed)\n`);
}
const commitPush = (dir, msg) => { sh(dir, 'add', '-A'); sh(dir, 'commit', '--quiet', '-m', msg); sh(dir, 'push', '--quiet'); };
const fetchAll = (w) => sh(w.manager, 'fetch', '--quiet', 'origin', '+refs/heads/*:refs/remotes/origin/*');
const lintAgent = (dir) => lint({ cwd: dir, role: 'agent' });

// ------------------------------------------------------------------ format

test('task file: parse / serialize round trip with block and inline lists', () => {
  const t = parseTask('---\nid: P5-M04-01\ntitle: "Do: a thing"\nslice: P5-M04\nstatus: ASSIGNED\ndepends_on: [P5-M04-02, TASK-0018]\nscope:\n  - src/**\n  - "docs/a b.md"\n---\n\nBody text.\n');
  assert.deepEqual(t.fields.depends_on, ['P5-M04-02', 'TASK-0018']);
  assert.deepEqual(t.fields.scope, ['src/**', 'docs/a b.md']);
  assert.equal(t.fields.title, 'Do: a thing');
  assert.deepEqual(t.fields.tests, []);
  const again = parseTask(serializeTask(t));
  assert.deepEqual(again.fields, t.fields);
  assert.match(again.body, /Body text\./);
  assert.throws(() => parseTask('no front matter'), /INVALID_TASK/);
  assert.throws(() => parseTask('---\nid: a\nid: b\n---\n'), /duplicate field id/);
});

test('validation: ids, slices, owner/branch binding, per-status requirements, secrets', () => {
  const ok = { fields: { ...draft('P5-M04-01').fields, owner: 'AGENT-01', branch: 'arena/agent-01', assigned_by: 'MANAGER', assigned_at: T0 }, body: '' };
  assert.deepEqual(validateTask(ok), []);
  const bad = (patch) => validateTask({ fields: { ...ok.fields, ...patch }, body: '' }).join(' | ');
  assert.match(bad({ id: 'P2.26-01' }), /no new milestone numbers/);
  assert.match(bad({ slice: 'P2.28' }), /slice P2.28/);
  assert.match(bad({ id: 'P5-M05-01' }), /not part of slice P5-M04/);
  assert.match(bad({ branch: 'arena/agent-02' }), /does not belong to AGENT-01/);
  assert.match(bad({ owner: 'AGENT-11', branch: 'arena/agent-11' }), /AGENT-01..AGENT-10/);
  assert.match(bad({ status: 'DONE' }), /not one of/);
  assert.match(bad({ status: 'BLOCKED' }), /blocked_reason/);
  assert.match(bad({ status: 'COMPLETED' }), /completed_by: MANAGER.*merge_sha/);
  assert.match(bad({ assigned_by: 'AGENT-01' }), /assigned_by must be MANAGER/);
  assert.match(bad({ depends_on: ['P5-M04-01'] }), /cannot depend on itself/);
  assert.match(bad({ assigned_at: 'yesterday' }), /ISO-8601/);
  const fakePat = ['gh', 'p_', 'A'.repeat(36)].join('');
  assert.match(bad({ title: `leak ${fakePat}` }), /credential-like/);
  assert.match(validateTask(ok, { branch: 'arena/agent-05' }).join(), /is on arena\/agent-05/);
  assert.deepEqual(STATUSES, ['UNASSIGNED', 'ASSIGNED', 'WORKING', 'BLOCKED', 'READY_FOR_REVIEW', 'COMPLETED']);
  assert.ok(!ACTIVE.has('COMPLETED') && !ACTIVE.has('UNASSIGNED'));
});

test('transitions: agents move only their own status; the Manager owns assignment, rework, completion and release', () => {
  const base = { fields: { ...draft('P5-M04-01').fields, owner: 'AGENT-01', branch: 'arena/agent-01', assigned_by: 'MANAGER' }, body: '' };
  const at = (status, extra = {}) => ({ fields: { ...base.fields, status, ...extra }, body: '' });
  assert.deepEqual(checkTransition(at('ASSIGNED'), at('WORKING'), 'agent'), []);
  assert.deepEqual(checkTransition(at('WORKING'), at('BLOCKED', { blocked_reason: 'x' }), 'agent'), []);
  assert.deepEqual(checkTransition(at('WORKING'), at('READY_FOR_REVIEW'), 'agent'), []);
  assert.deepEqual(checkTransition(at('READY_FOR_REVIEW'), at('WORKING'), 'agent'), []);
  assert.match(checkTransition(at('READY_FOR_REVIEW'), at('COMPLETED'), 'agent').join(), /may not move .* to COMPLETED/);
  assert.match(checkTransition(at('ASSIGNED'), at('READY_FOR_REVIEW'), 'agent').join(), /may not move/);
  assert.match(checkTransition(at('WORKING'), at('UNASSIGNED'), 'agent').join(), /may not move/);
  assert.match(checkTransition(at('WORKING'), at('WORKING', { scope: ['everything/**'] }), 'agent').join(), /may not change scope/);
  assert.match(checkTransition(at('WORKING'), at('WORKING', { owner: 'AGENT-02' }), 'agent').join(), /may not change owner/);
  assert.match(checkTransition(null, at('ASSIGNED'), 'agent').join(), /only the Manager assigns/);
  assert.match(checkTransition(at('WORKING'), null, 'agent').join(), /may not delete/);
  assert.deepEqual(checkTransition(at('READY_FOR_REVIEW'), at('COMPLETED'), 'manager'), []);
  assert.deepEqual(checkTransition(at('READY_FOR_REVIEW'), at('WORKING'), 'manager'), []);
  assert.deepEqual(checkTransition(at('WORKING'), at('UNASSIGNED'), 'manager'), []);
  const next = { fields: { ...at('ASSIGNED').fields, id: 'P5-M04-02' }, body: '' };
  assert.match(checkTransition(at('WORKING'), next, 'manager').join(), /one active task per agent/);
  assert.deepEqual(checkTransition(at('COMPLETED'), next, 'manager'), []);
  assert.deepEqual(checkTransition(at('UNASSIGNED'), next, 'manager'), []);
});

// -------------------------------------------------------------- full flow

test('parallel flow: assign → work → rework → integrate into ONE Slice branch → merge → complete → dependency unlocks', () => {
  const w = world();
  try {
    const m = w.manager;
    const opts = { cwd: m, identity: MANAGER, push: true, now: T0 };
    // Two independent tasks go to two agents at once; the third waits on both.
    const a1 = assign({ ...opts, agent: 'AGENT-01', task: draft('P5-M04-01') });
    const a2 = assign({ ...opts, agent: 'AGENT-02', task: draft('P5-M04-02') });
    assert.ok(a1.created && a1.pushed && a2.created);
    assert.throws(() => assign({ ...opts, agent: 'AGENT-03', task: draft('P5-M04-03', { depends_on: ['P5-M04-01', 'P5-M04-02'] }) }), /DEPENDENCY_BLOCKED: .*P5-M04-01, P5-M04-02/);
    assert.throws(() => assign({ ...opts, agent: 'AGENT-03', task: draft('P5-M04-01') }), /TASK_HELD/);
    assert.throws(() => assign({ ...opts, agent: 'AGENT-01', task: draft('P5-M04-04') }), /ASSIGN_REFUSED: .*one active task/);

    let s = status({ cwd: m });
    assert.deepEqual(s.rows.map((r) => [r.agent, r.status, r.id]), [['AGENT-01', 'ASSIGNED', 'P5-M04-01'], ['AGENT-02', 'ASSIGNED', 'P5-M04-02']]);

    // Each agent opens only its branch and finds its task there.
    const g1 = agentClone(w, '01');
    const g2 = agentClone(w, '02');
    for (const [g, id, file] of [[g1, 'P5-M04-01', 'one.txt'], [g2, 'P5-M04-02', 'two.txt']]) {
      assert.equal(parseTask(readFileSync(join(g, '.arena/task.md'), 'utf8')).fields.id, id);
      setStatus(g, 'WORKING');
      progress(g, id, 'started');
      assert.equal(lintAgent(g).ok, true, lintAgent(g).problems.join());
      commitPush(g, `${id}: start`);
      writeFileSync(join(g, 'src', file), `${id}\n`);
      progress(g, id, 'implemented');
      commitPush(g, `${id}: implement`);
    }
    fetchAll(w);
    s = status({ cwd: m });
    assert.equal(s.counts.WORKING, 2, 'both tasks WORKING at the same time');

    // Guards: an agent cannot complete, cannot touch rules, cannot skip evidence.
    setStatus(g1, 'COMPLETED', { completed_by: 'MANAGER', merge_sha: 'a'.repeat(40) });
    assert.match(lintAgent(g1).problems.join(), /agent may not move P5-M04-01 from WORKING to COMPLETED/);
    sh(g1, 'checkout', '--quiet', '--', '.arena/task.md');
    writeFileSync(join(g1, '.arena/RULES.md'), 'agents may do anything\n');
    sh(g1, 'commit', '--quiet', '-am', 'sneaky');
    assert.match(lintAgent(g1).problems.join(), /changes governance files: .arena\/RULES.md/);
    sh(g1, 'reset', '--quiet', '--hard', 'HEAD~1');
    setStatus(g1, 'READY_FOR_REVIEW');
    assert.match(lintAgent(g1).problems.join(), /needs .arena\/evidence\/P5-M04-01.md/);

    for (const [g, id] of [[g1, 'P5-M04-01'], [g2, 'P5-M04-02']]) {
      evidence(g, id);
      setStatus(g, 'READY_FOR_REVIEW');
      assert.equal(lintAgent(g).ok, true, lintAgent(g).problems.join());
      commitPush(g, `${id}: ready for review`);
    }
    fetchAll(w);

    // Manager review: AGENT-02 must rework; AGENT-02 fixes and delivers again.
    rework({ ...opts, agent: 'AGENT-02', note: 'add a trailing line' });
    sh(g2, 'pull', '--quiet', '--ff-only');
    assert.equal(parseTask(readFileSync(join(g2, '.arena/task.md'), 'utf8')).fields.review_note, 'add a trailing line');
    assert.throws(() => integrate({ ...opts, slice: 'P5-M04', agents: ['AGENT-01', 'AGENT-02'] }), /P5-M04-02 is WORKING, expected READY_FOR_REVIEW/);
    writeFileSync(join(g2, 'src', 'two.txt'), 'P5-M04-02\nfixed\n');
    setStatus(g2, 'READY_FOR_REVIEW');
    assert.equal(lintAgent(g2).ok, true, lintAgent(g2).problems.join());
    commitPush(g2, 'P5-M04-02: rework done');
    fetchAll(w);

    // ONE Slice branch; per-agent working files never reach it.
    const it = integrate({ ...opts, slice: 'P5-M04', agents: ['AGENT-01', 'AGENT-02'] });
    assert.deepEqual(it.applied, ['P5-M04-01', 'P5-M04-02']);
    assert.equal(it.branch, 'arena/manager/P5-M04');
    const files = sh(m, 'ls-tree', '-r', '--name-only', 'origin/arena/manager/P5-M04').split('\n');
    for (const f of ['src/one.txt', 'src/two.txt', '.arena/evidence/P5-M04-01.md', '.arena/evidence/P5-M04-02.md']) assert.ok(files.includes(f), f);
    assert.ok(!files.includes('.arena/task.md') && !files.includes('.arena/progress.md'));
    assert.equal(sh(m, 'show', 'origin/arena/manager/P5-M04:src/two.txt'), 'P5-M04-02\nfixed');
    assert.deepEqual(integrate({ ...opts, slice: 'P5-M04', agents: ['AGENT-01'] }).applied, [], 'idempotent re-run');

    // The Slice PR merges (simulated), then COMPLETED needs the merge on main.
    assert.throws(() => complete({ ...opts, agent: 'AGENT-01', mergeSha: sh(m, 'rev-parse', 'origin/arena/manager/P5-M04') }), /NOT_ON_MAIN/);
    sh(m, 'checkout', '--quiet', '-B', 'main', 'origin/main');
    sh(m, 'merge', '--quiet', '--no-ff', '-m', 'Merge Slice P5-M04', 'origin/arena/manager/P5-M04');
    sh(m, 'push', '--quiet', 'origin', 'main');
    fetchAll(w);
    const mergeSha = sh(m, 'rev-parse', 'origin/main');
    complete({ ...opts, agent: 'AGENT-01', mergeSha });
    assert.throws(() => complete({ ...opts, agent: 'AGENT-01', mergeSha }), /WRONG_STATUS/);
    // Evidence on main alone also proves P5-M04-02 is done for dependency purposes.
    s = status({ cwd: m });
    assert.deepEqual(s.completed, ['P5-M04-01', 'P5-M04-02']);
    assert.equal(s.rows.find((r) => r.agent === 'AGENT-01').status, 'COMPLETED');

    // The dependent task unlocks and lands on AGENT-01, which is brought up to main.
    const a3 = assign({ ...opts, agent: 'AGENT-01', task: draft('P5-M04-03', { depends_on: ['P5-M04-01', 'P5-M04-02'] }) });
    assert.ok(a3.changed && !a3.created);
    assert.equal(sh(m, 'show', 'origin/arena/agent-01:src/two.txt'), 'P5-M04-02\nfixed', 'agent branch contains main');
    assert.equal(readTaskAt(m, 'origin/arena/agent-01').fields.status, 'ASSIGNED');
    assert.throws(() => assign({ ...opts, agent: 'AGENT-04', task: draft('P5-M04-01') }), /TASK_DONE/);
    // The Manager never force-pushes: agent branch history keeps the agent's commits.
    assert.match(sh(m, 'log', '--format=%s', 'origin/arena/agent-01'), /P5-M04-01: implement/);
  } finally { w.cleanup(); }
});

test('hybrid reassignment: stale owner → released with reason, successor continues from the carried commits', () => {
  const w = world();
  try {
    const m = w.manager;
    const opts = { cwd: m, identity: MANAGER, push: true, now: T0 };
    assign({ ...opts, agent: 'AGENT-03', task: draft('P6-S01-01') });
    const g3 = agentClone(w, '03');
    setStatus(g3, 'WORKING');
    writeFileSync(join(g3, 'src', 'half.txt'), 'half done\n');
    progress(g3, 'P6-S01-01', 'halfway');
    commitPush(g3, 'P6-S01-01: halfway');
    fetchAll(w);

    const later = new Date(Date.parse(T0) + 3 * 86400e3);
    const s = status({ cwd: m, now: later });
    assert.equal(s.rows.find((r) => r.agent === 'AGENT-03').stale, true, 'no commits for 72h → STALE');
    assert.throws(() => reassign({ ...opts, from: 'AGENT-03', to: 'AGENT-04' }), /REASON_REQUIRED/);
    assert.throws(() => reassign({ ...opts, from: 'AGENT-03', to: 'AGENT-03', reason: 'x' }), /successor must differ/);

    const r = reassign({ ...opts, from: 'AGENT-03', to: 'AGENT-04', reason: 'owner inactive 72h' });
    assert.ok(r.released.changed && r.assigned.created);
    const old = readTaskAt(m, 'origin/arena/agent-03').fields;
    assert.deepEqual([old.status, old.reassigned_to, old.reason], ['UNASSIGNED', 'AGENT-04', 'owner inactive 72h']);
    const now = readTaskAt(m, 'origin/arena/agent-04').fields;
    assert.deepEqual([now.status, now.owner, now.branch, now.reassigned_from], ['ASSIGNED', 'AGENT-04', 'arena/agent-04', 'AGENT-03']);
    assert.equal(sh(m, 'show', 'origin/arena/agent-04:src/half.txt'), 'half done', 'work carried over');
    assert.match(sh(m, 'log', '--format=%s', 'origin/arena/agent-03'), /P6-S01-01: halfway/, 'old branch untouched, not deleted');

    // The previous owner can no longer resume the task.
    sh(g3, 'pull', '--quiet', '--ff-only');
    setStatus(g3, 'WORKING');
    assert.match(lintAgent(g3).problems.join(), /agent may not move P6-S01-01 from UNASSIGNED to WORKING/);
    // And only one agent holds the id.
    assert.throws(() => assign({ ...opts, agent: 'AGENT-05', task: draft('P6-S01-01') }), /TASK_HELD: .*arena\/agent-04/);
  } finally { w.cleanup(); }
});

test('agent-side guards: wrong branch, foreign owner, blocked needs a reason, a stale checkout cannot overwrite the Manager', () => {
  const w = world();
  try {
    const m = w.manager;
    const opts = { cwd: m, identity: MANAGER, push: true, now: T0 };
    assign({ ...opts, agent: 'AGENT-05', task: draft('P9-S01-01') });
    const g5 = agentClone(w, '05');
    setStatus(g5, 'BLOCKED');
    assert.match(lintAgent(g5).problems.join(), /may not move .* ASSIGNED to BLOCKED|BLOCKED needs blocked_reason/);
    setStatus(g5, 'WORKING');
    progress(g5, 'P9-S01-01');
    commitPush(g5, 'start');
    setStatus(g5, 'BLOCKED', { blocked_reason: 'needs the mail-transport decision' });
    assert.equal(lintAgent(g5).ok, true, lintAgent(g5).problems.join());
    commitPush(g5, 'blocked');
    fetchAll(w);
    assert.equal(status({ cwd: m }).rows[0].blockedReason, 'needs the mail-transport decision');

    // The task file copied onto another branch is rejected there.
    sh(g5, 'checkout', '--quiet', '-b', 'arena/agent-06');
    assert.match(lintAgent(g5).problems.join(), /belongs to arena\/agent-05 but is on arena\/agent-06/);
    sh(g5, 'checkout', '--quiet', '-b', 'feature/x');
    assert.match(lintAgent(g5).problems.join(), /not an agent branch/);
  } finally { w.cleanup(); }
});

test('status flags invalid task files; the CLI reports usage and exit codes', () => {
  const w = world();
  try {
    const m = w.manager;
    sh(m, 'checkout', '--quiet', '-b', 'arena/agent-07', 'origin/main');
    writeFileSync(join(m, '.arena/task.md'), '---\nid: P2.26-01\ntitle: x\nslice: P2.26\nstatus: WORKING\nowner: AGENT-07\nbranch: arena/agent-07\n---\n');
    sh(m, 'add', '-A'); sh(m, 'commit', '--quiet', '-m', 'hand-written task'); sh(m, 'push', '--quiet', 'origin', 'arena/agent-07');
    fetchAll(w);
    const s = status({ cwd: m });
    assert.equal(s.invalid, 1);
    assert.match(s.rows[0].problems.join(), /no new milestone numbers/);

    const out = [];
    const io = { out: (x) => out.push(x), err: (x) => out.push(x) };
    assert.equal(cli(['status'], io, m), 1, 'invalid task files fail status');
    assert.match(out.join(''), /AGENT-07 .*INVALID/);
    assert.equal(cli(['frobnicate'], io, m), 2);
    assert.equal(cli(['assign', '--agent', 'AGENT-01'], io, m), 2);
    assert.equal(cli(['complete', '--agent', 'AGENT-07', '--merge-sha', 'nope'], io, m), 1);
    assert.ok(out.join('').includes('INVALID_SHA'));
    assert.equal(cli(['lint', '--role', 'agent'], io, m), 1);
    assert.ok(new TaskError('X', 'y') instanceof Error);
    assert.ok(!existsSync(join(REPO_ROOT, '.arena', 'task.md')), 'main never carries a task file');
  } finally { w.cleanup(); }
});
