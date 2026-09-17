/**
 * Reference-port regression tests for the `utils.ts` helper surface (`src/utils.mjs`).
 *
 * Oracles: `reference/n8n/packages/workflow/test/utils.test.ts`
 *   isObjectEmpty L21-97 (incl. the "should not call Object.keys unless a plain object" spy case),
 *   jsonStringify L293-315, fileTypeFromMimeType L394-436, randomInt L438-454,
 *   randomString L456-484, hasKey L485-554, isSafeObjectProperty L555-571,
 *   setSafeObjectProperty L572-583, isDomainAllowed L649-862, isCommunityPackageName L863-916,
 *   sanitizeFilename L917-end.
 * The differential group `N27` re-runs the same behaviour call-for-call against the published
 * `n8n-workflow@2.9.1` build (12 comparison batches, exact-value randoms included).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	base64DecodeUTF8,
	ExecutionBaseError,
	ExecutionCancelledError,
	fileTypeFromMimeType,
	hasKey,
	isCommunityPackageName,
	isDomainAllowed,
	isObject,
	isObjectEmpty,
	isSafeObjectProperty,
	isTraversableObject,
	jsonStringify,
	lodashIsObject,
	ManualExecutionCancelledError,
	merge,
	randomInt,
	randomString,
	removeCircularRefs,
	replaceCircularReferences,
	sanitizeFilename,
	setSafeObjectProperty,
	setUtilsTimerFns,
	sleep,
	sleepWithAbort,
	updateDisplayOptions,
	assert as utilAssert,
} from '../src/index.mjs';

test('isObjectEmpty: null/undefined/arrays/Set/Map/views/plain objects (oracle L21-97)', () => {
	assert.equal(isObjectEmpty(null), true);
	assert.equal(isObjectEmpty(undefined), true);
	assert.equal(isObjectEmpty([]), true);
	assert.equal(isObjectEmpty([1, 2, 3]), false);
	assert.equal(isObjectEmpty(new Set()), true);
	assert.equal(isObjectEmpty(new Set([1, 2, 3])), false);
	assert.equal(isObjectEmpty(new Map()), true);
	assert.equal(isObjectEmpty(new Map([['a', 1]])), false);
	assert.equal(isObjectEmpty(Buffer.from('')), true);
	assert.equal(isObjectEmpty(Buffer.from('abcd')), false);
	assert.equal(isObjectEmpty(Uint8Array.from([])), true);
	assert.equal(isObjectEmpty(Uint8Array.from([1, 2, 3])), false);
	assert.equal(isObjectEmpty(new ArrayBuffer(0)), true);
	assert.equal(isObjectEmpty(new ArrayBuffer(1)), false);
	assert.equal(isObjectEmpty({}), true);
	assert.equal(isObjectEmpty({ a: 1, b: 2 }), false);
	assert.equal(isObjectEmpty(new (class Test {})()), true);
	assert.equal(isObjectEmpty(new (class Test { prop = 123; })()), false);
});

test('isObjectEmpty never calls Object.keys on non-plain values (oracle L74-97 spy case)', () => {
	const original = Object.keys;
	let calls = 0;
	Object.keys = (...args) => {
		calls += 1;
		return original(...args);
	};
	try {
		// the oracle's exact sequence (L87-96): null / array / Buffer must not touch Object.keys
		const assertCalls = (count) => assert.equal(calls, count, '`Object.keys()` call count');
		assertCalls(0);
		isObjectEmpty(null);
		assertCalls(0);
		isObjectEmpty([1, 2, 3]);
		assertCalls(0);
		isObjectEmpty(Buffer.from('123'));
		assertCalls(0);
		isObjectEmpty({});
		assertCalls(1);
	} finally {
		Object.keys = original;
	}
});

test('jsonStringify / replaceCircularReferences (oracle L293-315)', () => {
	const source = { a: 1, b: 2, d: new Date(1680089084200), r: new RegExp('^test$', 'ig') };
	source.c = source;

	// "should throw errors on circular references by default"
	assert.throws(() => jsonStringify(source), /Converting circular structure to JSON/);
	// "should break circular references when requested"
	assert.equal(
		jsonStringify(source, { replaceCircularRefs: true }),
		'{"a":1,"b":2,"d":"2023-03-29T11:24:44.200Z","r":{},"c":"[Circular Reference]"}',
	);
	// "should not detect duplicates as circular references"
	const y = { z: 5 };
	assert.equal(
		jsonStringify([y, y, { y }], { replaceCircularRefs: true }),
		'[{"z":5},{"z":5},{"y":{"z":5}}]',
	);
	// toJSON wins over traversal, RegExp is returned as-is, primitives/null short-circuit
	assert.equal(replaceCircularReferences({ x: { toJSON: () => 'x:1,y:2' } }).x, 'x:1,y:2');
	assert.equal(replaceCircularReferences(42), 42);
	assert.equal(replaceCircularReferences(null), null);
	assert.ok(replaceCircularReferences(/ab/g) instanceof RegExp);
});

test('fileTypeFromMimeType (oracle L394-436)', () => {
	assert.equal(fileTypeFromMimeType('application/json'), 'json');
	assert.equal(fileTypeFromMimeType('text/html'), 'html');
	for (const mime of ['image/jpeg', 'image/png', 'image/avif', 'image/webp']) {
		assert.equal(fileTypeFromMimeType(mime), 'image');
	}
	for (const mime of ['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp3']) {
		assert.equal(fileTypeFromMimeType(mime), 'audio');
	}
	for (const mime of ['video/mp4', 'video/webm', 'video/ogg']) {
		assert.equal(fileTypeFromMimeType(mime), 'video');
	}
	assert.equal(fileTypeFromMimeType('text/plain'), 'text');
	assert.equal(fileTypeFromMimeType('text/css'), 'text');
	assert.notEqual(fileTypeFromMimeType('text/html'), 'text');
	assert.equal(fileTypeFromMimeType('text/javascript'), 'text');
	assert.equal(fileTypeFromMimeType('application/javascript'), 'text');
	assert.equal(fileTypeFromMimeType('application/pdf'), 'pdf');
	assert.equal(fileTypeFromMimeType('application/octet-stream'), undefined);
	assert.equal(fileTypeFromMimeType(''), undefined);
});

test('randomInt / randomString (oracle L438-484 + a deterministic RNG)', () => {
	const repeat = (fn, times = 10) => Array(times).fill(0).forEach(fn);

	// "should generate random integers" / "should generate random in range"
	repeat(() => {
		const result = randomInt(10);
		assert.ok(result <= 10 && result >= 0);
	});
	repeat(() => {
		const result = randomInt(10, 100);
		assert.ok(result <= 100 && result >= 10);
	});
	// "should return a random string of the specified length" / length range / character set
	repeat(() => assert.equal(randomString(42).length, 42));
	repeat(() => {
		const { length } = randomString(10, 100);
		assert.ok(length >= 10 && length <= 100);
	});
	const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
	for (const char of randomString(1000)) {
		assert.ok(ALPHABET.includes(char), `unexpected character ${char}`);
	}

	// With a deterministic WebCrypto the port must produce exact values — this is the same LCG
	// the differential injects, so the two agree bit-for-bit rather than only in range.
	const cryptoProto = Object.getPrototypeOf(globalThis.crypto);
	const original = cryptoProto.getRandomValues;
	let seed = 0;
	cryptoProto.getRandomValues = (arr) => {
		for (let i = 0; i < arr.length; i++) {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			arr[i] = seed % 256;
		}
		return arr;
	};
	try {
		assert.deepEqual([randomInt(100), randomInt(10, 20), randomInt(5), randomInt(0, 256)], [57, 16, 0, 0]);
		assert.equal(randomString(8), '00002000');
		assert.equal(randomString(4, 6), '0020');
	} finally {
		cryptoProto.getRandomValues = original;
	}
});

test('hasKey checks own properties only (oracle L485-554)', () => {
	assert.equal(hasKey(null, 'key'), false);
	assert.equal(hasKey(undefined, 'key'), false);
	assert.equal(hasKey(1, 'key'), false);
	assert.equal(hasKey('str', 'key'), false);
	assert.equal(hasKey([1, 2], 5), false); // out of bounds
	assert.equal(hasKey([1, 2], 1), true); // in bounds
	assert.equal(hasKey([1, 2], 'length'), true);
	assert.equal(hasKey([1, 2], 'toString'), false); // inherited, not own
	assert.equal(hasKey({ a: 3 }, 'a'), true);
	assert.equal(hasKey({ a: 3 }, 'b'), false);
	assert.equal(hasKey(Object.create({ inherited: 1 }), 'inherited'), false);
});

test('isObject is the plain-object guard of utils.ts L29 (port-only)', () => {
	assert.equal(isObject({}), true);
	assert.equal(isObject(Object.create(null)), true);
	assert.equal(isObject({ a: 1 }), true);
	assert.equal(isObject([]), false);
	assert.equal(isObject(new Date()), false);
	assert.equal(isObject(new Map()), false);
	assert.equal(isObject(/re/), false);
	assert.equal(isObject(null), false);
	assert.equal(isObject('s'), false);
	assert.equal(isObject(7), false);
	// DELTA-01: the lodash subset of the same name is a different predicate
	assert.equal(lodashIsObject([]), true);
	assert.equal(lodashIsObject(() => {}), true);
});

test('isTraversableObject / removeCircularRefs (utils.ts L290-314, port-only)', () => {
	assert.ok(isTraversableObject({ a: 1 }));
	assert.equal(isTraversableObject({}), false);
	assert.equal(isTraversableObject([]), false);
	assert.equal(isTraversableObject(7), false);
	// pinned quirk: the reference's `value && …` short-circuit returns the falsy INPUT itself,
	// not `false` — `isTraversableObject(null) === null`, `isTraversableObject(0) === 0`
	assert.equal(isTraversableObject(null), null);
	assert.equal(isTraversableObject(0), 0);
	assert.equal(isTraversableObject(''), '');

	const obj = { a: { b: 1 } };
	obj.a.parent = obj;
	obj.self = obj;
	obj.list = [{ n: 1 }, obj.a];
	removeCircularRefs(obj);
	assert.deepEqual(obj.a.parent, { circularReference: true });
	assert.deepEqual(obj.self, { circularReference: true });
	assert.deepEqual(obj.list, [{ n: 1 }, { circularReference: true }]);
});

test('isSafeObjectProperty / setSafeObjectProperty (oracle L555-583)', () => {
	for (const [key, expected] of [
		['__proto__', false],
		['prototype', false],
		['constructor', false],
		['getPrototypeOf', false],
		['mainModule', false],
		['binding', false],
		['_load', false],
		['safeKey', true],
		['anotherKey', true],
		['toString', true],
	]) {
		assert.equal(isSafeObjectProperty(key), expected, `isSafeObjectProperty(${key})`);
	}

	const safe = {};
	setSafeObjectProperty(safe, 'safeKey', 123);
	assert.deepEqual(safe, { safeKey: 123 });

	const protoTarget = {};
	setSafeObjectProperty(protoTarget, '__proto__', 456);
	assert.deepEqual(protoTarget, {});
	assert.equal(Object.getPrototypeOf(protoTarget), Object.prototype);

	const ctorTarget = {};
	setSafeObjectProperty(ctorTarget, 'constructor', 'test');
	assert.deepEqual(ctorTarget, {});
});

test('isDomainAllowed (oracle L649-862)', () => {
	// "should allow all domains when allowedDomains is empty" / whitespace-only
	assert.equal(isDomainAllowed('https://example.com', { allowedDomains: '' }), true);
	assert.equal(isDomainAllowed('https://example.com', { allowedDomains: '   ' }), true);
	// exact matches and comma-separated lists (with whitespace tolerance)
	assert.equal(isDomainAllowed('https://example.com', { allowedDomains: 'example.com' }), true);
	assert.equal(isDomainAllowed('https://other.com', { allowedDomains: 'example.com, other.com' }), true);
	assert.equal(isDomainAllowed('https://other.com', { allowedDomains: 'example.com,other.com' }), true);
	// wildcards match subdomains only, never the base domain
	assert.equal(isDomainAllowed('https://api.example.com', { allowedDomains: '*.example.com' }), true);
	assert.equal(isDomainAllowed('https://sub.deep.example.com', { allowedDomains: '*.example.com' }), true);
	assert.equal(isDomainAllowed('https://example.com', { allowedDomains: '*.example.com' }), false);
	// trailing dots are normalised on both sides
	assert.equal(isDomainAllowed('https://example.com.', { allowedDomains: 'example.com' }), true);
	assert.equal(isDomainAllowed('https://example.com', { allowedDomains: 'example.com.' }), true);
	// case-insensitive, port-aware, and safe on unparsable input
	assert.equal(isDomainAllowed('https://EXAMPLE.com', { allowedDomains: 'example.com' }), true);
	assert.equal(isDomainAllowed('https://example.com:8443/p', { allowedDomains: 'example.com' }), true);
	assert.equal(isDomainAllowed('not a url', { allowedDomains: 'example.com' }), false);
	assert.equal(isDomainAllowed('https://x.com', { allowedDomains: 'example.com' }), false);
});

test('isCommunityPackageName (oracle L863-916)', () => {
	assert.equal(isCommunityPackageName('n8n-nodes-example'), true);
	assert.equal(isCommunityPackageName('n8n-nodes-my_package'), true);
	assert.equal(isCommunityPackageName('@username/n8n-nodes-example'), true);
	assert.equal(isCommunityPackageName('@user_name/n8n-nodes-example'), true);
	assert.equal(isCommunityPackageName('@n8n-io/n8n-nodes-test'), true);
	assert.equal(isCommunityPackageName('n8n-nodes-example.NodeName'), true);
	assert.equal(isCommunityPackageName('@n8n/n8n-nodes-example'), false);
	assert.equal(isCommunityPackageName('n8n-nodes-base'), false);
	assert.equal(isCommunityPackageName('not-n8n-nodes'), false);
	assert.equal(isCommunityPackageName('n8n-core'), false);
	// the reference resets `lastIndex` on every call: consecutive calls must not drift
	assert.equal(isCommunityPackageName('@user/n8n-nodes-example'), true);
	assert.equal(isCommunityPackageName('n8n-nodes-base'), false);
	assert.equal(isCommunityPackageName('@test-scope/n8n-nodes-test'), true);
});

test('sanitizeFilename (oracle L917-end)', () => {
	assert.equal(sanitizeFilename('normalfile'), 'normalfile');
	assert.equal(sanitizeFilename('my-file_v2'), 'my-file_v2');
	assert.equal(sanitizeFilename('test.txt'), 'test.txt');
	assert.equal(sanitizeFilename(''), 'untitled');
	assert.equal(sanitizeFilename('.'), 'untitled');
	assert.equal(sanitizeFilename('..'), 'untitled');
	assert.equal(sanitizeFilename('...'), 'untitled');
	assert.equal(sanitizeFilename('../../../etc/passwd'), 'passwd');
	assert.equal(sanitizeFilename('..\\..\\..\\windows\\system32'), 'system32');
	assert.equal(sanitizeFilename('../file.txt'), 'file.txt');
	assert.equal(sanitizeFilename('path/to/file'), 'file');
	assert.equal(sanitizeFilename('path\\to\\file'), 'file');
	assert.equal(sanitizeFilename('../../../.ssh/authorized_keys'), 'authorized_keys');
	// null bytes are stripped rather than passed through (the oracle's null-byte case)
	assert.equal(sanitizeFilename('dir\0file.txt'), 'dirfile.txt');
});

test('base64DecodeUTF8 (utils.ts L195-209)', () => {
	assert.equal(base64DecodeUTF8(Buffer.from('hello').toString('base64')), 'hello');
	assert.equal(base64DecodeUTF8(Buffer.from('héllo ✓ 漢字').toString('base64')), 'héllo ✓ 漢字');
	assert.equal(base64DecodeUTF8(''), '');
});

test('assert throws with the given message and hides its own stack frame (utils.ts L272-289)', () => {
	utilAssert(true); // no throw
	assert.throws(() => utilAssert(false), { name: 'Error', message: 'Invalid assertion' });
	assert.throws(() => utilAssert(false, 'custom message'), /custom message/);
	try {
		utilAssert(false, 'boom');
	} catch (error) {
		const frames = error.stack.split('\n');
		assert.ok(!frames[1].includes('utilAssert'), `assert frame not hidden: ${frames[1]}`);
	}
});

/* ---------------------------------------------------------------------------
 * TASK-UTILS-02 — the trio the coverage manifest used to defer. The timer seam
 * (`setUtilsTimerFns`) makes `sleep`/`sleepWithAbort` exact instead of timing-dependent; the
 * oracle cases are ported from `reference/n8n/packages/workflow/test/utils.test.ts` L584-645.
 * ------------------------------------------------------------------------- */

