/** Frontend contract tests for the bounded Workspace consumer (P2.15). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WORKSPACE_FRONTEND_FIELDS,
  WORKSPACE_NON_RENDERED,
  checkWorkspaceAlignment,
  describeWorkspace,
  validateWorkspaceRecord,
  workspaceCatalogAudit,
  workspacePublication,
} from '../src/workspace.mjs';
import { loadManifests } from '../src/manifests.mjs';
import { vocabularyConflicts, vocabularyOf } from '../src/vocabulary.mjs';

const RECORD = Object.freeze({
  workspaceId: 'ws-surabaya',
  kind: 'EPHEMERAL',
  lifecycle: 'created',
  metadata: Object.freeze({ purpose: 'test', labels: ['bounded', 'ui'] }),
  resourceReferences: Object.freeze(['memory:scope-1']),
  version: 1,
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z',
});

const ROW = Object.freeze({ contract: 'ai.workspace', version: '1.0.0' });

function declaration(overrides = {}) {
  return {
    contract: 'ai.workspace',
    version: '1.0.0',
    operations: ['workspace.create', 'workspace.describe', 'workspace.mount', 'workspace.release'],
    permissions: ['ai:workspace:read', 'ai:workspace:create'],
    ...overrides,
  };
}

test('the Workspace catalog has canonical provenance and is internally aligned', () => {
  const catalog = loadManifests().workspaceCatalog;
  assert.equal(workspaceCatalogAudit(catalog).ok, true);
  assert.deepEqual(catalog.contracts, ['ai.workspace']);
  assert.equal(catalog.declarationSource.contract.file, 'apps/n8n-lego/src/lego/manifest/workspace.json');
  assert.equal(catalog.rendering.executeAffordance, false);
  assert.equal(catalog.rendering.providerState, false);
});

test('the frontend quotes exactly the Workspace kinds, lifecycle, operations and permissions', () => {
  assert.deepEqual(vocabularyOf('workspaceKind').values, ['LOCAL', 'CONTAINER', 'REMOTE', 'VPS', 'EPHEMERAL', 'PERSISTENT']);
  assert.deepEqual(vocabularyOf('workspaceLifecycle').values, ['declared', 'created', 'mounted', 'active', 'released']);
  assert.deepEqual(vocabularyOf('workspaceOperation').values, declaration().operations);
  assert.deepEqual(vocabularyOf('workspacePermission').values, declaration().permissions);
  assert.equal(vocabularyConflicts().ok, true);
});

test('publication is absent until an exact handed-over contract row exists', () => {
  assert.equal(workspacePublication().published, false);
  assert.equal(workspacePublication().status, 'optional-absent');
  assert.equal(workspacePublication({ contractRows: [{ contract: 'ai.workspace', version: '2.0.0' }] }).published, false);
  assert.equal(workspacePublication({ contractRows: [ROW] }).published, true);
});

test('no handed-over record produces an explicit absent view, never a fabricated Workspace', () => {
  const view = describeWorkspace();
  assert.equal(view.renderable, false);
  assert.equal(view.record, null);
  assert.deepEqual(view.renderedFields, []);
  assert.equal(view.status, 'optional-absent');
});

test('an exact handed-over record is rendered as bounded public data', () => {
  const view = describeWorkspace({ record: RECORD, contractRows: [ROW] });
  assert.equal(view.renderable, true);
  assert.equal(view.status, 'available');
  assert.deepEqual(Object.keys(view.record), WORKSPACE_FRONTEND_FIELDS);
  assert.equal(view.record.workspaceId, 'ws-surabaya');
  assert.deepEqual(view.record.resourceReferences, ['memory:scope-1']);
  assert.equal(view.notRendered.includes('executeAffordance'), true);
});

test('record validation refuses provider and authority internals', () => {
  assert.throws(() => validateWorkspaceRecord({ ...RECORD, providerState: 'internal' }), /non-public field/);
  assert.throws(() => validateWorkspaceRecord({ ...RECORD, metadata: { terminal: 'bash' } }), /metadata key/);
  assert.throws(() => validateWorkspaceRecord({ ...RECORD, metadata: { nested: { nested: { nested: { nested: { nested: 'too deep' } } } } } }), /depth/);
});

test('record validation preserves exact identity and rejects unknown kinds or lifecycle states', () => {
  assert.throws(() => validateWorkspaceRecord({ ...RECORD, workspaceId: '../other' }), /workspaceId/);
  assert.throws(() => validateWorkspaceRecord({ ...RECORD, kind: 'FILESYSTEM' }), /unknown Workspace kind/);
  assert.throws(() => validateWorkspaceRecord({ ...RECORD, lifecycle: 'running' }), /unknown Workspace lifecycle/);
});

test('opaque references are bounded and duplicate-safe on the frontend seam', () => {
  assert.throws(() => validateWorkspaceRecord({ ...RECORD, resourceReferences: ['/tmp/host'] }), /valid bounded/);
  assert.throws(() => validateWorkspaceRecord({ ...RECORD, resourceReferences: ['memory:x', 'memory:x'] }), /duplicate/);
  assert.throws(() => validateWorkspaceRecord({ ...RECORD, resourceReferences: Array.from({ length: 17 }, (_, i) => `r:${i}`) }), /bounded array/);
});

test('alignment compares contract, exact operation and permission surfaces', () => {
  assert.equal(checkWorkspaceAlignment({ declaration: declaration() }).ok, true);
  assert.equal(checkWorkspaceAlignment({ declaration: declaration({ operations: ['workspace.create'] }) }).ok, false);
  assert.match(checkWorkspaceAlignment({ declaration: declaration({ permissions: ['ai:workspace:execute'] }) }).problems.join(' '), /permission vocabulary/);
});

test('alignment refuses execution or runtime leakage', () => {
  const result = checkWorkspaceAlignment({ declaration: declaration({ operations: [...declaration().operations, 'workspace.execute'] }) });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /forbidden authority/);
});

test('the view is immutable and isolated from caller mutation', () => {
  const input = structuredClone(RECORD);
  const view = describeWorkspace({ record: input, contractRows: [ROW] });
  input.metadata.purpose = 'changed';
  assert.equal(view.record.metadata.purpose, 'test');
  assert.throws(() => { view.record.workspaceId = 'other'; }, TypeError);
});

test('rendering includes lifecycle and metadata but never grants actions', () => {
  const view = describeWorkspace({ record: { ...RECORD, lifecycle: 'active' }, contractRows: [ROW] });
  assert.deepEqual(view.renderedFields, ['workspaceId', 'kind', 'lifecycle', 'metadata', 'resourceReferences', 'version', 'createdAt', 'updatedAt']);
  for (const forbidden of WORKSPACE_NON_RENDERED) assert.equal(view.notRendered.includes(forbidden), true);
});

test('frontend Workspace has no backend implementation import or provider selection', () => {
  const source = readFileSync(new URL('../src/workspace.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['\"][^'\"]*apps\/n8n-lego|from ['\"]node:fs|process\.exec/i);
});
