// #295 §14/§18 — replaceable session transport (HTTP polling), worker client loop and runtime CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rig, MAIN } from './runtime-helpers.mjs';
import { SHA, tempDir } from './helpers.mjs';
import { createSessionServer, createSessionClient, SESSION_OPS } from '../../arena-session/transport.mjs';
import { runWorker } from '../../arena-session/worker.mjs';
import { main } from '../src/cli.mjs';

function listen(server) { return new Promise((res) => server.listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${server.address().port}`))); }
const close = (server) => new Promise((res) => server.close(res));

test('transport: unknown kinds fail closed; the protocol exposes no assignment or governance operation', () => {
  assert.throws(() => createSessionClient({ kind: 'carrier-pigeon' }), (e) => e.code === 'POLICY_DENIED');
  assert.throws(() => createSessionClient(undefined), (e) => e.code === 'POLICY_DENIED');
  assert.throws(() => createSessionClient({ kind: 'http', url: 'file:///etc/passwd' }), (e) => e.code === 'INVALID_SCHEMA');
  assert.ok(!SESSION_OPS.some((op) => /assign|govern|policy|decision|merge|complete/i.test(op)));
});

test('transport(http): server-determined transport, bearer credential, error mapping, health', async () => {
  const r = rig();
  const server = createSessionServer({ runtime: r.rt });
  const url = await listen(server);
  try {
    const client = createSessionClient({ kind: 'http', url });
    const reg = await client.register({ ...r.regReq('AGENT-01'), transport: 'inproc' });
    assert.equal(r.state().sessions[reg.session.sessionId].transport, 'http', 'the client cannot choose its recorded transport');
    const me = { sessionId: reg.session.sessionId, agentId: 'AGENT-01', sessionToken: reg.sessionToken };
    await client.ready({ ...me, idempotencyKey: 'ready-1' });
    await assert.rejects(client.poll({ ...me, sessionToken: ['ars1', 'x'.repeat(32)].join('_') }), (e) => e.code === 'UNAUTHORIZED');
    await assert.rejects(client.poll({ ...me, agentId: 'AGENT-02' }), (e) => e.code === 'FORBIDDEN');
    // Token in the body is ignored: only the Authorization header authenticates.
    const raw = await fetch(`${url}/v1/session/poll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...me }) });
    assert.equal(raw.status, 401);
    assert.equal((await fetch(`${url}/v1/session/assign`, { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await fetch(`${url}/v1/session/poll`, { method: 'POST', body: 'not json' })).status, 400);
    const health = await (await fetch(`${url}/v1/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.liveSessions, 1);
  } finally { await close(server); }
});

test('transport(http): two worker sessions register, ACK concurrently, execute and deliver; the slots refill', async () => {
  const r = rig();
  const server = createSessionServer({ runtime: r.rt });
  const url = await listen(server);
  const client = createSessionClient({ kind: 'http', url });
  const tasks = [r.task(1), r.task(2), r.task(3)];
  const acked = new Set();
  let release;
  const bothRunning = new Promise((res) => { release = res; });
  const exec = (agentId) => async (env) => {
    assert.ok(existsSync(join(r.dir, 'inbox', env.sessionId, `${env.assignmentId}.json`)));
    acked.add(env.assignmentId);
    if (acked.size >= 2) release();
    await bothRunning; // both sessions hold an ACKED assignment at the same moment
    return { status: 'READY_FOR_REVIEW', headSha: SHA(agentId === 'AGENT-01' ? '1' : '2') };
  };
  const logs = [];
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'wf-ws-'));
  r.rt.bootstrap({ config: { workspaceRoot } });
  const fresh = r.rt.bootstrap({ config: { workspaceRoot }, rotate: true });
  const bundles = Object.fromEntries(fresh.bundles.map((b) => [b.agentId, b]));
  const workers = ['AGENT-01', 'AGENT-02'].map((a) => runWorker({
    client, bundle: bundles[a], kind: 'local-harness', execute: exec(a), now: r.h.iso, pollMs: 20,
    shouldStop: (s) => s.delivered >= 1, log: (o) => logs.push({ a, ...o }),
  }));
  // Manager loop: offer work once both sessions are IDLE.
  const deadline = Date.now() + 10000;
  let offered = 0;
  while (offered < 2 && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 20));
    offered += r.rt.assignReady({ fill: 10, mainSha: MAIN }).offered.filter((x) => x.status === 'OFFERED').length;
  }
  const summaries = await Promise.all(workers);
  await close(server);
  assert.equal(offered, 2);
  assert.deepEqual(summaries.map((s) => [s.acks, s.delivered]), [[1, 1], [1, 1]]);
  const events = r.rt.store.events();
  let live = 0; let max = 0;
  for (const e of events) { if (e.type === 'ASSIGNMENT_ACKED') live += 1; if (e.type === 'ASSIGNMENT_REPORTED' && e.assignmentStatus === 'READY_FOR_REVIEW') live -= 1; max = Math.max(max, live); }
  assert.ok(max >= 2, `observed ${max} concurrent assignments`);
  const delivered = r.h.cp.store.list('Task').filter((t) => t.state === 'READY_FOR_REVIEW');
  assert.equal(delivered.length, 2);
  // Sessions are IDLE again: refill hands out the third task.
  const refill = r.rt.assignReady({ fill: 10, mainSha: MAIN, reconcile: false });
  assert.deepEqual(refill.offered.map((x) => x.taskId), [tasks.find((t) => !delivered.some((d) => d.objectId === t))]);
  assert.ok(!JSON.stringify(logs).includes('ars1_'), 'worker logs never print the session credential');
  const sessFile = join(bundles['AGENT-01'].workspace, '.arena-session', 'session.json');
  assert.equal(statSync(sessFile).mode & 0o777, 0o600);
});

test('cli: worker-bootstrap writes 0600 bundles without printing credentials; status and dry-run reconcile work', () => {
  const state = tempDir('wf-cli-');
  const runtime = tempDir('wf-cli-rt-');
  const out = tempDir('wf-cli-out-');
  const io = { buf: '', err: '', out(s) { this.buf += s; }, errf(s) { this.err += s; } };
  const call = (argv) => { io.buf = ''; return main([...argv, '--state', state, '--runtime', runtime], { out: (s) => io.out(s), err: (s) => { io.err += s; } }); };
  assert.equal(call(['bootstrap']), 0);
  assert.equal(call(['worker-bootstrap', '--out', out, '--url', 'http://127.0.0.1:8795']), 0);
  const res = JSON.parse(io.buf);
  assert.equal(res.bundlesWritten.length, 10);
  assert.ok(!io.buf.includes('are1_'), 'enrollment credentials are never printed');
  for (const f of readdirSync(out)) assert.equal(statSync(join(out, f)).mode & 0o777, 0o600, f);
  assert.match(readFileSync(join(out, 'AGENT-07.json'), 'utf8'), /are1_/);
  assert.equal(call(['runtime-status']), 0);
  assert.match(io.buf, /ACCEPTANCE: BOOTSTRAPPING/);
  assert.match(io.buf, /\| AGENT-10 \| AVAILABLE \| - \| NO_SESSION/);
  const sessOut = join(out, 's1.json');
  assert.equal(call(['worker-register', '--bundle', join(out, 'AGENT-03.json'), '--session-id', 'cli-session-agent03', '--session-out', sessOut]), 0);
  assert.equal(statSync(sessOut).mode & 0o777, 0o600);
  assert.equal(call(['worker-poll', '--session', sessOut]), 0);
  assert.equal(JSON.parse(io.buf).sessionState, 'IDLE');
  assert.equal(call(['worker-heartbeat', '--session', sessOut]), 0);
  assert.equal(call(['assign-ready', '--fill', '10']), 2, '--main is mandatory');
  assert.equal(call(['assign-ready', '--fill', '10', '--main', MAIN]), 0);
  assert.equal(JSON.parse(io.buf).offered.length, 0, 'no READY task exists');
  assert.equal(call(['runtime-reconcile', '--dry-run', 'true']), 0);
  assert.equal(call(['runtime-gate']), 1, 'the live gate is NOT_MET');
  assert.equal(call(['worker-claim', '--session', sessOut]), 1);
});
