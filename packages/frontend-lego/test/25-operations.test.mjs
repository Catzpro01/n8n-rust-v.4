/**
 * Operation negotiation (Task 6).
 *
 * The UI has to know *why* an operation cannot run. These tests build one fixture
 * per declared outcome — and then assert that the set of outcomes the code can
 * actually produce equals the declared set, so a state cannot be documented and
 * unreachable, or reachable and undocumented.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEGRADATION_SITUATIONS,
  OPERATION_PRECEDENCE,
  OPERATION_STATES,
  createCapabilityNegotiator,
} from '../src/negotiation.mjs';
import { backendAvailabilityFrom } from '../src/backend-view.mjs';
import { createFrontendRegistry } from '../src/registry.mjs';
import { createSubLegoRegistry } from '../src/sublegos.mjs';
import { loadManifests } from '../src/manifests.mjs';
import { createFrontendLego } from '../src/lego.mjs';
import { vocabularyOf } from '../src/vocabulary.mjs';

const manifests = loadManifests();
const TEST_REF = 'packages/frontend-lego/test/25-operations.test.mjs';

function negotiatorFor({ capabilities = [], overrides = {}, declared = [] } = {}) {
  const registry = createFrontendRegistry({
    surfaces: manifests.surfaces,
    extensionPoints: manifests.extensionPoints,
    owners: manifests.owners,
  });
  for (const capability of capabilities) registry.register(capability);
  const subLegos = createSubLegoRegistry({ subLegos: manifests.subLegos });
  return createCapabilityNegotiator({
    registry,
    subLegos,
    surfaces: manifests.surfaces,
    declared,
    backend: backendAvailabilityFrom({ surfaces: manifests.surfaces, overrides }),
    contractVersion: '1.0.0',
    locales: ['id', 'en', 'ar'],
  });
}

const search = {
  id: 'search',
  lego: 'search',
  title: 'Search',
  status: 'available',
  lifecycle: 'active',
  surfaces: ['node-picker'],
  contracts: ['contracts/frontend.contract.md'],
  tests: [TEST_REF],
  operations: ['search.nodes', 'search.workflows'],
  activation: 'lazy',
  entry: './features/search/index.mjs',
};

test('the declared outcomes cover the vocabulary, and the precedence orders all of them', () => {
  assert.deepEqual(OPERATION_STATES, vocabularyOf('operationOutcome').values);
  assert.equal(OPERATION_STATES.length, 12);
  assert.deepEqual([...OPERATION_PRECEDENCE].sort(), [...OPERATION_STATES].sort(), 'every outcome has a precedence slot');
  // Which capability-level degradation states block an operation, and how they map.
  const blockers = DEGRADATION_SITUATIONS.map((row) => row.state).filter((state) => state !== 'available' && state !== 'degraded');
  for (const state of blockers) assert.ok(OPERATION_STATES.includes(state), `${state} is answerable at the operation level`);
});

test('available: the operation exists, may run, and says what it takes', () => {
  const negotiator = negotiatorFor({ capabilities: [{ ...search, operations: ['search.nodes', 'search.workflows'], permissions: ['search:read'] }] });
  const answer = negotiator.negotiateOperation({ capabilityId: 'search', operation: 'search.nodes', held: ['search:read'] });
  assert.equal(answer.state, 'available');
  assert.equal(answer.exists, true);
  assert.equal(answer.usable, true);
  assert.equal(answer.identity, 'search@1.0.0#search.nodes');
  assert.deepEqual(answer.requiredPermissions, ['search:read']);
  assert.equal(answer.degradation.state, 'available');
  assert.equal(answer.behavior, 'proceed');
});

test('operation-unpublished: a provider that lists no operations is refused, not trusted', () => {
  const negotiator = negotiatorFor({ capabilities: [{ ...search, operations: [] }] });
  const answer = negotiator.negotiateOperation({ capabilityId: 'search', operation: 'search.nodes' });
  assert.equal(answer.state, 'operation-unpublished');
  assert.equal(answer.exists, null, 'nobody can say whether it exists');
  assert.equal(answer.usable, false);
  assert.equal(answer.degradation, null, 'the canonical vocabulary is not asked, and no answer is invented');
  assert.match(answer.reasons.join(' '), /publishes no operation list/);
  assert.equal(answer.behavior, 'fallback');
});

test('feature-unsupported: the capability is here and does not offer this operation', () => {
  const negotiator = negotiatorFor({ capabilities: [search] });
  const answer = negotiator.negotiateOperation({ capabilityId: 'search', operation: 'search.credentials' });
  assert.equal(answer.state, 'feature-unsupported');
  assert.equal(answer.exists, false);
  assert.equal(answer.degradation.state, 'feature-unsupported');
  assert.equal(answer.degradation.action, 'answer 501 through the compatibility layer');
  assert.match(answer.reasons.join(' '), /does not offer "search.credentials"/);
});

test('permission-missing and permission-unknown are different facts', () => {
  const negotiator = negotiatorFor({ capabilities: [{ ...search, permissions: ['search:read'] }] });
  const missing = negotiator.negotiateOperation({ capabilityId: 'search', operation: 'search.nodes' });
  assert.equal(missing.state, 'permission-missing');
  assert.deepEqual(missing.requiredPermissions, ['search:read']);
  assert.match(missing.reasons.join(' '), /does not hold search:read/);

  const unknown = negotiator.negotiateOperation({ capabilityId: 'search', operation: 'search.nodes', held: ['search:read'], requirePermissions: ['search:write'] });
  assert.equal(unknown.state, 'permission-unknown');
  assert.match(unknown.reasons.join(' '), /never declares search:write/);

  // A held permission the capability never asks for is not an error: it is simply unused.
  assert.equal(negotiator.negotiateOperation({ capabilityId: 'search', operation: 'search.nodes', held: ['search:read', 'search:admin'] }).state, 'available');
});

test('operation-denied: an ungranted caller learns nothing about the capability', () => {
  const negotiator = negotiatorFor({ capabilities: [search] });
  const answer = negotiator.negotiateOperation({ capabilityId: 'search', operation: 'search.nodes', unitId: 'settings.localization.rtl' });
  assert.equal(answer.state, 'operation-denied');
  assert.equal(answer.capability, null, 'no metadata leaks');
  assert.equal(answer.identity, null);
  assert.equal(answer.exists, null);
  assert.deepEqual(answer.requiredPermissions, []);
  assert.match(answer.reasons[0], /placement never grants/);
});

test('the capability-level blockers pass through with their own names', () => {
  const cases = [
    { overrides: {}, declared: [], capabilityId: 'no-such-capability', expected: 'capability-unavailable' },
    { overrides: { settings: { status: 'unsupported', owner: 'settings' } }, capabilityId: 'settings', expected: 'feature-unsupported' },
  ];
  for (const entry of cases) {
    const negotiator = negotiatorFor({ overrides: entry.overrides });
    const answer = negotiator.negotiateOperation({ capabilityId: entry.capabilityId, operation: 'settings.read' });
    assert.equal(answer.state, entry.expected, `${entry.capabilityId} → ${entry.expected}`);
  }

  const gated = negotiatorFor({ overrides: { settings: { status: 'implemented', owner: 'settings', migration: { required: true, from: 'v1', to: 'v2' } } } });
  assert.equal(gated.negotiateOperation({ capabilityId: 'settings', operation: 'settings.read' }).state, 'migration-required');

  const mismatch = negotiatorFor({ overrides: { settings: { status: 'implemented', owner: 'settings', contractVersion: '2.0.0' } } });
  assert.equal(mismatch.negotiateOperation({ capabilityId: 'settings', operation: 'settings.read', requireVersion: '1.0.0' }).state, 'version-incompatible');

  const disabled = negotiatorFor({ declared: [{ ...search, lifecycle: 'disabled' }] });
  assert.equal(disabled.negotiateOperation({ capabilityId: 'search', operation: 'search.nodes' }).state, 'dependency-disabled');

  const absent = negotiatorFor({ declared: [{ ...search, lifecycle: 'declared' }] });
  assert.equal(absent.negotiateOperation({ capabilityId: 'search', operation: 'search.nodes' }).state, 'optional-absent');
});

test('degraded is reported as degraded, with the capability reason attached', () => {
  // The capability publishes its operations and implements them partially: the UI may
  // proceed with reduced guarantees, and the answer says which.
  const negotiator = negotiatorFor({ overrides: { settings: { status: 'partial', owner: 'settings', operations: ['settings.read', 'settings.write'] } } });
  const answer = negotiator.negotiateOperation({ capabilityId: 'settings', operation: 'settings.read' });
  assert.equal(answer.state, 'degraded');
  assert.equal(answer.usable, true, 'a degraded capability still serves');
  assert.equal(answer.exists, true);
  assert.equal(answer.degradation.state, 'degraded');
  assert.equal(answer.degradation.usable, true);
  assert.match(answer.reasons.join(' '), /partially/);

  // A partial capability that publishes nothing is refused rather than trusted: failing
  // closed outranks proceeding.
  const silent = negotiatorFor({ overrides: { settings: { status: 'partial', owner: 'settings' } } });
  assert.equal(silent.negotiateOperation({ capabilityId: 'settings', operation: 'settings.read' }).state, 'operation-unpublished');
});

test('every declared outcome is producible, and nothing outside the declaration is', () => {
  const produced = new Set();
  const fixtures = [
    () => negotiatorFor({ capabilities: [search] }).negotiateOperation({ capabilityId: 'search', operation: 'search.nodes' }),
    () => negotiatorFor({ overrides: { settings: { status: 'partial', owner: 'settings', operations: ['settings.read'] } } }).negotiateOperation({ capabilityId: 'settings', operation: 'settings.read' }),
    () => negotiatorFor({ overrides: { settings: { status: 'partial', owner: 'settings' } } }).negotiateOperation({ capabilityId: 'settings', operation: 'settings.read' }),
    () => negotiatorFor({ capabilities: [{ ...search, operations: [] }] }).negotiateOperation({ capabilityId: 'search', operation: 'search.nodes' }),
    () => negotiatorFor({ capabilities: [search] }).negotiateOperation({ capabilityId: 'search', operation: 'search.missing' }),
    () => negotiatorFor({ capabilities: [search] }).negotiateOperation({ capabilityId: 'search', operation: 'search.nodes', unitId: 'settings.localization.rtl' }),
    () => negotiatorFor({}).negotiateOperation({ capabilityId: 'nothing', operation: 'nothing.read' }),
    () => negotiatorFor({ overrides: { settings: { status: 'implemented', owner: 'settings', contractVersion: '2.0.0' } } }).negotiateOperation({ capabilityId: 'settings', operation: 'settings.read', requireVersion: '1.0.0' }),
    () => negotiatorFor({ overrides: { settings: { status: 'implemented', owner: 'settings', migration: { required: true } } } }).negotiateOperation({ capabilityId: 'settings', operation: 'settings.read' }),
    () => negotiatorFor({ declared: [{ ...search, lifecycle: 'disabled' }] }).negotiateOperation({ capabilityId: 'search', operation: 'search.nodes' }),
    () => negotiatorFor({ declared: [{ ...search, lifecycle: 'declared' }] }).negotiateOperation({ capabilityId: 'search', operation: 'search.nodes' }),
    () => negotiatorFor({ overrides: { settings: { status: 'unsupported', owner: 'settings' } } }).negotiateOperation({ capabilityId: 'settings', operation: 'settings.read' }),
    () => negotiatorFor({ capabilities: [{ ...search, permissions: ['search:read'] }] }).negotiateOperation({ capabilityId: 'search', operation: 'search.nodes' }),
    () => negotiatorFor({ capabilities: [{ ...search, permissions: ['search:read'] }] }).negotiateOperation({ capabilityId: 'search', operation: 'search.nodes', held: ['search:read'], requirePermissions: ['search:write'] }),
  ];
  for (const fixture of fixtures) produced.add(fixture().state);
  assert.deepEqual([...produced].sort(), [...OPERATION_STATES].sort(), `unreachable: ${OPERATION_STATES.filter((state) => !produced.has(state)).join(', ')}`);
});

test('a malformed operation name is refused loudly; a refusal is never hidden', () => {
  const negotiator = negotiatorFor({ capabilities: [search] });
  for (const bad of ['searchNodes', 'search.', '.nodes', '', null, 42]) {
    assert.throws(
      () => negotiator.negotiateOperation({ capabilityId: 'search', operation: bad }),
      (error) => {
        assert.equal(error.code, 'frontend.operation.invalid-name');
        return true;
      },
      `"${bad}" is refused`,
    );
  }
});

test('the assembly answers operation questions without importing a transport', () => {
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  const conversation = frontend.negotiateOperation({ capabilityId: 'ai-assistant', operation: 'assistant.ask' });
  assert.equal(conversation.state, 'optional-absent', 'a declared AI capability is absent, not broken');
  assert.equal(conversation.capability.installed, false);

  const unpublished = frontend.negotiateOperation({ capabilityId: 'ai-agent-node', operation: 'agent.delegate', requirePermissions: ['agent:delegate'] });
  assert.equal(unpublished.state, 'optional-absent');

  frontend.registerOperation('trace.list', async () => []);
  const trace = frontend.negotiateOperation({ capabilityId: 'agent-work-trace', operation: 'trace.list' });
  assert.equal(trace.state, 'optional-absent');
  assert.equal(frontend.describeAgentEvents().eventTypes.length, 26);
});
