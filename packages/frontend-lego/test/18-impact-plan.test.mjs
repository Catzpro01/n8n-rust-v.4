/**
 * The selective test plan: runnable, honest, and never a substitute for CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  SELECTIVE_CAVEAT,
  TEST_TIERS,
  TIER_SUITES,
  commandFor,
  createImpactGraph,
  requiresInstance,
} from '../src/impact.mjs';
import { PACKAGE_ROOT, loadManifests } from '../src/manifests.mjs';
import { createSubLegoRegistry } from '../src/sublegos.mjs';

const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const manifests = loadManifests();
const subLegos = createSubLegoRegistry({
  subLegos: manifests.subLegos,
  owners: manifests.owners,
  surfaces: manifests.surfaces,
  extensionPoints: manifests.extensionPoints,
});
const graph = createImpactGraph({ subLegos, surfaces: manifests.surfaces });

test('every suite the tiers name exists on disk — a plan that cannot run is a lie', () => {
  for (const [tier, suites] of Object.entries(TIER_SUITES)) {
    for (const suite of suites) {
      // Command entries (npm/node/python3/bash, globs) are checked by the tier
      // commands themselves, not as paths.
      if (/^(npm|node|python3|bash)\s/.test(suite) || suite.includes('*')) continue;
      assert.ok(existsSync(join(REPO_ROOT, suite)), `${tier} → ${suite} exists`);
    }
  }
  // The declared test path of every unit must exist too: it is what the plan runs.
  for (const unit of manifests.subLegos) {
    for (const test of unit.tests) {
      assert.ok(existsSync(join(REPO_ROOT, test)), `${unit.id} declares ${test}`);
    }
  }
});

test('commands are copy-pasteable and browser suites are marked as needing an instance', () => {
  assert.equal(commandFor('packages/frontend-lego/test/06-sublegos.test.mjs'), 'node --test packages/frontend-lego/test/06-sublegos.test.mjs');
  assert.equal(commandFor('apps/n8n-lego/test/frontend.boundary.test.mjs'), 'node --test apps/n8n-lego/test/frontend.boundary.test.mjs');
  assert.equal(commandFor('tests/e2e/frontend-boundary.mjs'), 'node tests/e2e/frontend-boundary.mjs <instance-url>');
  assert.equal(commandFor('tests/e2e/frontend-boundary.mjs', { url: 'http://127.0.0.1:6200' }), 'node tests/e2e/frontend-boundary.mjs http://127.0.0.1:6200');
  assert.equal(commandFor('npm run frontend-lego:test'), 'npm run frontend-lego:test');
  assert.equal(commandFor('tools/sublego-audit/audit.py'), 'python3 tools/sublego-audit/audit.py');
  assert.equal(requiresInstance('tests/e2e/lego-smoke.mjs'), true);
  assert.equal(requiresInstance('packages/frontend-lego/test/01-contract.test.mjs'), false);
  assert.throws(() => commandFor(''), /is not a suite reference/);
});

test('a low-risk private change produces a small plan and names what it skipped', () => {
  const plan = graph.planChange({ target: 'node-picker' });
  const tiers = new Map(plan.selectiveTestPlan.tiers.map((entry) => [entry.tier, entry]));
  assert.equal(plan.risk, 'low');
  assert.ok(tiers.get('fast-contract').commands.length >= 1);
  assert.ok(tiers.get('boundary').commands.length >= 1);
  assert.ok(tiers.get('browser').commands.length > 0, 'the unit reaches a surface, so the browser tier is in scope');
  assert.deepEqual(tiers.get('integration').commands, []);
  assert.deepEqual(tiers.get('full').commands, []);
  assert.deepEqual(plan.selectiveTestPlan.skipped, ['integration', 'full'], 'skipped tiers are named, never silent');
  assert.match(tiers.get('integration').reason, /low blast radius/);
  assert.match(tiers.get('full').reason, /full set in CI as usual/);
});

test('a high-risk change escalates, and the caveat travels with every plan', () => {
  const plan = graph.planChange({ target: 'workflow-editor.canvas' });
  const tiers = new Map(plan.selectiveTestPlan.tiers.map((entry) => [entry.tier, entry]));
  assert.equal(plan.risk, 'high');
  assert.ok(tiers.get('integration').commands.length > 0);
  assert.ok(tiers.get('full').commands.length > 0);
  assert.match(tiers.get('integration').reason, /blast radius is non-empty/);
  assert.deepEqual(plan.selectiveTestPlan.skipped, []);
  assert.equal(plan.selectiveTestPlan.caveat, SELECTIVE_CAVEAT.caveat);
  assert.match(plan.selectiveTestPlan.caveat, /not a substitute/);
  assert.deepEqual(plan.selectiveTestPlan.fullRunAlways, [...TIER_SUITES.full]);
  for (const entry of plan.selectiveTestPlan.tiers) {
    assert.ok(TEST_TIERS.includes(entry.tier));
    assert.equal(typeof entry.reason, 'string');
    assert.ok(entry.reason.length > 10, `${entry.tier} carries a reason`);
  }
});

test('the plan is JSON-safe: a tool can print it without special handling', () => {
  const plan = graph.planChange({ target: 'settings', kind: 'surface', description: 'add a settings section' });
  const roundTripped = JSON.parse(JSON.stringify(plan));
  assert.deepEqual(roundTripped.selectiveTestPlan.tiers.map((entry) => entry.tier), TEST_TIERS);
  assert.equal(roundTripped.risk, 'high');
  assert.ok(roundTripped.selectiveTestPlan.tiers.find((entry) => entry.tier === 'browser').requiresInstance);
});
