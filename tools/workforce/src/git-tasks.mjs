// Git-native task model (DEC-0017).
//
// Arena is the agent runtime, a git branch is the agent workspace, the
// repository is the control plane and GitHub is the code authority.
//
//   arena/agent-NN:.arena/task.md      the ONE authoritative task of that agent
//   arena/agent-NN:.arena/progress.md  the agent's running progress log
//   .arena/evidence/<task-id>.md       task evidence; reaches main with the Slice PR
//
// This module only reads and writes files and git refs. It has no server, no
// session, no daemon and no second store: whatever the task file on the agent
// branch says is the task state.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TASK_PATH = '.arena/task.md';
export const PROGRESS_PATH = '.arena/progress.md';
export const EVIDENCE_DIR = '.arena/evidence';
export const RULE_PATHS = ['.arena/RULES.md', '.arena/AGENT_RULES.md', '.arena/MANAGER_RULES.md', '.arena/WORKFLOW.md', '.arena/templates'];
// Per-agent working files never travel to main: integration excludes them.
export const AGENT_LOCAL_PATHS = [TASK_PATH, PROGRESS_PATH];

export const STATUSES = ['UNASSIGNED', 'ASSIGNED', 'WORKING', 'BLOCKED', 'READY_FOR_REVIEW', 'COMPLETED'];
export const ACTIVE = new Set(['ASSIGNED', 'WORKING', 'BLOCKED', 'READY_FOR_REVIEW']);

const RE = {
  id: /^(P\d{1,2}-[SM]\d{2}-\d{2}|TASK-\d{4})$/,
  slice: /^(P\d{1,2}-[SM]\d{2}|GOVERNANCE)$/,
  agent: /^AGENT-(0[1-9]|10)$/,
  sha: /^[0-9a-f]{40}$/,
  iso: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
};
// Fields an agent may change on its own task. Everything else is the Manager's.
const AGENT_MUTABLE = new Set(['status', 'blocked_reason', 'updated_at']);
const LIST_FIELDS = new Set(['depends_on', 'scope', 'tests', 'acceptance']);
const FIELD_ORDER = ['id', 'title', 'slice', 'owner', 'branch', 'status', 'depends_on', 'scope', 'tests', 'acceptance',
  'assigned_by', 'assigned_at', 'updated_at', 'blocked_reason', 'review_note', 'reassigned_from', 'reassigned_to', 'reason',
  'completed_by', 'merge_sha'];

// Credential-shaped values never belong in task, progress or evidence files.
const SECRET_RE = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;

export class TaskError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}

export const agentBranch = (agent) => `arena/agent-${agent.slice(-2)}`;
export const agentFromBranch = (branch) => { const m = /^arena\/agent-(0[1-9]|10)$/.exec(branch ?? ''); return m ? `AGENT-${m[1]}` : null; };

// ---------------------------------------------------------------- file format

function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

/** Parse a task file: `---` YAML-subset front matter (scalars, inline and block lists) plus a Markdown body. */
export function parseTask(text) {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) throw new TaskError('INVALID_TASK', 'missing --- front matter');
  const fields = {};
  let listKey = null;
  for (const raw of m[1].split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw) ?? /^-\s+(.*)$/.exec(raw);
    if (item && listKey) { fields[listKey].push(unquote(item[1])); continue; }
    const kv = /^([a-z_]+):\s*(.*)$/.exec(raw);
    if (!kv) throw new TaskError('INVALID_TASK', `cannot parse line: ${raw}`);
    const [, key, value] = kv;
    if (key in fields) throw new TaskError('INVALID_TASK', `duplicate field ${key}`);
    listKey = null;
    if (value === '' || value === '[]') {
      fields[key] = [];
      listKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      fields[key] = value.slice(1, -1).split(',').map(unquote).filter(Boolean);
    } else {
      fields[key] = unquote(value);
    }
  }
  // An empty scalar written as `key:` becomes [] above; keep scalars scalar.
  for (const [k, v] of Object.entries(fields)) if (Array.isArray(v) && !LIST_FIELDS.has(k) && v.length === 0) fields[k] = '';
  for (const k of LIST_FIELDS) if (!(k in fields)) fields[k] = [];
  return { fields, body: m[2] };
}

