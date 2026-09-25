#!/usr/bin/env node
// Arena worker session client (#295 §18):  arena worker start --agent AGENT-0X
//
//   node tools/arena-session/worker.mjs start  --agent AGENT-03 [--bundle FILE] [--url URL] [--session-id ID]
//                                             [--workspace DIR] [--kind arena-session|local-harness]
//                                             [--exec "<command>"] [--max-seconds N]
//   node tools/arena-session/worker.mjs report --agent AGENT-03 --status RUNNING|PROGRESS|WAITING_EXTERNAL|BLOCKED|READY_FOR_REVIEW|FAILED
//                                             [--head SHA] [--pr N] [--summary TEXT]
//   node tools/arena-session/worker.mjs status --agent AGENT-03
//   node tools/arena-session/worker.mjs drain  --agent AGENT-03
//
// start: register -> IDLE -> loop { heartbeat when due; poll (<= 1 s) ; claim an offer ; write the
// assignment manifest into the slot workspace ; run --exec if given ; report } — no manual task
// copy-paste. Without --exec the live Arena session does the work and reports through `report`.
//
// Files (slot workspace, mode 0600, never committed):
//   <workspace>/.arena-session/bootstrap.json   Manager-issued bundle (enrollment credential, one slot)
//   <workspace>/.arena-session/session.json     this session's runtime credential (workforce-scoped only)
//   <workspace>/.arena-session/assignment.json  the current envelope (task manifest; carries no secrets)
// The session never receives or stores a GitHub / owner / Supabase / webhook credential.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createSessionClient } from './transport.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 1000))); // polling waits never exceed 1 s
const iso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const key = (p) => `${p}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

function writePrivate(path, obj) { mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 }); writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 }); }
export function sessionDir(workspace) { return join(workspace, '.arena-session'); }
export function defaultSessionId(agentId) { return `arena-${agentId.toLowerCase()}-${hostname().replace(/[^A-Za-z0-9]/g, '').slice(0, 16) || 'host'}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`; }

/**
 * Run one worker session until `shouldStop()` or drain. Returns a summary. `execute(envelope)`
 * resolves { status: 'READY_FOR_REVIEW', headSha, prNumber } | { status: 'FAILED', summary } | null
 * (null = the live session reports on its own).
 */
export async function runWorker({ client, bundle, sessionId, workspace, kind, execute = null, shouldStop = () => false, log = () => {}, now = iso, pollMs = 1000 }) {
  const ws = workspace ?? bundle.workspace;
  const reg = await client.register({
    agentId: bundle.agentId, sessionId: sessionId ?? defaultSessionId(bundle.agentId), enrollmentToken: bundle.enrollment?.token,
    protocolVersion: bundle.protocolVersion, capabilities: bundle.capabilities, runnerClass: bundle.runnerClass,
    workspace: ws, branch: bundle.branch, sessionKind: kind, idempotencyKey: key('register'),
  });
  if (!reg.sessionToken) throw new Error('registration returned no session credential');
  const me = { sessionId: reg.session.sessionId, agentId: bundle.agentId, sessionToken: reg.sessionToken };
  writePrivate(join(sessionDir(ws), 'session.json'), { ...me, url: bundle.transport?.url ?? null, registeredAt: reg.session.registeredAt, kind });
  log({ event: 'REGISTERED', sessionId: me.sessionId, agentId: me.agentId, generation: reg.session.generation });
  await client.ready({ ...me, idempotencyKey: key('ready') });
  log({ event: 'IDLE', sessionId: me.sessionId });
  const hbEvery = (reg.heartbeatIntervalSeconds ?? bundle.heartbeatIntervalSeconds ?? 30) * 1000;
  let lastHb = 0; let current = null; let running = null; const summary = { sessionId: me.sessionId, heartbeats: 0, acks: 0, delivered: 0, failed: 0, stopped: 0 };
  while (!shouldStop(summary)) {
    try {
      if (Date.now() - lastHb >= hbEvery) {
        const hb = await client.heartbeat({ ...me, assignmentId: current?.assignmentId, leaseId: current?.leaseId, timestamp: now(), sessionState: current ? 'WORKING' : 'IDLE', idempotencyKey: key('hb') });
        lastHb = Date.now(); summary.heartbeats += 1;
        if (hb.leaseRenewed) log({ event: 'LEASE_RENEWED', leaseId: hb.lease?.leaseId, expiresAt: hb.lease?.expiresAt });
        if (hb.directive === 'STOP_ASSIGNMENT' && current) { log({ event: 'STOP_ASSIGNMENT', assignmentId: current.assignmentId }); current = null; summary.stopped += 1; rmSync(join(sessionDir(ws), 'assignment.json'), { force: true }); }
        if (hb.sessionState === 'OFFLINE') break;
      }
      const p = await client.poll(me);
      if (!p.assignment && current && !running) { current = null; rmSync(join(sessionDir(ws), 'assignment.json'), { force: true }); }
      if (p.assignment && p.assignment.status === 'OFFERED') {
        const env = p.assignment;
        const ack = await client.claim({ ...me, assignmentId: env.assignmentId, leaseId: env.leaseId, taskRevision: env.taskRevision, idempotencyKey: `ack-${env.assignmentId}` });
        current = ack.assignment; summary.acks += 1;
        writePrivate(join(sessionDir(ws), 'assignment.json'), current);
        log({ event: 'ACKED', assignmentId: current.assignmentId, taskId: current.taskId, branch: current.branch, resume: current.resume, manifest: join(sessionDir(ws), 'assignment.json') });
        await client.report({ ...me, assignmentId: current.assignmentId, status: 'RUNNING', idempotencyKey: `run-${current.assignmentId}` });
        if (execute) {
          const env2 = current;
          running = Promise.resolve(execute(env2)).then(async (outcome) => {
            if (!outcome) return;
            await client.report({ ...me, assignmentId: env2.assignmentId, idempotencyKey: `${outcome.status.toLowerCase()}-${env2.assignmentId}`, ...outcome });
            if (outcome.status === 'READY_FOR_REVIEW') summary.delivered += 1; else summary.failed += 1;
            log({ event: outcome.status, assignmentId: env2.assignmentId, taskId: env2.taskId });
          }).catch((e) => log({ event: 'EXECUTE_ERROR', code: e.code ?? null, message: e.message })).finally(() => { running = null; current = null; rmSync(join(sessionDir(ws), 'assignment.json'), { force: true }); });
        }
      }
    } catch (e) {
      log({ event: 'ERROR', code: e.code ?? null, message: e.message });
      if (['UNAUTHORIZED', 'FORBIDDEN'].includes(e.code) && /LOST|OFFLINE|register a new session/.test(e.message)) break;
    }
    await sleep(pollMs);
  }
  if (running) await running;
  return summary;
}

/** --exec: run a command with the envelope in the environment; `HEAD=<sha>` / `PR=<n>` lines report delivery. */
export function commandExecutor(command, workspace) {
  return (env) => new Promise((resolve) => {
    const file = join(sessionDir(workspace), 'assignment.json');
    const child = spawn(command, { shell: true, cwd: workspace, env: { PATH: process.env.PATH, HOME: process.env.HOME, ARENA_ASSIGNMENT_FILE: file, ARENA_TASK_ID: env.taskId, ARENA_BRANCH: env.branch, ARENA_BASE_SHA: env.mainSha, ARENA_WORKSPACE: workspace }, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    child.on('close', (code) => {
      const head = /^HEAD=([0-9a-f]{40})$/m.exec(out)?.[1];
      const pr = /^PR=([0-9]+)$/m.exec(out)?.[1];
      if (code === 0 && head) resolve({ status: 'READY_FOR_REVIEW', headSha: head, ...(pr ? { prNumber: Number(pr) } : {}) });
      else resolve({ status: 'FAILED', summary: `executor exited ${code}${head ? '' : ' without HEAD=<sha>'}` });
    });
  });
}

function parse(argv) { const a = { _: [] }; for (let i = 0; i < argv.length; i += 1) { if (argv[i].startsWith('--')) { a[argv[i].slice(2)] = argv[i + 1]; i += 1; } else a._.push(argv[i]); } return a; }

async function main(argv = process.argv.slice(2)) {
  const a = parse(argv);
  const cmd = a._[0];
  if (!a.agent || !/^AGENT-(0[1-9]|10)$/.test(a.agent)) { process.stderr.write('usage: worker.mjs <start|report|status|drain> --agent AGENT-0X ...\n'); return 2; }
  const defaultWs = `/srv/arena/workspaces/${a.agent}`;
  const out = (o) => process.stdout.write(`${JSON.stringify({ at: iso(), ...o })}\n`);
  if (cmd === 'start') {
    const bundlePath = a.bundle ?? process.env.ARENA_WORKER_BUNDLE ?? join(a.workspace ?? defaultWs, '.arena-session', 'bootstrap.json');
    if (!existsSync(bundlePath)) { process.stderr.write(`bootstrap bundle not found: ${bundlePath} (the Manager runs worker-bootstrap)\n`); return 1; }
    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
    if (bundle.agentId !== a.agent) { process.stderr.write(`bundle is for ${bundle.agentId}, not ${a.agent}\n`); return 1; }
    const client = createSessionClient({ kind: 'http', url: a.url ?? bundle.transport?.url });
    const ws = a.workspace ?? bundle.workspace;
    const deadline = a['max-seconds'] ? Date.now() + Number(a['max-seconds']) * 1000 : Infinity;
    let stop = false;
    process.on('SIGINT', () => { stop = true; }); process.on('SIGTERM', () => { stop = true; });
    const summary = await runWorker({ client, bundle, sessionId: a['session-id'], workspace: ws, kind: a.kind ?? 'arena-session', execute: a.exec ? commandExecutor(a.exec, ws) : null, shouldStop: () => stop || Date.now() > deadline, log: out });
    out({ event: 'STOPPED', ...summary });
    return 0;
  }
  const ws = a.workspace ?? defaultWs;
  const sessPath = join(sessionDir(ws), 'session.json');
  if (!existsSync(sessPath)) { process.stderr.write(`no session at ${sessPath}; run start first\n`); return 1; }
  const sess = JSON.parse(readFileSync(sessPath, 'utf8'));
  const client = createSessionClient({ kind: 'http', url: a.url ?? sess.url });
  const me = { sessionId: sess.sessionId, agentId: sess.agentId, sessionToken: sess.sessionToken };
  try {
    if (cmd === 'status') { out(await client.poll(me)); return 0; }
    if (cmd === 'drain') { out(await client.drain({ ...me, idempotencyKey: key('drain') })); return 0; }
    if (cmd === 'report') {
      const p = await client.poll(me);
      if (!p.assignment) { process.stderr.write('no active assignment for this session\n'); return 1; }
      out(await client.report({ ...me, assignmentId: p.assignment.assignmentId, status: a.status, ...(a.head ? { headSha: a.head } : {}), ...(a.pr ? { prNumber: Number(a.pr) } : {}), ...(a.summary ? { summary: a.summary } : {}), idempotencyKey: key('report') }));
      return 0;
    }
  } catch (e) { process.stderr.write(`${e.code ?? 'ERROR'}: ${e.message}\n`); return 1; }
  process.stderr.write('usage: worker.mjs <start|report|status|drain> --agent AGENT-0X ...\n');
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) main().then((c) => { process.exitCode = c; });
