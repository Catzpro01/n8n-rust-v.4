/**
 * Governance reset (Issue #256) — the canonical register's program / slice / feature layer, the
 * runner protocol, and the <= 1 s polling rule are enforced by machine, not by convention.
 *
 * The register (`docs/n8n-lego/milestones.json`) is the single source; the generated view
 * (`.ai/master/MILESTONE_REGISTER.md`) is kept fresh by `npm run lego:ai:check`. This test runs the
 * same validator the generator uses, then proves the validator is not vacuous by mutating a copy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateGovernanceRegister, TOP_LEVEL_PROGRAMS, EXPECTED_PROGRAM_STATUS, LEGACY_FUTURE_MILESTONES, countBy,
  README_MARKERS, renderReadmeMilestoneSection, syncReadmeMilestoneSection,
} from '../../../tools/lego/governance-register.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');
const REGISTER = JSON.parse(read('docs/n8n-lego/milestones.json'));
const GOVERNANCE = JSON.parse(read('docs/engineering-operations/workforce-governance.json'));
const clone = () => JSON.parse(JSON.stringify(REGISTER));
const slices = (register) => [...register.programs, ...register.futurePrograms].flatMap((entity) => entity.slices);

test('the canonical register passes every governance rule', () => {
  assert.deepEqual(validateGovernanceRegister(REGISTER), []);
});

test('top level is exactly P0-P11 with the recorded Manager statuses', () => {
  assert.deepEqual(REGISTER.programs.map((program) => program.id), [...TOP_LEVEL_PROGRAMS]);
  for (const program of REGISTER.programs) assert.equal(program.status, EXPECTED_PROGRAM_STATUS[program.id], program.id);
  assert.deepEqual(REGISTER.programs.filter((p) => p.status === 'complete').map((p) => p.id), ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P9']);
  assert.deepEqual(REGISTER.programs.filter((p) => p.status === 'planned').map((p) => p.id), ['P7', 'P8', 'P10', 'P11']);
});

test('P5.1-P5.8 are recorded with their merge SHAs; P5 debt is P5-M01..M03, never P5.9', () => {
  const p5 = REGISTER.programs.find((program) => program.id === 'P5');
  const byId = new Map(p5.slices.map((slice) => [slice.id, slice]));
  const expected = {
    'P5.1': '0842a05f297b1c0fc96a3b0b65498e5c52febb49', 'P5.2': 'd8f18174697d6b8f3227490d28f5cce60e675b3c',
    'P5.3': '57606b52ff9e19ab0b57fb90d89e81a37002e75b', 'P5.4': 'ae99e9808d0685425ef99cca5005cf60a2407144',
    'P5.5': '260b838d2ab5e5de21ffa8acaeb94316cce8a39b', 'P5.6': '4e6802c84270986b519418856f95b625943edeb0',
    'P5.7': '5310bf31fd2517ea797432d9b86ed974a685bca0', 'P5.8': '87099dc0fd32264db711db3a43ef1167a84e9f96',
  };
  for (const [id, sha] of Object.entries(expected)) {
    assert.equal(byId.get(id)?.status, 'implemented', id);
    assert.equal(byId.get(id).mergeSha, sha, `${id} merge SHA`);
  }
  for (const id of ['P5-M01', 'P5-M02', 'P5-M03']) assert.equal(byId.get(id)?.kind, 'maintenance', id);
  assert.equal(byId.has('P5.9'), false);
});

test('legacy P12-P23 are consolidated into five thematic future programs, each exactly once', () => {
  assert.deepEqual(REGISTER.futurePrograms.map((future) => future.id),
    ['FUTURE-EVENT', 'FUTURE-RELIABILITY', 'FUTURE-PLATFORM', 'FUTURE-DISTRIBUTION', 'FUTURE-AI-ECOSYSTEM']);
  const legacy = REGISTER.futurePrograms.flatMap((future) => future.legacyMilestones).sort((a, b) => a.slice(1) - b.slice(1));
  assert.deepEqual(legacy, [...LEGACY_FUTURE_MILESTONES]);
  const issues = REGISTER.futurePrograms.flatMap((future) => future.legacyIssues).sort((a, b) => a - b);
  assert.deepEqual(issues, [228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239], 'every legacy planning issue stays traceable');
  for (const issue of issues) {
    assert.ok(REGISTER.features.some((feature) => feature.sourceIssue.includes(issue)), `#${issue} has at least one registered feature`);
  }
});

test('the reconciled PRs are recorded as implemented slices with post-merge verification', () => {
  const byId = new Map(slices(REGISTER).map((slice) => [slice.id, slice]));
  assert.equal(byId.get('P2-S01').pr, 244);
  assert.equal(byId.get('P2-S01').mergeSha, 'c77c3dba562e577c0f42348d55be9e5c722157ff');
  assert.equal(byId.get('FUTURE-RELIABILITY-S01').pr, 246);
  assert.equal(byId.get('FUTURE-RELIABILITY-S01').legacyMilestone, 'P21');
  for (const id of ['P2-S01', 'FUTURE-RELIABILITY-S01']) {
    assert.match(byId.get(id).postMergeVerified, /^[0-9a-f]{40}$/, `${id} records its post-merge verification`);
  }
});

test('every implemented feature is backed by a merged slice, never by an issue alone', () => {
  const byId = new Map(slices(REGISTER).map((slice) => [slice.id, slice]));
  for (const feature of REGISTER.features.filter((f) => f.status === 'implemented' && f.type !== 'governance')) {
    assert.ok(feature.slice, `${feature.id} names its slice`);
    assert.equal(byId.get(feature.slice)?.status, 'implemented', `${feature.id}: its slice is implemented`);
    assert.equal(feature.mergeSha, byId.get(feature.slice).mergeSha, `${feature.id}: SHA agrees with its slice`);
  }
  const counts = countBy(REGISTER.features, 'status');
  assert.ok(counts.implemented > 0 && counts.planned > 0);
  for (const status of Object.keys(counts)) assert.ok(REGISTER.governance.statusVocabulary.includes(status), status);
});

/* ------------------------------------------------------ the validator is not vacuous */

