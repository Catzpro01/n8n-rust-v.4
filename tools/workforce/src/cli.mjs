#!/usr/bin/env node
// Workforce control-plane CLI.
//
//   node tools/workforce/src/cli.mjs <command> [--state DIR] [--now ISO]
//
//   validate-policy               validate docs/engineering-operations/workforce/policy.json
//   bootstrap                     register the MANAGER / SYSTEM / HUMAN actor identities (idempotent)
//   exec <file.json|->            execute one command envelope, print the structured result
//   plan                          scheduler plan (assignments, deferrals, concurrency, alerts)
//   reconcile                     read-only recovery / integrity / event-log report
//   recover                       roll a pending journal forward + apply SAFE expiries only
//   status                        MANAGER STATUS (§47)
//   render <outDir>               write derived Manager memory views (AGENTS.md, TASKS.md, …)
//   decisions-check               validate the canonical decision records on disk
//   checks <jobs.json|->          DEC-0015 merge verdict for exact-head jobs ({ jobs, onlineRunners? })
//
// Live worker session runtime (#295; operational state under --runtime, default .arena/workforce-runtime):
//   worker-bootstrap [--out DIR] [--url URL] [--workspace-root DIR] [--heartbeat-interval S] [--lost-after S]
//                    [--lease-renew-below S] [--ack-timeout S] [--rotate true]
//                                 register missing canonical slots; write one 0600 bootstrap bundle per slot
//   worker-register --bundle FILE --session-id ID --session-out FILE [--workspace DIR] [--kind arena-session|local-harness]
//   worker-heartbeat --session FILE   worker-poll --session FILE   worker-claim --session FILE
//   worker-report --session FILE --status S [--head SHA] [--pr N] [--summary TEXT]
//   assign-ready --fill N --main SHA  reconcile, then offer READY work to live IDLE sessions only
//   runtime-status [--json true]      slot / session / task / lease matrix + acceptance status
//   runtime-reconcile [--main SHA] [--dry-run true]   loss detection, recovery, slot activation
//   runtime-serve [--host H] [--port P] [--manager-loop-ms MS --main SHA --fill N]   HTTP session transport
//   runtime-gate [--record true]      evaluate the live acceptance gate from observed runtime events
//
// plan / status / render accept --runners WINDOWS=n,WSL=n (observed online self-hosted pool, DEC-0015);
// without it runner availability is unknown and runner-required work stays WAITING_RUNNER.
//
// Exit codes: 0 ok, 1 command rejected / findings, 2 usage error.
// State lives OUTSIDE git by default (.arena/workforce-state is gitignored operational state).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ControlPlane } from './engine.mjs';
import { loadPolicy, isoNow } from './core.mjs';
import { plan } from './scheduler.mjs';
import { classifyChecks, formatChecks } from './checks.mjs';
import { reconcile, applySafeRecovery, snapshot } from './recovery.mjs';
import { renderMemory, statusReport } from './render.mjs';
import { validate, REPO_ROOT, WORKFORCE_DOCS } from './schema.mjs';
import { WorkforceRuntime } from './assignment-runtime.mjs';
import { createSessionServer } from '../../arena-session/transport.mjs';

const BOOTSTRAP_ACTORS = [
  { id: 'MANAGER-01', type: 'MANAGER', displayName: 'Arena Manager' },
  { id: 'HUMAN-OWNER', type: 'HUMAN', displayName: 'Repository owner' },
  { id: 'SYSTEM-CI', type: 'SYSTEM' },
  { id: 'SYSTEM-GITHUB-WEBHOOK', type: 'SYSTEM' },
  { id: 'SYSTEM-HEARTBEAT', type: 'SYSTEM' },
  { id: 'SYSTEM-RECOVERY', type: 'SYSTEM' },
  { id: 'SYSTEM-MERGE-EXECUTOR', type: 'SYSTEM' },
  { id: 'SYSTEM-MERGE-CLASSIFIER', type: 'SYSTEM' },
];

