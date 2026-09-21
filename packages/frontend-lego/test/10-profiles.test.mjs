/**
 * Device profiles: declared budgets, four support states, no platform branching.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEVICE_PROFILES,
  ProfileError,
  REQUIREMENT_FIELDS,
  SUPPORT_STATES,
  describeProfiles,
  getProfile,
  resolveSupport,
  supportMatrix,
} from '../src/profiles.mjs';

const ids = DEVICE_PROFILES.map((profile) => profile.id);

test('the declared profiles cover the devices the brief names', () => {
  for (const id of ['desktop', 'laptop', 'low-memory', 'android', 'termux-companion', 'remote-only']) {
    assert.ok(ids.includes(id), `${id} is a declared profile`);
  }
  for (const profile of DEVICE_PROFILES) {
    for (const field of ['memoryMb', 'storageMb', 'input', 'alwaysOnline', 'executionModel']) {
      assert.ok(field in profile.budget, `${profile.id} declares ${field}`);
    }
  }
  assert.deepEqual(SUPPORT_STATES, ['supported', 'degraded', 'remote', 'unsupported']);
  assert.deepEqual(REQUIREMENT_FIELDS, ['memoryMb', 'storageMb', 'requiresLocalExecution', 'requiresNetwork', 'heavy', 'input']);
});

test('an unprofiled device is refused, not silently assumed to be a desktop', () => {
  assert.throws(() => getProfile('smart-fridge'), (error) => {
    assert.ok(error instanceof ProfileError);
    assert.equal(error.code, 'frontend.profile.unknown');
    assert.equal(error.profileId, 'smart-fridge');
    assert.match(error.message, /one of desktop/);
    return true;
  });
  assert.throws(() => resolveSupport('smart-fridge', { id: 'x' }), ProfileError);
});

test('within budget is supported, over budget is unsupported, a stretched preview is degraded', () => {
  const light = { id: 'notifications', requirements: { memoryMb: 8 } };
  assert.equal(resolveSupport('desktop', light).state, 'supported');
  assert.equal(resolveSupport('termux-companion', light).state, 'supported');

  const heavy = { id: 'workflow-editor', requirements: { memoryMb: 4096, heavy: true } };
  assert.equal(resolveSupport('desktop', heavy).state, 'supported');
  assert.equal(resolveSupport('low-memory', heavy).state, 'unsupported', 'a 1 GB profile cannot host a 4 GB editor');
  assert.match(resolveSupport('low-memory', heavy).reason, /needs ~4096 MB/);

  const stretched = { id: 'translation', requirements: { memoryMb: 1500, heavy: true } };
  assert.equal(resolveSupport('low-memory', stretched).state, 'unsupported');
  const soft = { id: 'search', requirements: { heavy: true } };
  assert.equal(resolveSupport('low-memory', soft).state, 'degraded', 'heavy without a hard budget is a degradation, not a refusal');
  assert.match(resolveSupport('low-memory', soft).reason, /expected to be lazy or reduced/);
});

test('a thin client reaches capabilities remotely instead of dropping them', () => {
  const local = { id: 'execution-panel', requirements: { requiresLocalExecution: true, memoryMb: 2048 } };
  const remote = resolveSupport('remote-only', local);
  assert.equal(remote.state, 'remote');
  assert.match(remote.reason, /through the server instead/);

  const heavy = { id: 'workflow-editor', requirements: { memoryMb: 4096 } };
  assert.equal(resolveSupport('remote-only', heavy).state, 'remote', 'over budget, but a remote-only profile has a server to lean on');
  const trivial = { id: 'notifications' };
  assert.equal(resolveSupport('remote-only', trivial).state, 'supported');
});

test('input, network and storage produce degradations rather than surprises', () => {
  const pointerFirst = { id: 'workflow-editor.canvas', requirements: { input: 'pointer' } };
  assert.equal(resolveSupport('desktop', pointerFirst).state, 'supported');
  assert.equal(resolveSupport('android', pointerFirst).state, 'degraded');
  assert.match(resolveSupport('android', pointerFirst).reason, /reduced interaction/);

  const onlineOnly = { id: 'node-picker', requirements: { requiresNetwork: true } };
  assert.equal(resolveSupport('laptop', onlineOnly).state, 'supported');
  assert.equal(resolveSupport('termux-companion', onlineOnly).state, 'degraded');
  assert.match(resolveSupport('termux-companion', onlineOnly).reason, /offline gaps/);

  const storage = { id: 'cache', requirements: { storageMb: 512 } };
  assert.equal(resolveSupport('desktop', storage).state, 'supported');
  assert.equal(resolveSupport('low-memory', storage).state, 'degraded');

  // Every answer carries a reason: a support state nobody can explain is a bug report.
  for (const id of ids) {
    const answer = resolveSupport(id, { id: 'capability', requirements: { memoryMb: 100 } });
    assert.equal(answer.profile, id);
    assert.equal(answer.capability, 'capability');
    assert.ok(answer.reason.length > 0);
  }
});

test('the support matrix and profile catalog are data for docs and `.ai/` cards', () => {
  const matrix = supportMatrix([{ id: 'translation', requirements: { heavy: true } }, { id: 'notifications' }]);
  assert.equal(matrix.length, DEVICE_PROFILES.length);
  assert.deepEqual(matrix.map((row) => row.profile), ids);
  for (const row of matrix) {
    assert.equal(row.capabilities.length, 2);
    assert.ok(SUPPORT_STATES.includes(row.capabilities[0].state));
  }
  const catalog = describeProfiles();
  assert.deepEqual(catalog.states, SUPPORT_STATES);
  assert.equal(catalog.profiles.length, ids.length);
  assert.match(catalog.rule, /never on platform identity/);
  assert.equal(JSON.stringify(catalog).includes('navigator'), false, 'a profile is a budget, not a user-agent sniff');
});
