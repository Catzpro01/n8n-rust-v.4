import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { Cipher, OPENSSL_SALTED_HEADER, getKeyAndIv } from '../src/cipher.mjs';

const KEY = 'test-encryption-key';
const cipher = () => new Cipher({ encryptionKey: KEY });

test('C-01 every ciphertext carries the OpenSSL "Salted__" header', () => {
	const blob = cipher().encrypt({ a: 1 });
	assert.ok(blob.startsWith('U2FsdGVkX1'), `expected the CryptoJS prefix, got ${blob.slice(0, 12)}`);
	assert.equal(OPENSSL_SALTED_HEADER.toString('utf8'), 'Salted__');

	const raw = Buffer.from(blob, 'base64');
	assert.equal(raw.subarray(0, 8).toString('utf8'), 'Salted__');
	assert.equal(raw.subarray(8, 16).length, 8, 'salt is 8 bytes');
});

test('encrypt/decrypt round-trips strings and objects', () => {
	assert.equal(cipher().decrypt(cipher().encrypt('plain text')), 'plain text');
	assert.equal(cipher().decrypt(cipher().encrypt({ user: 'u', pass: 'p' })), '{"user":"u","pass":"p"}');
	assert.equal(cipher().decrypt(cipher().encrypt([])), '[]');
	assert.equal(
		cipher().decrypt(cipher().encrypt({ nested: { a: [1, 2] } })),
		'{"nested":{"a":[1,2]}}',
	);
});

test('C-06 decrypt returns a STRING — it never parses JSON (Credentials does)', () => {
	// Upstream: `Buffer.concat([decipher.update(contents), decipher.final()]).toString('utf-8')`.
	// Parsing is `Credentials.getData()`'s job via jsonParse, which is exactly why
	// a non-JSON plaintext surfaces as INVALID_JSON rather than as a cipher error.
	const plaintext = cipher().decrypt(cipher().encrypt({ a: 1 }));
	assert.equal(typeof plaintext, 'string');
	assert.equal(plaintext, '{"a":1}');
});

test('C-05 a fresh 8-byte salt per call — the same payload never repeats', () => {
	const c = cipher();
	const a = c.encrypt({ secret: 'x' });
	const b = c.encrypt({ secret: 'x' });
	assert.notEqual(a, b);
	assert.notEqual(
		Buffer.from(a, 'base64').subarray(8, 16).toString('hex'),
		Buffer.from(b, 'base64').subarray(8, 16).toString('hex'),
	);
	// …but the plaintext is stable, and only the salt differs
	assert.equal(a.length, b.length);
	assert.deepEqual(c.decrypt(a), c.decrypt(b));
});

test('C-04 decrypt returns an empty string for anything shorter than 16 bytes', () => {
	const c = cipher();
	assert.equal(c.decrypt(''), '');
	assert.equal(c.decrypt(Buffer.from('short').toString('base64')), '');
	// exactly 15 bytes of input is still "too short"
	assert.equal(c.decrypt(Buffer.alloc(15).toString('base64')), '');
});

test('C-04a a 16-byte-or-longer garbage input does NOT short-circuit — it throws', () => {
	const c = cipher();
	assert.throws(
		() => c.decrypt(Buffer.alloc(32, 7).toString('base64')),
		/bad decrypt|wrong final block length|unable to authenticate/i,
	);
});

test('C-02 key derivation is EVP_BytesToKey with MD5 and a single iteration', () => {
	const salt = Buffer.alloc(8, 3);
	const [key, iv] = getKeyAndIv(salt, undefined, { encryptionKey: KEY });

	assert.equal(key.length, 32, 'aes-256 key');
	assert.equal(iv.length, 16, 'cbc iv');

	// Independent recomputation of the OpenSSL derivation.
	const password = Buffer.concat([Buffer.from(KEY, 'binary'), salt]);
	const h1 = createHash('md5').update(password).digest();
	const h2 = createHash('md5').update(Buffer.concat([h1, password])).digest();
	const expectedIv = createHash('md5').update(Buffer.concat([h2, password])).digest();

	assert.deepEqual(key, Buffer.concat([h1, h2]));
	assert.deepEqual(iv, expectedIv);
});

test('C-03 the encryption key is read as latin1 ("binary"), not UTF-8', () => {
	const salt = Buffer.alloc(8, 9);
	// A non-ASCII code point: latin1 keeps 1 byte, UTF-8 would use 2.
	const [latin1Key] = getKeyAndIv(salt, 'é', { encryptionKey: 'unused' });
	const utf8Password = Buffer.concat([Buffer.from('é', 'utf8'), salt]);
	const utf8Hash1 = createHash('md5').update(utf8Password).digest();

	assert.notEqual(latin1Key.subarray(0, 16).toString('hex'), utf8Hash1.toString('hex'));

	// The derivation really used the single latin1 byte 0xE9.
	const binaryPassword = Buffer.concat([Buffer.from('é', 'binary'), salt]);
	assert.equal(binaryPassword.length, 9);
	assert.deepEqual(
		latin1Key.subarray(0, 16),
		createHash('md5').update(binaryPassword).digest(),
	);
});

test('a custom encryption key overrides the instance key, symmetrically', () => {
	const c = new Cipher({ encryptionKey: 'instance-key' });
	const blob = c.encrypt({ v: 1 }, 'custom-key');
	assert.equal(c.decrypt(blob, 'custom-key'), JSON.stringify({ v: 1 }));
	assert.throws(() => c.decrypt(blob, 'a-different-key'));
	assert.equal(c.decrypt(c.encrypt({ v: 1 }), undefined), JSON.stringify({ v: 1 }));
});

test('the salted envelope is AES-CBC, so the body length is a multiple of 16', () => {
	const blob = cipher().encrypt(JSON.stringify({ name: 'ab' }));
	const body = Buffer.from(blob, 'base64').subarray(16);
	assert.equal(body.length % 16, 0);
});
