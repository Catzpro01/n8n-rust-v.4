/**
 * The AI foundation's frontend contract (Tasks 7, 11, 12, 13, 14, 15).
 *
 * The frontend declares the AI vocabulary and implements none of it. These tests
 * hold that line: the six capabilities are declared and not installed, provider and
 * runtime types stay distinct, an installation with no model is valid, a thin device
 * reaches a remote runtime, MCP is described without a transport, and **none of it
 * reaches the browser boot payload**.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_CAPABILITIES,
  AgentContractError,
  MCP_CONNECTION_STATES,
  MCP_OBJECTS,
  PROVIDER_KINDS,
  RUNTIME_DECLARATION_FIELDS,
  RUNTIME_IDENTITY_FIELDS,
  RUNTIME_KINDS,
  RUNTIME_LOCALITY,
  describeAgents,
  describeInstallation,
  mcpRelationship,
  suitableRuntimes,
  validateProviderDeclaration,
  validateRuntimeDeclaration,
} from '../src/agents.mjs';
import { DEVICE_PROFILES } from '../src/profiles.mjs';
import { loadManifests, PACKAGE_ROOT } from '../src/manifests.mjs';
import { createFrontendLego } from '../src/lego.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifests = loadManifests();
const TEST_REF = 'packages/frontend-lego/test/26-ai-contracts.test.mjs';
const read = (relative) => readFileSync(join(PACKAGE_ROOT, '..', '..', relative), 'utf8');

test('the six AI capabilities are declared in the catalog, and none of them is installed', () => {
  assert.equal(AI_CAPABILITIES.length, 6);
  const declared = new Map(manifests.capabilities.map((capability) => [capability.id, capability]));
  for (const capability of AI_CAPABILITIES) {
    const entry = declared.get(capability.id);
    assert.ok(entry, `${capability.id} is declared in manifest/capabilities.json`);
    assert.equal(entry.status, 'declared', `${capability.id} claims nothing but a declaration`);
    assert.equal(entry.activation === 'eager', false, `${capability.id} is never eager`);
    assert.ok(entry.surfaces.includes(capability.surface), `${capability.id} attaches to a declared surface`);
    assert.ok(entry.operations.length > 0, `${capability.id} publishes semantic operations`);
    assert.equal(entry.entry, undefined, `${capability.id} names no implementation path`);
    for (const operation of entry.operations) assert.match(operation, /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/, `${operation} is a semantic operation name`);
  }
  // The test reference each declaration names exists: a claim with no proof is noise.
  for (const capability of AI_CAPABILITIES) {
    const entry = declared.get(capability.id);
    if (entry.tests) assert.ok(entry.tests.every((path) => path.includes('test/')), `${capability.id} names its suite`);
  }
  assert.ok(TEST_REF.endsWith('26-ai-contracts.test.mjs'));
});

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the frontend implements no inference: no model call, no provider client, no vendor field', () => {
  // Comments may name products as examples; code may not.
  const source = stripComments(`${read('packages/frontend-lego/src/agents.mjs')}${read('packages/frontend-lego/src/agent-events.mjs')}`);
  for (const forbidden of ['9Router', 'Composio', 'Hermes', 'Gemini', 'Antigravity', 'OpenClaw', 'MiroFish', 'fetch(', 'http.request', 'openai', 'anthropic']) {
    assert.equal(source.includes(forbidden), false, `the AI contract modules never mention ${forbidden}`);
  }
  // Vendors may be named as examples in documentation, never as fields.
  assert.equal(JSON.stringify(describeAgents().capabilities).includes('9Router'), false);
  assert.equal(JSON.stringify(manifests.capabilities).includes('Composio'), false);
});

test('a provider, a runtime and a tool are different kinds of object', () => {
  assert.deepEqual(PROVIDER_KINDS, ['model-provider', 'tool-provider', 'application-provider']);
  assert.deepEqual(RUNTIME_KINDS, ['agent-runtime', 'simulation-runtime']);
  assert.deepEqual(RUNTIME_LOCALITY, ['local', 'remote']);
  // A runtime kind is never a provider kind, and vice versa.
  for (const kind of RUNTIME_KINDS) assert.equal(PROVIDER_KINDS.includes(kind), false, `${kind} is not a provider kind`);
  for (const kind of PROVIDER_KINDS) assert.equal(RUNTIME_KINDS.includes(kind), false, `${kind} is not a runtime kind`);

  const selection = suitableRuntimes({
    profile: 'laptop',
    runtimes: [
      { id: 'real-local', kind: 'agent-runtime', locality: 'local', requirements: {} },
      { id: 'pretend', kind: 'simulation-runtime', locality: 'local', requirements: {} },
    ],
  });
  const kinds = new Map(selection.candidates.map((candidate) => [candidate.id, candidate.kind]));
  assert.equal(kinds.get('pretend'), 'simulation-runtime', 'a simulation keeps its own kind');
  assert.equal(selection.preference[0], 'real-local', 'real work is preferred over simulation');
});

test('a runtime or provider declaration is validated fail-closed', () => {
  assert.equal(validateRuntimeDeclaration({ id: 'local-agent', kind: 'agent-runtime', locality: 'local' }).ok, true);
  for (const bad of [
    { id: 'Local Agent', kind: 'agent-runtime', locality: 'local' },
    { id: 'x', kind: 'llm', locality: 'local' },
    { id: 'x', kind: 'agent-runtime', locality: 'cloud' },
    { id: 'x', kind: 'agent-runtime', locality: 'local', token: 'sk-1' },
    { id: 'x', kind: 'agent-runtime', locality: 'local', endpoint: 'https://example.test' },
    { id: 'x', kind: 'agent-runtime', locality: 'local', requirements: { gpu: 1 } },
    null,
  ]) {
    const result = validateRuntimeDeclaration(bad);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} is refused`);
    assert.ok(result.errors.length > 0);
  }
  const credential = validateRuntimeDeclaration({ id: 'x', kind: 'agent-runtime', locality: 'local', secret: 'a' });
  assert.match(credential.errors.join(' '), /credential material/);

  assert.equal(validateProviderDeclaration({ id: 'model-provider-1', kind: 'model-provider' }).ok, true);
  assert.equal(validateProviderDeclaration({ id: 'p', kind: 'agent-runtime' }).ok, false, 'a runtime is not a provider kind');
  assert.equal(validateProviderDeclaration({ id: 'p', kind: 'model-provider', apiKey: 'k' }).ok, false);
  assert.equal(validateProviderDeclaration({ id: 'p', kind: 'model-provider', model: 'gpt-x' }).ok, false, 'the vendor model name is not a provider field');
});

test('zero-install is a valid installation, and it says which layer is absent', () => {
  const bare = describeInstallation({});
  assert.equal(bare.zeroInstall, true);
  assert.equal(bare.valid, true);
  assert.deepEqual(bare.layers.core, 'available');
  assert.deepEqual(bare.layers.aiFoundation, 'available');
  assert.deepEqual(bare.layers.inference, 'unavailable');
  assert.match(bare.message, /no model or agent runtime is configured yet/);
  assert.deepEqual(bare.configurable, ['model-provider', 'agent-runtime', 'tool-provider']);

  const wired = describeInstallation({
    inference: true,
    runtimes: [{ id: 'remote', kind: 'agent-runtime', locality: 'remote' }],
    providers: [{ id: 'gw', kind: 'model-provider' }],
    mcp: [{ id: 'gh', state: 'connected' }],
  });
  assert.equal(wired.zeroInstall, false);
  assert.equal(wired.layers.inference, 'available');
  assert.equal(wired.layers.mcp, 'connected');
  assert.deepEqual(wired.configurable, []);

  // The declared capabilities exist either way: absent inference is not a broken install.
  assert.equal(AI_CAPABILITIES.length, 6);
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  assert.equal(frontend.negotiate({ capabilityId: 'ai-assistant' }).state, 'optional-absent');
  assert.equal(frontend.featureAvailability().every((entry) => typeof entry.state === 'string'), true);
});

test('runtime selection follows the declared device budget, not an installation wish', () => {
  const runtimes = [
    { id: 'local-heavy', kind: 'agent-runtime', locality: 'local', requirements: { memoryMb: 4096 } },
    { id: 'remote-gateway', kind: 'agent-runtime', locality: 'remote', requirements: {} },
  ];
  const thin = suitableRuntimes({ profile: 'low-memory', runtimes });
  const local = thin.candidates.find((candidate) => candidate.id === 'local-heavy');
  assert.equal(local.state, 'unsupported');
  assert.match(local.reason, /1024 MB/);
  assert.equal(local.reachable, false, 'what the device cannot run is not offered as if it could');
  assert.ok(thin.usable.includes('remote-gateway'), 'the thin client reaches the remote runtime');
  assert.equal(thin.ok, true);
  assert.deepEqual(thin.preference, ['remote-gateway']);

  const desktop = suitableRuntimes({ profile: 'desktop', runtimes });
  assert.deepEqual(desktop.preference, ['local-heavy', 'remote-gateway'], 'local first when it fits');
  assert.ok(DEVICE_PROFILES.some((profile) => profile.id === 'low-memory'));

  const nothing = suitableRuntimes({ profile: 'low-memory', runtimes: [runtimes[0]] });
  assert.equal(nothing.ok, false);
  assert.match(nothing.reason, /remote runtime is the declared way/);
});

test('MCP is an interoperability layer the UI can describe without a transport', () => {
  assert.deepEqual(MCP_CONNECTION_STATES, ['connected', 'unavailable', 'permission-required', 'capability-unsupported']);
  assert.deepEqual(MCP_OBJECTS, ['client-capability', 'server-capability', 'tool', 'resource', 'prompt', 'connection', 'authorization', 'availability']);

  const connected = mcpRelationship({ id: 'files', state: 'connected', objects: ['tool', 'resource'] });
  assert.equal(connected.label, 'Connected');
  assert.equal(connected.role, 'interoperability-layer');
  assert.deepEqual(connected.objects, ['tool', 'resource']);
  assert.equal(connected.authorization, 'not-required');
  assert.equal(JSON.stringify(connected).includes('http'), false, 'no transport reaches the business contract');
  assert.equal('transport' in connected, false);

  for (const [state, label] of [['unavailable', 'Unavailable'], ['permission-required', 'Permission required'], ['capability-unsupported', 'Capability unsupported']]) {
    assert.equal(mcpRelationship({ id: 'x', state }).label, label);
  }
  assert.equal(mcpRelationship({ id: 'x', state: 'connected', authorization: 'granted' }).authorization, 'granted');
  assert.equal(mcpRelationship({ id: 'x', state: 'nonsense' }).state, 'unavailable', 'an unknown state is not guessed');

  assert.throws(
    () => mcpRelationship({ id: 'x', state: 'connected', objects: ['socket'] }),
    (error) => {
      assert.ok(error instanceof AgentContractError);
      assert.equal(error.code, 'frontend.ai.invalid-declaration');
      return true;
    },
  );
});

test('identity is declarable, chain-of-thought is not', () => {
  for (const field of ['sessionId', 'agentId', 'parentAgentId', 'taskId', 'executionId', 'runtimeId', 'model', 'provider']) {
    assert.ok(RUNTIME_IDENTITY_FIELDS.includes(field), `${field} may be shown`);
  }
  for (const field of ['reasoning', 'chainOfThought', 'thoughts', 'messages', 'transcript', 'payload']) {
    assert.equal(RUNTIME_IDENTITY_FIELDS.includes(field), false, `${field} is never a field`);
    assert.equal(RUNTIME_DECLARATION_FIELDS.includes(field), false, `${field} is never a declaration field`);
  }
  const model = describeAgents();
  assert.equal(model.trace.inheritsPermissions, false);
  assert.equal(model.trace.referencesOnly, true);
  assert.equal(model.mcp.role, 'interoperability-layer');
  assert.match(model.rules.join(' '), /no model call/);
});

test('AI metadata never becomes browser boot payload', () => {
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  const payload = JSON.stringify(frontend.bootPayload);
  // A declared *consumer* of an extension hook may name an AI capability id (that is a
  // hook declaration, shipped since P2.5). Its capability metadata, operations and
  // vocabularies must not travel: the browser asks the LEGO for them in-process.
  for (const capability of AI_CAPABILITIES) {
    const declared = frontend.manifests.capabilities.find((entry) => entry.id === capability.id);
    for (const operation of declared.operations) {
      assert.equal(payload.includes(operation), false, `${operation} is not in the boot payload`);
    }
    assert.equal(payload.includes(`"${capability.id}","title"`), false, `${capability.id} metadata is not in the boot payload`);
  }
  assert.equal(payload.includes('agent.created'), false, 'the event vocabulary is not in the boot payload');
  assert.equal(payload.includes('model-provider'), false, 'the provider kinds are not in the boot payload');
  assert.deepEqual(frontend.bootPayload.capabilities, [], 'nothing claims to be installed');
  // The catalogs stay queryable in-process, which is where a UI asks for them.
  assert.equal(frontend.describe().aiCapabilities, 6);
  assert.ok(frontend.describeCapability('ai-copilot').operations.includes('copilot.suggest'));
});
