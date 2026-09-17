/**
 * A/B PARITY — this port against the real n8n 2.9.4 dependency set
 * (`n8n-core@2.9.1`), loaded from `.runtime/node_modules`.
 *
 * Every test drives BOTH sides with the same input and diffs the observable
 * result, so a divergence is a behavioural difference rather than an opinion.
 *
 * The reference `Credentials` resolves its cipher through the `@n8n/di`
 * container, so the helper registers a real `Cipher` before constructing it
 * (verified to share the same container instance as `n8n-core`'s dist).
 */

import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import test from 'node:test';

import { Cipher, getKeyAndIv } from '../src/cipher.mjs';
import { CREDENTIAL_ERRORS, Credentials } from '../src/credentials.mjs';
import {
	makeReferenceCipher,
	makeReferenceCredentials,
	skip,
} from './helpers/reference.mjs';

const KEY = 'test-encryption-key';
const mine = () => new Cipher({ encryptionKey: KEY });
const theirs = () => makeReferenceCipher(KEY);

function pair({ id = 'cred-1', name = 'My credential', type = 'httpHeaderAuth', data } = {}) {
	return {
		mine: new Credentials({ id, name }, type, data, { cipher: mine() }),
		theirs: makeReferenceCredentials({ encryptionKey: KEY, id, name, type, data }),
	};
}

test('parity: the port decrypts what the reference encrypts, and vice versa', { skip }, () => {
	const a = theirs().encrypt({ user: 'u', pass: 'p' });
	const b = mine().encrypt({ user: 'u', pass: 'p' });

	assert.equal(mine().decrypt(a), '{"user":"u","pass":"p"}');
	assert.equal(theirs().decrypt(b), '{"user":"u","pass":"p"}');
	assert.equal(theirs().decrypt(a), '{"user":"u","pass":"p"}');
	assert.equal(mine().decrypt(b), '{"user":"u","pass":"p"}');
});

test('parity: the envelope is byte-shaped identically (prefix, salt, block size)', { skip }, () => {
	const a = mine().encrypt(JSON.stringify({ name: 'ab' }));
	const b = theirs().encrypt(JSON.stringify({ name: 'ab' }));

	assert.equal(a.length, b.length, 'same payload length => same envelope length');
	assert.equal(a.slice(0, 10), b.slice(0, 10), 'both start with the Salted__ prefix');

	const rawA = Buffer.from(a, 'base64');
	const rawB = Buffer.from(b, 'base64');
	assert.equal(rawA.subarray(0, 8).toString('utf8'), rawB.subarray(0, 8).toString('utf8'));
	assert.equal(rawA.subarray(8, 16).length, rawB.subarray(8, 16).length);
	assert.equal(rawA.subarray(16).length % 16, 0);
	assert.equal(rawB.subarray(16).length % 16, 0);
});

test('parity: my EVP_BytesToKey derivation reads a reference-produced blob', { skip }, () => {
	// The strongest available check on the derivation: take the salt out of a
	// ciphertext the REFERENCE encrypted, derive key+iv with MY getKeyAndIv, and
	// decrypt the body with plain node:crypto.
	const blob = theirs().encrypt({ a: 1 });
	const raw = Buffer.from(blob, 'base64');
	const [key, iv] = getKeyAndIv(raw.subarray(8, 16), undefined, { encryptionKey: KEY });

	assert.equal(key.length, 32);
	assert.equal(iv.length, 16);

	const decipher = createDecipheriv('aes-256-cbc', key, iv);
	assert.equal(
		Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]).toString('utf8'),
		'{"a":1}',
	);
});

test('parity: an undecryptable body behaves identically on both sides', { skip }, () => {
	// Whether a random body happens to produce valid PKCS#7 padding is
	// probabilistic, so the parity claim is that BOTH sides agree — either both
	// throw the same error type, or both return the same plaintext.
	const blob = Buffer.concat([
		Buffer.from('Salted__', 'utf8'),
		Buffer.alloc(8, 1),
		Buffer.alloc(32, 5),
	]).toString('base64');

	const outcome = (c) => {
		try {
			return { ok: true, value: c.decrypt(blob) };
		} catch (error) {
			return { ok: false, name: error.constructor.name };
		}
	};

	assert.deepEqual(outcome(mine()), outcome(theirs()));
});

test('parity: the <16-byte short-circuit returns an empty string on both sides', { skip }, () => {
	for (const blob of ['', Buffer.from('short').toString('base64'), Buffer.alloc(15).toString('base64')]) {
		assert.equal(mine().decrypt(blob), theirs().decrypt(blob), `input: ${blob}`);
		assert.equal(theirs().decrypt(blob), '');
	}
});