const needsQuote = (v) => v === '' || /^[\s[{#&*!|>'"%@`-]|: |\s#|\s$/.test(v);
const q = (v) => (needsQuote(v) ? JSON.stringify(v) : v);

export function serializeTask({ fields, body = '' }) {
  const keys = [...FIELD_ORDER.filter((k) => k in fields), ...Object.keys(fields).filter((k) => !FIELD_ORDER.includes(k)).sort()];
  const lines = [];
  for (const k of keys) {
    const v = fields[k];
    if (Array.isArray(v)) {
      if (!v.length) { lines.push(`${k}: []`); continue; }
      lines.push(`${k}:`);
      for (const x of v) lines.push(`  - ${q(String(x))}`);
    } else if (v !== undefined && v !== null && v !== '') {
      lines.push(`${k}: ${q(String(v))}`);
    }
  }
  return `---\n${lines.join('\n')}\n---\n${body.startsWith('\n') ? body : `\n${body}`}`;
}

// ----------------------------------------------------------------- validation

/** Structural validation of one task file. Returns a list of problems (empty = valid). */
export function validateTask(task, { branch } = {}) {
  const f = task.fields;
  const p = [];
  const req = (k) => { if (!f[k] || (Array.isArray(f[k]) && !f[k].length)) p.push(`${k} is required`); };
  ['id', 'title', 'slice', 'status'].forEach(req);
  if (f.id && !RE.id.test(f.id)) p.push(`id ${f.id} must look like Pn-Snn-NN, Pn-Mnn-NN or TASK-NNNN (no new milestone numbers)`);
  if (f.slice && !RE.slice.test(f.slice)) p.push(`slice ${f.slice} must look like Pn-Snn, Pn-Mnn or GOVERNANCE`);
  if (f.id && f.slice && RE.id.test(f.id) && f.id.startsWith('P') && !f.id.startsWith(`${f.slice}-`)) p.push(`id ${f.id} is not part of slice ${f.slice}`);
  if (f.status && !STATUSES.includes(f.status)) p.push(`status ${f.status} is not one of ${STATUSES.join(', ')}`);
  if (f.status && f.status !== 'UNASSIGNED') { req('owner'); req('branch'); }
  if (f.owner && !RE.agent.test(f.owner)) p.push(`owner ${f.owner} must be AGENT-01..AGENT-10`);
  if (f.owner && f.branch && RE.agent.test(f.owner) && f.branch !== agentBranch(f.owner)) p.push(`branch ${f.branch} does not belong to ${f.owner} (expected ${agentBranch(f.owner)})`);
  if (branch && f.branch && branch !== f.branch) p.push(`task belongs to ${f.branch} but is on ${branch}`);
  for (const d of f.depends_on) { if (!RE.id.test(d)) p.push(`depends_on ${d} is not a task id`); if (d === f.id) p.push('a task cannot depend on itself'); }
  for (const k of ['assigned_at', 'updated_at']) if (f[k] && !RE.iso.test(f[k])) p.push(`${k} must be an ISO-8601 UTC timestamp`);
  if (ACTIVE.has(f.status) && f.assigned_by !== 'MANAGER') p.push('assigned_by must be MANAGER');
  if (f.status === 'BLOCKED' && !f.blocked_reason) p.push('BLOCKED needs blocked_reason');
  if (f.status === 'COMPLETED') {
    if (f.completed_by !== 'MANAGER') p.push('COMPLETED needs completed_by: MANAGER');
    if (!RE.sha.test(f.merge_sha ?? '')) p.push('COMPLETED needs merge_sha (40-hex main commit)');
  }
  if (f.status === 'UNASSIGNED' && f.reassigned_to && !(RE.agent.test(f.reassigned_to) && f.reason)) p.push('a reassigned task needs reassigned_to AGENT-NN and reason');
  if (f.reassigned_from && !RE.agent.test(f.reassigned_from)) p.push('reassigned_from must be AGENT-NN');
  if (SECRET_RE.test(serializeTask(task))) p.push('task file contains credential-like material');
  return p;
}

// Status transitions per role. The same status is always allowed (field edits
// are checked separately). A new task id may only replace a finished one.
const TRANSITIONS = {
  agent: { ASSIGNED: ['WORKING'], WORKING: ['BLOCKED', 'READY_FOR_REVIEW'], BLOCKED: ['WORKING'], READY_FOR_REVIEW: ['WORKING'] },
  manager: {
    ASSIGNED: ['UNASSIGNED'], WORKING: ['UNASSIGNED'], BLOCKED: ['UNASSIGNED', 'WORKING'],
    READY_FOR_REVIEW: ['WORKING', 'COMPLETED', 'UNASSIGNED'],
  },
};

/** Check the change from `before` (may be null) to `after` for a role ('agent' | 'manager'). */
export function checkTransition(before, after, role) {
  const p = [];
  if (!TRANSITIONS[role]) return [`unknown role ${role}`];
  if (!after) return before && role === 'agent' ? ['an agent may not delete its task file'] : [];
  const a = after.fields;
  if (!before || before.fields.id !== a.id) {
    const prev = before?.fields.status;
    if (role === 'agent') p.push('only the Manager assigns a new task');
    else if (prev && ACTIVE.has(prev)) p.push(`${before.fields.id} is still ${prev}; one active task per agent (complete or reassign it first)`);
    else if (a.status !== 'ASSIGNED') p.push(`a new task starts as ASSIGNED, not ${a.status}`);
    return p;
  }
  const b = before.fields;
  if (b.status !== a.status && !(TRANSITIONS[role][b.status] ?? []).includes(a.status)) p.push(`${role} may not move ${a.id} from ${b.status} to ${a.status}`);
  if (role === 'agent') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (AGENT_MUTABLE.has(k)) continue;
      if (JSON.stringify(a[k] ?? '') !== JSON.stringify(b[k] ?? '')) p.push(`agent may not change ${k} (Manager field)`);
    }
  }
  return p;
}

// ------------------------------------------------------------------------ git

export function git(cwd, args, { allowFail = false, input } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw new TaskError('GIT_FAILED', `git ${args.join(' ')}: ${(r.stderr || r.stdout).trim()}`);
  return allowFail ? { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() } : r.stdout.trim();
}
const showFile = (cwd, ref, path) => { const r = git(cwd, ['show', `${ref}:${path}`], { allowFail: true }); return r.ok ? r.out + '\n' : null; };
const refExists = (cwd, ref) => git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true }).ok;
export const readTaskAt = (cwd, ref) => { const t = showFile(cwd, ref, TASK_PATH); return t ? parseTask(t) : null; };

