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
//
// Exit codes: 0 ok, 1 command rejected / findings, 2 usage error.
// State lives OUTSIDE git by default (.arena/workforce-state is gitignored operational state).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ControlPlane } from './engine.mjs';
import { loadPolicy, isoNow } from './core.mjs';
import { plan } from './scheduler.mjs';
import { reconcile, applySafeRecovery, snapshot } from './recovery.mjs';
import { renderMemory, statusReport } from './render.mjs';
import { validate, REPO_ROOT, WORKFORCE_DOCS } from './schema.mjs';

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
    case 'decisions-check': { const r = checkDecisionRecords(); json({ ok: r.problems.length === 0, decisions: r.records.map((d) => `${d.objectId}:${d.state}`), problems: r.problems }); return r.problems.length ? 1 : 0; }
  }
  const cp = new ControlPlane({ stateDir, now: () => now });
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
    case 'plan': { const s = snapshot(cp.store); json(plan({ tasks: s.Task, agents: s.AgentState, reservations: s.Reservation }, cp.policy, now)); return 0; }
    case 'reconcile': { const r = reconcile(cp.store, cp.policy, now); json(r); return r.findings.length ? 1 : 0; }
    case 'recover': { const r = applySafeRecovery(cp, now); json({ journal: r.journal, applied: r.applied, remaining: r.remaining.findings.length }); return 0; }
    case 'status': io.out(statusReport(cp, now, { main: args.main, arenaManager: args['arena-manager'] })); return 0;
    case 'render': {
      const out = resolve(args._[1] ?? join(stateDir, 'memory'));
      mkdirSync(out, { recursive: true });
      const files = renderMemory(cp, now, { main: args.main, arenaManager: args['arena-manager'] });
      for (const [name, text] of Object.entries(files)) writeFileSync(join(out, name), text);
      json({ ok: true, out, files: Object.keys(files) });
      return 0;
    }
    default:
      io.err('usage: cli.mjs <validate-policy|decisions-check|bootstrap|exec|plan|reconcile|recover|status|render> [--state DIR] [--now ISO]\n');
      return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main();