const MUTATIONS = [
  ['a P12 top-level program', (r) => { r.programs.push({ ...r.programs[7], id: 'P12' }); }, /exactly P0/],
  ['P5.9', (r) => { r.programs[5].slices.push({ ...r.programs[5].slices[0], id: 'P5.9' }); }, /P5\.9 is forbidden/],
  ['a changed program status', (r) => { r.programs[7].status = 'complete'; }, /Manager decision/],
  ['an implemented slice without a SHA', (r) => { r.programs[4].slices[0].mergeSha = null; }, /without a 40-hex merge SHA/],
  ['a slice named under the wrong P', (r) => { r.programs[3].slices.push({ ...r.programs[3].slices.at(-1), id: 'P4-S09' }); }, /sits under P3/],
  ['a future program named like a P', (r) => { r.futurePrograms[0].id = 'P24'; }, /FUTURE-<THEME>|never a P number/],
  ['a dropped legacy milestone', (r) => { r.futurePrograms[0].legacyMilestones = []; }, /exactly one future program/],
  ['an unknown feature status', (r) => { r.features[0].status = 'done'; }, /status "done"/],
  ['a duplicate feature id', (r) => { r.features.push({ ...r.features[0] }); }, /duplicate feature id/],
  ['an implemented feature claimed from an issue only', (r) => {
    const f = r.features.find((x) => x.status === 'planned'); f.status = 'implemented'; f.evidence = null;
  }, /implemented without evidence/],
  ['a superseded feature without replacement', (r) => { r.features.find((x) => x.status === 'planned').status = 'superseded'; }, /without supersededBy/],
  ['a slice reference into another program', (r) => { r.features.find((x) => x.parent === 'P7').slice = 'P8-S01'; }, /belongs to P8/],
  // DEC-0020: completion, in-progress and pointer semantics.
  ['a P24 top-level program', (r) => { r.programs.push({ ...r.programs[7], id: 'P24' }); }, /exactly P0/],
  ['a duplicate slice id', (r) => { r.programs[5].slices.push({ ...r.programs[5].slices.find((x) => x.id === 'P5-M09') }); }, /declared twice/],
  ['a verifying slice recorded as implemented before post-merge verification', (r) => {
    r.programs[5].slices.find((x) => x.id === 'P5-M08').status = 'implemented';
  }, /P5-M08: implemented without a 40-hex merge SHA|verifying slice P5-M08 is implemented/],
  ['an implemented slice without evidence', (r) => { r.programs[5].slices.find((x) => x.id === 'P5-M03').evidence = null; }, /P5-M03: implemented without evidence/],
  ['an in-progress slice missing from the pointer', (r) => {
    const slice = r.programs[5].slices.find((x) => x.id === 'P5-M09'); slice.status = 'in-progress';
    r.executionPointer.plannedQueue = r.executionPointer.plannedQueue.filter((id) => id !== 'P5-M09');
  }, /in-progress slice P5-M09 is neither active nor verifying/],
  ['a queued slice that is not planned', (r) => { r.executionPointer.plannedQueue.push('P5-M03'); }, /queued slice P5-M03 is implemented/],
  ['a blocked slice without blockedBy', (r) => { delete r.programs[5].slices.find((x) => x.id === 'P5-M10').blockedBy; }, /P5-M10 does not record blockedBy/],
  ['a blocked slice missing from blockedSlices', (r) => { r.executionPointer.blockedSlices = []; }, /blocked slice P5-M02 is missing/],
  ['a latest completed slice that is not implemented', (r) => { r.executionPointer.latestCompletedSlice.id = 'P5-M09'; }, /latestCompletedSlice P5-M09/],
  ['a pointer naming an unknown slice', (r) => { r.executionPointer.plannedQueue.push('P5-M99'); }, /unknown slice P5-M99/],
  ['a pointer whose authority is not main', (r) => { r.executionPointer.authority = 'arena-manager'; }, /authority must be main/],
  ['a slice listed twice in the pointer', (r) => { r.executionPointer.blockedSlices.push('P5-M09'); }, /listed in both/],
];
for (const [name, mutate, expected] of MUTATIONS) {
  test(`the validator rejects ${name}`, () => {
    const register = clone();
    mutate(register);
    const errors = validateGovernanceRegister(register);
    assert.ok(errors.some((error) => expected.test(error)), `expected ${expected} in:\n${errors.join('\n')}`);
  });
}