function identityArgs(identity) {
  return ['-c', `user.name=${identity?.name ?? 'arena-manager'}`, '-c', `user.email=${identity?.email ?? 'arena-manager@arena.local'}`];
}

// ----------------------------------------------------------------------- lint

/**
 * Lint the working tree of an agent (or Manager) checkout before pushing.
 * base: ref holding the previous task state (default: the upstream of HEAD, else HEAD).
 */
export function lint({ cwd, role = 'agent', base, mainRef = 'origin/main' }) {
  const problems = [];
  const warnings = [];
  const branch = git(cwd, ['branch', '--show-current'], { allowFail: true }).out;
  const file = join(cwd, TASK_PATH);
  const after = existsSync(file) ? parseTask(readFileSync(file, 'utf8')) : null;
  if (role === 'agent' && !agentFromBranch(branch)) problems.push(`branch ${branch || '(detached)'} is not an agent branch arena/agent-NN`);
  if (after) problems.push(...validateTask(after, { branch: role === 'agent' ? branch : undefined }));
  else if (role === 'agent') warnings.push(`no ${TASK_PATH}: nothing assigned to this branch yet`);

  const baseRef = base ?? (git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { allowFail: true }).out || 'HEAD');
  const before = refExists(cwd, baseRef) ? readTaskAt(cwd, baseRef) : null;
  problems.push(...checkTransition(before, after, role));

  if (after) {
    const f = after.fields;
    const progressFile = join(cwd, PROGRESS_PATH);
    if (['WORKING', 'BLOCKED', 'READY_FOR_REVIEW'].includes(f.status)) {
      if (!existsSync(progressFile)) problems.push(`${f.status} needs ${PROGRESS_PATH}`);
      else if (!readFileSync(progressFile, 'utf8').includes(f.id)) problems.push(`${PROGRESS_PATH} does not mention ${f.id}`);
    }
    if (['READY_FOR_REVIEW', 'COMPLETED'].includes(f.status)) {
      const ev = join(cwd, EVIDENCE_DIR, `${f.id}.md`);
      if (!existsSync(ev)) problems.push(`${f.status} needs ${EVIDENCE_DIR}/${f.id}.md`);
      else {
        const t = readFileSync(ev, 'utf8');
        if (!/commit\s*:/i.test(t) || !/tests?\s*:/i.test(t)) problems.push(`${EVIDENCE_DIR}/${f.id}.md needs "Commit:" and "Tests:" lines`);
      }
    }
    for (const pth of [PROGRESS_PATH, join(EVIDENCE_DIR, `${f.id}.md`)]) {
      const full = join(cwd, pth);
      if (existsSync(full) && SECRET_RE.test(readFileSync(full, 'utf8'))) problems.push(`${pth} contains credential-like material`);
    }
  }

  // Agents read the rules; they never change them.
  if (role === 'agent') {
    if (refExists(cwd, mainRef)) {
      const mb = git(cwd, ['merge-base', 'HEAD', mainRef], { allowFail: true }).out;
      if (mb) {
        const changed = git(cwd, ['diff', '--name-only', mb, '--', ...RULE_PATHS]).split('\n').filter(Boolean);
        if (changed.length) problems.push(`agent branch changes governance files: ${changed.join(', ')}`);
      }
    } else warnings.push(`${mainRef} not found; governance-file check skipped (git fetch origin main)`);
  }
  return { ok: problems.length === 0, branch, role, base: baseRef, task: after?.fields ?? null, problems, warnings };
}

