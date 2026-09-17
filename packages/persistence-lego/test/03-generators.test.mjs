/**
 * POOL-004 · Suite 03 — @n8n/db utils/generators.ts + @n8n/utils workflowId.ts
 * NANOID_ALPHABET pinned from @n8n/constants/src/index.ts:130.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NANOID_ALPHABET, generateNanoId, generateHostInstanceId } from '../src/utils/generators.mjs';
import { customAlphabet } from '../src/consumed.mjs';

test('NANOID_ALPHABET is byte-exact the @n8n/constants pin', () => {
	assert.equal(NANOID_ALPHABET, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');
	assert.equal(NANOID_ALPHABET.length, 62);
});

test('generateNanoId: 16 chars from the alphabet (200 samples), unique', () => {
	const seen = new Set();
	const charRe = /^[0-9A-Za-z]{16}$/;
	for (let i = 0; i < 200; i++) {
		const id = generateNanoId();
		assert.match(id, charRe);
		seen.add(id);
	}
	assert.equal(seen.size, 200);
});

test('generateHostInstanceId: `${instanceType}-${nanoid}`', () => {
	for (const instanceType of ['main', 'webhook', 'worker']) {
		assert.match(generateHostInstanceId(instanceType), new RegExp(`^${instanceType}-[0-9A-Za-z]{16}$`));
	}
});

test('A/B: an independent customAlphabet(alphabet,16) build draws from the same alphabet', () => {
	const referenceSide = customAlphabet(NANOID_ALPHABET, 16);
	for (let i = 0; i < 100; i++) {
		assert.match(referenceSide(), /^[0-9A-Za-z]{16}$/);
	}
});
