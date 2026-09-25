#!/usr/bin/env node
// npm run arena:task -- <command>   (DEC-0017 git-native task model)
//
// Agent:    lint                                   check your branch before every push
// Manager:  status [--fetch] [--json]              every agent branch at a glance
//           assign --agent AGENT-03 --task draft.md [--push]
//           reassign --from AGENT-01 --to AGENT-04 --reason "..." [--push]
//           rework --agent AGENT-03 --note "..." [--push]
//           integrate --slice P5-M04 --agents AGENT-01,AGENT-02 [--push]
//           complete --agent AGENT-03 --merge-sha <40-hex> [--push]
//
// No command reads, prints or stores a credential. `--push` uses whatever git
// credential the caller's environment already provides, and never force-pushes.

import { pathToFileURL } from 'node:url';
import { assign, complete, formatStatus, integrate, lint, readDraft, reassign, rework, status, TaskError } from './git-tasks.mjs';

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const [k, v] = a.slice(2).split('=', 2);
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

const USAGE = 'usage: arena:task <lint|status|assign|reassign|rework|integrate|complete> [options]  (see .arena/WORKFLOW.md)\n';

export function main(argv = process.argv.slice(2), io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }, cwd = process.cwd()) {
  const a = parse(argv);
  const json = (v) => io.out(`${JSON.stringify(v, null, 2)}\n`);
  const common = { cwd, remote: a.remote ?? 'origin', mainRef: a.main, push: a.push === true, now: a.now };
  if (!common.now) delete common.now;
  try {
    switch (a._[0]) {
      case 'lint': {
        const r = lint({ cwd, role: a.role ?? 'agent', base: a.base, mainRef: a.main ?? `${common.remote}/main` });
        if (a.json) json(r);
        else {
          for (const w of r.warnings) io.out(`warn: ${w}\n`);
          for (const p of r.problems) io.out(`FAIL: ${p}\n`);
          io.out(r.ok ? `OK ${r.task ? `${r.task.id} ${r.task.status}` : '(no task)'} on ${r.branch}\n` : `LINT FAILED (${r.problems.length})\n`);
        }
        return r.ok ? 0 : 1;
      }
      case 'status': {
        const s = status({ ...common, fetch: a.fetch === true, staleHours: a['stale-hours'] ? Number(a['stale-hours']) : 24, now: a.now ? new Date(a.now) : new Date() });
        if (a.json) json(s); else io.out(`${formatStatus(s)}\n`);
        return s.invalid ? 1 : 0;
      }
      case 'assign': {
        if (!a.agent || !a.task) { io.err('usage: assign --agent AGENT-NN --task <draft.md> [--push]\n'); return 2; }
        json(assign({ ...common, agent: a.agent, task: readDraft(a.task) }));
        return 0;
      }
      case 'reassign': {
        if (!a.from || !a.to || !a.reason) { io.err('usage: reassign --from AGENT-NN --to AGENT-NN --reason "..." [--push]\n'); return 2; }
        json(reassign({ ...common, from: a.from, to: a.to, reason: a.reason }));
        return 0;
      }
      case 'rework': {
        if (!a.agent || !a.note) { io.err('usage: rework --agent AGENT-NN --note "..." [--push]\n'); return 2; }
        json(rework({ ...common, agent: a.agent, note: a.note }));
        return 0;
      }
      case 'integrate': {
        if (!a.slice || !a.agents) { io.err('usage: integrate --slice Pn-Snn --agents AGENT-01,AGENT-02 [--branch b] [--push]\n'); return 2; }
        json(integrate({ ...common, slice: a.slice, agents: String(a.agents).split(','), branch: a.branch }));
        return 0;
      }
      case 'complete': {
        if (!a.agent || !a['merge-sha']) { io.err('usage: complete --agent AGENT-NN --merge-sha <40-hex> [--push]\n'); return 2; }
        json(complete({ ...common, agent: a.agent, mergeSha: a['merge-sha'] }));
        return 0;
      }
      default:
        io.err(USAGE);
        return 2;
    }
  } catch (e) {
    if (e instanceof TaskError) { io.err(`${e.message}\n`); return 1; }
    throw e;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main();
