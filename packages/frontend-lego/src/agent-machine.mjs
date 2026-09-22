/**
 * Frontend Agent Machine surface — a bounded consumer of ai.agent-machine@1.1.0.
 *
 * This module receives an exact Agent Machine record and an optional contract
 * handoff. It does not call a provider, create, prepare, start, step, pause,
 * resume, delegate or cancel a machine, infer an executor kind's authority,
 * offer execution affordances or render provider internals. Backend semantics
 * are quoted from the vocabulary lock and the frontend catalog is the
 * provenance record. A machine record the application never handed over is
 * refused, never fabricated. Delegation edges, capability scope and graph
 * semantics are quoted as bounded data at most — never as child-agent
 * controls.
 */

import { vocabularyOf } from './vocabulary.mjs';

const LIFECYCLE_VOCABULARY = vocabularyOf('agentMachineLifecycle');
const OPERATION_VOCABULARY = vocabularyOf('agentMachineOperation');
const PERMISSION_VOCABULARY = vocabularyOf('agentMachinePermission');
const OUTCOME_VOCABULARY = vocabularyOf('agentMachineStepOutcome');

export const AGENT_MACHINE_SURFACE_CONTRACT = Object.freeze({
  id: 'ai.agent-machine',
  version: '1.1.0',
  provenance: Object.freeze({
    manifest: 'packages/frontend-lego/manifest/agent-machine.json',
    backendContract: 'apps/n8n-lego/src/lego/manifest/agent-machine.json',
    backendModule: 'apps/n8n-lego/src/lego/agent-machine.mjs#AGENT_MACHINE_CONTRACT',
  }),
});

export const AGENT_MACHINE_FRONTEND_FIELDS = Object.freeze([
  'machineId',
  'taskId',
  'agentId',
  'executorKind',
  'lifecycle',
  'sessionReference',
  'contextReference',
  'workspaceReference',
  'capabilityScope',
  'budgets',
  'metadata',
  'steps',
  'stepCount',
  'delegations',
  'failure',
  'version',
  'createdAt',
  'updatedAt',
  'startedAt',
]);

export const AGENT_MACHINE_NON_RENDERED = Object.freeze([
  'providerState',
  'executeAffordance',
  'startAffordance',
  'prepareAffordance',
  'stepAffordance',
  'pauseAffordance',
  'resumeAffordance',
  'delegateAffordance',
  'cancelAffordance',
  'approvalDecision',
  'modelOutput',
  'delegationState',
  'delegationEdge',
  'graphExecution',
  'fabricatedMachine',
]);

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const FORBIDDEN_KEY = /(?:credential|secret|password|token|cookie|authorization|api[-_]?key|private[-_]?key|host[-_]?path|filesystem|terminal|process|command|shell|mcp|runtime|provider)/i;
const BUDGET_DIMENSIONS = new Set([
  'maxSteps', 'maxDurationMs', 'maxContinuationBytes', 'maxReferences', 'maxChildren', 'maxTasksPerAgent',
]);
const STEP_FIELDS = Object.freeze([
  'stepId', 'sequence', 'inputReference', 'approvalReference', 'outcome',
  'final', 'resultReference', 'errorReference', 'continuation', 'recordedAt',
]);
const DELEGATION_FIELDS = Object.freeze([
  'delegationId', 'childAgentId', 'grants', 'budget', 'deadline', 'createdAt',
]);
const MAX_STEPS_RENDERED = 64;
const MAX_DELEGATIONS_RENDERED = 16;
const MAX_CAPABILITY_SCOPE = 32;

export class AgentMachineSurfaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AgentMachineSurfaceError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(message, details = {}) {
  throw new AgentMachineSurfaceError('lego.contract_violation', message, details);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function assertPlainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be a plain object`);
}

function assertString(value, field, pattern = null) {
  if (typeof value !== 'string' || (pattern && !pattern.test(value))) {
    fail(`${field} is not a valid bounded Agent Machine value`);
  }
}

function assertReferenceOrAbsent(value, field) {
  if (value === null) return;
  assertString(value, field, REFERENCE_RE);
}

function assertMetadata(value, path = 'metadata', depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be a plain object`);
  if (depth > 4) fail(`${path} exceeds Agent Machine metadata depth 4`);
  if (seen.has(value)) fail(`${path} contains a cyclic value`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (!key || key.length > 64 || FORBIDDEN_KEY.test(key)) fail(`${path}.${key} is not a renderable Agent Machine metadata key`);
    assertMetadataValue(child, `${path}.${key}`, depth + 1, seen);
  }
  seen.delete(value);
}