/* ------------------------------------------------------------------ generated view */

test('the generated register view renders the program table from the canonical source', () => {
  const view = read('.ai/master/MILESTONE_REGISTER.md');
  assert.match(view, /GENERATED by tools\/lego\/ai-pack\.mjs/);
  assert.match(view, /## Programs P0–P11 \(top level\)/);
  for (const program of REGISTER.programs) assert.match(view, new RegExp(`\\| \\*\\*${program.id}\\*\\* \\|`));
  for (const future of REGISTER.futurePrograms) assert.match(view, new RegExp(`\\*\\*${future.id}\\*\\*`));
  assert.match(view, new RegExp(`\\| \\*\\*total\\*\\* \\| \\*\\*${REGISTER.features.length}\\*\\* \\|`));
});

/* ------------------------------------------------------------------ runner protocol */

test('runner protocol: 5 Windows + 5 WSL, 1 s polling, one authoritative document, cross-referenced from .ai/master', () => {
  const protocol = GOVERNANCE.runnerProtocol;
  assert.ok(protocol, 'workforce-governance.json carries runnerProtocol');
  assert.equal(protocol.runners.windows.length, 5);
  assert.equal(protocol.runners.wsl.length, 5);
  assert.equal(new Set([...protocol.runners.windows, ...protocol.runners.wsl]).size, 10);
  assert.equal(protocol.pollIntervalSeconds, 1);
  assert.equal(protocol.maxSleepSeconds, 1);
  assert.ok(existsSync(join(REPO_ROOT, protocol.document)), protocol.document);
  assert.match(read(protocol.document), /at most 1 second/);
  assert.equal(REGISTER.governance.runnerProtocol.startsWith(protocol.document), true, 'the register points at the same document');
  const view = read('.ai/master/PROJECT_WORKFORCE_ORCHESTRATION.md');
  assert.match(view, /## Runner protocol/);
  assert.ok(view.includes(protocol.document), 'the generated master view cross-references the document');
});

/** Waits in CI workflows and operations tooling: no literal sleep above 1 s. */
function* opsFiles(relative) {
  const absolute = join(REPO_ROOT, relative);
  if (!existsSync(absolute)) return;
  for (const name of readdirSync(absolute)) {
    const child = join(relative, name);
    const stat = statSync(join(REPO_ROOT, child));
    if (stat.isDirectory()) {
      if (['node_modules', 'tests', 'test', '__pycache__', 'vendor'].includes(name)) continue;
      yield* opsFiles(child);
    } else if (/\.(ya?ml|sh|py|ps1|mjs|cjs|js)$/.test(name)) {
      yield child;
    }
  }
}

test('no polling/wait sleep above 1 second in CI workflows or operations tooling', () => {
  const offenders = [];
  const roots = ['.github/workflows', 'tools/orchestration', 'scripts', 'apps/n8n-lego/scripts'];
  const patterns = [
    /\bsleep\s+(\d+(?:\.\d+)?)\b/g, // shell
    /time\.sleep\(\s*(\d+(?:\.\d+)?)\s*\)/g, // python literal
    /Start-Sleep\s+(?:-Seconds\s+)?(\d+(?:\.\d+)?)/gi, // powershell
  ];
  for (const root of roots) {
    for (const file of opsFiles(root)) {
      const lines = read(file).split('\n');
      lines.forEach((line, index) => {
        if (/^\s*(#|\/\/)/.test(line)) return;
        for (const pattern of patterns) {
          for (const match of line.matchAll(pattern)) {
            if (Number(match[1]) > 1) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
          }
        }
        for (const match of line.matchAll(/set(?:Timeout|Interval)\([^)]*?,\s*(\d[\d_]*)\s*\)/g)) {
          if (Number(match[1].replace(/_/g, '')) > 1000) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }
  assert.deepEqual(offenders, [], 'waits must poll at <= 1 s (docs/engineering-operations/RUNNER-PROTOCOL.md §3)');
});

test('runtime token material from the gateway is never committable', () => {
  assert.match(read('.gitignore'), /^\.arena\/gateway_tokens\.json$/m);
});

/* ------------------------------------------ DEC-0020: milestone truth is main-owned */

const README = read('README.md');
const HISTORICAL_LADDER = ['P2.11', 'P2.12', 'P2.13', 'P2.14', 'P2.15', 'P2.16', 'P2.17', 'P2.18', 'P2.19', 'P2.20', 'P2.21', 'P2.22',
  'P2.23', 'P2.24', 'P2.25', 'P2.26', 'P2.27', 'P2.17+'];
const HISTORICAL_P2_SLICES = ['P2.1-P2.4', 'P2.5', 'P2.6-P2.10', 'P2.11', 'P2.12', 'P2.13', 'P2.14', 'P2.15', 'P2.16', 'P2.17', 'P2.18',
  'P2.19', 'P2.20', 'P2.21', 'P2.22', 'P2.23', 'P2.24', 'P2.25', 'P2.26', 'P2.27', 'P2.27.0', 'P2.27.1', 'P2.27.2', 'P2.27.3', 'P2.27.4',
  'P2.27.5', 'P2.27.6', 'P2.27.7', 'P2.27.8', 'P2.27.9', 'P2.27.10'];

test('DEC-0020 is recorded as an active decision', () => {
  const decision = JSON.parse(read('docs/engineering-operations/workforce/decisions/DEC-0020.json'));
  assert.equal(decision.state, 'ACTIVE');
  assert.equal(decision.selectedOption, 'A-main-owned');
  assert.equal(REGISTER.governance.milestoneAuthority.decision, 'DEC-0020');
  assert.match(REGISTER.governance.milestoneAuthority.rule, /main-owned/);
  assert.match(REGISTER.governance.milestoneAuthority.rule, /arena-manager is not an alternate milestone authority/);
});

test('README carries the generated projection of the register, and it is current', () => {
  assert.equal(README.split(README_MARKERS.begin).length, 2, 'exactly one begin marker');
  assert.equal(README.split(README_MARKERS.end).length, 2, 'exactly one end marker');
  const synced = syncReadmeMilestoneSection(README, REGISTER);
  assert.equal(synced.ok, true);
  assert.equal(synced.changed, false, 'README milestone block is stale: run npm run lego:ai');
  const block = renderReadmeMilestoneSection(REGISTER);
  assert.match(block, /docs\/n8n-lego\/milestones\.json/);
  assert.match(block, /`main` is authoritative/);
  const pointer = REGISTER.executionPointer;
  assert.ok(block.includes(`\`${pointer.latestCompletedSlice.id}\``), 'latest completed slice');
  for (const entry of pointer.verifyingSlices) assert.ok(block.includes(`\`${entry.id}\``), `verifying ${entry.id}`);
  for (const id of [...pointer.activeSlices, ...pointer.plannedQueue, ...pointer.blockedSlices]) assert.ok(block.includes(`\`${id}\``), id);
  for (const program of REGISTER.programs) assert.match(block, new RegExp(`\\| ${program.id} \\| .* \\| ${program.status} \\|`));
});

test('README states no milestone truth outside the generated block', () => {
  const outside = README.slice(0, README.indexOf(README_MARKERS.begin)) + README.slice(README.indexOf(README_MARKERS.end));
  const ids = outside.match(/\bP\d+(?:\.\d+|-[SM]\d{2})\b/g) ?? [];
  assert.deepEqual(ids, [], 'milestone/slice ids belong in the generated block only');
});

test('ROADMAP.md points to the register instead of stating milestone status', () => {
  const roadmap = read('docs/n8n-lego/ROADMAP.md');
  assert.match(roadmap, /application roadmap/i);
  assert.match(roadmap, /docs\/n8n-lego\/milestones\.json|\(milestones\.json\)/);
  assert.doesNotMatch(roadmap, /\| \*\*P2\.13[^|]*\| 🔄/, 'no stale "P2.13 in progress" row');
  assert.doesNotMatch(roadmap, /^\| (\*\*)?P\d+\.\d+[^|]*\| (🔄|⏳)/m, 'no milestone status rows');
});

test('the historical P2 ladder and P2 slices are preserved unchanged', () => {
  assert.deepEqual(REGISTER.milestones.map((milestone) => milestone.id), HISTORICAL_LADDER);
  for (const milestone of REGISTER.milestones.filter((m) => m.id !== 'P2.17+')) assert.equal(milestone.status, 'complete', milestone.id);
  const p2 = REGISTER.programs.find((program) => program.id === 'P2');
  const historical = p2.slices.filter((slice) => slice.id.startsWith('P2.'));
  assert.deepEqual(historical.map((slice) => slice.id), HISTORICAL_P2_SLICES);
  for (const slice of historical) assert.equal(slice.status, 'implemented', slice.id);
  assert.equal(REGISTER.currentMilestone, REGISTER.executionPointer.historicalLastP2Milestone, 'the P2 pointer is history, not active work');
});

test('the P5 maintenance ladder is P5-M01..M10, each a separate slice with evidence-backed state', () => {
  const p5 = new Map(REGISTER.programs.find((program) => program.id === 'P5').slices.map((slice) => [slice.id, slice]));
  const ladder = ['P5-M01', 'P5-M02', 'P5-M03', 'P5-M04', 'P5-M05', 'P5-M06', 'P5-M07', 'P5-M08', 'P5-M09', 'P5-M10'];
  for (const id of ladder) assert.equal(p5.get(id)?.kind, 'maintenance', id);
  assert.deepEqual(['P5-M01', 'P5-M03'].map((id) => [p5.get(id).status, p5.get(id).mergeSha]), [
    ['implemented', '2719109169e99714e70937767e9a15af65bd640e'], ['implemented', 'cf52701c91e5447f19c32377c38f6ae5eea7f3a7']]);
  const m08 = p5.get('P5-M08');
  assert.equal(m08.pr, 304);
  const verifying = REGISTER.executionPointer.verifyingSlices.find((entry) => entry.id === 'P5-M08');
  if (m08.status === 'in-progress') assert.ok(verifying, 'a merged, unverified slice is listed as verifying');
  else assert.equal(m08.status, 'implemented', 'P5-M08 leaves in-progress only by post-merge verification');
  for (const id of REGISTER.executionPointer.blockedSlices) assert.ok(p5.get(id)?.blockedBy || REGISTER.programs.some((p) => p.slices.some((x) => x.id === id && x.blockedBy)), id);
});
