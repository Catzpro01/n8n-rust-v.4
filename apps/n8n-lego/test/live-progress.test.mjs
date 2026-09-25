/**
 * DEC-0021 (LIVE-MILESTONE EXCEPTION) — the live progress mechanism.
 *
 * The owner asked for a mechanism, not a dashboard: when work actually advances,
 * `tools/lego/progress-event.mjs record` must move the canonical register, the
 * README projection and the generated `.ai` projection onto `main` in one atomic
 * commit, without a governance PR, while everything that is not telemetry stays
 * behind a delivery PR and no completion gate is bypassed.
 *
 * These tests prove the twelve properties the owner listed, plus that the
 * surgical register writer round-trips the real register byte for byte.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  CHECKPOINT_STATUSES, LIVE_PROGRESS_MODEL, LIVE_PROGRESS_PATHS, classifyProgressCommit,
  completionContribution, formatPercent, headlineMetrics, historicalP2Fingerprint, programTally,
  renderReadmeMilestoneSection, sliceDeliveryProgress, syncReadmeMilestoneSection,
  validateGovernanceRegister, validateLiveProgressModel, validateMilestoneProjections,
  displayStatus, verifyingIndex, HISTORICAL_P2_FINGERPRINT,
} from '../../../tools/lego/governance-register.mjs';
import { currentStatus, milestoneRegisterDoc } from '../../../tools/lego/ai-pack.mjs';
import {
  applyProgressEvent, findSlice, syncSliceText, deriveCheckpointState, deriveCommandState,
  fetchJobs, fetchOnlineRunners, checkpointRequires,
} from '../../../tools/lego/progress-event.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');
const REGISTER = JSON.parse(read('docs/n8n-lego/milestones.json'));
const REGISTER_TEXT = read('docs/n8n-lego/milestones.json');
const README = read('README.md');
const clone = () => JSON.parse(JSON.stringify(REGISTER));
const m08 = (register) => findSlice(register, 'P5-M08').slice;

/** One checkpoint event, applied to a clone of the canonical register. */
function event(patch = {}) {
  return { slice: 'P5-M08', checkpoint: 'CP-05', ...patch };
}

test('the register declares the DEC-0021 live-progress path and it validates', () => {
  const model = REGISTER.governance.progressModel;
  assert.equal(model.liveException.decision, 'DEC-0021');
  assert.equal(model.liveException.commitPrefix, LIVE_PROGRESS_MODEL.commitPrefix);
  assert.equal(model.liveException.tool, LIVE_PROGRESS_MODEL.tool);
  assert.deepEqual(model.checkpointModel.statuses, [...CHECKPOINT_STATUSES]);
  assert.equal(model.reconciledToMain, true);
  assert.deepEqual(validateLiveProgressModel(REGISTER), []);
  assert.deepEqual(classifyProgressCommit([...LIVE_PROGRESS_PATHS]).allowed.length, LIVE_PROGRESS_PATHS.length);
});