// --------------------------------------------------------------------- status

function agentRefs(cwd, remote) {
  const out = git(cwd, ['for-each-ref', '--format=%(refname:short)', `refs/remotes/${remote}/arena/`]);
  return out.split('\n').filter(Boolean).map((r) => ({ ref: r, branch: r.slice(remote.length + 1) }))
    .filter((x) => agentFromBranch(x.branch)).sort((x, y) => x.branch.localeCompare(y.branch));
}

/** Task ids proven done: COMPLETED on an agent branch, or evidence merged to main. */
function completedIds(cwd, rows, mainRef) {
  const done = new Set(rows.filter((r) => r.status === 'COMPLETED').map((r) => r.id));
  if (refExists(cwd, mainRef)) {
    const ls = git(cwd, ['ls-tree', '--name-only', `${mainRef}:${EVIDENCE_DIR}`], { allowFail: true });
    if (ls.ok) for (const n of ls.out.split('\n')) if (n.endsWith('.md')) done.add(n.slice(0, -3));
  }
  return done;
}

/** The Manager's overview: read every agent branch's task file. */
export function status({ cwd, remote = 'origin', mainRef, fetch = false, now = new Date(), staleHours = 24 }) {
  mainRef ??= `${remote}/main`;
  if (fetch) git(cwd, ['fetch', '--quiet', remote, '+refs/heads/main:refs/remotes/' + remote + '/main', '+refs/heads/arena/*:refs/remotes/' + remote + '/arena/*']);
  const rows = [];
  for (const { ref, branch } of agentRefs(cwd, remote)) {
    const agent = agentFromBranch(branch);
    const head = git(cwd, ['rev-parse', ref]);
    const lastCommitAt = git(cwd, ['log', '-1', '--format=%cI', ref]);
    let t = null; let problems = [];
    try { t = readTaskAt(cwd, ref); if (t) problems = validateTask(t, { branch }); } catch (e) { problems = [e.message]; }
    const f = t?.fields;
    if (f && f.owner && f.owner !== agent) problems.push(`owner ${f.owner} on ${branch}`);
    const ageHours = (now.getTime() - Date.parse(lastCommitAt)) / 3.6e6;
    const behindMain = refExists(cwd, mainRef) ? Number(git(cwd, ['rev-list', '--count', `${ref}..${mainRef}`])) : null;
    rows.push({
      agent, branch, head, lastCommitAt, id: f?.id ?? null, slice: f?.slice ?? null, title: f?.title ?? null,
      status: f?.status ?? 'IDLE', dependsOn: f?.depends_on ?? [], blockedReason: f?.blocked_reason ?? null,
      stale: Boolean(f && ACTIVE.has(f.status) && f.status !== 'READY_FOR_REVIEW' && ageHours > staleHours),
      behindMain, problems,
    });
  }
  const done = completedIds(cwd, rows, mainRef);
  for (const r of rows) r.unmetDependencies = r.dependsOn.filter((d) => !done.has(d));
  const counts = Object.fromEntries(['IDLE', ...STATUSES].map((s) => [s, rows.filter((r) => r.status === s).length]));
  return { mainRef, rows, counts, completed: [...done].sort(), invalid: rows.filter((r) => r.problems.length).length };
}

