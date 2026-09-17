// TASK-EERR-01 / ISSUE-024 — regression tests for the 1:1 NodeOperationError port.
// Every assertion cites the reference line it pins; the observable rows match
// tools/error-surface-differential.mjs (R = n8n-workflow@2.9.1 build).
import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeOperationError, NodeApiError } from '../src/index.mjs';

const NODE = { id: 'n1', name: 'My Node', type: 'n8n-nodes-base.test', typeVersion: 1, position: [0, 0], parameters: {} };

test('NodeOperationError: default level is warning (node-operation.error.ts L33)', () => {
  assert.equal(new NodeOperationError(NODE, 'boom').level, 'warning');
  assert.equal(new NodeOperationError(NODE, 'boom', { level: 'info' }).level, 'info');
});

test('NodeOperationError: options.message overrides (L30); description collapses when equal (L41-43)', () => {
  const overridden = new NodeOperationError(NODE, 'orig', { message: 'override', description: 'override' });
  assert.equal(overridden.message, 'override');
  assert.equal(overridden.description, undefined); // message === description -> collapsed
  const distinct = new NodeOperationError(NODE, 'orig', { message: 'override', description: 'other' });
  assert.equal(distinct.description, 'other');
});

test('NodeOperationError: COMMON_ERRORS replaces the message and preserves the original (node.error.ts L12-47, L137-166)', () => {
  const e = new NodeOperationError(NODE, 'connect ETIMEDOUT 10.0.0.1');
  assert.equal(e.message, "The connection timed out, consider setting the 'Retry on Fail' option in the node settings");
  assert.deepEqual(e.messages, ['connect ETIMEDOUT 10.0.0.1']);
  const clean = new NodeOperationError(NODE, 'nothing special');
  assert.equal(clean.message, 'nothing special');
  assert.deepEqual(clean.messages, []);
});

test('NodeOperationError: reflection returns the SAME instance (L16-18; 2.9.4 source pin)', () => {
  const first = new NodeOperationError(NODE, 'first');
  const again = new NodeOperationError(NODE, first);
  assert.equal(again, first);
});

test('NodeOperationError: context carries runIndex/itemIndex/metadata (L37-39); functionality defaults regular', () => {
  const e = new NodeOperationError(NODE, 'boom', { runIndex: 1, itemIndex: 2, metadata: { m: 3 } });
  assert.deepEqual(e.context, { runIndex: 1, itemIndex: 2, metadata: { m: 3 } });
  const bare = new NodeOperationError(NODE, 'boom');
  assert.deepEqual(bare.context, { runIndex: undefined, itemIndex: undefined, metadata: undefined });
  assert.equal(bare.functionality, 'regular'); // execution-base.error.ts L31
  assert.equal(bare.type, undefined);
  assert.equal(new NodeOperationError(NODE, 'boom', { type: 'T' }).type, 'T');
});

test('NodeOperationError: description falls back to the inner error description (L40); Error cause is not observable (execution-base.error.ts L47-51)', () => {
  const inner = new Error('inner');
  inner.description = 'inner-description';
  const e = new NodeOperationError(NODE, inner);
  assert.equal(e.description, 'inner-description');
  assert.equal(e.cause, undefined); // build + source agree: Error causes are not assigned
  assert.equal(e.message, 'inner');
});

test('NodeApiError keeps its explicit error level (node-api) and new surface fields', () => {
  const e = new NodeApiError(NODE, new Error('api down'));
  assert.equal(e.name, 'NodeApiError');
  assert.equal(e.level, 'error'); // NodeApiError ctor pins level explicitly
  assert.equal(e.message, 'api down');
});
