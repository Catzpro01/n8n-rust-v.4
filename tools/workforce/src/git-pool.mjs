// Pipeline mode (DEC-0018): TASK POOL → work → RESULT POOL → batch integration.
//
// For pipeline agents (AGENT-02..10; AGENT-01 keeps the DEC-0017 single-task
// model until it is migrated separately) the agent branch holds:
//
//   .arena/task-pool/<TASK-ID>.md      tasks the Manager queued for this agent (task authority)
//   .arena/current-task.md             pointer to the task being worked on (not a registry)
//   .arena/result-pool/RESULT-<n>.md   finished work waiting for the Manager
//   .arena/progress.md, .arena/evidence/<TASK-ID>.md
//
// An agent finishing task A takes the next READY task itself (`next`); the
// Manager collects results per Slice (`queue`) and integrates them in batches.
// Everything is plain files and git refs: no server, daemon or database.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  agentBranch, agentFromBranch, agentRefs, EVIDENCE_DIR, git, identityArgs, onBranch, parseTask, PROGRESS_PATH, RE, refExists,
  SECRET_RE, serializeTask, showFile, TaskError, validateTask,
} from './git-tasks.mjs';

export const POOL_DIR = '.arena/task-pool';
export const RESULT_DIR = '.arena/result-pool';
export const CURRENT_PATH = '.arena/current-task.md';
export const POOL_STATUSES = ['UNASSIGNED', 'ASSIGNED', 'READY', 'WORKING', 'BLOCKED', 'READY_FOR_REVIEW', 'COMPLETED'];
export const RESULT_STATUSES = ['READY_FOR_REVIEW', 'REWORK', 'COMPLETED'];
export const POOL_ACTIVE = new Set(['ASSIGNED', 'READY', 'WORKING', 'BLOCKED', 'READY_FOR_REVIEW']);
// DEC-0018 §0/§20: AGENT-01 stays on the DEC-0017 workflow until MIGRATE-AGENT-01.
export const PIPELINE_EXCLUDED = new Set(['AGENT-01']);

const RESULT_LISTS = new Set(['ranges', 'files_changed', 'tests']);
const NO_LISTS = new Set();
const AGENT_MUTABLE = new Set(['status', 'blocked_reason', 'updated_at', 'started_at']);
const RANGE_RE = /^[0-9a-f]{40}\.\.[0-9a-f]{40}$/;

export const resultName = (id) => `RESULT-${id.replace(/^TASK-/, '')}.md`;
const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// ------------------------------------------------------------ reading a pool

function readDir(read, list, dir, lists) {
  const out = [];
  for (const name of list(dir).filter((n) => n.endsWith('.md')).sort()) out.push({ name, doc: parseTask(read(`${dir}/${name}`), lists) });
  return out;
}

/** Read a pool from a working tree (dir) or from a git ref. */
export function readPool({ cwd, ref, dir }) {
  const read = dir ? (p) => readFileSync(join(dir, p), 'utf8') : (p) => showFile(cwd, ref, p);
  const list = dir
    ? (d) => (existsSync(join(dir, d)) ? readdirSync(join(dir, d)) : [])
    : (d) => { const r = git(cwd, ['ls-tree', '--name-only', `${ref}:${d}`], { allowFail: true }); return r.ok ? r.out.split('\n').filter(Boolean) : []; };
  const has = dir ? (p) => existsSync(join(dir, p)) : (p) => showFile(cwd, ref, p) !== null;
  if (!has(CURRENT_PATH)) return null; // not a pipeline branch
  return {
    tasks: readDir(read, list, POOL_DIR, undefined).map((x) => ({ ...x, task: x.doc })),
    results: readDir(read, list, RESULT_DIR, RESULT_LISTS).map((x) => ({ ...x, result: x.doc })),
    current: parseTask(read(CURRENT_PATH), NO_LISTS),
  };
}

// ------------------------------------------------------------- validation

export function validatePoolTask(task, agent) {
  const p = validateTask(task, { statuses: POOL_STATUSES, branch: agent ? agentBranch(agent) : undefined });
  if (task.fields.status === 'READY' && task.fields.rework_note === '') p.push('empty rework_note');
  return p;
}

export function validateResult(result, agent) {
  const f = result.fields;
  const p = [];
  if (!RE.id.test(f.task_id ?? '')) p.push(`result task_id ${f.task_id}`);
  if (agent && f.agent !== agent) p.push(`result agent ${f.agent} on ${agentBranch(agent)}`);
  if (!RESULT_STATUSES.includes(f.status)) p.push(`result status ${f.status} is not one of ${RESULT_STATUSES.join(', ')}`);
  if (!RE.sha.test(f.commit ?? '')) p.push('result commit must be a 40-hex sha');
  if (!f.ranges.length || f.ranges.some((r) => !RANGE_RE.test(r))) p.push('result ranges must be <base>..<head> sha pairs');
  if (f.status === 'COMPLETED' && !RE.sha.test(f.merge_sha ?? '')) p.push('COMPLETED result needs merge_sha');
  if (f.status === 'REWORK' && !f.rework_note) p.push('REWORK result needs rework_note');
  if (!/summary/i.test(result.body)) p.push('result body needs a Summary section');
  if (SECRET_RE.test(serializeTask(result))) p.push('result contains credential-like material');
  return p;
}

