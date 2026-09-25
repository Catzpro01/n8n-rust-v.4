#!/usr/bin/env node
// npm run arena:task -- <command>   (DEC-0017 git-native task model)
//
// Agent:    lint                                   check your branch before every push
//   pipeline agents (DEC-0018, AGENT-02..10):
//           next [--push]                          take the next READY task from your pool
//           result --summary "..." [--limitations ..] [--next ..] [--push]
//           block --reason "..." | unblock          [--push]
// Manager:  status [--fetch] [--json]              every agent branch at a glance
//           queue [--write] [--json]               integration queue per Slice (pipeline pools)
//           pool-init --agent AGENT-02 [--push]    make an agent branch a pipeline workspace
//           assign --agent AGENT-03 --task draft.md [--push]         (pool: queued READY/ASSIGNED)
//           reassign --from A --to B --reason ".." [--task ID] [--push]
//           rework --agent A [--task ID] --note ".." [--push]
//           integrate --slice P5-M04 [--tasks ID,ID | --agents A,B] [--push]
//           complete --agent A [--task ID] --merge-sha <40-hex> [--push]
//
// No command reads, prints or stores a credential. `--push` uses whatever git
// credential the caller's environment already provides, and never force-pushes.

import { pathToFileURL } from 'node:url';
import { agentBranch, assign, complete, formatStatus, integrate, lint, readDraft, reassign, rework, status, TaskError } from './git-tasks.mjs';
import {
  block, CURRENT_PATH, formatQueue, lintPool, next, poolAssign, poolComplete, poolInit, poolIntegrate, poolOverview, poolReassign, poolRework,
  queue, readPool, result, writeQueueIndex,
} from './git-pool.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

const USAGE = 'usage: arena:task <lint|next|result|block|unblock|status|queue|pool-init|assign|reassign|rework|integrate|complete> [options]  (see .arena/WORKFLOW.md)\n';
const isPoolRef = (cwd, remote, agent) => { try { return Boolean(readPool({ cwd, ref: `${remote}/${agentBranch(agent)}` })); } catch { return false; } };

