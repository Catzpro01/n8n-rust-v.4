/**
 * Frontend Workspace surface — a bounded consumer of ai.workspace@1.0.0.
 *
 * This module receives an exact Workspace record and an optional contract handoff. It
 * does not call a provider, create or mutate a Workspace, infer a kind's authority,
 * render provider internals, or expose execution controls. Backend semantics are
 * quoted from the vocabulary lock and the frontend catalog is the provenance record.
 */

import { vocabularyOf } from './vocabulary.mjs';

const KIND_VOCABULARY = vocabularyOf('workspaceKind');
const LIFECYCLE_VOCABULARY = vocabularyOf('workspaceLifecycle');
const OPERATION_VOCABULARY = vocabularyOf('workspaceOperation');
const PERMISSION_VOCABULARY = vocabularyOf('workspacePermission');

export const WORKSPACE_SURFACE_CONTRACT = Object.freeze({
  id: 'ai.workspace',
  version: '1.0.0',
  provenance: Object.freeze({
    manifest: 'packages/frontend-lego/manifest/workspace.json',
    backendContract: 'apps/n8n-lego/src/lego/manifest/workspace.json',
    backendModule: 'apps/n8n-lego/src/lego/workspace.mjs#WORKSPACE_CONTRACT',
  }),
});

export const WORKSPACE_FRONTEND_FIELDS = Object.freeze([
  'workspaceId',
  'kind',
  'lifecycle',
  'metadata',
  'resourceReferences',
  'version',
  'createdAt',
  'updatedAt',
]);

export const WORKSPACE_NON_RENDERED = Object.freeze([
  'providerState',
  'filesystemTree',
  'terminalState',
  'processState',
  'executionState',
  'credentialState',
  'fabricatedWorkspace',
  'createAffordance',
  'mountAffordance',
  'releaseAffordance',
  'executeAffordance',
]);

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const FORBIDDEN_KEY = /(?:credential|secret|password|token|cookie|authorization|api[-_]?key|private[-_]?key|host[-_]?path|filesystem|terminal|process|command|shell|mcp|runtime|provider)/i;

export class WorkspaceSurfaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkspaceSurfaceError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(message, details = {}) {
  throw new WorkspaceSurfaceError('lego.contract_violation', message, details);
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
    fail(`${field} is not a valid bounded Workspace value`);
  }
}

