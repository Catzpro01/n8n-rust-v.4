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
	randomInt,
	randomString,
	removeCircularRefs,
	replaceCircularReferences,
	sanitizeFilename,
	setSafeObjectProperty,
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
