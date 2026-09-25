#!/usr/bin/env node
// LOCAL HARNESS for the worker session runtime (#295). NOT Arena sessions: it starts one runtime server
// (Manager loop) and ten worker PROCESSES on this host, all registered as sessionKind "local-harness",
// so its evidence can never satisfy the live acceptance gate. It exercises, with real processes over
// HTTP: registration, heartbeat, concurrent assignment, ACK, lease renewal, execution with real git
// commits, READY_FOR_REVIEW, refill, a SIGKILLed session (loss), recovery transfer and a replacement
// session. Scratch control-plane state only; never the Manager's store.
//
//   node tools/arena-session/local-harness.mjs --main <40-hex main sha> --dir <empty scratch dir> [--port 8795]
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const MAIN = arg('main'); const H = arg('dir'); const PORT = arg('port', '8795');
if (!/^[0-9a-f]{40}$/.test(MAIN ?? '') || !H) { process.stderr.write('usage: local-harness.mjs --main <sha> --dir <scratch dir>\n'); process.exit(2); }
const S = join(H, 'state'), R = join(H, 'rt'), B = join(H, 'bundles'), WS = join(H, 'ws');
for (const d of [S, R, B, WS]) rmSync(d, { recursive: true, force: true });
mkdirSync(WS, { recursive: true });
const cli = (...a) => execFileSync('node', [join(REPO, 'tools/workforce/src/cli.mjs'), ...a, '--state', S, '--runtime', R], { encoding: 'utf8' });
const log = []; const t0 = Date.now(); const T = () => ((Date.now() - t0) / 1000).toFixed(1);
const note = (m) => { const l = `[t+${T()}s] ${m}`; log.push(l); console.log(l); };
cli('bootstrap');
const { ControlPlane } = await import(join(REPO, 'tools/workforce/src/engine.mjs'));
let n = 0;
const mkTasks = (count, tag) => { const cp = new ControlPlane({ stateDir: S }); const ids = []; for (let i = 0; i < count; i++) { n++; const r = cp.execute({ commandId: `CMD-harness-${n}`, commandType: 'TASK_CREATE', schemaVersion: '1.0', actor: { type: 'MANAGER', id: 'MANAGER-01' }, target: { objectType: 'Task', objectId: 'NEW' }, expectedRevision: 0, idempotencyKey: `harness-task-${n}`, requestedAt: new Date().toISOString(), reason: 'local harness task', payload: { program: 'GOVERNANCE', title: `harness ${tag} ${n}`, scope: { paths: [`harness/area-${n}/`] } } }); if (!r.ok) throw new Error(JSON.stringify(r.error)); ids.push(r.objectId); } return ids; };
const boot = JSON.parse(cli('worker-bootstrap', '--out', B, '--url', `http://127.0.0.1:${PORT}`, '--workspace-root', WS, '--heartbeat-interval', '3', '--lost-after', '15', '--lease-renew-below', '3595'));
note(`bootstrap: ${boot.bundlesWritten.length} bundles (0600), status=${JSON.parse(cli('runtime-status', '--json', 'true')).acceptance}`);
note(`tasks created: ${mkTasks(12, 'wave1').join(',')}`);
const server = spawn('node', [join(REPO, 'tools/workforce/src/cli.mjs'), 'runtime-serve', '--state', S, '--runtime', R, '--port', PORT, '--manager-loop-ms', '1000', '--main', MAIN, '--fill', '10'], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
await new Promise((r) => setTimeout(r, 800));
const EXEC = `sh -c 'mkdir -p repo && cd repo && { [ -d .git ] || git init -q; } && git -c user.name=harness -c user.email=harness@local commit -q --allow-empty -m "$ARENA_TASK_ID on $ARENA_BRANCH" && sleep 8 && echo HEAD=$(git rev-parse HEAD)'`;
const workers = {};
const startWorker = (a, gen) => {
  mkdirSync(join(WS, a), { recursive: true });
  const p = spawn('node', [join(REPO, 'tools/arena-session/worker.mjs'), 'start', '--agent', a, '--bundle', join(B, `${a}.json`), '--workspace', join(WS, a), '--kind', 'local-harness', '--session-id', `harness-${a.toLowerCase()}-g${gen}-${Date.now().toString(36)}`, '--exec', EXEC], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  p.out = ''; p.stdout.on('data', (d) => { p.out += d; }); p.stderr.on('data', (d) => { p.out += d; });
  workers[a] = p; return p;
};
const slots = Array.from({ length: 10 }, (_, i) => `AGENT-${String(i + 1).padStart(2, '0')}`);
for (const a of slots) startWorker(a, 1);
const status = () => JSON.parse(cli('runtime-status', '--json', 'true'));
const waitFor = async (pred, label, max = 60) => { for (let i = 0; i < max * 2; i++) { const s = status(); if (pred(s)) { note(`${label}`); return s; } await new Promise((r) => setTimeout(r, 500)); } note(`TIMEOUT waiting for ${label}`); return status(); };
let st = await waitFor((s) => s.liveSessions === 10, '10 worker processes registered + heartbeating');
st = await waitFor((s) => s.slots.filter((x) => x.sessionState === 'WORKING').length >= 2, '>=2 sessions WORKING concurrently');
note(`working now: ${st.slots.filter((x) => x.sessionState === 'WORKING').map((x) => `${x.slot}:${x.taskId}`).join(' ')}`);
const victim = st.slots.find((x) => x.sessionState === 'WORKING').slot;
const victimSession = st.slots.find((x) => x.slot === victim).sessionId;
process.kill(-workers[victim].pid, 'SIGKILL');
note(`SIGKILL worker process group of ${victim} (session ${victimSession}) mid-task`);
st = await waitFor((s) => s.slots.find((x) => x.slot === victim).sessionState === 'LOST', `${victim} session declared LOST by the manager loop`, 40);
await new Promise((r) => setTimeout(r, 2500));
startWorker(victim, 2);
note(`restarted ${victim} worker process -> new session (generation 2)`);
await waitFor((s) => s.slots.find((x) => x.slot === victim).sessionId !== victimSession && ['IDLE', 'ASSIGNED', 'WORKING'].includes(s.slots.find((x) => x.slot === victim).sessionState), `${victim} replacement session live`, 30);
note(`tasks created: ${mkTasks(3, 'wave2').join(',')}`);
await waitFor((s) => s.slots.every((x) => x.sessionState === 'IDLE') , 'all work delivered; every session IDLE', 90);
const final = status();
const events = readFileSync(join(R, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const gate = JSON.parse(spawnSync('node', [join(REPO, 'tools/workforce/src/cli.mjs'), 'runtime-gate', '--state', S, '--runtime', R], { encoding: 'utf8' }).stdout);
for (const a of Object.keys(workers)) { try { process.kill(-workers[a].pid, 'SIGTERM'); } catch {} }
server.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 500));
const eng = JSON.parse(spawnSync('node', [join(REPO, 'tools/workforce/src/cli.mjs'), 'reconcile', '--state', S], { encoding: 'utf8' }).stdout);
writeFileSync(join(H, 'result.json'), JSON.stringify({ log, final, events, gate, engineFindings: eng.findings, serverTail: serverLog.split('\n').slice(-15) }, null, 1));
console.log('DONE', final.acceptance, 'events', events.length, 'engine findings', eng.findings.length);