function assertMetadata(value, path = 'metadata', depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be a plain object`);
  if (depth > 4) fail(`${path} exceeds Workspace metadata depth 4`);
  if (seen.has(value)) fail(`${path} contains a cyclic value`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (!key || key.length > 64 || FORBIDDEN_KEY.test(key)) fail(`${path}.${key} is not a renderable Workspace metadata key`);
    assertMetadataValue(child, `${path}.${key}`, depth + 1, seen);
  }
  seen.delete(value);
}

function assertMetadataValue(value, path, depth, seen) {
  if (depth > 4) fail(`${path} exceeds Workspace metadata depth 4`);
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') fail(`${path} contains a non-JSON value`);
  if (seen.has(value)) fail(`${path} contains a cyclic value`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMetadataValue(item, `${path}[${index}]`, depth + 1, seen));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (!key || key.length > 64 || FORBIDDEN_KEY.test(key)) fail(`${path}.${key} is not a renderable Workspace metadata key`);
      assertMetadataValue(child, `${path}.${key}`, depth + 1, seen);
    }
  }
  seen.delete(value);
}

/** Validate and clone only the public record shape; unknown/provider fields fail closed. */
export function validateWorkspaceRecord(record) {
  assertPlainObject(record, 'workspace record');
  for (const key of Object.keys(record)) {
    if (!WORKSPACE_FRONTEND_FIELDS.includes(key)) fail(`workspace record contains non-public field '${key}'`);
  }
  for (const key of WORKSPACE_FRONTEND_FIELDS) {
    if (!(key in record)) fail(`workspace record is missing '${key}'`);
  }
  assertString(record.workspaceId, 'workspaceId', ID_RE);
  if (!KIND_VOCABULARY.values.includes(record.kind)) fail(`unknown Workspace kind '${record.kind}'`);
  if (!LIFECYCLE_VOCABULARY.values.includes(record.lifecycle)) fail(`unknown Workspace lifecycle '${record.lifecycle}'`);
  if (!Number.isInteger(record.version) || record.version < 1) fail('Workspace version must be a positive integer');
  assertString(record.createdAt, 'createdAt');
  assertString(record.updatedAt, 'updatedAt');
  assertMetadata(record.metadata);
  if (!Array.isArray(record.resourceReferences) || record.resourceReferences.length > 16) {
    fail('resourceReferences must be a bounded array of at most 16 opaque identifiers');
  }
  const references = new Set();
  for (const reference of record.resourceReferences) {
    assertString(reference, 'resource reference', REFERENCE_RE);
    if (references.has(reference)) fail(`resourceReferences contains duplicate '${reference}'`);
    references.add(reference);
  }
  return freezeDeep(clone(record));
}

function contractRow(row) {
  if (!row) return null;
  if (typeof row === 'string') return { contract: row, version: null };
  if (typeof row === 'object') return { contract: row.contract ?? row.id, version: row.version ?? null };
  return null;
}

/**
 * A publication is true only when the application hands over a matching lock row.
 * The frontend catalog's version claim is never treated as publication evidence.
 */
export function workspacePublication({ contractRows = [] } = {}) {
  const rows = Array.isArray(contractRows) ? contractRows.map(contractRow).filter(Boolean) : [];
  const row = rows.find((candidate) => candidate.contract === WORKSPACE_SURFACE_CONTRACT.id) ?? null;
  const published = row?.version === WORKSPACE_SURFACE_CONTRACT.version;
  return Object.freeze({
    contract: WORKSPACE_SURFACE_CONTRACT.id,
    version: WORKSPACE_SURFACE_CONTRACT.version,
    published,
    status: published ? 'available' : 'optional-absent',
    evidence: published ? Object.freeze({ contract: row.contract, version: row.version }) : null,
  });
}

function sameList(left = [], right = []) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((item, index) => item === right[index]);
}

/** Compare a handed-over contract declaration with every frontend-quoted value. */
export function checkWorkspaceAlignment({ declaration, catalog = null } = {}) {
  assertPlainObject(declaration, 'Workspace declaration');
  const expected = catalog?.publication?.expected ?? {
    version: WORKSPACE_SURFACE_CONTRACT.version,
    operations: OPERATION_VOCABULARY.values,
    permissions: PERMISSION_VOCABULARY.values,
  };
  const operations = OPERATION_VOCABULARY.values;
  const permissions = PERMISSION_VOCABULARY.values;
  const problems = [];
  if (declaration.contract !== WORKSPACE_SURFACE_CONTRACT.id) problems.push('contract id mismatch');
  if (declaration.version !== WORKSPACE_SURFACE_CONTRACT.version) problems.push('contract version mismatch');
  if (!sameList(declaration.operations, expected.operations) || !sameList(declaration.operations, operations)) problems.push('operation vocabulary mismatch');
  if (!sameList(declaration.permissions, expected.permissions) || !sameList(declaration.permissions, permissions)) problems.push('permission vocabulary mismatch');
  if (declaration.operations?.some((operation) => /execute|shell|process|runtime|filesystem/i.test(operation))) problems.push('forbidden authority operation published');
  return Object.freeze({
    ok: problems.length === 0,
    problems: Object.freeze(problems),
    contract: WORKSPACE_SURFACE_CONTRACT,
    catalog: catalog?.declarationSource ?? null,
  });
}

/**
 * Produce a browser-safe view. With no handed-over record this is an explicit absent
 * state, not a fabricated empty Workspace. Rendering is limited to exact public fields.
 */
export function describeWorkspace({ record = null, contractRows = [], catalog = null } = {}) {
  const publication = workspacePublication({ contractRows });
  const validated = record === null ? null : validateWorkspaceRecord(record);
  const rendered = validated
      ? Object.freeze(WORKSPACE_FRONTEND_FIELDS.filter((field) => catalog?.rendering?.[field] !== false))
    : Object.freeze([]);
  return freezeDeep({
    contract: WORKSPACE_SURFACE_CONTRACT,
    publication,
    status: validated ? publication.status : 'optional-absent',
    renderable: validated !== null,
    record: validated,
    renderedFields: rendered,
    notRendered: WORKSPACE_NON_RENDERED,
  });
}

/** A small catalog audit used by tests and by the consuming application seam. */
export function workspaceCatalogAudit(catalog = null) {
  const expected = catalog?.publication?.expected ?? {};
  const problems = [];
  if (catalog.lego !== 'workspace') problems.push('catalog does not identify the existing workspace LEGO');
  if (!sameList(catalog.contracts, ['ai.workspace'])) problems.push('catalog must consume exactly ai.workspace');
  if (expected.version !== '1.0.0') problems.push('catalog must pin ai.workspace@1.0.0');
  for (const operation of OPERATION_VOCABULARY.values) {
    if (!expected.operations?.includes(operation)) problems.push(`catalog omitted ${operation}`);
  }
  for (const permission of PERMISSION_VOCABULARY.values) {
    if (!expected.permissions?.includes(permission)) problems.push(`catalog omitted ${permission}`);
  }
  if (catalog.rendering?.executeAffordance !== false) problems.push('catalog must disable execute affordance');
  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems) });
}

export const WORKSPACE_VOCABULARY = Object.freeze({
  kind: KIND_VOCABULARY,
  lifecycle: LIFECYCLE_VOCABULARY,
  operation: OPERATION_VOCABULARY,
  permission: PERMISSION_VOCABULARY,
});
