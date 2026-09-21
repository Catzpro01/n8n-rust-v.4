/**
 * Capability lifecycle, criticality, trust and degradation.
 *
 * The point of these rules is that "installed" must never silently mean
 * "loaded", and a missing optional feature must degrade along a documented path
 * instead of taking the editor with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPABILITY_STATES,
  CRITICALITY,
  LifecycleError,
  RUNNABLE_STATES,
  STATE_TRANSITIONS,
  TRUST_LEVELS,
  canTransition,
  createLifecycle,
  degradationFor,
  describeLifecycle,
  describeTrust,
  isRunnable,
  mayPerform,
  trustInherited,
  trustRank,
} from '../src/lifecycle.mjs';

test('the state machine covers the full lifecycle asked of a capability', () => {
  for (const state of ['available', 'installed', 'loaded', 'active', 'idle', 'unloaded', 'disabled']) {
    assert.ok(CAPABILITY_STATES.includes(state), `${state} is part of the vocabulary`);
  }
  // Anything not in the transition table is refused, so the vocabulary cannot
  // grow into an implicit free-for-all.
  for (const [from, targets] of Object.entries(STATE_TRANSITIONS)) {
    for (const to of targets) assert.ok(CAPABILITY_STATES.includes(to), `${from} -> ${to} must be a known state`);
  }
});

test('availability is not activation: a declared capability runs nothing', () => {
  assert.equal(isRunnable('available'), false);
  assert.equal(isRunnable('installed'), false);
  assert.equal(isRunnable('loaded'), true);
  assert.equal(isRunnable('active'), true);
  assert.equal(isRunnable('idle'), true);
  assert.equal(isRunnable('unloaded'), false);
  assert.equal(isRunnable('disabled'), false);
  assert.deepEqual(RUNNABLE_STATES, ['loaded', 'active', 'idle']);
  const catalog = describeLifecycle();
  assert.equal(catalog.length, CAPABILITY_STATES.length);
  assert.equal(catalog.find((entry) => entry.state === 'installed').runnable, false);
});

test('a capability walks available -> installed -> loaded -> active -> idle -> unloaded', () => {
  const lifecycle = createLifecycle({ capabilityId: 'translation' });
  assert.equal(lifecycle.state, 'available');
  assert.equal(lifecycle.runnable, false);
  assert.equal(lifecycle.transition('installed'), 'installed');
  assert.equal(lifecycle.transition('loaded'), 'loaded');
  assert.equal(lifecycle.transition('active'), 'active');
  assert.equal(lifecycle.runnable, true);
  assert.equal(lifecycle.transition('idle'), 'idle');
  assert.equal(lifecycle.transition('unloaded'), 'unloaded');
  assert.deepEqual(lifecycle.history.map((entry) => entry.state), ['available', 'installed', 'loaded', 'active', 'idle', 'unloaded']);
  assert.equal(lifecycle.describe().runnable, false);
});

test('illegal transitions are refused with the allowed set in the message', () => {
  const lifecycle = createLifecycle({ capabilityId: 'translation' });
  assert.throws(() => lifecycle.transition('active'), (error) => {
    assert.ok(error instanceof LifecycleError);
    assert.equal(error.code, 'frontend.lifecycle.invalid-transition');
    assert.equal(error.from, 'available');
    assert.equal(error.to, 'active');
    assert.match(error.message, /allowed: installed, disabled/);
    return true;
  });
  assert.throws(() => lifecycle.transition('teleported'), /unknown state/);
  assert.equal(lifecycle.state, 'available', 'a refused transition changes nothing');
  assert.equal(canTransition('disabled', 'loaded'), false);
  assert.equal(canTransition('disabled', 'available'), true, 'a disabled capability can be re-enabled, not silently activated');
});

test('criticality decides what happens when a capability is missing', () => {
  const core = degradationFor({ criticality: 'core' });
  assert.equal(core.behavior, 'fail-loud');
  assert.equal(core.fallback, null);
  assert.match(core.detail, /broken instance/);

  const optional = degradationFor({ criticality: 'optional', degradation: { fallback: 'fallback-locale' } });
  assert.equal(optional.behavior, 'fallback');
  assert.equal(optional.fallback, 'fallback-locale');

  const enhancement = degradationFor({ criticality: 'enhancement' });
  assert.equal(enhancement.behavior, 'continue');

  // A missing criticality declaration is treated as core: unknown must not be
  // quietly downgraded to optional.
  assert.equal(degradationFor({}).behavior, 'fail-loud');
  assert.equal(degradationFor({ criticality: 'whatever' }).behavior, 'fail-loud');
  assert.deepEqual(CRITICALITY, ['core', 'optional', 'enhancement']);
});

test('trust levels are ordered, and a child may not be more trusted than its parent', () => {
  assert.deepEqual(TRUST_LEVELS, ['core', 'feature', 'extension', 'untrusted']);
  assert.ok(trustRank('core') < trustRank('feature'));
  assert.ok(trustRank('feature') < trustRank('extension'));
  assert.ok(trustRank('extension') < trustRank('untrusted'));

  assert.equal(trustInherited('feature', 'feature'), true, 'same level is allowed');
  assert.equal(trustInherited('feature', 'extension'), true, 'lowering trust is allowed');
  assert.equal(trustInherited('extension', 'feature'), false, 'promotion by nesting is not');
  assert.equal(trustInherited('core', 'core'), true);
  assert.equal(trustInherited('feature', 'not-a-level'), false, 'an unknown level is refused, not assumed');

  assert.equal(mayPerform('core', 'own-routes').allowed, true);
  const extension = mayPerform('extension', 'own-routes');
  assert.equal(extension.allowed, false);
  assert.match(extension.reason, /may not own-routes/);
  assert.equal(mayPerform('untrusted', 'read-session').allowed, false);
  assert.equal(mayPerform('untrusted', 'render-own-subtree').allowed, true);
  assert.equal(mayPerform('nonsense', 'anything').allowed, false);
});

test('the trust model is published as data, including what each level may not do', () => {
  const model = describeTrust();
  assert.equal(model.length, TRUST_LEVELS.length);
  for (const level of model) {
    assert.ok(level.may.length > 0, `${level.level} must be able to do something`);
    assert.ok(Array.isArray(level.mayNot));
    assert.equal(typeof level.rank, 'number');
  }
  const untrusted = model.find((entry) => entry.level === 'untrusted');
  assert.deepEqual(untrusted.may, ['render-own-subtree'], 'untrusted content renders in its own subtree and nothing else');
  assert.ok(untrusted.mayNot.includes('read-session'));
});
