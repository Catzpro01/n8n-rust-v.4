/**
 * The operation envelope: semantic context at the boundary, no payload tax.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ENVELOPE_FIELDS,
  EnvelopeError,
  TRANSPORTS,
  createOperationContext,
  describeEnvelope,
  nextCorrelationId,
  observationRecord,
} from '../src/envelope.mjs';
import { CONTRACT_VERSION } from '../src/contract.mjs';

test('the envelope carries the semantic identity a boundary needs', () => {
  const context = createOperationContext({ capability: 'workflow', operation: 'workflow.list', authorization: { subject: 'u1', scopes: ['workflow:read'] } });
  assert.equal(context.capability, 'workflow');
  assert.equal(context.operation, 'workflow.list');
  assert.equal(context.contractVersion, CONTRACT_VERSION);
  assert.equal(context.identity, `workflow:workflow.list@${CONTRACT_VERSION}`);
  assert.deepEqual(context.authorization, { subject: 'u1', scopes: ['workflow:read'] });
  assert.deepEqual(ENVELOPE_FIELDS, ['capability', 'operation', 'contractVersion', 'correlationId', 'authorization', 'deadlineMs', 'cancellation', 'idempotencyKey']);
  assert.equal(context.kind, 'query');
  assert.ok(context.correlationId.length > 0);
  assert.notEqual(nextCorrelationId(), nextCorrelationId(), 'correlation ids do not repeat');
});

test('an authorization context is not a credential', () => {
  for (const forbidden of ['token', 'password', 'apiKey', 'cookie', 'authorization']) {
    assert.throws(
      () => createOperationContext({ capability: 'workflow', operation: 'workflow.list', authorization: { subject: 'u1', [forbidden]: 'x' } }),
      (error) => {
        assert.ok(error instanceof EnvelopeError);
        assert.equal(error.code, 'frontend.envelope.invalid');
        assert.equal(error.field, 'authorization');
        assert.match(error.message, /never a credential/);
        return true;
      },
    );
  }
  assert.throws(() => createOperationContext({ capability: 'workflow', operation: 'workflow.list', authorization: 'Bearer abc' }), /must be a context object/);
});

test('operations and capabilities are named semantically, and commands need an idempotency key', () => {
  assert.throws(() => createOperationContext({ capability: 'Workflow', operation: 'workflow.list' }), /capability must be kebab-case/);
  assert.throws(() => createOperationContext({ capability: 'workflow', operation: 'listWorkflows' }), /must look like "<domain>\.<name>"/);
  assert.throws(
    () => createOperationContext({ capability: 'workflow', operation: 'workflow.run', kind: 'command' }),
    /is a command and needs an idempotencyKey/,
  );
  const command = createOperationContext({ capability: 'workflow', operation: 'workflow.run', kind: 'command', idempotencyKey: 'run-42' });
  assert.equal(command.idempotencyKey, 'run-42');
});

test('deadlines and cancellation are real, not decorative', () => {
  let clock = 1000;
  const context = createOperationContext({ capability: 'workflow', operation: 'workflow.list', deadlineMs: 250, now: () => clock });
  assert.equal(context.deadline, 1250);
  assert.equal(context.remainingMs(), 250);
  assert.equal(context.expired(), false);
  clock = 1300;
  assert.equal(context.expired(), true);
  assert.equal(context.remainingMs(), 0, 'a spent budget reads as zero, never negative');

  const controller = new AbortController();
  const cancellable = createOperationContext({ capability: 'workflow', operation: 'workflow.list', signal: controller.signal });
  assert.equal(cancellable.cancelled(), false);
  controller.abort();
  assert.equal(cancellable.cancelled(), true, 'cancellation is observed, not polled by the caller');
  assert.throws(() => createOperationContext({ capability: 'workflow', operation: 'workflow.list', deadlineMs: -1 }), /positive number/);
});

test('local execution serializes nothing', () => {
  const local = createOperationContext({ capability: 'workflow', operation: 'workflow.list', transport: 'local' });
  assert.deepEqual(local.toTransportHints(), { headers: {}, query: {} });
  const none = createOperationContext({ capability: 'workflow', operation: 'workflow.list', transport: 'none' });
  assert.deepEqual(none.toTransportHints().headers, {});

  const rest = createOperationContext({ capability: 'workflow', operation: 'workflow.list', transport: 'rest' });
  const hints = rest.toTransportHints();
  assert.equal(hints.headers['x-correlation-id'], rest.correlationId);
  assert.equal(hints.headers['x-contract-version'], CONTRACT_VERSION);
  assert.equal('idempotency-key' in hints.headers, false, 'queries are not idempotent commands');

  const command = createOperationContext({ capability: 'workflow', operation: 'workflow.run', kind: 'command', idempotencyKey: 'k1' });
  assert.equal(command.toTransportHints().headers['idempotency-key'], 'k1');
  assert.deepEqual(TRANSPORTS, ['rest', 'local', 'none']);
  assert.throws(() => createOperationContext({ capability: 'workflow', operation: 'workflow.list', transport: 'carrier-pigeon' }), /transport must be one of/);
});

test('the observation record is boundary-level and payload-free', () => {
  const context = createOperationContext({ capability: 'settings', operation: 'settings.update', kind: 'command', idempotencyKey: 'k2', authorization: { subject: 'u1', scopes: ['settings:write'] } });
  const record = observationRecord(context, { outcome: 'error', durationMs: 12, errorCode: 'settings.conflict', subLego: 'settings.security' });
  assert.equal(record.lego, 'ui-frontend');
  assert.equal(record.subLego, 'settings.security');
  assert.equal(record.identity, context.identity);
  assert.equal(record.outcome, 'error');
  assert.equal(record.errorCode, 'settings.conflict');
  assert.match(record.at, /^\d{4}-\d{2}-\d{2}T/);
  const serialized = JSON.stringify(record);
  // No scope list, no subject, no payload — an observability record that leaks a
  // session context is a liability, not telemetry.
  assert.equal(serialized.includes('settings:write'), false);
  assert.equal(serialized.includes('"u1"'), false);
  assert.equal(serialized.includes('scopes'), false);
});

test('the envelope contract is published as data', () => {
  const contract = describeEnvelope();
  assert.deepEqual(contract.fields, ENVELOPE_FIELDS);
  assert.equal(contract.rules.length, 6);
  assert.ok(contract.rules.some((rule) => /never a token/.test(rule)));
  assert.ok(contract.rules.some((rule) => /Local execution serializes nothing/.test(rule)));
});
