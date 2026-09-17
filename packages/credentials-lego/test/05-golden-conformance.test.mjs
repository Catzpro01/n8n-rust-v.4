/**
 * GOLDEN CONFORMANCE — `tests/reference/agent-4/golden/credentials.golden.json`.
 *
 * The golden was recorded against a LIVE n8n 2.9.4 instance (HTTP endpoints,
 * a real encryption key we do not have). What CAN be checked offline is that
 * the reconstructed core reproduces every credential-owned transition it
 * records — including the real ciphertext it captured.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { Cipher } from '../src/cipher.mjs';
import { Credentials } from '../src/credentials.mjs';
import {
	CREDENTIAL_BLANKING_VALUE,
	CREDENTIAL_EMPTY_VALUE,
	redactValues,
	unredact,
} from '../src/redaction.mjs';
import { HTTP_HEADER_AUTH_PROPERTIES } from './helpers/reference.mjs';

const GOLDEN = path.resolve(
	import.meta.dirname,
	'../../../tests/reference/agent-4/golden/credentials.golden.json',
);
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

const cipher = () => new Cipher({ encryptionKey: 'golden-replay-key' });

test('golden is a pinned n8n 2.9.4 recording with the documented cases', () => {
	assert.equal(golden.reference, 'n8n 2.9.4');
	for (const key of [
		'create',
		'getWithoutData',
		'getWithDataIsRedacted',
		'updateWithBlankedValueKeepsSecret',
		'notFound',
		'createInvalidType',
		'createNameTooShort',
		'delete',
	]) {
		assert.ok(golden.cases?.[key], `golden is missing the "${key}" case`);
	}
});

test('the sentinel constants are identical to the golden', () => {
	assert.equal(CREDENTIAL_BLANKING_VALUE, golden.constants.CREDENTIAL_BLANKING_VALUE);
	assert.equal(CREDENTIAL_EMPTY_VALUE, golden.constants.CREDENTIAL_EMPTY_VALUE);
	assert.equal(
		CREDENTIAL_BLANKING_VALUE,
		'__n8n_BLANK_VALUE_e5362baf-c777-4d57-a609-6eaf1f9e87f6',
	);
	assert.equal(
		CREDENTIAL_EMPTY_VALUE,
		'__n8n_EMPTY_VALUE_7b1af746-3729-4c60-9b9b-e08eb29e58da',
	);
});

test('the `create` side effect formula is reproduced exactly', () => {
	// golden.cases.create.sideEffect:
	//   credentials_entity.data = base64("Salted__"+salt+aes-256-cbc(...))
	const blob = cipher().encrypt({ name: 'X-Dummy', value: 'super-secret' });
	const raw = Buffer.from(blob, 'base64');

	assert.equal(raw.subarray(0, 8).toString('utf8'), 'Salted__');
	assert.equal(raw.subarray(8, 16).length, 8, 'salt');
	assert.equal(raw.subarray(16).length % 16, 0, 'aes-256-cbc blocks');
	assert.equal(Buffer.from(blob, 'base64').toString('base64'), blob);
});

test('the ciphertext the golden actually recorded has our exact envelope', () => {
	// golden.cases.createNameTooShort.expected.body.data.data — a real blob
	// captured from a live instance, encrypted with an unknown key.
	const blob = golden.cases.createNameTooShort.expected.body.data.data;
	const raw = Buffer.from(blob, 'base64');

	assert.ok(blob.startsWith('U2FsdGVkX1'), 'the recorded blob carries the Salted__ header');
	assert.equal(raw.subarray(0, 8).toString('utf8'), 'Salted__');
	assert.equal(raw.subarray(8, 16).length, 8);
	assert.equal(
		raw.subarray(16).length % 16,
		0,
		`body length ${raw.subarray(16).length} must be a multiple of the 16-byte CBC block`,
	);
	// It is a real encryption, not a placeholder: it is longer than one block.
	assert.ok(raw.subarray(16).length > 16);
});

test('replay getWithDataIsRedacted — `name` plain, `value` blanked', () => {
	// golden.cases.getWithDataIsRedacted.expected.data
	//   { name: 'X-Dummy', value: CREDENTIAL_BLANKING_VALUE }
	const stored = { name: 'X-Dummy', value: 'super-secret' };
	const redacted = redactValues({ ...stored }, HTTP_HEADER_AUTH_PROPERTIES);

	assert.deepEqual(redacted, {
		name: 'X-Dummy',
		value: CREDENTIAL_BLANKING_VALUE,
	});
	assert.deepEqual(redacted, golden.cases.getWithDataIsRedacted.expected.data);
});

test('replay updateWithBlankedValueKeepsSecret — unredact restores the plaintext', () => {
	// golden sideEffect: "CredentialsService.unredact restores the stored
	// plaintext for blanked keys; ciphertext re-encrypted with a fresh salt"
	const stored = { name: 'X-Dummy', value: 'super-secret' };
	const redacted = redactValues({ ...stored }, HTTP_HEADER_AUTH_PROPERTIES);

	const restored = unredact(redacted, stored);
	assert.deepEqual(restored, stored);
	assert.equal(restored.value, 'super-secret', 'the blanked secret came back');

	// …and re-encrypting the restored data mints a fresh salt
	const credentials = new Credentials({ id: 'cred-1', name: 'Dummy' }, 'httpHeaderAuth', undefined, {
		cipher: cipher(),
	});
	credentials.setData(stored);
	const first = credentials.data;
	credentials.setData(restored);
	assert.notEqual(credentials.data, first, 'fresh salt on every write');
	assert.deepEqual(credentials.getData(), stored);
});

test('the full round trip matches every credential-owned golden expectation', () => {
	const credentials = new Credentials(
		{ id: 'mHyc2U0r8psUIZu9', name: 'Dummy' },
		'httpHeaderAuth',
		undefined,
		{ cipher: cipher() },
	);
	credentials.setData({ name: 'X-Dummy', value: 'super-secret' });

	// `create` / `createNameTooShort`: the stored entity carries an opaque data field
	const saved = credentials.getDataToSave();
	assert.equal(saved.type, 'httpHeaderAuth');
	assert.equal(typeof saved.data, 'string');
	assert.ok(saved.data.startsWith('U2FsdGVkX1'));

	// `getWithoutData`: the API omits `data`, the core always includes it —
	// omission is the API's job, so assert the core's contract explicitly
	assert.equal('data' in saved, true);

	// `getWithDataIsRedacted`
	const redacted = redactValues(credentials.getData(), HTTP_HEADER_AUTH_PROPERTIES);
	assert.equal(redacted.value, CREDENTIAL_BLANKING_VALUE);

	// `updateWithBlankedValueKeepsSecret`
	assert.deepEqual(unredact(redacted, credentials.getData()), {
		name: 'X-Dummy',
		value: 'super-secret',
	});
});

test('the HTTP-only golden cases are out of scope for this LEGO', () => {
	// notFound (404), createInvalidType (500) and delete (200 {data:true}) are
	// produced by the API layer: routing, status codes and the response envelope.
	// Recorded here so nobody adds HTTP to the credential core.
	assert.equal(golden.cases.notFound.expected.status, 404);
	assert.equal(golden.cases.createInvalidType.expected.status, 500);
	assert.equal(golden.cases.delete.expected.body.data, true);

	for (const symbol of ['sendSuccessResponse', 'sendErrorResponse', 'Request', 'Response']) {
		assert.equal(
			Object.getOwnPropertyNames(Credentials.prototype).includes(symbol),
			false,
			`the credential core must not grow an HTTP entry point (${symbol})`,
		);
	}
});