/** Deterministic timer double: records scheduled callbacks and fires them on demand. */
function createFakeTimers() {
	const scheduled = new Map();
	let nextId = 1;
	return {
		scheduled,
		fns: {
			setTimeout: (callback, ms) => {
				const id = nextId++;
				scheduled.set(id, { callback, ms });
				return id;
			},
			clearTimeout: (id) => {
				scheduled.delete(id);
			},
		},
		fire(id) {
			const entry = scheduled.get(id);
			scheduled.delete(id);
			entry.callback();
			return entry.ms;
		},
	};
}

test('sleep resolves once its timer fires (utils.ts L239-241, oracle "resolves after the specified time")', async () => {
	const timers = createFakeTimers();
	setUtilsTimerFns(timers.fns);
	try {
		let settled = false;
		const promise = sleep(100).then(() => {
			settled = true;
		});

		assert.equal(timers.scheduled.size, 1);
		const [id, entry] = [...timers.scheduled.entries()][0];
		assert.equal(entry.ms, 100);
		assert.equal(settled, false);

		timers.fire(id);
		await promise;
		assert.equal(settled, true);

		// a zero-delay sleep still goes through the seam (the reference schedules a real timer)
		const zero = sleep(0);
		const [zeroId, zeroEntry] = [...timers.scheduled.entries()][0];
		assert.equal(zeroEntry.ms, 0);
		timers.fire(zeroId);
		assert.equal(await zero, undefined);
	} finally {
		setUtilsTimerFns(null);
	}
});