/** --runners WINDOWS=0,WSL=2 -> { WINDOWS: 0, WSL: 2 }; absent -> undefined (unknown, fail closed). */
export function parseRunners(v) {
  if (v === undefined) return undefined;
  const out = {};
  for (const part of String(v).split(',').filter(Boolean)) {
    const [k, n] = part.split('=');
    if (!['WINDOWS', 'WSL'].includes(k) || !/^[0-9]+$/.test(n ?? '')) throw new Error(`--runners expects WINDOWS=n,WSL=n, got ${part}`);
    out[k] = Number(n);
  }
  return out;
}

function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) { args[a.slice(2)] = argv[i + 1]; i += 1; } else args._.push(a);
  }
  return args;
}

export function checkDecisionRecords(dir = join(WORKFORCE_DOCS, 'decisions')) {
  const problems = [];
  const records = [];
  let files = [];
  try { files = readdirSync(dir).filter((f) => /^DEC-\d{4,}\.json$/.test(f)).sort(); } catch { return { records, problems: [`missing ${dir}`] }; }
  for (const f of files) {
    let d;
    try { d = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) { problems.push(`${f}: ${e.message}`); continue; }
    const errs = validate('Decision', d);
    if (errs.length) problems.push(...errs.map((e) => `${f}: ${e}`));
    if (`${d.objectId}.json` !== f) problems.push(`${f}: objectId ${d.objectId} does not match the file name`);
    records.push(d);
  }
  const ids = new Set(records.map((d) => d.objectId));
  for (const d of records) {
    if (d.supersedes && !ids.has(d.supersedes)) problems.push(`${d.objectId}: supersedes unknown ${d.supersedes}`);
    if (d.supersededBy && !ids.has(d.supersededBy)) problems.push(`${d.objectId}: supersededBy unknown ${d.supersededBy}`);
    if (d.state === 'ACTIVE' && d.supersededBy) problems.push(`${d.objectId}: ACTIVE but superseded`);
  }
  return { records, problems };
}

