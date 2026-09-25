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
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHECKPOINT_STATUSES, LIVE_PROGRESS_MODEL, LIVE_PROGRESS_PATHS, classifyProgressCommit,
  completionContribution, formatPercent, headlineMetrics, historicalP2Fingerprint, programTally,
  renderReadmeMilestoneSection, sliceDeliveryProgress, syncReadmeMilestoneSection,
  validateGovernanceRegister, validateLiveProgressModel, validateMilestoneProjections,
  displayStatus, verifyingIndex, HISTORICAL_P2_FINGERPRINT,
} from '../../../tools/lego/governance-register.mjs';
import { currentStatus, milestoneRegisterDoc } from '../../../tools/lego/ai-pack.mjs';
import { applyProgressEvent, findSlice, syncSliceText } from '../../../tools/lego/progress-event.mjs';

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
  const applied = applyProgressEvent(REGISTER, event({ status: 'blocked', at: '2026-09-26T09:00:00Z' }));
  assert.equal(sliceDeliveryProgress(applied.slice).percent, 70, 'earned points are never reset');
  assert.equal(sliceDeliveryProgress(applied.slice).current.status, 'blocked');
  assert.equal(completionContribution(applied.slice), 0);
  const skipped = applyProgressEvent(REGISTER, event({ status: 'skipped', reason: 'superseded by the runner retry policy', at: '2026-09-26T09:00:00Z' }));
  assert.equal(sliceDeliveryProgress(skipped.slice).percent, 70, 'a skipped checkpoint earns nothing and removes nothing');
  assert.throws(() => applyProgressEvent(REGISTER, event({ status: 'skipped', at: '2026-09-26T09:00:00Z' })), /without --reason/);
  assert.throws(() => applyProgressEvent(REGISTER, event({ status: 'blocked', at: '2026-09-26T09:00:00Z', checkpoint: 'CP-01' })), /without --blocked-by/);
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

test('an event on an unknown slice or checkpoint is refused before anything is written', () => {
  assert.throws(() => applyProgressEvent(REGISTER, { slice: 'P5-M99', checkpoint: 'CP-01', status: 'in-progress' }), /not in the register/);
  assert.throws(() => applyProgressEvent(REGISTER, event({ checkpoint: 'CP-42', status: 'in-progress' })), /no checkpoint CP-42/);
  assert.throws(() => applyProgressEvent(REGISTER, event({ status: 'done' })), /must be one of/);
  assert.throws(() => applyProgressEvent(REGISTER, event({ checkpoint: 'C1' })), /must look like CP-01/);
});

test('the live state is readable from the register alone: status, checkpoint, evidence, blocker, timestamp', () => {
  const slice = m08(REGISTER);
  const rendered = renderReadmeMilestoneSection(REGISTER);
  assert.match(rendered, new RegExp(`- \\*\\*Current checkpoint:\\*\\* CP-05[^\\n]*\\(blocked, 30\\)`));
  assert.match(rendered, /- \*\*Checkpoint evidence:\*\* CP-01: docs\/n8n-lego\/evidence\/P5-M08-EVIDENCE\.md/);
  assert.match(rendered, new RegExp(`- \\*\\*Last progress update:\\*\\* ${slice.updatedAt}`));
  assert.match(rendered, /- 🔴 \*\*P5-M02\*\*[^\n]*Last progress update: —/);
  assert.match(rendered, /governance\(progress\):/);
  assert.match(rendered, /LIVE-MILESTONE EXCEPTION/);
  assert.match(formatPercent(headlineMetrics(REGISTER).current.realtime), /^\d+\.\d%$/);
});