/** Whole-pool consistency: one WORKING task, current-task pointer agrees, results match tasks. */
export function validatePool(pool, agent) {
  const p = [];
  for (const { name, task } of pool.tasks) {
    if (name !== `${task.fields.id}.md`) p.push(`${POOL_DIR}/${name}: file name must be ${task.fields.id}.md`);
    p.push(...validatePoolTask(task, agent).map((x) => `${task.fields.id}: ${x}`));
  }
  for (const { name, result } of pool.results) {
    if (name !== resultName(result.fields.task_id ?? '')) p.push(`${RESULT_DIR}/${name}: file name must be ${resultName(result.fields.task_id ?? '')}`);
    p.push(...validateResult(result, agent).map((x) => `${name}: ${x}`));
    const t = pool.tasks.find((x) => x.task.fields.id === result.fields.task_id);
    if (!t) p.push(`${name}: no task ${result.fields.task_id} in the pool`);
    else {
      const ts = t.task.fields.status;
      const expect = { READY_FOR_REVIEW: ['READY_FOR_REVIEW'], REWORK: ['READY', 'WORKING', 'BLOCKED'], COMPLETED: ['COMPLETED'] }[result.fields.status] ?? [];
      if (!expect.includes(ts) && !(ts === 'UNASSIGNED')) p.push(`${name}: result ${result.fields.status} but task ${ts}`);
    }
  }
  const working = pool.tasks.filter((x) => ['WORKING', 'BLOCKED'].includes(x.task.fields.status)).map((x) => x.task.fields.id);
  if (working.length > 1) p.push(`more than one task in progress: ${working.join(', ')}`);
  const c = pool.current.fields;
  if (!['IDLE', 'WORKING', 'BLOCKED'].includes(c.status)) p.push(`current-task status ${c.status} must be IDLE, WORKING or BLOCKED`);
  if (c.status === 'IDLE' && c.task_id !== 'none') p.push('IDLE current-task must have task_id: none');
  if (c.status !== 'IDLE') {
    if (working[0] !== c.task_id) p.push(`current-task points to ${c.task_id} but the pool has ${working[0] ?? 'nothing'} in progress`);
    else if (pool.tasks.find((x) => x.task.fields.id === c.task_id).task.fields.status !== c.status) p.push('current-task status disagrees with the pool task');
    if (!RE.sha.test(c.base_commit ?? '')) p.push('current-task needs base_commit');
  } else if (working.length) p.push(`${working[0]} is in progress but current-task is IDLE`);
  return p;
}

// ------------------------------------------------------------- dependencies

function evidenceOnMain(cwd, mainRef) {
  const r = git(cwd, ['ls-tree', '--name-only', `${mainRef}:${EVIDENCE_DIR}`], { allowFail: true });
  return new Set(r.ok ? r.out.split('\n').filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)) : []);
}

/**
 * A dependency is met when its evidence is merged to main (integrated and
 * COMPLETED), or when the SAME agent already delivered it (READY_FOR_REVIEW /
 * COMPLETED in this pool): its code is on this branch, so work can continue.
 * A dependency delivered by another agent needs the merge first.
 */
export function unmetDeps(task, pool, done) {
  const local = new Set(pool.tasks.filter((x) => ['READY_FOR_REVIEW', 'COMPLETED'].includes(x.task.fields.status)).map((x) => x.task.fields.id));
  return task.fields.depends_on.filter((d) => !done.has(d) && !local.has(d));
}

const priority = (t) => [t.fields.rework_note ? 0 : 1, Number(t.fields.order ?? 1e6), t.fields.id];
const byPriority = (a, b) => { const x = priority(a.task); const y = priority(b.task); return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]); };

// --------------------------------------------------------------- agent side

function currentDoc(fields) { return { fields, body: '\nPointer to the task this agent is working on. The task itself is in .arena/task-pool/.\n' }; }
function writeDoc(dir, path, doc) { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), serializeTask(doc)); }

function requirePipelineCheckout(cwd) {
  const branch = git(cwd, ['branch', '--show-current'], { allowFail: true }).out;
  const agent = agentFromBranch(branch);
  if (!agent) throw new TaskError('NOT_AGENT_BRANCH', `branch ${branch || '(detached)'} is not arena/agent-NN`);
  const pool = readPool({ dir: cwd });
  if (!pool) throw new TaskError('NOT_PIPELINE', `${branch} has no ${CURRENT_PATH}; this agent is not in pipeline mode`);
  return { branch, agent, pool };
}

/**
 * Agent: take the next task. Brings main in first (so dependencies merged by
 * other agents become available), then starts the highest-priority READY task
 * (rework first, then `order`, then id). No Manager round trip.
 */