function assertMetadataValue(value, path, depth, seen) {
  if (depth > 4) fail(`${path} exceeds Agent Machine metadata depth 4`);
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') fail(`${path} contains a non-JSON value`);
  if (seen.has(value)) fail(`${path} contains a cyclic value`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMetadataValue(item, `${path}[${index}]`, depth + 1, seen));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (!key || key.length > 64 || FORBIDDEN_KEY.test(key)) fail(`${path}.${key} is not a renderable Agent Machine metadata key`);
      assertMetadataValue(child, `${path}.${key}`, depth + 1, seen);
    }
  }
  seen.delete(value);
}

function assertBudgets(budgets) {
  assertPlainObject(budgets, 'budgets');
  const keys = Object.keys(budgets);
  if (keys.length === 0 || keys.length > BUDGET_DIMENSIONS.size) fail('budgets must declare the bounded dimensions only');
  for (const [key, value] of Object.entries(budgets)) {
    if (!BUDGET_DIMENSIONS.has(key)) fail(`budgets declares unknown dimension '${key}'`);
    if (!Number.isInteger(value) || value <= 0) fail(`budgets.${key} must be a positive integer`);
  }
}

function assertCapabilityScope(scope) {
  if (!Array.isArray(scope)) fail('capabilityScope must be an array of bounded capability ids');
  if (scope.length > MAX_CAPABILITY_SCOPE) fail(`capabilityScope exceeds the bounded ceiling ${MAX_CAPABILITY_SCOPE}`);
  const seen = new Set();
  for (const entry of scope) {
    if (typeof entry !== 'string' || !entry || entry.length > 64) fail('capabilityScope entries must be bounded capability ids');
    if (seen.has(entry)) fail(`capabilityScope repeats capability '${entry}'`);
    seen.add(entry);
  }
}

function assertDelegation(edge, index) {
  assertPlainObject(edge, `delegations[${index}]`);
  for (const key of Object.keys(edge)) {
    if (!DELEGATION_FIELDS.includes(key)) fail(`delegations[${index}] contains non-public field '${key}'`);
  }
  for (const key of DELEGATION_FIELDS) {
    if (!(key in edge)) fail(`delegations[${index}] is missing '${key}'`);
  }
  assertString(edge.delegationId, `delegations[${index}].delegationId`, ID_RE);
  assertString(edge.childAgentId, `delegations[${index}].childAgentId`, ID_RE);
  if (!Array.isArray(edge.grants) || edge.grants.length === 0) {
    fail(`delegations[${index}].grants must be a non-empty bounded array`);
  }
  const seen = new Set();
  for (const grant of edge.grants) {
    if (typeof grant !== 'string' || !grant || grant.length > 64) fail(`delegations[${index}].grants entries must be bounded strings`);
    if (seen.has(grant)) fail(`delegations[${index}] repeats grant '${grant}'`);
    seen.add(grant);
  }
  assertPlainObject(edge.budget, `delegations[${index}].budget`);
  for (const [key, value] of Object.entries(edge.budget)) {
    if (!BUDGET_DIMENSIONS.has(key)) fail(`delegations[${index}].budget declares unknown dimension '${key}'`);
    if (!Number.isInteger(value) || value <= 0) fail(`delegations[${index}].budget.${key} must be a positive integer`);
  }
  assertString(edge.deadline, `delegations[${index}].deadline`);
  assertString(edge.createdAt, `delegations[${index}].createdAt`);
}

function assertStep(step, index) {
  assertPlainObject(step, `steps[${index}]`);
  for (const key of Object.keys(step)) {
    if (!STEP_FIELDS.includes(key)) fail(`steps[${index}] contains non-public field '${key}'`);
  }
  for (const key of STEP_FIELDS) {
    if (!(key in step)) fail(`steps[${index}] is missing '${key}'`);
  }
  assertString(step.stepId, `steps[${index}].stepId`, ID_RE);
  if (!Number.isInteger(step.sequence) || step.sequence < 1) fail(`steps[${index}].sequence must be a positive integer`);
  assertReferenceOrAbsent(step.inputReference, `steps[${index}].inputReference`);
  assertReferenceOrAbsent(step.approvalReference, `steps[${index}].approvalReference`);
  if (!OUTCOME_VOCABULARY.values.includes(step.outcome)) fail(`steps[${index}].outcome is an unknown Agent Machine step outcome '${step.outcome}'`);
  if (typeof step.final !== 'boolean') fail(`steps[${index}].final must be a boolean`);
  assertReferenceOrAbsent(step.resultReference, `steps[${index}].resultReference`);
  assertReferenceOrAbsent(step.errorReference, `steps[${index}].errorReference`);
  if (step.continuation !== null && typeof step.continuation !== 'string') fail(`steps[${index}].continuation must be a bounded string or null`);
  assertString(step.recordedAt, `steps[${index}].recordedAt`);
}