test('parity: a wrong key fails on both sides, a right key succeeds on both', { skip }, () => {
	const blob = theirs().encrypt({ v: 1 }, 'custom');
	assert.equal(mine().decrypt(blob, 'custom'), '{"v":1}');
	assert.throws(() => mine().decrypt(blob, 'wrong'));
	assert.throws(() => theirs().decrypt(blob, 'wrong'));
});

test('parity: setData accepts exactly the same values (isObjectLiteral table)', { skip }, () => {
	const cases = [
		{ a: 1 },
		{},
		null,
		undefined,
		1,
		's',
		[],
		[1],
		new Date(),
		Object.create(null),
	];

	for (const value of cases) {
		const result = (factory) => {
			const c = factory();
			try {
				c.setData(value);
				return { ok: true, type: typeof c.data };
			} catch (error) {
				return { ok: false, name: error.constructor.name };
			}
		};
		const mineResult = result(() => pair().mine);
		const theirsResult = result(() => pair().theirs);
		assert.deepEqual(
			mineResult,
			theirsResult,
			`divergence for ${JSON.stringify(value) ?? String(value)}: ${JSON.stringify([mineResult, theirsResult])}`,
		);
	}
});

test('parity: the three CredentialDataError messages are identical', { skip }, () => {
	const cipher = mine();

	// NO_DATA
	const noData = pair();
	for (const c of [noData.mine, noData.theirs]) {
		assert.throws(() => c.getData(), { message: CREDENTIAL_ERRORS.NO_DATA });
	}

	// DECRYPTION_FAILED
	const garbage = Buffer.alloc(32, 7).toString('base64');
	const bad = pair({ data: garbage });
	for (const c of [bad.mine, bad.theirs]) {
		assert.throws(() => c.getData(), { message: CREDENTIAL_ERRORS.DECRYPTION_FAILED });
	}

	// INVALID_JSON
	const notJson = pair({ data: cipher.encrypt('this is not json') });
	for (const c of [notJson.mine, notJson.theirs]) {
		assert.throws(() => c.getData(), { message: CREDENTIAL_ERRORS.INVALID_JSON });
	}
});

test('parity: getDataToSave — identical shape and identical error', { skip }, () => {
	const empty = pair();
	for (const c of [empty.mine, empty.theirs]) {
		assert.throws(() => c.getDataToSave(), { message: 'No credentials were set to save.' });
	}

	const filled = pair();
	filled.mine.setData({ a: 1 });
	filled.theirs.setData({ a: 1 });
	assert.deepEqual(
		Object.keys(filled.mine.getDataToSave()).sort(),
		Object.keys(filled.theirs.getDataToSave()).sort(),
	);
	assert.deepEqual(filled.theirs.getDataToSave(), {
		id: 'cred-1',
		name: 'My credential',
		type: 'httpHeaderAuth',
		data: filled.theirs.data,
	});
});

test('parity: updateData merges, deletes and re-salts identically', { skip }, () => {
	const p = pair();
	for (const c of [p.mine, p.theirs]) c.setData({ user: 'u', pass: 'p', stale: 'x' });
	const mineBefore = p.mine.data;
	const theirsBefore = p.theirs.data;

	p.mine.updateData({ pass: 'p2' }, ['stale']);
	p.theirs.updateData({ pass: 'p2' }, ['stale']);

	assert.deepEqual(p.mine.getData(), { user: 'u', pass: 'p2' });
	assert.deepEqual(p.theirs.getData(), { user: 'u', pass: 'p2' });
	assert.notEqual(p.mine.data, mineBefore, 'mine re-salted');
	assert.notEqual(p.theirs.data, theirsBefore, 'theirs re-salted');

	// …and the two ciphertexts remain mutually readable
	assert.equal(mine().decrypt(p.theirs.data), '{"user":"u","pass":"p2"}');
	assert.equal(theirs().decrypt(p.mine.data), '{"user":"u","pass":"p2"}');
});

test('parity: updating an empty credential throws NO_DATA on both sides', { skip }, () => {
	const p = pair();
	for (const c of [p.mine, p.theirs]) {
		assert.throws(() => c.updateData({ a: 1 }), { message: CREDENTIAL_ERRORS.NO_DATA });
	}
});

test('parity: CredentialDataError extra fields are identical', { skip }, () => {
	const p = pair({ id: 'cred-1', name: 'My credential', type: 'httpHeaderAuth' });
	const extras = [p.mine, p.theirs].map((c) => {
		try {
			c.getData();
			return null;
		} catch (error) {
			return error.extra;
		}
	});
	assert.deepEqual(extras[0], { name: 'My credential', type: 'httpHeaderAuth', id: 'cred-1' });
	assert.deepEqual(extras[0], extras[1]);
});