export function next({ cwd, mainRef = 'origin/main', syncMain = true, identity, push = false, now = isoNow(), executedBy }) {
  let { agent, pool } = requirePipelineCheckout(cwd);
  const c = pool.current.fields;
  if (c.status !== 'IDLE') throw new TaskError('BUSY', `${c.task_id} is ${c.status}; deliver it (result) or mark it BLOCKED first`);
  if (git(cwd, ['status', '--porcelain']).length) throw new TaskError('DIRTY', 'commit or discard local changes first');
  const warnings = [];
  if (syncMain && refExists(cwd, mainRef)) {
    const r = git(cwd, [...identityArgs(identity), 'merge', '--quiet', '--no-edit', mainRef], { allowFail: true });
    if (!r.ok) { git(cwd, ['merge', '--abort'], { allowFail: true }); warnings.push(`${mainRef} does not merge cleanly; continuing without it`); }
    pool = readPool({ dir: cwd });
  }
  const done = refExists(cwd, mainRef) ? evidenceOnMain(cwd, mainRef) : new Set();
  const candidates = pool.tasks.filter((x) => ['READY', 'ASSIGNED'].includes(x.task.fields.status)).sort(byPriority);
  const waiting = [];
  for (const cand of candidates) {
    const unmet = unmetDeps(cand.task, pool, done);
    if (unmet.length) { waiting.push({ id: cand.task.fields.id, waitsOn: unmet }); continue; }
    const f = cand.task.fields;
    f.status = 'WORKING'; f.started_at = now; f.updated_at = now;
    writeDoc(cwd, `${POOL_DIR}/${f.id}.md`, cand.task);
    const base = git(cwd, ['rev-parse', 'HEAD']);
    writeDoc(cwd, CURRENT_PATH, currentDoc({ task_id: f.id, status: 'WORKING', started_at: now, base_commit: base, ...(executedBy ? { executed_by: executedBy } : {}) }));
    const prog = join(cwd, PROGRESS_PATH);
    const prev = existsSync(prog) ? readFileSync(prog, 'utf8') : `# ${agent} progress\n`;
    writeFileSync(prog, `${prev.trimEnd()}\n\n## ${f.id} — ${f.title}\nStarted: ${now}${f.rework_note ? `\nRework: ${f.rework_note}` : ''}\n`);
    git(cwd, ['add', '-A', '.arena']);
    git(cwd, [...identityArgs(identity), 'commit', '--quiet', '-m', `task: start ${f.id}`]);
    if (push) git(cwd, ['push', '--quiet']);
    return { agent, started: f.id, rework: Boolean(f.rework_note), base, waiting, warnings };
  }
  return { agent, started: null, waiting, warnings, idle: true };
}

function evidenceTests(text) {
  const out = [];
  let on = false;
  for (const line of text.split('\n')) {
    if (/^tests?\s*:/i.test(line.trim())) { on = true; const rest = line.split(':').slice(1).join(':').trim(); if (rest) out.push(rest); continue; }
    if (on) { if (/^\s*-\s+/.test(line)) out.push(line.replace(/^\s*-\s+/, '').trim()); else if (line.trim()) on = false; }
  }
  return out;
}

/**
 * Agent: deliver the current task into the result pool. All work must be
 * committed; the result records the exact commit range of this task so the
 * Manager can integrate it independently of later tasks on the same branch.
 */
export function result({ cwd, summary, limitations = 'none', nextNote = 'none', identity, push = false, now = isoNow() }) {
  const { agent, pool } = requirePipelineCheckout(cwd);
  const c = pool.current.fields;
  if (c.status !== 'WORKING') throw new TaskError('NOT_WORKING', `current task is ${c.status}`);
  if (!summary) throw new TaskError('SUMMARY_REQUIRED', 'a result needs --summary');
  if (git(cwd, ['status', '--porcelain']).length) throw new TaskError('DIRTY', 'commit your work first; a result points at a commit');
  const id = c.task_id;
  const evPath = join(cwd, EVIDENCE_DIR, `${id}.md`);
  if (!existsSync(evPath)) throw new TaskError('NO_EVIDENCE', `write ${EVIDENCE_DIR}/${id}.md first (template .arena/templates/evidence.md)`);
  const head = git(cwd, ['rev-parse', 'HEAD']);
  const range = `${c.base_commit}..${head}`;
  const excl = ['.arena/task-pool', '.arena/current-task.md', '.arena/result-pool', PROGRESS_PATH, '.arena/task.md'].map((x) => `:(exclude)${x}`);
  const files = git(cwd, ['diff', '--name-only', c.base_commit, head, '--', '.', ...excl]).split('\n').filter(Boolean);
  if (!files.length) throw new TaskError('NO_CHANGES', `${id} has no committed changes since ${c.base_commit.slice(0, 12)}`);
  const t = pool.tasks.find((x) => x.task.fields.id === id).task;
  const prev = pool.results.find((x) => x.result.fields.task_id === id)?.result;
  const tests = evidenceTests(readFileSync(evPath, 'utf8'));
  const res = {
    fields: {
      task_id: id, agent, slice: t.fields.slice, status: 'READY_FOR_REVIEW', commit: head,
      ranges: [...(prev?.fields.ranges ?? []), range], files_changed: [...new Set([...(prev?.fields.files_changed ?? []), ...files])].sort(),
      tests, created_at: prev?.fields.created_at ?? now, updated_at: now,
      ...(c.executed_by ? { executed_by: c.executed_by } : {}),
    },
    body: `\n## Summary\n\n${summary}\n\n## Limitations\n\n${limitations}\n\n## Next\n\n${nextNote}\n\nEvidence: ${EVIDENCE_DIR}/${id}.md\n`,
  };
  const p = validateResult(res, agent);
  if (p.length) throw new TaskError('INVALID_RESULT', p.join('; '));
  t.fields.status = 'READY_FOR_REVIEW'; t.fields.updated_at = now; delete t.fields.rework_note;
  writeDoc(cwd, `${POOL_DIR}/${id}.md`, t);
  writeDoc(cwd, `${RESULT_DIR}/${resultName(id)}`, res);
  writeDoc(cwd, CURRENT_PATH, currentDoc({ task_id: 'none', status: 'IDLE', last_task: id, updated_at: now }));
  const prog = join(cwd, PROGRESS_PATH);
  writeFileSync(prog, `${readFileSync(prog, 'utf8').trimEnd()}\nDelivered: ${now} → ${RESULT_DIR}/${resultName(id)} (commit ${head.slice(0, 12)})\n`);
  git(cwd, ['add', '-A', '.arena']);
  git(cwd, [...identityArgs(identity), 'commit', '--quiet', '-m', `task: result ${id}`]);
  if (push) git(cwd, ['push', '--quiet']);
  return { agent, delivered: id, result: `${RESULT_DIR}/${resultName(id)}`, commit: head, ranges: res.fields.ranges };
}