export function main(argv = process.argv.slice(2), io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  const args = parse(argv);
  const cmd = args._[0];
  const now = args.now ?? isoNow();
  const stateDir = resolve(args.state ?? join(REPO_ROOT, '.arena', 'workforce-state'));
  const json = (v) => io.out(`${JSON.stringify(v, null, 2)}\n`);
  switch (cmd) {
    case 'validate-policy': { const p = loadPolicy(); json({ ok: true, path: p.path, digest: p.digest }); return 0; }
    case 'checks': {
      const src = args._[1];
      if (!src) { io.err('usage: checks <jobs.json|->\n'); return 2; }
      const input = JSON.parse(readFileSync(src === '-' ? 0 : src, 'utf8'));
      const r = classifyChecks(input.jobs ?? [], { onlineRunners: input.onlineRunners });
      json({ ...r, summary: formatChecks(r) });
      return r.mergeAllowed ? 0 : 1;
    }
    case 'decisions-check': { const r = checkDecisionRecords(); json({ ok: r.problems.length === 0, decisions: r.records.map((d) => `${d.objectId}:${d.state}`), problems: r.problems }); return r.problems.length ? 1 : 0; }
  }
  if (cmd?.startsWith('worker-') || cmd?.startsWith('runtime-') || cmd === 'assign-ready') return runtimeMain(cmd, args, stateDir, io, json);
  const cp = new ControlPlane({ stateDir, now: () => now });
  const runners = parseRunners(args.runners);
  const repo = { main: args.main, arenaManager: args['arena-manager'], runners };
  switch (cmd) {
    case 'bootstrap': json({ ok: true, actors: cp.bootstrapActors(BOOTSTRAP_ACTORS) }); return 0;
    case 'exec': {
      const src = args._[1];
      if (!src) { io.err('usage: exec <file.json|->\n'); return 2; }
      const command = JSON.parse(readFileSync(src === '-' ? 0 : src, 'utf8'));
      const result = cp.execute(command);
      json(result);
      return result.ok ? 0 : 1;
    }
    case 'plan': { const s = snapshot(cp.store); json(plan({ tasks: s.Task, agents: s.AgentState, reservations: s.Reservation, runners }, cp.policy, now)); return 0; }
    case 'reconcile': { const r = reconcile(cp.store, cp.policy, now); json(r); return r.findings.length ? 1 : 0; }
    case 'recover': { const r = applySafeRecovery(cp, now); json({ journal: r.journal, applied: r.applied, remaining: r.remaining.findings.length }); return 0; }
    case 'status': io.out(statusReport(cp, now, repo)); return 0;
    case 'render': {
      const out = resolve(args._[1] ?? join(stateDir, 'memory'));
      mkdirSync(out, { recursive: true });
      const files = renderMemory(cp, now, repo);
      for (const [name, text] of Object.entries(files)) writeFileSync(join(out, name), text);
      json({ ok: true, out, files: Object.keys(files) });
      return 0;
    }
    default:
      io.err('usage: cli.mjs <validate-policy|decisions-check|checks|bootstrap|exec|plan|reconcile|recover|status|render|worker-*|assign-ready|runtime-*> [--state DIR] [--now ISO]\n');
      return 2;
  }
}

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writePrivate(path, obj) { writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 }); }
const rkey = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Text matrix for runtime-status (#295 §16). */
export function formatRuntimeStatus(st) {
  const cols = ['slot', 'slotState', 'sessionId', 'sessionState', 'sessionKind', 'heartbeatAgeSeconds', 'taskId', 'taskState', 'assignmentStatus', 'leaseId', 'leaseExpiresAt', 'runnerClass', 'workspace'];
  const cell = (v) => (v === null || v === undefined ? '-' : String(v));
  const lines = [`WORKFORCE RUNTIME ${st.runtimeVersion} @ ${st.at}`, `ACCEPTANCE: ${st.acceptance}   live sessions: ${st.liveSessions}/10 ${JSON.stringify(st.liveSessionKinds)}   pending recovery: ${st.pendingRecovery}   live gate: ${st.liveGate?.status ?? 'NOT_EVALUATED'}`];
  if (st.integrity.length) lines.push(`INTEGRITY FINDINGS: ${JSON.stringify(st.integrity)}`);
  lines.push(`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`);
  for (const r of st.slots) lines.push(`| ${cols.map((c) => cell(r[c])).join(' | ')} |`);
  return `${lines.join('\n')}\n`;
}

function runtimeMain(cmd, args, stateDir, io, json) {
  const clock = args.now ? () => args.now : () => isoNow();
  const cp = new ControlPlane({ stateDir, now: clock });
  const rt = new WorkforceRuntime({ cp, dir: resolve(args.runtime ?? join(REPO_ROOT, '.arena', 'workforce-runtime')), now: clock });
  const need = (k) => { if (args[k] === undefined) throw Object.assign(new Error(`--${k} is required`), { usage: true }); return args[k]; };
  const session = () => readJson(need('session'));
  const fail2 = (e) => { if (e.usage) { io.err(`${e.message}\n`); return 2; } json({ ok: false, error: { code: e.code ?? 'INTERNAL', message: e.message, details: e.details } }); return 1; };
  try {
    switch (cmd) {
      case 'worker-bootstrap': {
        const config = {};
        if (args.url) config.transport = { kind: 'http', url: args.url };
        if (args['workspace-root']) config.workspaceRoot = args['workspace-root'];
        if (args['heartbeat-interval']) config.heartbeatIntervalSeconds = Number(args['heartbeat-interval']);
        if (args['lost-after']) config.sessionLostSeconds = Number(args['lost-after']);
        if (args['lease-renew-below']) config.leaseRenewBelowSeconds = Number(args['lease-renew-below']);
        if (args['ack-timeout']) config.offerAckTimeoutSeconds = Number(args['ack-timeout']);
        const r = rt.bootstrap({ config, rotate: args.rotate === 'true' });
        const out = resolve(args.out ?? join(rt.store.dir, 'bootstrap'));
        mkdirSync(out, { recursive: true, mode: 0o700 });
        const files = [];
        for (const b of r.bundles) { if (b.enrollment.token) { const f = join(out, `${b.agentId}.json`); writePrivate(f, b); files.push(f); } }
        // Enrollment credentials go to 0600 files only; they are never printed.
        json({ ok: true, slots: r.slots, bundlesWritten: files, unchanged: r.bundles.filter((b) => !b.enrollment.token).map((b) => b.agentId), note: 'bootstrap files do not make a slot ONLINE; a session must register and heartbeat' });
        return 0;
      }
      case 'worker-register': {
        const b = readJson(need('bundle'));
        const r = rt.register({ agentId: b.agentId, sessionId: need('session-id'), enrollmentToken: b.enrollment?.token, protocolVersion: b.protocolVersion, capabilities: b.capabilities, runnerClass: args['runner-class'] ?? b.runnerClass, workspace: args.workspace ?? b.workspace, branch: b.branch, sessionKind: args.kind ?? 'local-harness', transport: 'inproc', idempotencyKey: rkey('register') });
        writePrivate(resolve(need('session-out')), { sessionId: r.session.sessionId, agentId: r.session.agentId, sessionToken: r.sessionToken });
        rt.ready({ sessionId: r.session.sessionId, agentId: r.session.agentId, sessionToken: r.sessionToken, idempotencyKey: rkey('ready') });
        json({ ok: true, sessionId: r.session.sessionId, agentId: r.session.agentId, sessionState: 'IDLE', generation: r.session.generation });
        return 0;
      }
      case 'worker-poll': json(rt.poll(session())); return 0;
      case 'worker-heartbeat': {
        const me = session();
        const cur = rt.poll(me).assignment;
        json(rt.heartbeat({ ...me, assignmentId: cur?.assignmentId, leaseId: cur?.leaseId, timestamp: clock(), sessionState: cur ? 'WORKING' : 'IDLE', idempotencyKey: rkey('hb') }));
        return 0;
      }
      case 'worker-claim': {
        const me = session();
        const cur = rt.poll(me).assignment;
        if (!cur) { json({ ok: false, error: { code: 'NOT_FOUND', message: 'no assignment is offered to this session' } }); return 1; }
        json(rt.claim({ ...me, assignmentId: args.assignment ?? cur.assignmentId, leaseId: cur.leaseId, taskRevision: cur.taskRevision, idempotencyKey: `ack-${cur.assignmentId}` }));
        return 0;
      }
      case 'worker-report': {
        const me = session();
        const cur = rt.poll(me).assignment;
        if (!cur) { json({ ok: false, error: { code: 'NOT_FOUND', message: 'no active assignment for this session' } }); return 1; }
        json(rt.report({ ...me, assignmentId: cur.assignmentId, status: need('status'), ...(args.head ? { headSha: args.head } : {}), ...(args.pr ? { prNumber: Number(args.pr) } : {}), ...(args.summary ? { summary: args.summary } : {}), idempotencyKey: rkey('report') }));
        return 0;
      }
      case 'assign-ready': { const r = rt.assignReady({ fill: Number(args.fill ?? 10), mainSha: need('main'), runners: parseRunners(args.runners) }); json(r); return 0; }
      case 'runtime-reconcile': json(rt.reconcile({ dryRun: args['dry-run'] === 'true', mainSha: args.main ?? null })); return 0;
      case 'runtime-status': { const st = rt.status(); if (args.json === 'true') json(st); else io.out(formatRuntimeStatus(st)); return 0; }
      case 'runtime-gate': { const g = rt.evaluateLiveGate({ record: args.record === 'true' }); json(g); return g.status === 'PASS' ? 0 : 1; }
      case 'runtime-serve': {
        const loopMs = args['manager-loop-ms'] ? Number(args['manager-loop-ms']) : null;
        const server = createSessionServer({ runtime: rt, managerLoop: loopMs ? { intervalMs: loopMs, mainSha: need('main'), fill: Number(args.fill ?? 10), runners: parseRunners(args.runners) } : null, log: (o) => io.out(`${JSON.stringify({ at: clock(), ...o })}\n`) });
        const port = Number(args.port ?? 8795);
        server.listen(port, args.host ?? '127.0.0.1', () => io.out(`${JSON.stringify({ ok: true, listening: `${args.host ?? '127.0.0.1'}:${port}`, managerLoopMs: loopMs })}\n`));
        return 0;
      }
      default: io.err(`unknown runtime command ${cmd}\n`); return 2;
    }
  } catch (e) { return fail2(e); }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main();