function assertFailure(failure, lifecycle) {
  if (failure === null) {
    if (lifecycle === 'failed') fail('a failed machine must carry its bounded failure record');
    return;
  }
  if (lifecycle !== 'failed') fail('only a failed machine carries a failure record');
  assertPlainObject(failure, 'failure');
  const keys = Object.keys(failure).sort().join(',');
  if (failure.code === 'budget-exhausted') {
    if (!['maxSteps', 'maxDurationMs'].includes(failure.budget)) fail('failure.budget names an unknown budget dimension');
    if (keys !== 'budget,code,stepId') fail('failure record is malformed');
  } else if (failure.code === 'step-failed') {
    if (keys !== 'code,errorReference,stepId') fail('failure record is malformed');
  } else {
    fail(`failure.code is unknown: '${failure.code}'`);
  }
}

/** Validate and clone only the public record shape; unknown/provider fields fail closed. */
export function validateAgentMachineRecord(record) {
  assertPlainObject(record, 'agent machine record');
  for (const key of Object.keys(record)) {
    if (!AGENT_MACHINE_FRONTEND_FIELDS.includes(key)) fail(`agent machine record contains non-public field '${key}'`);
  }
  for (const key of AGENT_MACHINE_FRONTEND_FIELDS) {
    if (!(key in record)) fail(`agent machine record is missing '${key}'`);
  }
  assertString(record.machineId, 'machineId', ID_RE);
  assertString(record.taskId, 'taskId', ID_RE);
  assertString(record.agentId, 'agentId', ID_RE);
  if (record.executorKind !== 'IN_MEMORY' && record.executorKind !== 'EXTERNAL') {
    fail(`unknown Agent Machine executor kind '${record.executorKind}'`);
  }
  if (!LIFECYCLE_VOCABULARY.values.includes(record.lifecycle)) fail(`unknown Agent Machine lifecycle '${record.lifecycle}'`);
  assertReferenceOrAbsent(record.sessionReference, 'sessionReference');
  assertReferenceOrAbsent(record.contextReference, 'contextReference');
  assertReferenceOrAbsent(record.workspaceReference, 'workspaceReference');
  assertCapabilityScope(record.capabilityScope);
  assertBudgets(record.budgets);
  assertMetadata(record.metadata);
  if (!Array.isArray(record.steps) || record.steps.length > MAX_STEPS_RENDERED) {
    fail(`steps must be a bounded array of at most ${MAX_STEPS_RENDERED} records`);
  }
  if (record.steps.length !== record.stepCount) fail('stepCount must equal the recorded step ledger length');
  record.steps.forEach(assertStep);
  if (!Array.isArray(record.delegations) || record.delegations.length > MAX_DELEGATIONS_RENDERED) {
    fail(`delegations must be a bounded array of at most ${MAX_DELEGATIONS_RENDERED} edges`);
  }
  record.delegations.forEach(assertDelegation);
  assertFailure(record.failure, record.lifecycle);
  if (!Number.isInteger(record.version) || record.version < 1) fail('Agent Machine version must be a positive integer');
  assertString(record.createdAt, 'createdAt');
  assertString(record.updatedAt, 'updatedAt');
  if (record.startedAt !== null) assertString(record.startedAt, 'startedAt');
  return freezeDeep(clone(record));
}

function contractRow(row) {
  if (!row) return null;
  if (typeof row === 'string') return { contract: row, version: null };
  if (typeof row === 'object') return { contract: row.contract ?? row.id, version: row.version ?? null };
  return null;
}

/**
 * A publication is true only when the application hands over a matching lock
 * row. The frontend catalog's version claim is never treated as publication
 * evidence.
 */
export function agentMachinePublication({ contractRows = [] } = {}) {
  const rows = Array.isArray(contractRows) ? contractRows.map(contractRow).filter(Boolean) : [];
  const row = rows.find((candidate) => candidate.contract === AGENT_MACHINE_SURFACE_CONTRACT.id) ?? null;
  const published = row?.version === AGENT_MACHINE_SURFACE_CONTRACT.version;
  return Object.freeze({
    contract: AGENT_MACHINE_SURFACE_CONTRACT.id,
    version: AGENT_MACHINE_SURFACE_CONTRACT.version,
    published,
    status: published ? 'available' : 'optional-absent',
    evidence: published ? Object.freeze({ contract: row.contract, version: row.version }) : null,
  });
}

function sameList(left = [], right = []) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * Compare a handed-over contract declaration with every frontend-quoted value.
 * The forbidden-authority scan refuses execute/shell/process/runtime/
 * filesystem style operations; the canonical agentMachine.delegate bookkeeping
 * operation of 1.1.0 is part of the published vocabulary and is compared
 * exactly, not pattern-rejected.
 */