/** Agent: BLOCKED with a reason (keeps the pointer), or back to WORKING. */
export function block({ cwd, reason, unblock = false, identity, push = false, now = isoNow() }) {
  const { pool } = requirePipelineCheckout(cwd);
  const c = pool.current.fields;
  const want = unblock ? 'BLOCKED' : 'WORKING';
  if (c.status !== want) throw new TaskError('WRONG_STATUS', `current task is ${c.status}`);
  if (!unblock && !reason) throw new TaskError('REASON_REQUIRED', 'blocking needs a reason');
  const t = pool.tasks.find((x) => x.task.fields.id === c.task_id).task;
  t.fields.status = unblock ? 'WORKING' : 'BLOCKED'; t.fields.updated_at = now;
  if (unblock) delete t.fields.blocked_reason; else t.fields.blocked_reason = reason;
  writeDoc(cwd, `${POOL_DIR}/${t.fields.id}.md`, t);
  writeDoc(cwd, CURRENT_PATH, currentDoc({ ...c, status: t.fields.status }));
  git(cwd, ['add', '-A', '.arena']);
  git(cwd, [...identityArgs(identity), 'commit', '--quiet', '-m', `task: ${unblock ? 'unblock' : 'block'} ${t.fields.id}`]);
  if (push) git(cwd, ['push', '--quiet']);
  return { task: t.fields.id, status: t.fields.status };
}

// Agent transition rules for pool tasks (lint).
const AGENT_POOL_TRANSITIONS = { ASSIGNED: ['WORKING'], READY: ['WORKING'], WORKING: ['BLOCKED', 'READY_FOR_REVIEW'], BLOCKED: ['WORKING'], READY_FOR_REVIEW: ['WORKING'] };

/** Agent-side lint for a pipeline checkout, comparing against the upstream (last pushed) state. */
export function lintPool({ cwd, base, mainRef = 'origin/main' }) {
  const problems = [];
  const { agent, pool } = requirePipelineCheckout(cwd);
  problems.push(...validatePool(pool, agent));
  const baseRef = base ?? (git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { allowFail: true }).out || 'HEAD');
  const before = refExists(cwd, baseRef) ? readPool({ cwd, ref: baseRef }) : null;
  if (before) {
    const ids = new Set(before.tasks.map((x) => x.task.fields.id));
    for (const { task } of pool.tasks) {
      const b = before.tasks.find((x) => x.task.fields.id === task.fields.id)?.task;
      if (!b) { problems.push(`${task.fields.id}: only the Manager adds tasks to the pool`); continue; }
      const bs = b.fields.status; const as = task.fields.status;
      if (bs !== as && !(AGENT_POOL_TRANSITIONS[bs] ?? []).includes(as)) problems.push(`${task.fields.id}: agent may not move ${bs} → ${as}`);
      for (const k of new Set([...Object.keys(b.fields), ...Object.keys(task.fields)])) {
        if (AGENT_MUTABLE.has(k) || (k === 'rework_note' && as === 'READY_FOR_REVIEW' && !task.fields[k])) continue;
        if (JSON.stringify(b.fields[k] ?? '') !== JSON.stringify(task.fields[k] ?? '')) problems.push(`${task.fields.id}: agent may not change ${k}`);
      }
      ids.delete(task.fields.id);
    }
    for (const id of ids) problems.push(`${id}: agent may not delete a pool task`);
    for (const { name, result: r } of pool.results) {
      const b = before.results.find((x) => x.name === name)?.result;
      if (b && b.fields.status !== r.fields.status && !(b.fields.status === 'REWORK' && r.fields.status === 'READY_FOR_REVIEW')) problems.push(`${name}: agent may not move ${b.fields.status} → ${r.fields.status}`);
      if (r.fields.merge_sha && r.fields.merge_sha !== b?.fields.merge_sha) problems.push(`${name}: only the Manager sets merge_sha`);
    }
  }
  const done = refExists(cwd, mainRef) ? evidenceOnMain(cwd, mainRef) : new Set();
  for (const { task } of pool.tasks) {
    if (task.fields.status === 'WORKING' && before?.tasks.find((x) => x.task.fields.id === task.fields.id)?.task.fields.status !== 'WORKING') {
      const unmet = unmetDeps(task, pool, done);
      if (unmet.length) problems.push(`${task.fields.id}: started before its dependencies (${unmet.join(', ')})`);
    }
  }
  return problems;
}