export function main(argv = process.argv.slice(2), io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }, cwd = process.cwd()) {
  const a = parse(argv);
  const json = (v) => io.out(`${JSON.stringify(v, null, 2)}\n`);
  const common = { cwd, remote: a.remote ?? 'origin', mainRef: a.main, push: a.push === true, now: a.now };
  if (!common.now) delete common.now;
  try {
    switch (a._[0]) {
      case 'lint': {
        if (existsSync(join(cwd, CURRENT_PATH))) {
          const problems = lintPool({ cwd, base: a.base, mainRef: a.main ?? `${common.remote}/main` });
          for (const p of problems) io.out(`FAIL: ${p}\n`);
          io.out(problems.length ? `LINT FAILED (${problems.length})\n` : 'OK pipeline workspace\n');
          return problems.length ? 1 : 0;
        }
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
        const ov = poolOverview(common);
        const pools = new Set(ov.agents.map((x) => x.agent));
        s.rows = s.rows.filter((r) => !pools.has(r.agent));
        if (a.json) { json({ ...s, pipeline: ov }); return s.invalid || ov.agents.some((x) => x.problems.length) ? 1 : 0; }
        io.out(`${formatStatus(s)}\n`);
        if (ov.agents.length) {
          io.out('\nPIPELINE (DEC-0018)\nAGENT     CURRENT            POOL                                             RESULTS\n');
          for (const x of ov.agents) {
            const count = (st) => x.tasks.filter((t) => t.status === st).length;
            const poolTxt = `ready ${count('READY')} waiting ${count('ASSIGNED')} working ${count('WORKING') + count('BLOCKED')} review ${count('READY_FOR_REVIEW')} done ${count('COMPLETED')}`;
            const cur = x.current.status === 'IDLE' ? 'IDLE' : `${x.current.task_id} ${x.current.status}`;
            io.out(`${x.agent.padEnd(9)} ${cur.padEnd(18)} ${poolTxt.padEnd(48)} ${x.results.filter((r) => r.status === 'READY_FOR_REVIEW').length} ready${x.problems.length ? `  INVALID: ${x.problems.join('; ')}` : ''}\n`);
          }
        }
        return s.invalid || ov.agents.some((x) => x.problems.length) ? 1 : 0;
      }
      case 'assign': {
        if (!a.agent || !a.task) { io.err('usage: assign --agent AGENT-NN --task <draft.md> [--push]\n'); return 2; }
        const draft = readDraft(a.task);
        json(isPoolRef(cwd, common.remote, a.agent) ? poolAssign({ ...common, agent: a.agent, task: draft }) : assign({ ...common, agent: a.agent, task: draft }));
        return 0;
      }
      case 'reassign': {
        if (!a.from || !a.to || !a.reason) { io.err('usage: reassign --from AGENT-NN --to AGENT-NN --reason "..." [--push]\n'); return 2; }
        json(a.task ? poolReassign({ ...common, from: a.from, to: a.to, id: a.task, reason: a.reason }) : reassign({ ...common, from: a.from, to: a.to, reason: a.reason }));
        return 0;
      }
      case 'rework': {
        if (!a.agent || !a.note) { io.err('usage: rework --agent AGENT-NN --note "..." [--push]\n'); return 2; }
        json(a.task ? poolRework({ ...common, agent: a.agent, id: a.task, note: a.note }) : rework({ ...common, agent: a.agent, note: a.note }));
        return 0;
      }
      case 'integrate': {
        if (!a.slice) { io.err('usage: integrate --slice Pn-Snn [--tasks ID,ID | --agents AGENT-01,AGENT-02] [--branch b] [--push]\n'); return 2; }
        json(a.agents ? integrate({ ...common, slice: a.slice, agents: String(a.agents).split(','), branch: a.branch })
          : poolIntegrate({ ...common, slice: a.slice, tasks: a.tasks ? String(a.tasks).split(',') : undefined, branch: a.branch }));
        return 0;
      }
      case 'complete': {
        if (!a.agent || !a['merge-sha']) { io.err('usage: complete --agent AGENT-NN --merge-sha <40-hex> [--push]\n'); return 2; }
        json(a.task ? poolComplete({ ...common, agent: a.agent, id: a.task, mergeSha: a['merge-sha'] }) : complete({ ...common, agent: a.agent, mergeSha: a['merge-sha'] }));
        return 0;
      }
      case 'next': {
        const r = next({ cwd, mainRef: a.main ?? `${common.remote}/main`, syncMain: a['no-sync'] !== true, push: common.push, executedBy: a['executed-by'] });
        if (a.json) json(r);
        else {
          for (const w of r.warnings) io.out(`warn: ${w}\n`);
          io.out(r.started ? `STARTED ${r.started}${r.rework ? ' (rework)' : ''} — base ${r.base.slice(0, 12)}\n` : 'IDLE: no READY task in your pool\n');
          for (const w of r.waiting) io.out(`  waiting: ${w.id} (needs ${w.waitsOn.join(', ')})\n`);
        }
        return 0;
      }
      case 'result': {
        json(result({ cwd, summary: a.summary, limitations: a.limitations, nextNote: a.next, push: common.push }));
        return 0;
      }
      case 'block': case 'unblock': {
        json(block({ cwd, reason: a.reason, unblock: a._[0] === 'unblock', push: common.push }));
        return 0;
      }
      case 'queue': {
        const q = queue(common);
        if (a.write) json(writeQueueIndex(common));
        if (a.json) json(q); else io.out(`${formatQueue(q)}\n`);
        return q.problems.length ? 1 : 0;
      }
      case 'pool-init': {
        if (!a.agent) { io.err('usage: pool-init --agent AGENT-NN [--push]\n'); return 2; }
        json(poolInit({ ...common, agent: a.agent }));
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