export function formatStatus(s) {
  const lines = ['AGENT     BRANCH           STATUS            TASK           SLICE      NOTES'];
  for (const r of s.rows) {
    const notes = [r.stale && 'STALE (reassign candidate)', r.unmetDependencies.length && `waits on ${r.unmetDependencies.join(',')}`,
      r.blockedReason && `blocked: ${r.blockedReason}`, r.problems.length && `INVALID: ${r.problems.join('; ')}`].filter(Boolean).join(' | ');
    lines.push(`${r.agent.padEnd(9)} ${r.branch.padEnd(16)} ${r.status.padEnd(17)} ${(r.id ?? '-').padEnd(14)} ${(r.slice ?? '-').padEnd(10)} ${notes}`);
  }
  lines.push(Object.entries(s.counts).map(([k, v]) => `${k}=${v}`).join(' '));
  return lines.join('\n');
}

// --------------------------------------------------- Manager write operations

/** Run fn inside a temporary worktree of `ref` (or of mainRef when ref is missing); commit and optionally push to `branch`. */
function onBranch(cwd, { remote, branch, mainRef, identity, push }, fn) {
  const remoteRef = `${remote}/${branch}`;
  const exists = refExists(cwd, remoteRef);
  const dir = mkdtempSync(join(tmpdir(), 'arena-task-'));
  git(cwd, ['worktree', 'add', '--quiet', '--detach', dir, exists ? remoteRef : mainRef]);
  try {
    const message = fn(dir, { created: !exists });
    if (!message) return { branch, pushed: false, changed: false };
    git(dir, ['add', '-A', '.arena']);
    if (!git(dir, ['status', '--porcelain']).length) return { branch, pushed: false, changed: false };
    git(dir, [...identityArgs(identity), 'commit', '--quiet', '-m', message]);
    const head = git(dir, ['rev-parse', 'HEAD']);
    // A plain fast-forward push; never forced.
    if (push) git(dir, ['push', '--quiet', remote, `HEAD:refs/heads/${branch}`]);
    git(cwd, ['update-ref', `refs/remotes/${remote}/${branch}`, head]);
    return { branch, head, pushed: Boolean(push), changed: true, created: !exists };
  } finally {
    git(cwd, ['worktree', 'remove', '--force', dir], { allowFail: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeWorkingFiles(dir, task, progressText) {
  mkdirSync(join(dir, '.arena'), { recursive: true });
  writeFileSync(join(dir, TASK_PATH), serializeTask(task));
  if (progressText !== undefined) writeFileSync(join(dir, PROGRESS_PATH), progressText);
}

export function progressTemplate(f, now) {
  return `# ${f.owner} progress\n\nTask: ${f.id} — ${f.title}\nStatus: ${f.status}\nStarted: ${now}\n\n## Done\n\n## Remaining\n\n## Evidence\n`;
}

function assertManagerTask(task) {
  const problems = validateTask(task);
  if (problems.length) throw new TaskError('INVALID_TASK', problems.join('; '));
}

/**
 * Assign a task: write .arena/task.md on the agent's branch (created from main
 * when missing), after bringing the branch up to date with main.
 */
export function assign({ cwd, agent, task: draft, remote = 'origin', mainRef, identity, push = false, now = new Date().toISOString(), carryFrom }) {
  mainRef ??= `${remote}/main`;
  if (!RE.agent.test(agent ?? '')) throw new TaskError('INVALID_AGENT', `agent ${agent}`);
  const branch = agentBranch(agent);
  const fields = { ...draft.fields, owner: agent, branch, status: 'ASSIGNED', assigned_by: 'MANAGER', assigned_at: now, updated_at: now };
  for (const k of ['completed_by', 'merge_sha', 'blocked_reason', 'reassigned_to', 'review_note']) delete fields[k];
  const task = { fields, body: draft.body ?? '' };
  assertManagerTask(task);

  // One owner per task id across all agent branches.
  const overview = status({ cwd, remote, mainRef });
  const holder = overview.rows.find((r) => r.id === fields.id && ACTIVE.has(r.status) && r.agent !== agent && r.agent !== carryFrom);
  if (holder) throw new TaskError('TASK_HELD', `${fields.id} is ${holder.status} on ${holder.branch}; reassign it instead`);
  if (overview.completed.includes(fields.id)) throw new TaskError('TASK_DONE', `${fields.id} is already completed`);
  const unmet = fields.depends_on.filter((d) => !overview.completed.includes(d));
  if (unmet.length) throw new TaskError('DEPENDENCY_BLOCKED', `${fields.id} waits on ${unmet.join(', ')}`);

  return onBranch(cwd, { remote, branch, mainRef, identity, push }, (dir, { created }) => {
    const current = existsSync(join(dir, TASK_PATH)) ? parseTask(readFileSync(join(dir, TASK_PATH), 'utf8')) : null;
    const p = checkTransition(current, task, 'manager');
    if (p.length) throw new TaskError('ASSIGN_REFUSED', p.join('; '));
    if (!created) {
      // Bring the workspace up to date with main. A finished task's code is
      // already on main (squash-integrated), so main wins any overlap.
      const finished = current && current.fields.status === 'COMPLETED';
      const r = git(dir, [...identityArgs(identity), 'merge', '--quiet', '--no-edit', ...(finished ? ['-X', 'theirs'] : []), mainRef], { allowFail: true });
      if (!r.ok) { git(dir, ['merge', '--abort'], { allowFail: true }); throw new TaskError('MERGE_CONFLICT', `${branch} does not merge ${mainRef} cleanly; resolve on the branch first`); }
    }
    if (carryFrom) {
      // Reassignment: continue from the previous owner's work, keeping its commits.
      const r = git(dir, [...identityArgs(identity), 'merge', '--quiet', '--no-edit', '-X', 'theirs', `${remote}/${agentBranch(carryFrom)}`], { allowFail: true });
      if (!r.ok) { git(dir, ['merge', '--abort'], { allowFail: true }); throw new TaskError('MERGE_CONFLICT', `cannot carry ${agentBranch(carryFrom)} into ${branch}`); }
    }
    writeWorkingFiles(dir, task, progressTemplate(fields, now));
    return `task: assign ${fields.id} to ${agent}${carryFrom ? ` (reassigned from ${carryFrom})` : ''}`;
  });
}

function updateOwnTask(cwd, { agent, remote, mainRef, identity, push, expectStatus, mutate, message }) {
  const branch = agentBranch(agent);
  return onBranch(cwd, { remote, branch, mainRef: mainRef ?? `${remote}/main`, identity, push }, (dir) => {
    const file = join(dir, TASK_PATH);
    if (!existsSync(file)) throw new TaskError('NO_TASK', `${branch} has no ${TASK_PATH}`);
    const before = parseTask(readFileSync(file, 'utf8'));
    if (expectStatus && !expectStatus.includes(before.fields.status)) throw new TaskError('WRONG_STATUS', `${before.fields.id} is ${before.fields.status}, expected ${expectStatus.join(' or ')}`);
    const after = { fields: { ...before.fields }, body: before.body };
    mutate(after.fields, dir);
    const p = [...validateTask(after, { branch }), ...checkTransition(before, after, 'manager')];
    if (p.length) throw new TaskError('INVALID_TASK', p.join('; '));
    writeFileSync(file, serializeTask(after));
    return message(after.fields);
  });
}

/** Hybrid reassignment (DEC-0017): release the task on the old branch, then assign it to another agent carrying the work. */
export function reassign({ cwd, from, to, reason, remote = 'origin', mainRef, identity, push = false, now = new Date().toISOString() }) {
  if (!reason) throw new TaskError('REASON_REQUIRED', 'reassignment needs a reason');
  if (from === to) throw new TaskError('INVALID_AGENT', 'successor must differ from the current owner');
  const current = readTaskAt(cwd, `${remote}/${agentBranch(from)}`);
  if (!current || !ACTIVE.has(current.fields.status)) throw new TaskError('NO_ACTIVE_TASK', `${from} has no active task`);
  const released = updateOwnTask(cwd, {
    agent: from, remote, mainRef, identity, push, expectStatus: [...ACTIVE],
    mutate: (f) => { f.status = 'UNASSIGNED'; f.reassigned_to = to; f.reason = reason; f.updated_at = now; },
    message: (f) => `task: release ${f.id} from ${from} (reassigned to ${to}: ${reason})`,
  });
  const draft = { fields: { ...current.fields, reassigned_from: from, reason }, body: current.body };
  delete draft.fields.reassigned_to;
  const assigned = assign({ cwd, agent: to, task: draft, remote, mainRef, identity, push, now, carryFrom: from });
  return { released, assigned };
}

export function rework({ cwd, agent, note, remote = 'origin', mainRef, identity, push = false, now = new Date().toISOString() }) {
  if (!note) throw new TaskError('NOTE_REQUIRED', 'rework needs a review note');
  return updateOwnTask(cwd, {
    agent, remote, mainRef, identity, push, expectStatus: ['READY_FOR_REVIEW'],
    mutate: (f) => { f.status = 'WORKING'; f.review_note = note; f.updated_at = now; },
    message: (f) => `task: rework ${f.id} (${note})`,
  });
}

/** COMPLETED only after the Slice PR merged: merge_sha must be on main. */
export function complete({ cwd, agent, mergeSha, remote = 'origin', mainRef, identity, push = false, now = new Date().toISOString() }) {
  mainRef ??= `${remote}/main`;
  if (!RE.sha.test(mergeSha ?? '')) throw new TaskError('INVALID_SHA', 'merge SHA must be a full 40-hex commit');
  if (!git(cwd, ['merge-base', '--is-ancestor', mergeSha, mainRef], { allowFail: true }).ok) throw new TaskError('NOT_ON_MAIN', `${mergeSha} is not on ${mainRef}`);
  return updateOwnTask(cwd, {
    agent, remote, mainRef, identity, push, expectStatus: ['READY_FOR_REVIEW'],
    mutate: (f, dir) => {
      if (!git(dir, ['cat-file', '-e', `${mergeSha}:${EVIDENCE_DIR}/${f.id}.md`], { allowFail: true }).ok) throw new TaskError('NO_EVIDENCE_ON_MAIN', `${EVIDENCE_DIR}/${f.id}.md is not in ${mergeSha}`);
      f.status = 'COMPLETED'; f.completed_by = 'MANAGER'; f.merge_sha = mergeSha; f.updated_at = now; delete f.review_note;
    },
    message: (f) => `task: complete ${f.id} (merged ${mergeSha.slice(0, 12)})`,
  });
}

/**
 * Build or extend the ONE Slice delivery branch (DEC-0014) from agent branches.
 * Each agent's work is applied as a squash of its branch diff against main,
 * excluding the per-agent working files, so main never receives task.md or
 * progress.md and agent branches keep their history untouched.
 */
export function integrate({ cwd, slice, agents, remote = 'origin', mainRef, branch, identity, push = false }) {
  mainRef ??= `${remote}/main`;
  if (!RE.slice.test(slice ?? '')) throw new TaskError('INVALID_SLICE', `slice ${slice}`);
  if (!agents?.length) throw new TaskError('NO_AGENTS', 'name at least one agent');
  branch ??= `arena/manager/${slice}`;
  const picks = agents.map((agent) => {
    const ref = `${remote}/${agentBranch(agent)}`;
    const t = readTaskAt(cwd, ref);
    if (!t) throw new TaskError('NO_TASK', `${ref} has no task`);
    if (t.fields.slice !== slice) throw new TaskError('WRONG_SLICE', `${t.fields.id} belongs to ${t.fields.slice}`);
    if (t.fields.status !== 'READY_FOR_REVIEW') throw new TaskError('WRONG_STATUS', `${t.fields.id} is ${t.fields.status}, expected READY_FOR_REVIEW`);
    return { agent, ref, id: t.fields.id, head: git(cwd, ['rev-parse', ref]) };
  });
  const remoteRef = `${remote}/${branch}`;
  const dir = mkdtempSync(join(tmpdir(), 'arena-slice-'));
  git(cwd, ['worktree', 'add', '--quiet', '--detach', dir, refExists(cwd, remoteRef) ? remoteRef : mainRef]);
  try {
    const applied = [];
    for (const pk of picks) {
      const mb = git(dir, ['merge-base', mainRef, pk.ref]);
      const patch = git(dir, ['diff', '--binary', mb, pk.ref, '--', '.', ...AGENT_LOCAL_PATHS.map((x) => `:(exclude)${x}`)]);
      if (!patch) continue;
      const r = git(dir, ['apply', '--3way', '--index', '--whitespace=nowarn'], { allowFail: true, input: `${patch}\n` });
      if (!r.ok) throw new TaskError('INTEGRATION_CONFLICT', `${pk.id} from ${pk.ref} does not apply: ${r.err}`);
      if (git(dir, ['diff', '--cached', '--quiet'], { allowFail: true }).ok) continue; // already integrated
      git(dir, [...identityArgs(identity), 'commit', '--quiet', '-m', `${slice}: integrate ${pk.id} from ${agentBranch(pk.agent)} @ ${pk.head.slice(0, 12)}`]);
      applied.push(pk.id);
    }
    for (const x of AGENT_LOCAL_PATHS) if (existsSync(join(dir, x))) throw new TaskError('LEAK', `${x} would reach main`);
    const head = git(dir, ['rev-parse', 'HEAD']);
    if (applied.length && push) git(dir, ['push', '--quiet', remote, `HEAD:refs/heads/${branch}`]);
    if (applied.length) git(cwd, ['update-ref', `refs/remotes/${remote}/${branch}`, head]);
    return { branch, head, applied, pushed: Boolean(applied.length && push) };
  } finally {
    git(cwd, ['worktree', 'remove', '--force', dir], { allowFail: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

export function readDraft(path) {
  if (!existsSync(path)) throw new TaskError('NO_DRAFT', `${path} not found`);
  return parseTask(readFileSync(path, 'utf8'));
}