test('sleepWithAbort resolves without a signal (oracle "should work without abort signal")', async () => {
	const timers = createFakeTimers();
	setUtilsTimerFns(timers.fns);
	try {
		const promise = sleepWithAbort(100, undefined);
		const [id, entry] = [...timers.scheduled.entries()][0];
		assert.equal(entry.ms, 100);
		timers.fire(id);
		assert.equal(await promise, undefined);
		assert.equal(timers.scheduled.size, 0, 'a plain resolve leaves no pending timer');
	} finally {
		setUtilsTimerFns(null);
	}
});

test('sleepWithAbort rejects immediately when the signal is already aborted (oracle case, utils.ts L243-245)', async () => {
	const timers = createFakeTimers();
	setUtilsTimerFns(timers.fns);
	try {
		const controller = new AbortController();
		controller.abort();

		await assert.rejects(
			() => sleepWithAbort(1000, controller.signal),
			(error) => {
				assert.ok(error instanceof ManualExecutionCancelledError);
				assert.ok(error instanceof ExecutionCancelledError);
				assert.ok(error instanceof ExecutionBaseError);
				assert.equal(error.message, 'The execution was cancelled manually');
				assert.equal(error.name, 'ManualExecutionCancelledError');
				assert.equal(error.level, 'warning');
				assert.equal(error.reason, 'manual');
				assert.deepEqual(error.extra, { executionId: '' }); // utils.ts L244 — the empty execution id
				return true;
			},
		);
		assert.equal(timers.scheduled.size, 0, 'the timer must never be scheduled on the fast path');
	} finally {
		setUtilsTimerFns(null);
	}
});

