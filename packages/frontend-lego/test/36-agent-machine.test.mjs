/** Frontend contract tests for the bounded Agent Machine consumer (P2.16, ai.agent-machine@1.1.0). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGENT_MACHINE_FRONTEND_FIELDS,
  AGENT_MACHINE_NON_RENDERED,
  agentMachineCatalogAudit,
  agentMachinePublication,
  checkAgentMachineAlignment,
  describeAgentMachine,
  validateAgentMachineRecord,
} from '../src/agent-machine.mjs';
import { loadManifests } from '../src/manifests.mjs';
import { vocabularyConflicts, vocabularyOf } from '../src/vocabulary.mjs';

const STEP = Object.freeze({
  stepId: 's1',
  sequence: 1,
  inputReference: 'ctx:1',
  approvalReference: 'approval-1',
  outcome: 'approval-required',
  final: false,
  resultReference: null,
  errorReference: null,
  continuation: null,
  recordedAt: '2026-09-22T00:00:00.000Z',
});
const EDGE = Object.freeze({
  delegationId: 'del-1',
  childAgentId: 'child-researcher',
  grants: Object.freeze(['ai.context']),
  budget: Object.freeze({ maxSteps: 2 }),
  deadline: '2026-09-22T00:10:00.000Z',
  createdAt: '2026-09-22T00:00:02.000Z',
});
const DECLARED_OPERATIONS = Object.freeze([
  'agentMachine.create', 'agentMachine.describe', 'agentMachine.prepare', 'agentMachine.start',
  'agentMachine.step', 'agentMachine.pause', 'agentMachine.resume', 'agentMachine.delegate',
  'agentMachine.cancel',
]);
const DECLARED_PERMISSIONS = Object.freeze([
  'ai:agent:create', 'ai:agent:invoke', 'ai:agent:control', 'ai:agent:read', 'ai:agent:delegate',
]);
const RECORD = Object.freeze({
  machineId: 'am-surabaya',
  taskId: 'task-1',
  agentId: 'agent-surabaya',
  executorKind: 'IN_MEMORY',
  lifecycle: 'waiting',
  sessionReference: 'sess-1',
  contextReference: 'ctx-1',
  workspaceReference: 'ws-1',
  capabilityScope: Object.freeze(['ai.context']),
  budgets: Object.freeze({ maxSteps: 4, maxDurationMs: 600000, maxContinuationBytes: 64, maxReferences: 8, maxChildren: 4 }),
  metadata: Object.freeze({ purpose: 'test', labels: ['bounded', 'ui'] }),
  steps: Object.freeze([STEP]),
  stepCount: 1,
  delegations: Object.freeze([EDGE]),
  failure: null,
  version: 3,
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:03.000Z',
  startedAt: '2026-09-22T00:00:01.000Z',
});
const COMPLETED = Object.freeze({
  ...RECORD,
  machineId: 'am-done',
  lifecycle: 'completed',
  steps: Object.freeze([{ ...STEP, stepId: 's1', sequence: 1, outcome: 'succeeded', final: true, resultReference: 'res:1', approvalReference: null }]),
  failure: null,
});
const FAILED = Object.freeze({
  ...RECORD,
  machineId: 'am-failed',
  lifecycle: 'failed',
  steps: Object.freeze([{ ...STEP, stepId: 's1', sequence: 1, outcome: 'failed', final: false, errorReference: 'err:1', approvalReference: null }]),
  failure: Object.freeze({ code: 'step-failed', stepId: 's1', errorReference: 'err:1' }),
});
const ROW = Object.freeze({ contract: 'ai.agent-machine', version: '1.1.0' });

function declaration(overrides = {}) {
  return {
    contract: 'ai.agent-machine',
    version: '1.1.0',
    operations: [...DECLARED_OPERATIONS],
    permissions: [...DECLARED_PERMISSIONS],
    ...overrides,
  };
}

test('the Agent Machine catalog has canonical provenance and is internally aligned', () => {
  const catalog = loadManifests().agentMachineCatalog;
  assert.equal(agentMachineCatalogAudit(catalog).ok, true, JSON.stringify(agentMachineCatalogAudit(catalog).problems));
  assert.deepEqual(catalog.contracts, ['ai.agent-machine']);
  assert.equal(catalog.declarationSource.contract.file, 'apps/n8n-lego/src/lego/manifest/agent-machine.json');
  assert.equal(catalog.declarationSource.capability.path, 'domains#id=ai-foundation.capabilities[id=ai.agent-machine]');
  for (const affordance of [
    'startAffordance', 'stepAffordance', 'pauseAffordance', 'resumeAffordance', 'cancelAffordance',
    'prepareAffordance', 'delegateAffordance', 'executeAffordance', 'approvalDecision',
  ]) {
    assert.equal(catalog.rendering[affordance], false, `${affordance} must stay disabled`);
  }
  assert.equal(catalog.rendering.delegations, false, 'delegation edge records stay off the rendered surface');
});

test('the frontend quotes exactly the Agent Machine lifecycle, operations and permissions', () => {
  assert.deepEqual(vocabularyOf('agentMachineLifecycle').values,
    ['created', 'ready', 'running', 'waiting', 'paused', 'completed', 'failed', 'cancelled']);
  assert.deepEqual(vocabularyOf('agentMachineOperation').values, declaration().operations);
  assert.deepEqual(vocabularyOf('agentMachinePermission').values, declaration().permissions);
  assert.deepEqual(vocabularyOf('agentMachineStepOutcome').values, ['succeeded', 'failed', 'cancelled', 'approval-required']);
  assert.equal(vocabularyOf('aiFoundationCapability').values.length, 16, 'the capability registry gained the agent-machine foundation (P2.16), the MCP boundary declaration (P2.20) and the runtime adapter seam (P2.21)');
  assert.equal(vocabularyConflicts().ok, true, JSON.stringify(vocabularyConflicts().conflicts));
});

test('publication is absent until an exact handed-over contract row exists', () => {
  assert.equal(agentMachinePublication().published, false);
  assert.equal(agentMachinePublication().status, 'optional-absent');
  assert.equal(agentMachinePublication({ contractRows: [{ contract: 'ai.agent-machine', version: '2.0.0' }] }).published, false);
  assert.equal(agentMachinePublication({ contractRows: [{ contract: 'ai.agent-machine', version: '1.0.0' }] }).published, false,
    'the superseded 1.0.0 row is not a 1.1.0 publication');
  assert.equal(agentMachinePublication({ contractRows: [ROW] }).published, true);
});

test('no handed-over record produces an explicit absent view, never a fabricated machine', () => {
  const view = describeAgentMachine();
  assert.equal(view.renderable, false);
  assert.equal(view.record, null);
  assert.deepEqual(view.renderedFields, []);
  assert.equal(view.status, 'optional-absent');
  assert.ok(view.notRendered.includes('fabricatedMachine'));
  assert.ok(view.notRendered.includes('executeAffordance'));
  assert.ok(view.notRendered.includes('delegateAffordance'));
  assert.ok(view.notRendered.includes('prepareAffordance'));
});

test('an exact handed-over record is rendered as bounded public data', () => {
  const view = describeAgentMachine({ record: RECORD, contractRows: [ROW], catalog: loadManifests().agentMachineCatalog });
  assert.equal(view.renderable, true);
  assert.equal(view.status, 'available');
  assert.deepEqual(Object.keys(view.record), AGENT_MACHINE_FRONTEND_FIELDS);
  assert.equal(view.record.machineId, 'am-surabaya');
  assert.equal(view.record.agentId, 'agent-surabaya');
  assert.equal(view.record.lifecycle, 'waiting');
  assert.equal(view.record.steps[0].approvalReference, 'approval-1');
  assert.deepEqual([...view.record.capabilityScope], ['ai.context']);
  assert.equal(view.renderedFields.includes('delegations'), false, 'edge records validate but do not render');
  assert.equal(view.renderedFields.includes('agentId'), true);
  assert.equal(view.renderedFields.includes('startedAt'), true);
});

test('terminal records render their bounded outcomes, never a fabricated success', () => {
  const done = describeAgentMachine({ record: COMPLETED, contractRows: [ROW] });
  assert.equal(done.record.lifecycle, 'completed');
  assert.equal(done.record.failure, null);
  const failed = describeAgentMachine({ record: FAILED, contractRows: [ROW] });
  assert.equal(failed.record.lifecycle, 'failed');
  assert.deepEqual(failed.record.failure, { code: 'step-failed', stepId: 's1', errorReference: 'err:1' });
});

test('record validation refuses provider and authority internals', () => {
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, providerState: 'internal' }), /non-public field/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, metadata: { command: 'bash' } }), /metadata key/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, metadata: { token: 'abc' } }), /metadata key/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, metadata: { nested: { nested: { nested: { nested: { nested: 'too deep' } } } } } }), /depth/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, executorKind: 'SHELL' }), /unknown Agent Machine executor kind/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, delegations: [{ ...EDGE, endpoint: 'https://x' }] }), /non-public field/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, delegations: [{ ...EDGE, grants: [] }] }), /non-empty/);
});

test('record validation preserves exact identity and rejects unknown lifecycle, outcome or budgets', () => {
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, machineId: '../other' }), /machineId/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, agentId: '' }), /agentId/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, lifecycle: 'stuck' }), /unknown Agent Machine lifecycle/);
  assert.equal(validateAgentMachineRecord({ ...RECORD, lifecycle: 'ready' }).lifecycle, 'ready', 'the 1.1.0 ready state validates');
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, steps: [{ ...STEP, outcome: 'exploding' }] }), /unknown Agent Machine step outcome/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, budgets: { ...RECORD.budgets, maxRetries: 99 } }), /unknown dimension|bounded dimensions/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, capabilityScope: ['ai.context', 'ai.context'] }), /repeats capability/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, stepCount: 2 }), /stepCount must equal/);
  assert.throws(() => validateAgentMachineRecord({ ...COMPLETED, failure: { code: 'step-failed', stepId: 's1', errorReference: null } }), /only a failed machine/);
  assert.throws(() => validateAgentMachineRecord({ ...FAILED, failure: null }), /must carry its bounded failure record/);
  assert.throws(() => validateAgentMachineRecord({ ...FAILED, failure: { code: 'budget-exhausted', budget: 'maxTokens' } }), /unknown budget dimension/);
});

test('the step ledger is bounded and exact on the frontend seam', () => {
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, steps: [{ ...STEP, extra: 'no' }] }), /non-public field/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, steps: [{ ...STEP, sequence: 0 }] }), /sequence must be a positive integer/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, steps: [{ ...STEP, inputReference: '/tmp/host' }] }), /inputReference/);
  assert.throws(() => validateAgentMachineRecord({ ...RECORD, steps: [{ ...STEP, continuation: 42 }] }), /continuation must be a bounded string/);
  const longLedger = {
    ...RECORD,
    stepCount: 65,
    steps: Array.from({ length: 65 }, (_, i) => ({ ...STEP, stepId: `s${i}`, sequence: i + 1, approvalReference: null, outcome: 'succeeded', final: i === 64 })),
  };
  assert.throws(() => validateAgentMachineRecord(longLedger), /bounded array/);
  const tooManyEdges = {
    ...RECORD,
    delegations: Array.from({ length: 17 }, (_, i) => ({ ...EDGE, delegationId: `del-${i}` })),
  };
  assert.throws(() => validateAgentMachineRecord(tooManyEdges), /delegations must be a bounded array/);
});

test('alignment compares contract, exact operation and permission surfaces', () => {
  const ok = checkAgentMachineAlignment({ declaration: declaration(), catalog: loadManifests().agentMachineCatalog });
  assert.equal(ok.ok, true, JSON.stringify(ok.problems));
  const wrong = checkAgentMachineAlignment({ declaration: declaration({ version: '2.0.0' }) });
  assert.equal(wrong.ok, false);
  assert.ok(wrong.problems.includes('contract version mismatch'));
  const fork = checkAgentMachineAlignment({ declaration: declaration({ operations: [...DECLARED_OPERATIONS, 'agentMachine.spawn'] }) });
  assert.equal(fork.ok, false, 'an operation outside the quoted vocabulary is a mismatch');
  const authority = checkAgentMachineAlignment({ declaration: declaration({ operations: ['agentMachine.executeShell'] }) });
  assert.equal(authority.ok, false);
  assert.ok(authority.problems.includes('forbidden authority operation published'));
  const missingDelegate = checkAgentMachineAlignment({
    declaration: declaration({ operations: DECLARED_OPERATIONS.filter((op) => op !== 'agentMachine.delegate') }),
  });
  assert.equal(missingDelegate.ok, false, 'the canonical delegate operation may not be dropped');
});

test('the backend contract file is the declaration the catalog points at', () => {
  const backend = JSON.parse(readFileSync(new URL('../../../apps/n8n-lego/src/lego/manifest/agent-machine.json', import.meta.url), 'utf8'));
  const catalog = loadManifests().agentMachineCatalog;
  assert.equal(backend.contract, catalog.publication.expected.contract);
  assert.equal(backend.version, catalog.publication.expected.version);
  assert.deepEqual(backend.operations.map((entry) => entry.name), catalog.publication.expected.operations);
  assert.deepEqual(backend.permissions, catalog.publication.expected.permissions);
  assert.deepEqual(backend.lifecycle.states, vocabularyOf('agentMachineLifecycle').values);
  assert.equal(backend.ownership.domain, 'ai-foundation');
});
