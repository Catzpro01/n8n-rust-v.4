/**
 * Gate 02 — the error layer.
 *
 * Errors are the most-copied code in n8n and the easiest to "improve" into a
 * difference: users match on `error.name`, the UI renders `error.description`,
 * and the log pipeline routes on `error.level`. Each of those is pinned here.
 *
 * The live half (comparing against the reference classes) runs whenever the oracle
 * is installed; the offline half pins the exact strings.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import {
	ApplicationError,
	ExecutionBaseError,
	ExpressionError,
	NodeError,
	NodeOperationError,
	WorkflowOperationError,
} from '../src/errors.mjs';
import { referenceRuntime } from '../src/reference-runtime.mjs';
import { serialize } from './helpers/serialize.mjs';

const PKG = resolve(import.meta.dirname, '..');
const runtime = referenceRuntime();

const own = (o) =>
	Object.fromEntries(
		Object.entries(o).filter(([, v]) => typeof v !== 'function'),
	);

test('ApplicationError keeps the built-in name and defaults level to "error"', () => {
	const e = new ApplicationError('boom');
	// The reference does NOT set `this.name`, so `error.name` is 'Error'. A port that
	// "helpfully" sets the class name changes every downstream `name ===` check.
	assert.equal(e.name, 'Error');
	assert.equal(e.level, 'error');
	assert.equal(e.message, 'boom');
	assert.deepEqual(e.tags, {});
});

test('ApplicationError passes unknown options through to Error, keeps the rest', () => {
	const cause = new Error('inner');
	const e = new ApplicationError('outer', { level: 'warning', tags: { a: '1' }, cause });
	assert.equal(e.level, 'warning');
	assert.deepEqual(e.tags, { a: '1' });
	assert.equal(e.cause, cause);
});

test('ExecutionBaseError sets the class name (the one place that does)', () => {
	class Mine extends ExecutionBaseError {}
	const e = new Mine('x');
	assert.equal(e.name, 'Mine');
});

test('NodeOperationError: level warning, idempotent wrapping, extra context', () => {
	const node = { id: 'n1', name: 'Set Me', type: 'n8n-nodes-base.set', typeVersion: 3 };
	const e = new NodeOperationError(node, 'nope');
	assert.equal(e.level, 'warning');
	assert.equal(e.message, 'nope');
	// `description` is dropped when it would repeat the message.
	assert.equal(e.description, undefined);
	// node.error.ts assigns runIndex/itemIndex/metadata UNCONDITIONALLY from
	// options, so the keys exist and are undefined. Not the same thing as "absent":
	// `Object.keys(e.context)` feeds the telemetry shape.
	assert.deepEqual(Object.keys(e.context), ['runIndex', 'itemIndex', 'metadata']);
	assert.equal(e.context.runIndex, undefined);
	assert.equal(e.node, node);
	assert.deepEqual(e.messages, []);

	const wrapping = new NodeOperationError(node, e);
	assert.equal(wrapping, e, 'wrapping an existing NodeOperationError must return it untouched');

	// A NodeError being re-wrapped is tagged, and the original messages survive.
	const inner = new NodeOperationError(node, { message: 'm', description: 'd' });
	assert.equal(inner.description, 'd');
	assert.equal(inner.message, '', 'a JsonObject error has no Error message, so the message stays empty');
	assert.deepEqual(inner.errorResponse, { message: 'm', description: 'd' });
	// `reWrapped` is NOT set here: NodeOperationError returns the same instance for
	// another NodeOperationError before NodeError's tagging can run, so re-wrapping
	// is invisible in the tags. It only appears when the inner error is a *different*
	// NodeError subclass (e.g. NodeApiError, not ported) — which is what the next
	// three lines pin, using NodeError directly as the stand-in.
	const sameAgain = new NodeOperationError(node, inner);
	assert.equal(sameAgain, inner);
	assert.equal(inner.tags.reWrapped, undefined);
	const foreign = new NodeOperationError(node, new NodeError(node, new Error('m')));
	assert.equal(foreign.tags.reWrapped, true);
});

test('NodeOperationError maps well-known error text to the shared message table', () => {
	const node = { id: 'n1', name: 'Req', type: 'n8n-nodes-base.httpRequest', typeVersion: 4 };
	const e = new NodeOperationError(node, 'connect ECONNREFUSED 127.0.0.1:5432');
	assert.equal(e.message, 'The service refused the connection - perhaps it is offline');
	// The raw text is not lost — it becomes the first entry of `messages`.
	assert.deepEqual(e.messages, ['connect ECONNREFUSED 127.0.0.1:5432']);

	// A caller-supplied mapping wins over COMMON_ERRORS, and the *unmapped* original
	// is what gets pushed into messages.
	const mapped = new NodeOperationError(node, 'socket hang up', {
		messageMapping: { 'SOCKET HANG UP': 'custom text' },
	});
	assert.equal(mapped.message, 'custom text');
	assert.deepEqual(mapped.messages, ['socket hang up']);

	// No match: message untouched, messages empty.
	const plain = new NodeOperationError(node, 'something else');
	assert.equal(plain.message, 'something else');
	assert.deepEqual(plain.messages, []);
});

test('setDescriptiveErrorMessage keeps the reference case-sensitivity quirk', () => {
	const node = { id: 'n1', name: 'Req', type: 'n8n-nodes-base.httpRequest', typeVersion: 4 };
	const e = new NodeOperationError(node, 'x');
	// Guard uses code.toUpperCase(), the lookup uses the raw code (node.error.ts).
	// For a lowercase code the guard passes and the lookup misses, so the message
	// becomes `undefined`. Preserved on purpose: NodeApiError passes real codes and
	// any "fix" here changes user-visible text. Rust port must copy the behaviour,
	// not the intent.
	const [message, messages] = e.setDescriptiveErrorMessage('orig', [], 'econnrefused');
	assert.equal(message, undefined);
	assert.deepEqual(messages, ['orig']);
	// The uppercase form hits both.
	const [upper, upperMessages] = e.setDescriptiveErrorMessage('orig', [], 'ECONNREFUSED');
	assert.equal(upper, 'The service refused the connection - perhaps it is offline');
	assert.deepEqual(upperMessages, ['orig']);
});

test('ExpressionError filters its context to the allowed keys', () => {
	const e = new ExpressionError('bad', {
		runIndex: 3,
		itemIndex: 4,
		description: 'desc',
		causeDetailed: 'why',
		notInThrottleLimit: undefined,
		messageTemplate: 'tpl',
		functionality: 'regular',
	});
	assert.equal(e.level, 'warning');
	assert.equal(e.functionality, 'regular');
	assert.deepEqual(Object.keys(e.context).sort(), [
		'causeDetailed',
		'itemIndex',
		'messageTemplate',
		'runIndex',
	].sort());
	assert.equal(e.context.runIndex, 3);
	// `description` lives on the error, not in context.
	assert.equal(e.description, 'desc');
	assert.equal('description' in e.context, false);
});

test('WorkflowOperationError is an ExecutionBaseError with the right name', () => {
	const e = new WorkflowOperationError('nope');
	assert.equal(e.name, 'WorkflowOperationError');
	assert.ok(e instanceof ExecutionBaseError);
	assert.ok(e instanceof Error);
});

test('live: error shapes are indistinguishable from the reference (same input, same output)', async (t) => {
	if (!runtime) {
		t.diagnostic('reference runtime not installed — live error comparison not run');
		return;
	}
	const req = createRequire(join(runtime.dir, 'noop.js'));
	const errs = req(join(runtime.dir, 'n8n-workflow/dist/cjs/errors/index.js'));
	const node = { id: 'n1', name: 'Set Me', type: 'n8n-nodes-base.set', typeVersion: 3 };
	const cases = [
		['ApplicationError', errs.ApplicationError, ApplicationError, ['boom', { tags: { k: 'v' } }]],
		[
			'ApplicationError/level',
			errs.ApplicationError,
			ApplicationError,
			['boom', { level: 'warning', extra: { z: 1 } }],
		],
		['NodeOperationError', errs.NodeOperationError, NodeOperationError, [node, 'nope']],
		[
			'NodeOperationError/description',
			errs.NodeOperationError,
			NodeOperationError,
			[node, { message: 'm', description: 'd' }],
		],
		[
			'ExpressionError',
			errs.ExpressionError,
			ExpressionError,
			['bad', { runIndex: 1, itemIndex: 2, description: 'd', messageTemplate: 't' }],
		],
		[
			'WorkflowOperationError',
			errs.WorkflowOperationError,
			WorkflowOperationError,
			['nope', { description: 'd' }],
		],
	];
	const diffs = [];
	for (const [label, Ref, Mine, args] of cases) {
		const a = new Ref(...structuredCloneSafe(args));
		const b = new Mine(...structuredCloneSafe(args));
		const sa = serialize(observable(a));
		const sb = serialize(observable(b));
		if (sa !== sb) diffs.push(`${label}\n    reference:      ${sa}\n    reconstruction: ${sb}`);
	}
	assert.deepEqual(diffs, [], 'error objects differ from the reference for identical inputs');
});

/** Own enumerable data properties + the fields n8n itself reads. */
function observable(error) {
	const ownProps = own(error);
	// Date.now() is stamped per construction, so the two sides can never agree on the
	// value — but they MUST agree on the key existing and being a number, which is
	// what the run-log ordering and telemetry depend on.
	ownProps.timestamp = `typeof:${typeof error.timestamp}`;
	return {
		name: error.name,
		message: error.message,
		level: error.level,
		description: error.description,
		// `timestamp` is Date.now() at construction: the two sides are built microseconds
		// apart, so comparing it is a coin flip. Its PRESENCE and type are what the port
		// must get right (execution-time ordering, telemetry) — asserted separately below.
		timestamp: typeof error.timestamp,
		context: error.context,
		messages: error.messages,
		functionality: error.functionality,
		extra: error.extra,
		tags: error.tags,
		own: ownProps,
	};
}

function structuredCloneSafe(args) {
	// `extra` objects are shared between the two constructions by intent for
	// primitives, but a Node object must not be: clone the second slot shallowly.
	return args.map((a) => (a && typeof a === 'object' ? { ...a } : a));
}