// ------------------------------------------------------------- Manager side

function managerPoolWrite(cwd, agent, opts, fn) {
  if (PIPELINE_EXCLUDED.has(agent)) throw new TaskError('PIPELINE_EXCLUDED', `${agent} stays on the DEC-0017 single-task workflow (DEC-0018 exception)`);
  return onBranch(cwd, { remote: opts.remote, branch: agentBranch(agent), mainRef: opts.mainRef, identity: opts.identity, push: opts.push }, (dir, info) => {
    const pool = readPool({ dir });
    const msg = fn(dir, pool, info);
    if (msg) { const p = validatePool(readPool({ dir }), agent); if (p.length) throw new TaskError('INVALID_POOL', p.join('; ')); }
    return msg;
  });
}

/** Manager: turn an agent branch into a pipeline workspace (created from main when missing). */
export function poolInit({ cwd, agent, remote = 'origin', mainRef, identity, push = false, now = isoNow() }) {
  mainRef ??= `${remote}/main`;
  if (!RE.agent.test(agent ?? '')) throw new TaskError('INVALID_AGENT', `agent ${agent}`);
  return managerPoolWrite(cwd, agent, { remote, mainRef, identity, push }, (dir, pool, { created }) => {
    if (pool) return null; // already a pipeline branch
    if (existsSync(join(dir, '.arena/task.md'))) {
      const t = parseTask(readFileSync(join(dir, '.arena/task.md'), 'utf8'));
      if (['ASSIGNED', 'WORKING', 'BLOCKED', 'READY_FOR_REVIEW'].includes(t.fields.status)) throw new TaskError('LEGACY_TASK_ACTIVE', `${t.fields.id} is ${t.fields.status} in the single-task model; finish or reassign it first`);
    }
    if (!created) {
      const r = git(dir, [...identityArgs(identity), 'merge', '--quiet', '--no-edit', mainRef], { allowFail: true });
      if (!r.ok) { git(dir, ['merge', '--abort'], { allowFail: true }); throw new TaskError('MERGE_CONFLICT', `${agentBranch(agent)} does not merge ${mainRef}`); }
    }
    for (const d of [POOL_DIR, RESULT_DIR]) { mkdirSync(join(dir, d), { recursive: true }); writeFileSync(join(dir, d, '.gitkeep'), ''); }
    writeDoc(dir, CURRENT_PATH, currentDoc({ task_id: 'none', status: 'IDLE', updated_at: now }));
    writeFileSync(join(dir, PROGRESS_PATH), `# ${agent} progress\n\nPipeline mode (DEC-0018) since ${now}.\n`);
    return `task: ${agent} pipeline workspace (DEC-0018)`;
  });
}

/** Everything the Manager knows about all pipeline pools (read from remote refs). */
export function poolOverview({ cwd, remote = 'origin', mainRef }) {
  mainRef ??= `${remote}/main`;
  const done = refExists(cwd, mainRef) ? evidenceOnMain(cwd, mainRef) : new Set();
  const agents = [];
  for (const { ref, branch } of agentRefs(cwd, remote)) {
    const agent = agentFromBranch(branch);
    let pool = null; let problems = [];
    try { pool = readPool({ cwd, ref }); if (pool) problems = validatePool(pool, agent); } catch (e) { problems = [e.message]; }
    if (!pool) continue;
    const tasks = pool.tasks.map(({ task }) => ({ ...task.fields, unmet: unmetDeps(task, pool, done) }));
    agents.push({ agent, branch, ref, head: git(cwd, ['rev-parse', ref]), lastCommitAt: git(cwd, ['log', '-1', '--format=%cI', ref]), current: pool.current.fields, tasks, results: pool.results.map((x) => ({ name: x.name, ...x.result.fields })), problems });
  }
  const completed = new Set(done);
  for (const a of agents) for (const t of a.tasks) if (t.status === 'COMPLETED') completed.add(t.id);
  return { mainRef, agents, completed: [...completed].sort() };
}

function heldBy(ov, id) {
  for (const a of ov.agents) { const t = a.tasks.find((x) => x.id === id && POOL_ACTIVE.has(x.status)); if (t) return { agent: a.agent, status: t.status }; }
  return null;
}