test('sleepWithAbort rejects and clears its timer when aborted mid-sleep (oracle "should clean up timeout", utils.ts L249-252)', async () => {
	const timers = createFakeTimers();
	setUtilsTimerFns(timers.fns);
	try {
		const controller = new AbortController();
		const promise = sleepWithAbort(1000, controller.signal);

		assert.equal(timers.scheduled.size, 1);
		const id = [...timers.scheduled.keys()][0];
		controller.abort();

		await assert.rejects(
			() => promise,
			(error) => error.name === 'ManualExecutionCancelledError' && error.reason === 'manual',
		);
		assert.equal(timers.scheduled.has(id), false, 'clearTimeout must have been called for the pending timer');
	} finally {
		setUtilsTimerFns(null);
	}
});

test('sleepWithAbort error shape matches the published build key-for-key', async () => {
	const error = new ManualExecutionCancelledError('exec-9');
	assert.deepEqual(Object.keys(error), [
		'level',
		'tags',
		'extra',
		'description',
		'cause',
		'errorResponse',
		'timestamp',
		'context',
		'lineNumber',
		'functionality',
		'name',
		'reason',
	]);
	assert.equal(typeof error.timestamp, 'number');
	assert.deepEqual(error.context, {});
	assert.equal(error.functionality, 'regular');
	assert.equal(error.lineNumber, undefined);
	assert.equal(error.description, undefined);

	const serialized = error.toJSON();
	assert.equal(serialized.message, 'The execution was cancelled manually');
	assert.equal(serialized.name, 'ManualExecutionCancelledError');
	assert.deepEqual(serialized.context, {});
	assert.equal(serialized.lineNumber, undefined);
	assert.equal(serialized.description, undefined);
	// `tags` carry the reference's environment-derived `packageName` there; this boundary keeps the
	// documented local default (DELTA-02), so it is excluded from the comparison.
	assert.deepEqual(error.tags, {});
});