test('P5-M08 carries an evidenced checkpoint model: 70% realtime, 0% completion', () => {
  const slice = m08(REGISTER);
  assert.equal(slice.status, 'in-progress');
  assert.equal(displayStatus(slice, verifyingIndex(REGISTER)), 'verifying');
  assert.equal(sliceDeliveryProgress(slice).source, 'checkpoints');
  assert.equal(sliceDeliveryProgress(slice).percent, 70);
  assert.equal(sliceDeliveryProgress(slice).current.id, 'CP-05');
  assert.equal(sliceDeliveryProgress(slice).latestCompleted.id, 'CP-04');
  assert.equal(completionContribution(slice), 0, 'verifying never adds to slice completion');
  for (const checkpoint of slice.checkpoints) {
    assert.equal(checkpoint.weight > 0, true, `${checkpoint.id} has a positive weight`);
    if (checkpoint.status === 'completed') assert.ok(String(checkpoint.evidence).trim(), `${checkpoint.id} evidence`);
    if (checkpoint.status === 'blocked') assert.ok(String(checkpoint.blockedBy).trim(), `${checkpoint.id} blocker`);
  }
  assert.equal(slice.checkpoints.reduce((total, checkpoint) => total + checkpoint.weight, 0), 100);
  assert.match(slice.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('1. changing a checkpoint changes slice progress', () => {
  const before = sliceDeliveryProgress(m08(REGISTER)).percent;
  const after = applyProgressEvent(REGISTER, event({ status: 'in-progress', at: '2026-09-26T09:00:00Z' }));
  assert.equal(sliceDeliveryProgress(after.slice).percent, before, 'an in-progress checkpoint earns nothing yet');
  const completed = applyProgressEvent(REGISTER, event({
    status: 'completed',
    evidence: 'docs/n8n-lego/evidence/P5-M08-EVIDENCE.md §6 — runner verification PASS on main',
    at: '2026-09-26T09:00:00Z',
  }));
  assert.equal(sliceDeliveryProgress(completed.slice).percent, 100, 'completing CP-05 moves the slice to 100%');
  assert.equal(sliceDeliveryProgress(completed.slice).current, null);
  assert.equal(completionContribution(completed.slice), 0, '100% realtime is still not implemented');
});

test('2. changing a checkpoint changes program progress', () => {
  const program = REGISTER.programs.find((item) => item.id === 'P5');
  const before = programTally(program, verifyingIndex(REGISTER)).realtime;
  const applied = applyProgressEvent(REGISTER, event({
    status: 'completed',
    evidence: 'docs/n8n-lego/evidence/P5-M08-EVIDENCE.md §6 — runner verification PASS on main',
    at: '2026-09-26T09:00:00Z',
  }));
  const after = programTally(applied.register.programs.find((item) => item.id === 'P5'), verifyingIndex(applied.register)).realtime;
  assert.ok(after > before, `P5 realtime ${before} → ${after}`);
  assert.equal(programTally(applied.register.programs.find((item) => item.id === 'P5'), verifyingIndex(applied.register)).percent,
    programTally(program, verifyingIndex(REGISTER)).percent, 'program slice completion does not move');
});

test('3. changing a checkpoint changes Realtime Delivery Progress and not Slice Completion', () => {
  const before = headlineMetrics(REGISTER).current;
  const applied = applyProgressEvent(REGISTER, event({
    status: 'completed',
    evidence: 'docs/n8n-lego/evidence/P5-M08-EVIDENCE.md §6 — runner verification PASS on main',
    at: '2026-09-26T09:00:00Z',
  }));
  const after = headlineMetrics(applied.register).current;
  assert.ok(after.realtime > before.realtime, `delivery realtime ${before.realtime} → ${after.realtime}`);
  assert.equal(after.sliceCompletion, before.sliceCompletion, 'slice completion is untouched by telemetry');
  assert.equal(after.implemented, before.implemented);
  assert.equal(headlineMetrics(applied.register).future.realtime, headlineMetrics(REGISTER).future.realtime, 'future programs never dilute the denominator');
});

test('4. README changes after a checkpoint change', () => {
  const applied = applyProgressEvent(REGISTER, event({ status: 'in-progress', at: '2026-09-26T09:00:00Z' }));
  const before = renderReadmeMilestoneSection(REGISTER);
  const after = renderReadmeMilestoneSection(applied.register);
  assert.notEqual(before, after);
  assert.match(after, /CP-05 DEC-0015 self-hosted runner verification on main[^\n]*\(in-progress, 30\)/);
  assert.match(after, /2026-09-26T09:00:00Z/);
  const synced = syncReadmeMilestoneSection(README, applied.register);
  assert.equal(synced.ok, true);
  assert.equal(synced.changed, true, 'the README block must be rewritten by the generator');
  assert.equal(syncReadmeMilestoneSection(README, REGISTER).changed, false, 'the committed README matches the committed register');
});

test('5. the generated .ai projections change after a checkpoint change', () => {
  // A status-only move (no percentage change) must still reach the .ai pack.
  const moved = applyProgressEvent(REGISTER, event({ status: 'in-progress', at: '2026-09-26T09:00:00Z' }));
  assert.notEqual(currentStatus(REGISTER), currentStatus(moved.register), 'CURRENT_STATUS.md carries the live checkpoint state');
  assert.match(currentStatus(moved.register), /CP-05 \(in-progress, 30\)/);

  const completed = applyProgressEvent(REGISTER, event({
    status: 'completed',
    evidence: 'docs/n8n-lego/evidence/P5-M08-EVIDENCE.md §6 — runner verification PASS on main',
    at: '2026-09-26T09:00:00Z',
  }));
  assert.notEqual(milestoneRegisterDoc(REGISTER), milestoneRegisterDoc(completed.register), 'MILESTONE_REGISTER.md');
  assert.notEqual(currentStatus(REGISTER), currentStatus(completed.register), 'CURRENT_STATUS.md');
  assert.match(currentStatus(completed.register), new RegExp(`\\*\\*Realtime Delivery Progress\\*\\* \\| \\*\\*${formatPercent(headlineMetrics(completed.register).current.realtime).replace('.', '\\.')}\\*\\*`));
});

test('6. freshness fails when a projection is stale after a checkpoint change', () => {
  const applied = applyProgressEvent(REGISTER, event({ status: 'in-progress', at: '2026-09-26T09:00:00Z' }));
  // The committed README is the pre-event projection: register advanced, projection did not.
  const problems = validateMilestoneProjections({
    register: applied.register,
    readme: README,
    roadmap: read('docs/n8n-lego/ROADMAP.md'),
  });
  assert.ok(problems.some((problem) => /stale or was generated from a different register/.test(problem)), problems.join('; '));
  assert.deepEqual(validateMilestoneProjections({ register: REGISTER, readme: README, roadmap: read('docs/n8n-lego/ROADMAP.md') }), []);
});

test('7. a completed checkpoint without evidence is rejected', () => {
  const applied = clone();
  const slice = m08(applied);
  slice.checkpoints[4].status = 'completed';
  delete slice.checkpoints[4].evidence;
  assert.ok(validateGovernanceRegister(applied).some((error) => /no evidence/.test(error)));

  const unevidenced = clone();
  delete m08(unevidenced).checkpoints[4].evidence;
  assert.throws(() => applyProgressEvent(unevidenced, event({ status: 'completed', at: '2026-09-26T09:00:00Z' })), /without --evidence/);
  assert.throws(() => applyProgressEvent(unevidenced, event({ status: 'completed', evidence: '  ', at: '2026-09-26T09:00:00Z' })), /without --evidence/);
  // Even with evidence already on the record, the event must name its own evidence.
  assert.throws(() => applyProgressEvent(REGISTER, event({ status: 'completed', at: '2026-09-26T09:00:00Z' })), /without --evidence/);
});

test('8. weights that do not sum to 100 are rejected', () => {
  const applied = clone();
  m08(applied).checkpoints[0].weight = 24;
  assert.ok(validateGovernanceRegister(applied).some((error) => /sum to 99, not 100/.test(error)));
  assert.throws(() => applyProgressEvent(REGISTER, event({ weight: 31, status: 'in-progress', at: '2026-09-26T09:00:00Z' })), /invalid/);
});

test('9. a blocked checkpoint keeps the progress already earned', () => {
  const applied = applyProgressEvent(REGISTER, event({ status: 'blocked', at: '2026-09-26T09:00:00Z', blockedBy: 'self-hosted runner lost communication' }));
  assert.equal(sliceDeliveryProgress(applied.slice).percent, 70, 'earned points are never reset');
  assert.equal(sliceDeliveryProgress(applied.slice).current.status, 'blocked');
  assert.equal(completionContribution(applied.slice), 0);
  const skipped = applyProgressEvent(REGISTER, event({ status: 'skipped', reason: 'superseded by the runner retry policy', at: '2026-09-26T09:00:00Z' }));
  assert.equal(sliceDeliveryProgress(skipped.slice).percent, 70, 'a skipped checkpoint earns nothing and removes nothing');
  assert.throws(() => applyProgressEvent(REGISTER, event({ status: 'skipped', at: '2026-09-26T09:00:00Z' })), /without --reason/);
  assert.throws(() => applyProgressEvent(REGISTER, event({ status: 'blocked', at: '2026-09-26T09:00:00Z', checkpoint: 'CP-05' })), /without --blocked-by/,
    'the live in-progress CP-05 still needs a blocker before it can be blocked');
  const blocked = applyProgressEvent(REGISTER, event({ status: 'blocked', at: '2026-09-26T09:00:00Z', blockedBy: 'runner lost communication' }));
  assert.equal(sliceDeliveryProgress(blocked.slice).percent, 70, 'a new blocker keeps the points already earned');
});

test('10. verifying does not add slice completion', () => {
  const applied = applyProgressEvent(REGISTER, event({
    status: 'completed',
    evidence: 'docs/n8n-lego/evidence/P5-M08-EVIDENCE.md §6 — runner verification PASS on main',
    at: '2026-09-26T09:00:00Z',
  }));
  const slice = applied.slice;
  assert.equal(sliceDeliveryProgress(slice).percent, 100);
  assert.equal(completionContribution(slice), 0);
  assert.equal(displayStatus(slice, verifyingIndex(applied.register)), 'verifying');
  assert.equal(headlineMetrics(applied.register).current.sliceCompletion, headlineMetrics(REGISTER).current.sliceCompletion);
  assert.equal(validateGovernanceRegister(applied.register).some((error) => /implemented/.test(error)), false);
});

test('11. historical milestones never change through a live progress event', () => {
  const applied = applyProgressEvent(REGISTER, event({
    status: 'completed',
    evidence: 'docs/n8n-lego/evidence/P5-M08-EVIDENCE.md §6 — runner verification PASS on main',
    at: '2026-09-26T09:00:00Z',
  }));
  assert.equal(historicalP2Fingerprint(applied.register), HISTORICAL_P2_FINGERPRINT);
  assert.equal(historicalP2Fingerprint(REGISTER), HISTORICAL_P2_FINGERPRINT);
  assert.equal(JSON.stringify(applied.register.milestones), JSON.stringify(REGISTER.milestones));
  assert.equal(JSON.stringify(applied.register.programs.find((program) => program.id === 'P2').slices),
    JSON.stringify(REGISTER.programs.find((program) => program.id === 'P2').slices));
  assert.equal(applied.register.governance.progressModel.liveException.decision, 'DEC-0021');
});

test('12. implementation code cannot enter through a live-progress commit', () => {
  const telemetry = classifyProgressCommit([
    'docs/n8n-lego/milestones.json', 'README.md', '.ai/master/MILESTONE_REGISTER.md',
    '.ai/master/CURRENT_STATUS.md', 'docs/n8n-lego/evidence/P5-M08-EVIDENCE.md',
  ]);
  assert.equal(telemetry.ok, true);
  assert.equal(telemetry.allowed.length, 5);

  const forbidden = [
    'apps/n8n-lego/src/server.mjs', 'apps/n8n-lego/test/public-api-v1.test.mjs',
    'crates/engine/src/lib.rs', 'Cargo.toml', 'Cargo.lock', '.cargo/config.toml',
    'contracts/public-api.json', 'packages/frontend-lego/src/index.ts',
    '.github/workflows/n8n-lego.yml', 'tools/lego/progress-event.mjs',
    'tools/setup_windows_runners_env.ps1', 'setup_laptop_runner.ps1',
    'docs/engineering-operations/RUNNER-PROTOCOL.md', 'package.json', 'package-lock.json',
  ];
  const classified = classifyProgressCommit(forbidden);
  assert.equal(classified.ok, false);
  assert.equal(classified.violations.length, forbidden.length);
  for (const path of forbidden) {
    assert.ok(!classifyProgressCommit([path]).ok, `${path} must not be a live-progress path`);
  }
  assert.equal(LIVE_PROGRESS_PATHS.includes('Cargo.toml'), false);
});

test('the surgical register writer round-trips the canonical register unchanged', () => {
  const raw = REGISTER_TEXT;
  for (const slice of [...REGISTER.programs, ...REGISTER.futurePrograms].flatMap((entity) => entity.slices)) {
    const sync = syncSliceText(raw, slice.id, slice);
    assert.equal(sync.ok, true, slice.id);
    assert.equal(sync.text, raw, `${slice.id}: rewriting the current state must not touch the file`);
  }
  const applied = applyProgressEvent(REGISTER, event({ status: 'in-progress', at: '2026-09-26T09:00:00Z' }));
  const sync = syncSliceText(raw, 'P5-M08', applied.slice);
  assert.equal(sync.ok, true);
  assert.equal(JSON.stringify(JSON.parse(sync.text)), JSON.stringify(applied.register), 'the text edit must equal the intended register');
  const before = raw.split('\n');
  const after = sync.text.split('\n');
  assert.notEqual(before.join('\n'), after.join('\n'), 'a checkpoint change must change the register text');
  // A progress commit touches only the slice it records: everything outside its block is byte-identical.
  const bounds = (lines) => {
    const start = lines.findIndex((line) => line === '          "id": "P5-M08",');
    const end = lines.findIndex((line, index) => index > start && /^ {8}\},?$/.test(line));
    return { start, end };
  };
  const beforeBounds = bounds(before);
  const afterBounds = bounds(after);
  const outside = (lines, region) => lines.slice(0, region.start).concat(lines.slice(region.end + 1));
  assert.deepEqual(outside(before, beforeBounds), outside(after, afterBounds), 'only the P5-M08 block may change');
  const grew = (afterBounds.end - afterBounds.start) - (beforeBounds.end - beforeBounds.start);
  assert.ok(Math.abs(grew) <= 2, `a single checkpoint event must stay surgical (block grew by ${grew} lines)`);
});

/* ------------------------------------- DEC-0021 §5/§6: evidence -> checkpoint state */

const GREEN_JOBS = [
  { name: 'Level 0 (Check & Format)', status: 'completed', conclusion: 'success', labels: ['self-hosted', 'Linux'], runner_name: 'MDMTEST-n8n-wsl', run_id: 36161486727 },
  { name: 'Level 1 (Affected Tests)', status: 'completed', conclusion: 'success', labels: ['self-hosted', 'Linux'], runner_name: 'MDMTEST-n8n-wsl-3', run_id: 36161486727 },
  { name: 'Level 2 Workspace Tests (linux)', status: 'completed', conclusion: 'success', labels: ['self-hosted', 'Linux'], runner_name: 'MDMTEST-n8n-wsl-4', run_id: 36161486715 },
  { name: 'Level 2 Workspace Tests (windows)', status: 'completed', conclusion: 'success', labels: ['self-hosted', 'Windows'], runner_name: 'laptop-build-worker-4', run_id: 36161486715 },
  { name: 'Level 2 Conformance LEGO & Node Catalog', status: 'completed', conclusion: 'success', labels: ['self-hosted', 'Linux'], runner_name: 'MDMTEST-n8n-wsl-2', run_id: 36161486715 },
  { name: 'Backend LEGO architecture gate (P2.6)', status: 'completed', conclusion: 'success', labels: ['ubuntu-latest'], runner_name: 'GitHub Actions', run_id: 36161486772 },
];

test('evidence resolver: all-green self-hosted checks derive completed, with run and runner identity', () => {
  const derived = deriveCheckpointState(GREEN_JOBS, { head: 'c2b519d6c7d013d7f032c34cd1d572c6c38018c8' });
  assert.equal(derived.status, 'completed');
  assert.equal(derived.verdict.verdict, 'ALL_GREEN');
  for (const identity of ['MDMTEST-n8n-wsl', 'MDMTEST-n8n-wsl-2', 'MDMTEST-n8n-wsl-3', 'MDMTEST-n8n-wsl-4', 'laptop-build-worker-4']) {
    assert.match(derived.evidence, new RegExp(identity.replace(/[-]/g, '\\-')), `evidence names ${identity}`);
  }
  assert.match(derived.evidence, /run 36161486727/);
  assert.match(derived.evidence, /run 36161486715/);

  const applied = applyProgressEvent(REGISTER, {
    slice: 'P5-M08', checkpoint: 'CP-05', status: derived.status, evidence: derived.evidence, at: '2026-09-26T09:00:00Z',
  });
  assert.equal(sliceDeliveryProgress(applied.slice).percent, 100);
  assert.equal(completionContribution(applied.slice), 0, 'resolver output never becomes completion by itself');
});

test('evidence resolver: WAITING_RUNNER, queued and hosted-only never derive completed (DEC-0015)', () => {
  // No online runner can take it: DEC-0015 WAITING_RUNNER, which is never PASS.
  const waiting = GREEN_JOBS.map((job) => (job.name.startsWith('Level 0') ? { ...job, status: 'queued', conclusion: null } : job));
  const derivedWaiting = deriveCheckpointState(waiting, { onlineRunners: [] });
  assert.equal(derivedWaiting.status, 'in-progress');
  assert.match(derivedWaiting.evidence, /WAITING_RUNNER is never PASS/);
  assert.equal(derivedWaiting.verdict.verdict, 'ALLOWED_BY_DEC-0015');

  // Runner availability unknown: still not earned.
  const unknown = deriveCheckpointState(waiting);
  assert.equal(unknown.status, 'in-progress');
  assert.equal(unknown.verdict.verdict, 'PENDING');

  const running = GREEN_JOBS.map((job) => (job.name.startsWith('Level 2 Workspace Tests (windows)') ? { ...job, status: 'in_progress', conclusion: null } : job));
  assert.equal(deriveCheckpointState(running).status, 'in-progress');

  const hostedOnly = GREEN_JOBS.filter((job) => !job.labels.includes('self-hosted'));
  assert.equal(deriveCheckpointState(hostedOnly).status, 'in-progress', 'a hosted-only result is not runner verification');
  assert.equal(deriveCheckpointState([]).status, 'in-progress', 'no checks at all is never PASS');
});

test('evidence resolver: a failed self-hosted check derives blocked with the failure as blocker', () => {
  const failed = GREEN_JOBS.map((job) => (job.name.startsWith('Level 1')
    ? { ...job, conclusion: 'failure' }
    : job));
  const derived = deriveCheckpointState(failed);
  assert.equal(derived.status, 'blocked');
  assert.equal(derived.verdict.verdict, 'BLOCKED');
  assert.match(derived.evidence, /Level 1 \(Affected Tests\)/);
  assert.match(derived.blockedBy, /classify the failure/, 'the tool never relabels a failure as environmental or a regression');
  const applied = applyProgressEvent(REGISTER, {
    slice: 'P5-M08', checkpoint: 'CP-05', status: derived.status, evidence: derived.evidence, blockedBy: derived.blockedBy, at: '2026-09-26T09:00:00Z',
  });
  assert.equal(sliceDeliveryProgress(applied.slice).percent, 70, 'earned progress survives a new blocker');
});

test('the resolver fetches its own evidence: no hand-exported jobs file, no typed state', async () => {
  const jobs = GREEN_JOBS.map((job) => ({ ...job, runner_name: job.runner_name, run_id: 36161486727 }));
  const fetchImpl = async (url) => {
    if (url.includes('/actions/runs?head_sha=')) return { ok: true, status: 200, json: async () => ({ workflow_runs: [{ id: 36161486727 }] }) };
    if (url.includes('/actions/runs/')) return { ok: true, status: 200, json: async () => ({ jobs }) };
    if (url.includes('/actions/runners')) return { ok: true, status: 200, json: async () => ({ runners: [{ name: 'MDMTEST-n8n-wsl', busy: false, labels: ['self-hosted', 'Linux'] }] }) };
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
  };
  const fetched = await fetchJobs({ repo: 'Catzpro01/n8n-rust-v.4', head: 'c2b519d6c7d013d7f032c34cd1d572c6c38018c8', token: 't', fetchImpl });
  assert.equal(fetched.length, jobs.length);
  assert.equal(fetched[0].run_id, 36161486727);
  const runners = await fetchOnlineRunners({ repo: 'Catzpro01/n8n-rust-v.4', token: 't', fetchImpl });
  const derived = deriveCheckpointState(fetched, { onlineRunners: runners, head: 'c2b519d6c7d013d7f032c34cd1d572c6c38018c8' });
  assert.equal(derived.status, 'completed', 'the same evidence resolves the same way however it is obtained');
  assert.match(derived.evidence, /run 36161486727/);

  await assert.rejects(() => fetchJobs({ repo: 'o/r', head: 'abc', fetchImpl: async () => ({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }) }), /404/);
});

test('DEC-0015 required checks: an absent check is never PASS, a declared set is earned only in full', () => {
  const required = checkpointRequires(REGISTER, 'P5-M08', 'CP-05');
  assert.deepEqual(required, [
    'Level 0 (Check & Format)',
    'Level 1 (Affected Tests)',
    'Level 2 Workspace Tests (linux)',
    'Level 2 Workspace Tests (windows)',
    'Level 2 Conformance LEGO & Node Catalog',
    'Post-Merge Verification & Branch Cleanup',
  ], 'CP-05 declares the exact DEC-0015 checks it needs');

  const oneGreen = GREEN_JOBS.filter((job) => job.name.startsWith('Level 0'));
  const partial = deriveCheckpointState(oneGreen, { required, head: '600a2145' });
  assert.equal(partial.status, 'in-progress', 'a green Level 0 with four checks absent is not verification');
  assert.match(partial.evidence, /required check\(s\) have not run: Level 1/);
  assert.match(partial.evidence, /An absent self-hosted check is never success/);

  const all = required.map((name, index) => ({
    name, status: 'completed', conclusion: 'success',
    labels: ['self-hosted', 'Linux'], runner_name: `runner-${index}`, run_id: 36161486727,
  }));
  const done = deriveCheckpointState(all, { required, head: '600a2145' });
  assert.equal(done.status, 'completed');
  assert.match(done.evidence, /Level 2 Workspace Tests \(windows\) on runner-3/);
  assert.match(done.evidence, /Post-Merge Verification & Branch Cleanup on runner-5/);

  const broke = all.map((job, index) => (index === 3 ? { ...job, conclusion: 'failure' } : job));
  const failed = deriveCheckpointState(broke, { required, head: '600a2145' });
  assert.equal(failed.status, 'blocked');
  assert.match(failed.blockedBy, /classify the failure/, 'the tool never relabels the failure');

  const running = all.map((job, index) => (index === 2 ? { ...job, status: 'in_progress', conclusion: null } : job));
  assert.equal(deriveCheckpointState(running, { required }).status, 'in-progress');
  assert.equal(deriveCheckpointState([], { required }).status, 'in-progress', 'no checks at all is never PASS');

  // The required set comes from the register, so the Manager cannot widen it.
  const applied = applyProgressEvent(REGISTER, {
    slice: 'P5-M08', checkpoint: 'CP-05', status: done.status, evidence: done.evidence, at: '2026-09-26T09:00:00Z',
  });
  assert.equal(sliceDeliveryProgress(applied.slice).percent, 100);
});

test('command evidence: exit 0 derives completed, non-zero derives blocked, never a typed percentage', () => {
  const passed = deriveCommandState('npm run lego:capabilities', { code: 0, output: 'ok' });
  assert.equal(passed.status, 'completed');
  assert.match(passed.evidence, /exited 0/);

  const failed = deriveCommandState('npm run lego:arch', { code: 1, output: 'line1\nline2\nARCH VIOLATION: domain boundary' });
  assert.equal(failed.status, 'blocked');
  assert.match(failed.blockedBy, /exited 1/);
  assert.match(failed.evidence, /ARCH VIOLATION/);

  for (const derived of [passed, failed]) {
    assert.doesNotMatch(JSON.stringify(derived), /\b(70|72|84|91|100)(\.\d)?%/, 'no percentage is ever derived or typed');
  }
});

test('telemetry never carries delivery state: a slice status transition is refused', () => {
  const mutated = clone();
  const slice = m08(mutated);
  slice.status = 'implemented';
  slice.mergeSha = '600a21456213602ebdc6193229bab8432e6d1024';
  assert.ok(validateGovernanceRegister(mutated).some((problem) => /cannot carry an incomplete checkpoint/.test(problem)),
    'the register itself refuses implemented while a checkpoint is incomplete');

  // The telemetry tool cannot move a slice status or attach a merge SHA at all.
  const applied = applyProgressEvent(REGISTER, event({ status: 'completed', evidence: 'docs/n8n-lego/evidence/P5-M08-EVIDENCE.md §6 — PASS', at: '2026-09-26T09:00:00Z' }));
  assert.equal(applied.slice.status, 'in-progress', 'a telemetry event cannot change a slice status');
  assert.equal(applied.slice.mergeSha, null, 'a telemetry event cannot attach a merge SHA');
  assert.equal(completionContribution(applied.slice), 0, 'completion still waits for the governance PR');
});

test('atomicity: a failing regeneration leaves the register byte-identical', () => {
  const root = mkdtempSync(join(tmpdir(), 'progress-atomic-'));
  try {
    mkdirSync(join(root, 'docs/n8n-lego'), { recursive: true });
    mkdirSync(join(root, 'tools/lego'), { recursive: true });
    writeFileSync(join(root, 'docs/n8n-lego/milestones.json'), REGISTER_TEXT);
    for (const file of ['governance-register.mjs', 'progress-event.mjs']) {
      writeFileSync(join(root, 'tools/lego', file), readFileSync(join(REPO_ROOT, 'tools/lego', file)));
    }
    // A generator that fails, as a stale or broken projection would.
    writeFileSync(join(root, 'tools/lego/ai-pack.mjs'), 'process.exit(1);\n');
    const before = readFileSync(join(root, 'docs/n8n-lego/milestones.json'));
    let code = 0;
    try {
      execFileSync('node', [join(root, 'tools/lego/progress-event.mjs'), 'record',
        '--slice', 'P5-M08', '--checkpoint', 'CP-05', '--status', 'in-progress',
        '--evidence', 'atomicity probe'], { cwd: root, stdio: 'pipe' });
    } catch (error) { code = error.status; }
    assert.notEqual(code, 0, 'a failing regeneration must fail the command');
    assert.equal(readFileSync(join(root, 'docs/n8n-lego/milestones.json')).toString(), before.toString(), 'the register is restored byte for byte');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an event on an unknown slice or checkpoint is refused before anything is written', () => {
  assert.throws(() => applyProgressEvent(REGISTER, { slice: 'P5-M99', checkpoint: 'CP-01', status: 'in-progress' }), /not in the register/);
  assert.throws(() => applyProgressEvent(REGISTER, event({ checkpoint: 'CP-42', status: 'in-progress' })), /no checkpoint CP-42/);
  assert.throws(() => applyProgressEvent(REGISTER, event({ status: 'done' })), /must be one of/);
  assert.throws(() => applyProgressEvent(REGISTER, event({ checkpoint: 'C1' })), /must look like CP-01/);
});

test('the live state is readable from the register alone: status, checkpoint, evidence, blocker, timestamp', () => {
  const slice = m08(REGISTER);
  const rendered = renderReadmeMilestoneSection(REGISTER);
  assert.match(rendered, new RegExp(`- \\*\\*Current checkpoint:\\*\\* CP-05[^\\n]*\\(in-progress, 30\\)`),
    'CP-05 is in-progress on main: the DEC-0015 retry is in flight');
  assert.match(rendered, /- \*\*Checkpoint evidence:\*\* CP-01: docs\/n8n-lego\/evidence\/P5-M08-EVIDENCE\.md/);
  assert.match(rendered, new RegExp(`- \\*\\*Last progress update:\\*\\* ${slice.updatedAt}`));
  assert.match(rendered, /- 🔴 \*\*P5-M02\*\*[^\n]*Last progress update: —/);
  assert.match(rendered, /governance\(progress\):/);
  assert.match(rendered, /LIVE-MILESTONE EXCEPTION/);
  assert.match(formatPercent(headlineMetrics(REGISTER).current.realtime), /^\d+\.\d%$/);
});