/** Manager: queue a task in an agent's pool; READY when its dependencies are met, otherwise ASSIGNED (waiting). */
export function poolAssign({ cwd, agent, task: draft, remote = 'origin', mainRef, identity, push = false, now = isoNow(), extra = {} }) {
  mainRef ??= `${remote}/main`;
  if (!RE.agent.test(agent ?? '')) throw new TaskError('INVALID_AGENT', `agent ${agent}`);
  const ov = poolOverview({ cwd, remote, mainRef });
  const id = draft.fields.id;
  const holder = heldBy(ov, id);
  if (holder && holder.agent !== agent) throw new TaskError('TASK_HELD', `${id} is ${holder.status} in ${agentBranch(holder.agent)}; reassign it instead`);
  if (ov.completed.includes(id)) throw new TaskError('TASK_DONE', `${id} is already completed`);
  return managerPoolWrite(cwd, agent, { remote, mainRef, identity, push }, (dir, pool) => {
    if (!pool) throw new TaskError('NOT_PIPELINE', `${agentBranch(agent)} is not a pipeline workspace; run pool-init first`);
    if (pool.tasks.some((x) => x.task.fields.id === id)) throw new TaskError('DUPLICATE', `${id} is already in ${agentBranch(agent)}'s pool`);
    const fields = { ...draft.fields, ...extra, owner: agent, branch: agentBranch(agent), assigned_by: 'MANAGER', assigned_at: now, updated_at: now };
    for (const k of ['completed_by', 'merge_sha', 'blocked_reason', 'reassigned_to', 'review_note', 'rework_note', 'started_at']) delete fields[k];
    const t = { fields, body: draft.body ?? '' };
    fields.status = unmetDeps(t, pool, new Set(ov.completed)).length ? 'ASSIGNED' : 'READY';
    const p = validatePoolTask(t, agent);
    if (p.length) throw new TaskError('INVALID_TASK', p.join('; '));
    writeDoc(dir, `${POOL_DIR}/${id}.md`, t);
    return `task: queue ${id} for ${agent} (${fields.status})`;
  });
}

function editPool(cwd, agent, opts, id, mutate, message) {
  return managerPoolWrite(cwd, agent, opts, (dir, pool) => {
    if (!pool) throw new TaskError('NOT_PIPELINE', `${agentBranch(agent)} is not a pipeline workspace`);
    const t = pool.tasks.find((x) => x.task.fields.id === id)?.task;
    if (!t) throw new TaskError('NO_TASK', `${id} is not in ${agentBranch(agent)}'s pool`);
    const r = pool.results.find((x) => x.result.fields.task_id === id)?.result ?? null;
    const out = mutate(t, r, pool, dir);
    writeDoc(dir, `${POOL_DIR}/${id}.md`, t);
    if (r) writeDoc(dir, `${RESULT_DIR}/${resultName(id)}`, r);
    if (out?.current) writeDoc(dir, CURRENT_PATH, currentDoc(out.current));
    return message(t);
  });
}

/** Manager: send a delivered result back. The task becomes READY with a rework_note; the agent's `next` takes rework first. */
export function poolRework({ cwd, agent, id, note, remote = 'origin', mainRef, identity, push = false, now = isoNow() }) {
  if (!note) throw new TaskError('NOTE_REQUIRED', 'rework needs a note');
  return editPool(cwd, agent, { remote, mainRef: mainRef ?? `${remote}/main`, identity, push }, id, (t, r) => {
    if (t.fields.status !== 'READY_FOR_REVIEW' || !r) throw new TaskError('WRONG_STATUS', `${id} is ${t.fields.status}`);
    t.fields.status = 'READY'; t.fields.rework_note = note; t.fields.updated_at = now;
    r.fields.status = 'REWORK'; r.fields.rework_note = note; r.fields.updated_at = now;
  }, () => `task: rework ${id} (${note})`);
}

/** Manager: COMPLETED after the Slice merge; the merge must be on main and carry the evidence. */
export function poolComplete({ cwd, agent, id, mergeSha, remote = 'origin', mainRef, identity, push = false, now = isoNow() }) {
  mainRef ??= `${remote}/main`;
  if (!RE.sha.test(mergeSha ?? '')) throw new TaskError('INVALID_SHA', 'merge SHA must be a full 40-hex commit');
  if (!git(cwd, ['merge-base', '--is-ancestor', mergeSha, mainRef], { allowFail: true }).ok) throw new TaskError('NOT_ON_MAIN', `${mergeSha} is not on ${mainRef}`);
  if (!git(cwd, ['cat-file', '-e', `${mergeSha}:${EVIDENCE_DIR}/${id}.md`], { allowFail: true }).ok) throw new TaskError('NO_EVIDENCE_ON_MAIN', `${EVIDENCE_DIR}/${id}.md is not in ${mergeSha}`);
  return editPool(cwd, agent, { remote, mainRef, identity, push }, id, (t, r) => {
    if (t.fields.status !== 'READY_FOR_REVIEW' || !r) throw new TaskError('WRONG_STATUS', `${id} is ${t.fields.status}`);
    t.fields.status = 'COMPLETED'; t.fields.completed_by = 'MANAGER'; t.fields.merge_sha = mergeSha; t.fields.updated_at = now;
    r.fields.status = 'COMPLETED'; r.fields.merge_sha = mergeSha; r.fields.updated_at = now;
  }, () => `task: complete ${id} (merged ${mergeSha.slice(0, 12)})`);
}