test('ExecutionBaseError keeps a non-Error cause and inherits context from an ExecutionBaseError cause', () => {
	const plainCause = { code: 'ETIMEDOUT' };
	const withPlain = new ManualExecutionCancelledError('e1');
	assert.equal(withPlain.cause, undefined);
	const base = new ExecutionBaseError('boom', { cause: plainCause });
	assert.equal(base.cause, plainCause);
	assert.equal(base.name, 'ExecutionBaseError'); // set from constructor.name, unlike ApplicationError

	const inner = new ExecutionBaseError('inner', { cause: plainCause });
	inner.context = { runIndex: 3 };
	const outer = new ExecutionBaseError('outer', { cause: inner });
	assert.deepEqual(outer.context, { runIndex: 3 });
	assert.equal(outer.cause, undefined, 'an ExecutionBaseError cause keeps its own context, it is not copied to `cause`');
});

test('updateDisplayOptions folds the caller options into every property (utils.ts L316-326)', () => {
	const properties = [
		{ name: 'a', displayOptions: { show: { mode: ['x', 'y'], sub: { k: 1 } } } },
		{ name: 'b' },
		{ name: 'c', displayOptions: { hide: { z: [1] }, show: { mode: 'single' } } },
	];

	const result = updateDisplayOptions({ show: { mode: ['z'], extra: true } }, properties);

	// arrays merge by index (the reference's `merge`, not a concatenation)
	assert.deepEqual(result, [
		{ name: 'a', displayOptions: { show: { mode: ['z', 'y'], sub: { k: 1 }, extra: true } } },
		{ name: 'b', displayOptions: { show: { mode: ['z'], extra: true } } },
		{ name: 'c', displayOptions: { hide: { z: [1] }, show: { mode: ['z'], extra: true } } },
	]);
	// the inputs are untouched: the property objects are shallow-copied, the merge target is fresh
	assert.deepEqual(properties[0].displayOptions, { show: { mode: ['x', 'y'], sub: { k: 1 } } });
	assert.equal(result[0] === properties[0], false);
	assert.equal(result[0].name, 'a');
	assert.deepEqual(Object.keys(result[0]), ['name', 'displayOptions']);
});

