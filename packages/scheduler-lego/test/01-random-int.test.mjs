import assert from 'node:assert/strict';
import test from 'node:test';

import { randomInt } from '../src/random.mjs';

test('S-02: the single-argument form means 0..n-1, not 1..n', () => {
	for (let i = 0; i < 500; i++) {
		const value = randomInt(60);
		assert.ok(Number.isInteger(value), 'always an integer');
		assert.ok(value >= 0 && value < 60, `${value} out of [0,60)`);
	}
});

test('the two-argument form honours min as INCLUSIVE and max as EXCLUSIVE', () => {
	for (let i = 0; i < 500; i++) {
		const value = randomInt(5, 10);
		assert.ok(value >= 5 && value < 10, `${value} out of [5,10)`);
	}
});

test('S-01: the draw is a raw modulo of a Uint32 (biased by construction)', () => {
	// The port must stay a plain `min + (u32 % (max - min))`. Rejection sampling
	// would change the value stream and break byte-for-byte parity with n8n.
	const source = randomInt.toString();
	assert.match(source, /getRandomValues/);
	assert.match(source, /Uint32Array/);
	assert.match(source, /%\s*\(\s*max\s*-\s*min\s*\)/);
	assert.doesNotMatch(source, /while|reject|>/, 'no rejection-sampling loop');
});

test('min === max-1 collapses to a constant', () => {
	assert.equal(randomInt(7, 8), 7);
});