function taskPatch(cwd, ranges) {
  const excl = ['.arena/task-pool', '.arena/current-task.md', '.arena/result-pool', PROGRESS_PATH, '.arena/task.md'].map((x) => `:(exclude)${x}`);
  return ranges.map((r) => { const [a, b] = r.split('..'); return git(cwd, ['diff', '--binary', a, b, '--', '.', ...excl]); }).filter(Boolean);
}

/**
 * Manager: reassign one pool task. The old pool keeps the task as UNASSIGNED
 * with previous/new owner, reason and timestamp; the new pool gets it with the
 * same history. Work already committed for it (its delivered ranges, or the
 * in-progress range) is applied onto the new branch.
 */
export function poolReassign({ cwd, from, to, id, reason, remote = 'origin', mainRef, identity, push = false, now = isoNow() }) {
  mainRef ??= `${remote}/main`;
  if (!reason) throw new TaskError('REASON_REQUIRED', 'reassignment needs a reason');
  if (from === to) throw new TaskError('INVALID_AGENT', 'successor must differ from the current owner');
  const fromRef = `${remote}/${agentBranch(from)}`;
  const pool = readPool({ cwd, ref: fromRef });
  const t = pool?.tasks.find((x) => x.task.fields.id === id)?.task;
  if (!t || !POOL_ACTIVE.has(t.fields.status)) throw new TaskError('NO_ACTIVE_TASK', `${id} is not active in ${agentBranch(from)}`);
  const r = pool.results.find((x) => x.result.fields.task_id === id)?.result;
  const ranges = [...(r?.fields.ranges ?? [])];
  if (pool.current.fields.task_id === id) ranges.push(`${pool.current.fields.base_commit}..${git(cwd, ['rev-parse', fromRef])}`);
  const patches = taskPatch(cwd, ranges);
  const released = editPool(cwd, from, { remote, mainRef, identity, push }, id, (task, res, p) => {
    task.fields.status = 'UNASSIGNED'; task.fields.reassigned_to = to; task.fields.reason = reason; task.fields.reassigned_at = now; task.fields.updated_at = now;
    if (res && res.fields.status !== 'COMPLETED') res.fields.status = 'REWORK', res.fields.rework_note = `reassigned to ${to}: ${reason}`;
    if (p.current.fields.task_id === id) return { current: { task_id: 'none', status: 'IDLE', last_task: id, updated_at: now } };
    return null;
  }, () => `task: release ${id} from ${from} (reassigned to ${to}: ${reason})`);
  const draft = { fields: { ...t.fields }, body: t.body };
  for (const k of ['rework_note', 'started_at']) delete draft.fields[k];
  const assigned = managerPoolWrite(cwd, to, { remote, mainRef, identity, push }, (dir, toPool) => {
    if (!toPool) throw new TaskError('NOT_PIPELINE', `${agentBranch(to)} is not a pipeline workspace`);
    for (const patch of patches) {
      const a = git(dir, ['apply', '--3way', '--index', '--whitespace=nowarn'], { allowFail: true, input: `${patch}\n` });
      if (!a.ok) throw new TaskError('MERGE_CONFLICT', `cannot carry ${id}'s work into ${agentBranch(to)}: ${a.err}`);
    }
    if (patches.length) git(dir, [...identityArgs(identity), 'commit', '--quiet', '-m', `carry ${id} work from ${agentBranch(from)}`]);
    const fields = { ...draft.fields, owner: to, branch: agentBranch(to), previous_owner: from, reason, reassigned_at: now, updated_at: now, status: 'READY' };
    delete fields.reassigned_to;
    writeDoc(dir, `${POOL_DIR}/${id}.md`, { fields, body: draft.body });
    return `task: queue ${id} for ${to} (reassigned from ${from}: ${reason})`;
  });
  return { released, assigned, carriedRanges: ranges.length };
}

/** Manager: the integration queue — delivered results per Slice, and what the Slice still waits for. */
export function queue({ cwd, remote = 'origin', mainRef }) {
  const ov = poolOverview({ cwd, remote, mainRef });
  const slices = {};
  const slot = (s) => (slices[s] ??= { ready: [], waiting: [], completed: [] });
  for (const a of ov.agents) {
    for (const t of a.tasks) {
      if (t.status === 'UNASSIGNED') continue;
      const res = a.results.find((x) => x.task_id === t.id);
      const row = { task: t.id, agent: a.agent, status: t.status, result: res?.name ?? null, commit: res?.commit ?? null };
      if (t.status === 'READY_FOR_REVIEW') slot(t.slice).ready.push(row);
      else if (t.status === 'COMPLETED') slot(t.slice).completed.push(row);
      else slot(t.slice).waiting.push({ ...row, unmet: t.unmet });
    }
  }
  return { mainRef: ov.mainRef, slices, problems: ov.agents.filter((a) => a.problems.length).map((a) => ({ agent: a.agent, problems: a.problems })) };
}