test('updateDisplayOptions with no properties and with empty options (edge cases)', () => {
	assert.deepEqual(updateDisplayOptions({ show: { a: 1 } }, []), []);
	assert.deepEqual(updateDisplayOptions({}, [{ name: 'p' }]), [{ name: 'p', displayOptions: {} }]);
	assert.deepEqual(updateDisplayOptions({ show: { a: 1 } }, [{ name: 'p', displayOptions: {} }]), [
		{ name: 'p', displayOptions: { show: { a: 1 } } },
	]);
});

test('merge reproduces the lodash subset the display-options call site relies on', () => {
	// primitives / null overwrite, arrays merge by index, undefined never overwrites
	assert.deepEqual(merge({}, { a: 1 }, { a: 2 }), { a: 2 });
	assert.deepEqual(merge({}, { a: { b: 1 } }, { a: null }), { a: null });
	assert.deepEqual(merge({}, { a: null }, { a: { b: 1 } }), { a: { b: 1 } });
	assert.deepEqual(merge({}, { a: [1, 2, 3] }, { a: ['x'] }), { a: ['x', 2, 3] });
	assert.deepEqual(merge({}, { a: [1, 2, 3] }, { a: [undefined, 9] }), { a: [1, 9, 3] });
	assert.deepEqual(merge({}, { a: 1 }, { a: undefined }), { a: 1 });
	assert.deepEqual(Object.keys(merge({}, { a: undefined })), ['a']);

	// deep merge, nested array-of-objects merged element-wise
	assert.deepEqual(merge({}, { a: { b: { c: 1 } } }, { a: { b: { d: 2 } } }), { a: { b: { c: 1, d: 2 } } });
	assert.deepEqual(merge({}, { a: [{ x: 1 }] }, { a: [{ y: 2 }, { z: 3 }] }), {
		a: [
			{ x: 1, y: 2 },
			{ z: 3 },
		],
	});

	// sources that are not containers are no-ops; non-plain objects are attached by reference
	assert.deepEqual(merge({}, { a: 1 }, null, undefined, 5, true), { a: 1 });
	assert.deepEqual(merge({}, { a: { b: 1 } }, 'ab'), { a: { b: 1 }, 0: 'a', 1: 'b' });
	const date = new Date(5);
	const withDate = merge({}, { a: date }, { a: { b: 2 } });
	assert.equal(withDate.a, date, 'a Date source is attached by reference (lodash behaviour)');
	assert.equal(date.b, 2);

	// prototype-pollution guard + inherited enumerable keys (lodash `keysIn`)
	assert.deepEqual(merge({}, JSON.parse('{"__proto__":{"polluted":1},"q":2}')), { q: 2 });
	assert.equal({}.polluted, undefined);
	assert.deepEqual(merge({}, Object.assign(Object.create({ inherited: 1 }), { own: 2 })), {
		inherited: 1,
		own: 2,
	});
	assert.deepEqual(merge({}, { constructor: { x: 1 } }).constructor, { x: 1 });
	assert.equal(typeof Object.x, 'undefined', 'the global Object must not be touched');

	// cycles are copied, shared-but-acyclic references are cloned independently. The clone of a
	// cyclic source is anchored on its own copy, not on the merge target — measured against the
	// real lodash (see the N28 differential group, where both sides agree on the same booleans).
	const cyclic = { a: 1 };
	cyclic.self = cyclic;
	const cyclicCopy = merge({}, cyclic);
	assert.notEqual(cyclicCopy.self, cyclicCopy);
	assert.equal(cyclicCopy.self, cyclicCopy.self.self, 'the cycle survives inside the copy');
	const shared = { x: 1 };
	const diamond = merge({}, { p: shared, q: shared });
	assert.notEqual(diamond.p, diamond.q);
	assert.deepEqual(diamond.p, { x: 1 });

	// the target is mutated and returned (the reference's `merge({}, …)` idiom)
	const target = { keep: true };
	assert.equal(merge(target, { a: 1 }), target);
	assert.deepEqual(target, { keep: true, a: 1 });
});
