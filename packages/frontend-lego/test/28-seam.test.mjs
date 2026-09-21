/**
 * The seam: a closed input list, forbidden sources, and one capability identity.
 *
 * This suite is the machine-checked form of two brief requirements that are easy to
 * satisfy on paper and easy to erode in code: "the frontend consumes declarations, it
 * never infers from an implementation", and "there is one canonical capability
 * identity, on both sides".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPABILITY_IDENTITY_FIELDS,
  IDENTITY_PROVENANCE_FIELDS,
  SEAM_FORBIDDEN,
  SEAM_INPUTS,
  SEAM_SOURCES,
  SeamError,
  capabilityIdentity,
  consumeInput,
  describeSeam,
  requireInput,
} from '../src/seam.mjs';
import { CAPABILITY_ORIGINS } from '../src/negotiation.mjs';
import { LOCAL_VOCABULARIES, VOCABULARIES, vocabularyOf } from '../src/vocabulary.mjs';
import { createFrontendLego } from '../src/lego.mjs';

test('the seam is a closed list of inputs, each with at least one declared source', () => {
  const ids = SEAM_INPUTS.map((input) => input.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate input');
  assert.deepEqual(ids, [
    'capability-id', 'capability-status', 'version', 'operations', 'permissions',
    'lifecycle', 'availability', 'degradation', 'interaction-class',
    'transport-capability', 'error-code', 'locale-set', 'observability-metadata',
  ]);
  const sources = SEAM_SOURCES.map((source) => source.id);
  for (const input of SEAM_INPUTS) {
    assert.ok(input.sources.length > 0, `${input.id} declares where it may be read from`);
    for (const source of input.sources) assert.ok(sources.includes(source), `${input.id} names a declared source (${source})`);
    assert.ok(input.question.length > 10, `${input.id} says what it is for`);
    // Every input that speaks in a vocabulary points at the lock entry that fixes it.
    if (input.vocabulary !== null) {
      const known = [...VOCABULARIES, ...LOCAL_VOCABULARIES].some((set) => set.id === input.vocabulary);
      assert.ok(known, `${input.id} quotes the ${input.vocabulary} vocabulary`);
    }
  }
  // Everything the brief lists as consumable is in here, and nothing else is.
  for (const required of ['capability-id', 'version', 'operations', 'permissions', 'lifecycle', 'availability', 'degradation', 'interaction-class', 'transport-capability', 'error-code', 'locale-set', 'observability-metadata']) {
    assert.ok(ids.includes(required), `${required} is a declared seam input`);
  }
});

test('a declared input is allowed from its declared sources and refused from anywhere else', () => {
  assert.equal(consumeInput({ input: 'capability-id', source: 'manifest' }).allowed, true);
  assert.equal(consumeInput({ input: 'error-code', source: 'compatibility-layer' }).allowed, true);
  assert.equal(consumeInput({ input: 'locale-set', source: 'locale-registry' }).allowed, true);
  assert.equal(consumeInput({ input: 'degradation', source: 'declaration' }).allowed, true);

  const wrongSource = consumeInput({ input: 'locale-set', source: 'manifest' });
  assert.equal(wrongSource.allowed, false);
  assert.match(wrongSource.reason, /is declared, but not from "manifest"/);
  const undeclaredSource = consumeInput({ input: 'capability-id', source: 'a friend told me' });
  assert.equal(undeclaredSource.allowed, false);
  assert.match(undeclaredSource.reason, /not a declared seam source/);
});

test('an implementation file, a route table, a port or a credential store is refused by name', () => {
  for (const forbidden of ['implementation-file', 'module-path', 'route-table', 'port', 'credential-store', 'model-output', 'screen']) {
    const verdict = consumeInput({ input: 'capability-id', source: forbidden });
    assert.equal(verdict.allowed, false, `${forbidden} may not be read`);
    assert.match(verdict.reason, /may not be consumed from/);
    assert.ok(SEAM_FORBIDDEN.find((entry) => entry.id === forbidden).why.length > 20, `${forbidden} explains itself`);
  }
  // The same list is refused when it is smuggled in as the *input*.
  const guessed = consumeInput({ input: 'implementation-file', source: 'manifest' });
  assert.equal(guessed.allowed, false);
  assert.match(guessed.reason, /may never be consumed/);
  assert.throws(() => requireInput({ input: 'capability-id', source: 'port' }), (error) => {
    assert.ok(error instanceof SeamError);
    assert.equal(error.code, 'frontend.seam.forbidden-source');
    assert.equal(error.source, 'port');
    return true;
  });
  assert.equal(requireInput({ input: 'operations', source: 'advertisement' }).allowed, true);
});

test('one capability identity, sixteen declared fields, on both sides of the seam', () => {
  assert.deepEqual(CAPABILITY_IDENTITY_FIELDS, [
    'id', 'lego', 'owner', 'contractVersion', 'operations', 'permissions', 'lifecycle',
    'status', 'availability', 'criticality', 'trust', 'interaction', 'migration',
    'degradation', 'surfaces', 'requirements',
  ]);
  assert.deepEqual(IDENTITY_PROVENANCE_FIELDS, ['origin']);

  const declared = capabilityIdentity({
    id: 'workflow.inspect.editor',
    lego: 'workflow',
    owner: 'agent-2',
    status: 'declared',
    lifecycle: 'declared',
    criticality: 'required',
    trust: 'core',
    surfaces: ['workflow-editor'],
    operations: ['workflow.inspect', 'workflow.patch'],
    interactions: { 'workflow.inspect': 'call', 'workflow.patch': 'call' },
    permissions: ['workflow:read'],
    requirements: { memoryMb: 64 },
    migration: { required: false },
    degradation: { fallback: 'native-behavior' },
  }, { origin: 'frontend-declared' });

  assert.equal(Object.keys(declared).length, CAPABILITY_IDENTITY_FIELDS.length + IDENTITY_PROVENANCE_FIELDS.length);
  for (const field of CAPABILITY_IDENTITY_FIELDS) assert.ok(field in declared, `${field} is in the identity`);
  assert.equal(declared.origin, 'frontend-declared');
  assert.deepEqual(declared.operations, ['workflow.inspect', 'workflow.patch']);
  assert.equal(declared.contractVersion, null, 'an undeclared version stays null — no inference');
  assert.equal(declared.availability, null, 'availability is a negotiated verdict, not a declared property');

  // The same shape serves an instance advertisement whose fields are all we have.
  const advertised = capabilityIdentity({ id: 'execution', status: 'implemented' }, { origin: 'backend-advertised' });
  assert.deepEqual(Object.keys(advertised), Object.keys(declared), 'one shape, whichever side declares it');
  assert.equal(advertised.operations, null, 'an unpublished operation list is null, never assumed');
  assert.equal(advertised.lego, null);

  // Availability is only filled when a negotiation answered it.
  const supported = capabilityIdentity({ id: 'translation' }, { origin: 'frontend-declared', support: { state: 'optional-absent', usable: false, source: 'declaration' } });
  assert.deepEqual(supported.availability, { state: 'optional-absent', usable: false, source: 'declaration' });
  assert.ok(vocabularyOf('degradation').values.includes(supported.availability.state), 'and it speaks the canonical vocabulary');
});

test('the identity refuses what it cannot normalise, instead of guessing', () => {
  assert.throws(() => capabilityIdentity({ id: 'workflow.*' }), (error) => {
    assert.equal(error.code, 'frontend.seam.invalid-capability-id');
    return true;
  });
  assert.throws(() => capabilityIdentity({}), SeamError);
  assert.throws(() => capabilityIdentity({ id: 'workflow' }, { origin: 'someone-said-so' }), (error) => {
    assert.equal(error.code, 'frontend.seam.unknown-origin');
    return true;
  });
  // Normalisation is declared and narrow: padding and case are folded (nothing else
  // is), and a foreign character is refused rather than transliterated into something
  // that merely looks canonical.
  assert.equal(capabilityIdentity({ id: '  Workflow.Inspect  ' }).id, 'workflow.inspect');
  assert.throws(() => capabilityIdentity({ id: 'workflow_inspect' }), SeamError);
  assert.throws(() => capabilityIdentity({ id: 'workflow..inspect' }), SeamError);
  assert.deepEqual(CAPABILITY_ORIGINS, ['frontend-registered', 'frontend-declared', 'backend-advertised']);
});

test('the assembly publishes the seam, and every declared capability fits it', () => {
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  const described = frontend.describeSeam();
  assert.equal(described.inputs.length, SEAM_INPUTS.length);
  assert.equal(described.identityFields.length, 16);
  assert.equal(described.rules.length, 4);
  assert.match(described.rules.join(' '), /refused by name/);
  assert.deepEqual(described.vocabulary.degradation, vocabularyOf('degradation').values);

  // One identity shape for a capability that is declared twice: as a catalog entry and
  // as a live registration.
  const catalogEntry = frontend.manifests.capabilities.find((entry) => entry.id === 'ai-assistant');
  const catalogIdentity = frontend.capabilityIdentity(catalogEntry, { origin: 'frontend-declared' });
  assert.equal(catalogIdentity.id, catalogEntry.id);
  assert.deepEqual(catalogIdentity.operations, ['assistant.ask', 'assistant.cancel']);
  // A capability that publishes no operation list is `null`, never an empty list that
  // would read as "it has none".
  const translation = frontend.capabilityIdentity(frontend.manifests.capabilities[0], { origin: 'frontend-declared' });
  assert.equal(translation.operations, null);

  frontend.register({
    id: 'audit-log', lego: 'settings', title: 'Audit log', status: 'available', surfaces: ['settings'],
    contracts: ['contracts/frontend.contract.md'], tests: ['packages/frontend-lego/test/21-security.test.mjs'],
    operations: ['audit.list'], permissions: ['audit:read'], activation: 'lazy', entry: './features/audit/index.mjs',
  });
  const liveIdentity = frontend.capabilityIdentity(frontend.describeCapability('audit-log'), { origin: 'frontend-registered' });
  assert.equal(liveIdentity.id, 'audit-log');
  assert.equal(liveIdentity.origin, 'frontend-registered');
  assert.deepEqual(liveIdentity.operations, ['audit.list']);
  assert.equal(liveIdentity.status, 'available', 'the identity reports the declared word; the lock maps it to a canonical one');
  assert.deepEqual(Object.keys(liveIdentity), Object.keys(catalogIdentity), 'a registered and a declared capability share one identity shape');
  assert.ok(vocabularyOf('frontendCapabilityDeclaration').mirror[liveIdentity.status], 'and that word is in the mapping table, not a second vocabulary');
});

test('the seam never carries a secret, a transcript or a transport', () => {
  const text = JSON.stringify(describeSeam()).toLowerCase();
  for (const word of ['token', 'password', 'cookie', 'authorization', 'secret', 'websocket', 'http://']) {
    assert.equal(text.includes(word), false, `the seam never names ${word}`);
  }
  // Permissions are names and declarations are closed: a credential-shaped field is
  // refused where it is declared, and a malformed permission is refused too.
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  const base = {
    id: 'leaky', lego: 'settings', title: 'Leaky', status: 'available', surfaces: ['settings'],
    contracts: ['contracts/frontend.contract.md'], tests: ['packages/frontend-lego/test/21-security.test.mjs'],
    operations: ['leaky.read'], activation: 'lazy', entry: './features/leaky/index.mjs',
  };
  assert.throws(() => frontend.register({ ...base, apiKey: 'sk-live-123' }), /unknown field "apiKey"/);
  assert.throws(() => frontend.register({ ...base, permissions: ['Authorization: Bearer x'] }), /permission/);
  assert.throws(() => frontend.register({ ...base, permissions: ['audit:read', 'audit:read'] }), /must not repeat a permission/);
  assert.equal(consumeInput({ input: 'permissions', source: 'declaration' }).allowed, true, 'the declaration itself is a legal input');
});