export function checkAgentMachineAlignment({ declaration, catalog = null } = {}) {
  assertPlainObject(declaration, 'Agent Machine declaration');
  const expected = catalog?.publication?.expected ?? {
    version: AGENT_MACHINE_SURFACE_CONTRACT.version,
    operations: OPERATION_VOCABULARY.values,
    permissions: PERMISSION_VOCABULARY.values,
  };
  const operations = OPERATION_VOCABULARY.values;
  const permissions = PERMISSION_VOCABULARY.values;
  const problems = [];
  if (declaration.contract !== AGENT_MACHINE_SURFACE_CONTRACT.id) problems.push('contract id mismatch');
  if (declaration.version !== AGENT_MACHINE_SURFACE_CONTRACT.version) problems.push('contract version mismatch');
  if (!sameList(declaration.operations, expected.operations) || !sameList(declaration.operations, operations)) problems.push('operation vocabulary mismatch');
  if (!sameList(declaration.permissions, expected.permissions) || !sameList(declaration.permissions, permissions)) problems.push('permission vocabulary mismatch');
  if (declaration.operations?.some((operation) => /execute|shell|process|runtime|filesystem/i.test(operation))) problems.push('forbidden authority operation published');
  return Object.freeze({
    ok: problems.length === 0,
    problems: Object.freeze(problems),
    contract: AGENT_MACHINE_SURFACE_CONTRACT,
    catalog: catalog?.declarationSource ?? null,
  });
}

/**
 * Produce a browser-safe view. With no handed-over record this is an explicit
 * absent state, not a fabricated empty machine. Rendering is limited to exact
 * public fields and never includes an execution, prepare or delegate
 * affordance; delegation edge records and capability scope stay off the
 * rendered surface even though they validate as public data.
 */
export function describeAgentMachine({ record = null, contractRows = [], catalog = null } = {}) {
  const publication = agentMachinePublication({ contractRows });
  const validated = record === null ? null : validateAgentMachineRecord(record);
  const rendered = validated
    ? Object.freeze(AGENT_MACHINE_FRONTEND_FIELDS.filter((field) => catalog?.rendering?.[field] !== false))
    : Object.freeze([]);
  return freezeDeep({
    contract: AGENT_MACHINE_SURFACE_CONTRACT,
    publication,
    status: validated ? publication.status : 'optional-absent',
    renderable: validated !== null,
    record: validated,
    renderedFields: rendered,
    notRendered: AGENT_MACHINE_NON_RENDERED,
  });
}

/** A small catalog audit used by tests and by the consuming application seam. */
export function agentMachineCatalogAudit(catalog = null) {
  const expected = catalog?.publication?.expected ?? {};
  const problems = [];
  if (catalog.lego !== 'agent-machine') problems.push('catalog does not identify the Agent Machine LEGO');
  if (!sameList(catalog.contracts, ['ai.agent-machine'])) problems.push('catalog must consume exactly ai.agent-machine');
  if (expected.version !== '1.1.0') problems.push('catalog must pin ai.agent-machine@1.1.0');
  for (const operation of OPERATION_VOCABULARY.values) {
    if (!expected.operations?.includes(operation)) problems.push(`catalog omitted ${operation}`);
  }
  for (const permission of PERMISSION_VOCABULARY.values) {
    if (!expected.permissions?.includes(permission)) problems.push(`catalog omitted ${permission}`);
  }
  if (expected.operations?.length !== OPERATION_VOCABULARY.values.length) problems.push('catalog publishes an operation the vocabulary does not quote');
  if (expected.permissions?.length !== PERMISSION_VOCABULARY.values.length) problems.push('catalog publishes a permission the vocabulary does not quote');
  for (const affordance of [
    'startAffordance', 'stepAffordance', 'pauseAffordance', 'resumeAffordance', 'cancelAffordance',
    'prepareAffordance', 'delegateAffordance', 'executeAffordance',
  ]) {
    if (catalog.rendering?.[affordance] !== false) problems.push(`catalog must disable ${affordance}`);
  }
  if (catalog.rendering?.approvalDecision !== false) problems.push('catalog must disable approval decisions: approval resolution is not P2.16');
  if (catalog.rendering?.delegations !== false) problems.push('catalog must keep delegation edge records off the rendered surface');
  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems) });
}

export const AGENT_MACHINE_VOCABULARY = Object.freeze({
  lifecycle: LIFECYCLE_VOCABULARY,
  operation: OPERATION_VOCABULARY,
  permission: PERMISSION_VOCABULARY,
  stepOutcome: OUTCOME_VOCABULARY,
});