export function formatQueue(q) {
  const lines = ['INTEGRATION QUEUE'];
  for (const [s, v] of Object.entries(q.slices).sort()) {
    lines.push('', `${s}  (ready ${v.ready.length} / waiting ${v.waiting.length} / completed ${v.completed.length})`);
    for (const r of v.ready) lines.push(`  ✓ ${r.result}  ${r.task}  ${r.agent}  ${r.commit.slice(0, 12)}`);
    for (const r of v.waiting) lines.push(`  … ${r.task}  ${r.agent}  ${r.status}${r.unmet?.length ? ` (waits on ${r.unmet.join(', ')})` : ''}`);
    for (const r of v.completed) lines.push(`  ■ ${r.task}  ${r.agent}  COMPLETED`);
  }
  for (const p of q.problems) lines.push(`INVALID ${p.agent}: ${p.problems.join('; ')}`);
  return lines.join('\n');
}

/** Write the queue snapshot to .arena/integration/QUEUE.md on arena-manager (an index, never task authority). */
export function writeQueueIndex({ cwd, remote = 'origin', mainRef, identity, push = false, now = isoNow() }) {
  const q = queue({ cwd, remote, mainRef });
  return onBranch(cwd, { remote, branch: 'arena-manager', mainRef: mainRef ?? `${remote}/main`, identity, push }, (dir) => {
    mkdirSync(join(dir, '.arena/integration'), { recursive: true });
    writeFileSync(join(dir, '.arena/integration/QUEUE.md'), `# Integration queue (index only — task authority is each agent branch, DEC-0018)\n\nGenerated: ${now}\n\n\`\`\`text\n${formatQueue(q)}\n\`\`\`\n`);
    writeFileSync(join(dir, '.arena/integration/queue.json'), `${JSON.stringify({ generatedAt: now, ...q }, null, 2)}\n`);
    return `manager: integration queue snapshot ${now}`;
  });
}

/**
 * Manager: batch-integrate delivered results of one Slice onto the ONE Slice
 * branch (DEC-0014). Each result is applied from its own commit ranges, so a
 * task can be integrated while the same agent is already working on the next.
 */
export function poolIntegrate({ cwd, slice, tasks, remote = 'origin', mainRef, branch, identity, push = false }) {
  mainRef ??= `${remote}/main`;
  if (!RE.slice.test(slice ?? '')) throw new TaskError('INVALID_SLICE', `slice ${slice}`);
  branch ??= `arena/manager/${slice}`;
  const q = queue({ cwd, remote, mainRef });
  const ready = q.slices[slice]?.ready ?? [];
  const picks = tasks?.length ? tasks.map((id) => ready.find((r) => r.task === id) ?? (() => { throw new TaskError('NOT_READY', `${id} has no READY_FOR_REVIEW result in ${slice}`); })()) : ready;
  if (!picks.length) throw new TaskError('NOTHING_READY', `no READY_FOR_REVIEW results in ${slice}`);
  const ov = poolOverview({ cwd, remote, mainRef });
  const items = picks.map((p) => ({ ...p, ranges: ov.agents.find((a) => a.agent === p.agent).results.find((r) => r.task_id === p.task).ranges }))
    .sort((a, b) => a.agent.localeCompare(b.agent) || a.task.localeCompare(b.task));
  const applied = [];
  // Ranges already on the Slice branch are recorded in its commit messages; never apply twice.
  const sliceRef = `${remote}/${branch}`;
  const done = new Set(refExists(cwd, sliceRef) ? (git(cwd, ['log', '--format=%B', `${mainRef}..${sliceRef}`]).match(/[0-9a-f]{40}\.\.[0-9a-f]{40}/g) ?? []) : []);
  const res = onBranch(cwd, { remote, branch, mainRef, identity, push }, (dir) => {
    for (const it of items) {
      const fresh = it.ranges.filter((r) => !done.has(r));
      if (!fresh.length) continue;
      for (const patch of taskPatch(cwd, fresh)) {
        const a = git(dir, ['apply', '--3way', '--index', '--whitespace=nowarn'], { allowFail: true, input: `${patch}\n` });
        if (!a.ok) throw new TaskError('INTEGRATION_CONFLICT', `${it.task} (${it.agent}) does not apply on ${branch}: ${a.err}`);
      }
      if (git(dir, ['diff', '--cached', '--quiet'], { allowFail: true }).ok) continue;
      git(dir, [...identityArgs(identity), 'commit', '--quiet', '-m', `${slice}: integrate ${it.task} from ${agentBranch(it.agent)} @ ${it.commit.slice(0, 12)}`, '-m', `ranges: ${fresh.join(' ')}`]);
      applied.push(it.task);
    }
    for (const x of ['.arena/task-pool', '.arena/current-task.md', '.arena/result-pool', PROGRESS_PATH, '.arena/task.md']) if (existsSync(join(dir, x))) throw new TaskError('LEAK', `${x} would reach main`);
    return applied.length ? `${slice}: integration batch (${applied.join(', ')})` : null;
  });
  return { ...res, branch, applied };
}
