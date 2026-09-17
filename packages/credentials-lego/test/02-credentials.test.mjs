import assert from 'node:assert/strict';
import test from 'node:test';

import { CREDENTIAL_ERRORS, CredentialDataError, Credentials } from '../src/credentials.mjs';
import { Cipher } from '../src/cipher.mjs';

const KEY = 'test-encryption-key';

/** A `Credentials` wired to a real (ported) cipher, mirroring upstream DI. */
function makeCredentials({ id = 'cred-1', name = 'My credential', type = 'httpHeaderAuth', data } = {}) {
	return new Credentials({ id, name }, type, data, { cipher: new Cipher({ encryptionKey: KEY }) });
}

test('constructor mirrors ICredentials: id falls back to undefined, data stays unset', () => {
	const c = makeCredentials();
	assert.equal(c.id, 'cred-1');
	assert.equal(c.name, 'My credential');
	assert.equal(c.type, 'httpHeaderAuth');
	assert.equal(c.data, undefined);

	const withoutId = new Credentials({ name: 'n' }, 't', undefined, {
		cipher: new Cipher({ encryptionKey: KEY }),
	});
	assert.equal(withoutId.id, undefined);
	assert.equal('id' in withoutId, true);
});

test('K-01 setData asserts a plain object literal — everything else throws AssertionError', () => {
	const ok = makeCredentials();
	ok.setData({ a: 1 });
	assert.equal(typeof ok.data, 'string');

	for (const bad of [null, undefined, 1, 's', [], [1], new Date(), Object.create(null)]) {
		const c = makeCredentials();
		assert.throws(
			() => c.setData(bad),
			(err) => err instanceof assert.AssertionError,
			`expected an AssertionError for ${JSON.stringify(bad) ?? String(bad)}`,
		);
	}
});

test('K-01a a class instance is rejected too', () => {
	class Payload {
		constructor() {
			this.a = 1;
		}
	}
	const c = makeCredentials();
	assert.throws(() => c.setData(new Payload()), assert.AssertionError);
});

test('K-02 NO_DATA when nothing has been set', () => {
	const c = makeCredentials();
	assert.throws(
		() => c.getData(),
		(err) => {
			assert.ok(err instanceof CredentialDataError);
			assert.equal(err.message, CREDENTIAL_ERRORS.NO_DATA);
			assert.deepEqual(err.extra, { name: 'My credential', type: 'httpHeaderAuth', id: 'cred-1' });
			return true;
		},
	);
});

test('K-02a DECRYPTION_FAILED when the stored blob cannot be decrypted', () => {
	// 32 bytes of garbage: long enough to skip the <16 short-circuit, wrong enough to fail.
	const garbage = Buffer.alloc(32, 7).toString('base64');
	const c = makeCredentials({ data: garbage });
	assert.throws(
		() => c.getData(),
		(err) => {
			assert.ok(err instanceof CredentialDataError);
			assert.equal(err.message, CREDENTIAL_ERRORS.DECRYPTION_FAILED);
			assert.ok(err.cause, 'the underlying crypto error is attached as the cause');
			return true;
		},
	);
});

test('K-02b INVALID_JSON when the plaintext is not JSON', () => {
	const cipher = new Cipher({ encryptionKey: KEY });
	const data = cipher.encrypt('this is not json');
	const c = makeCredentials({ data });
	assert.throws(
		() => c.getData(),
		(err) => {
			assert.ok(err instanceof CredentialDataError);
			assert.equal(err.message, CREDENTIAL_ERRORS.INVALID_JSON);
			assert.ok(err.cause instanceof SyntaxError);
			return true;
		},
	);
});

test('K-05 the error extra is a snapshot, not a live view of the entity', () => {
	const c = makeCredentials();
	try {
		c.getData();
		assert.fail('expected getData to throw');
	} catch (error) {
		assert.equal(error.extra.name, 'My credential');
		c.name = 'renamed after the throw';
		assert.equal(error.extra.name, 'My credential', 'extra must not follow the entity');
	}
});

test('K-03 updateData is decrypt, merge, delete, re-encrypt — with a fresh salt', () => {
	const c = makeCredentials();
	c.setData({ user: 'u', pass: 'p', stale: 'x' });
	const before = c.data;

	c.updateData({ pass: 'p2' }, ['stale']);

	assert.deepEqual(c.getData(), { user: 'u', pass: 'p2' });
	assert.notEqual(c.data, before, 'C-05: a new salt means a new ciphertext');
	assert.deepEqual(
		Buffer.from(c.data, 'base64').subarray(8, 16).toString('hex') ===
			Buffer.from(before, 'base64').subarray(8, 16).toString('hex'),
		false,
	);
});

test('K-03a updating a credential with no data throws NO_DATA', () => {
	const c = makeCredentials();
	assert.throws(() => c.updateData({ a: 1 }), { message: CREDENTIAL_ERRORS.NO_DATA });
});

test('K-04 getDataToSave shape, and a plain ApplicationError without extra', () => {
	const c = makeCredentials();
	assert.throws(() => c.getDataToSave(), { message: 'No credentials were set to save.' });

	let thrown;
	try {
		c.getDataToSave();
	} catch (error) {
		thrown = error;
	}
	assert.equal(thrown instanceof CredentialDataError, false, 'not a CredentialDataError');
	assert.equal(thrown.extra, undefined, 'no extra payload on the save error');

	c.setData({ a: 1 });
	assert.deepEqual(Object.keys(c.getDataToSave()).sort(), ['data', 'id', 'name', 'type']);
	assert.deepEqual(c.getDataToSave(), {
		id: 'cred-1',
		name: 'My credential',
		type: 'httpHeaderAuth',
		data: c.data,
	});
});

test('the cipher is injected — constructing without one fails loudly', () => {
	assert.throws(
		() => new Credentials({ id: '1', name: 'n' }, 't', undefined, {}),
		/deps\.cipher/,
	);
});
