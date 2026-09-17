import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
	Cipher,
	RANDOM_BYTES,
	Credentials,
	CREDENTIAL_BLANKING_VALUE,
	CREDENTIAL_EMPTY_VALUE,
	CREDENTIAL_ERRORS,
	CredentialDataError,
	CredentialNotFoundError,
	NodeOperationError,
	ApplicationError,
	redactCredentials,
	unredactCredentials,
	applyCredentialOverwrites,
	CredentialsHelper,
} from '../src/index.mjs';

const DUMMY_KEY = 'agent4-dummy-key-not-a-secret';
const OTHER_KEY = 'agent4-other-dummy-key';

/** Independent re-implementation of OpenSSL EVP_BytesToKey(MD5, 1 round) for differential verification. */
function evpBytesToKey(pass, salt) {
	const password = Buffer.concat([Buffer.from(pass, 'binary'), salt]);
	const h1 = createHash('md5').update(password).digest();
	const h2 = createHash('md5').update(Buffer.concat([h1, password])).digest();
	const iv = createHash('md5').update(Buffer.concat([h2, password])).digest();
	return { key: Buffer.concat([h1, h2]), iv };
}

test('01. Cipher: encrypt → decrypt round-trip and wire format', () => {
	const cipher = new Cipher({ encryptionKey: DUMMY_KEY });
	const plain = { user: 'dummy', token: 'not-a-real-token-123' };

	const enc = cipher.encrypt(plain);
	const raw = Buffer.from(enc, 'base64');

	// Wire format is base64("Salted__" + 8-byte salt + ciphertext)
	assert.equal(raw.subarray(0, 8).toString('ascii'), 'Salted__');
	assert.ok(raw.subarray(0, 8).equals(RANDOM_BYTES));
	assert.equal(cipher.decrypt(enc), JSON.stringify(plain));

	// Random salt makes ciphertexts differ across runs
	const enc2 = cipher.encrypt(plain);
	assert.notEqual(enc, enc2);
	assert.equal(cipher.decrypt(enc2), JSON.stringify(plain));
});

test('02. Cipher: differential cross-check against independent OpenSSL EVP_BytesToKey', () => {
	const cipher = new Cipher({ encryptionKey: DUMMY_KEY });
	const plain = { apiKey: 'secret-api-key-xyz', endpoint: 'https://api.example.com' };
	const enc = cipher.encrypt(plain);
	const raw = Buffer.from(enc, 'base64');

	const salt = raw.subarray(8, 16);
	const ciphertext = raw.subarray(16);
	const { key, iv } = evpBytesToKey(DUMMY_KEY, salt);

	const decipher = createDecipheriv('aes-256-cbc', key, iv);
	const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
	assert.equal(decrypted, JSON.stringify(plain));
});

test('03. Cipher: decrypt with wrong key throws, short input returns empty string', () => {
	const cipherA = new Cipher({ encryptionKey: DUMMY_KEY });
	const cipherB = new Cipher({ encryptionKey: OTHER_KEY });
	const enc = cipherA.encrypt('hello world');

	assert.throws(() => cipherB.decrypt(enc));
	assert.equal(cipherA.decrypt(Buffer.from('short').toString('base64')), '');
});

test('04. Credentials class: setData and getData round-trip', () => {
	const cipher = new Cipher({ encryptionKey: DUMMY_KEY });
	const cred = new Credentials({ id: 'c1', name: 'My Header Auth' }, 'httpHeaderAuth', undefined, cipher);

	cred.setData({ name: 'X-Auth-Token', value: 'secret-token-123' });
	assert.deepEqual(cred.getData(), { name: 'X-Auth-Token', value: 'secret-token-123' });

	const toSave = cred.getDataToSave();
	assert.equal(toSave.id, 'c1');
	assert.equal(toSave.name, 'My Header Auth');
	assert.equal(toSave.type, 'httpHeaderAuth');
	assert.ok(toSave.data.length > 0);
	assert.ok(!toSave.data.includes('secret-token-123'));
});

test('05. Credentials class: throws NO_DATA error when data is undefined', () => {
	const cipher = new Cipher({ encryptionKey: DUMMY_KEY });
	const cred = new Credentials({ id: 'c1', name: 'Empty' }, 'httpHeaderAuth', undefined, cipher);

	assert.throws(
		() => cred.getData(),
		(e) => e instanceof CredentialDataError && e.message === CREDENTIAL_ERRORS.NO_DATA,
	);
});

test('06. Credentials class: throws DECRYPTION_FAILED error when key is wrong', () => {
	const cipherA = new Cipher({ encryptionKey: DUMMY_KEY });
	const cipherB = new Cipher({ encryptionKey: OTHER_KEY });
	const cred = new Credentials({ id: 'c1', name: 'Wrong Key' }, 'httpHeaderAuth', undefined, cipherA);
	cred.setData({ secret: 'value' });
	const encryptedData = cred.getDataToSave().data;

	const wrongCred = new Credentials({ id: 'c1', name: 'Wrong Key' }, 'httpHeaderAuth', encryptedData, cipherB);
	assert.throws(
		() => wrongCred.getData(),
		(e) => e instanceof CredentialDataError && e.message === CREDENTIAL_ERRORS.DECRYPTION_FAILED,
	);
});

test('07. Credentials class: throws INVALID_JSON error when decrypted data is not valid JSON', () => {
	const cipher = new Cipher({ encryptionKey: DUMMY_KEY });
	const notJsonCiphertext = cipher.encrypt('plain text, not json at all');
	const cred = new Credentials({ id: 'c2', name: 'Not JSON' }, 'httpHeaderAuth', notJsonCiphertext, cipher);

	assert.throws(
		() => cred.getData(),
		(e) => e instanceof CredentialDataError && e.message === CREDENTIAL_ERRORS.INVALID_JSON,
	);
});

test('08. Credentials class: setData rejects non-object literal', () => {
	const cipher = new Cipher({ encryptionKey: DUMMY_KEY });
	const cred = new Credentials({ id: 'c3', name: 'Type Check' }, 'httpHeaderAuth', undefined, cipher);

	assert.throws(() => cred.setData('string-primitive'));
	assert.throws(() => cred.setData([1, 2, 3]));
	assert.throws(() => cred.setData(null));
});

test('09. Credentials class: updateData merges updates and removes specified keys', () => {
	const cipher = new Cipher({ encryptionKey: DUMMY_KEY });
	const cred = new Credentials({ id: 'c4', name: 'Updatable' }, 'httpHeaderAuth', undefined, cipher);

	cred.setData({ name: 'X-Dummy', value: 'secret-val', extra: 'to-remove' });
	assert.deepEqual(cred.getData(), { name: 'X-Dummy', value: 'secret-val', extra: 'to-remove' });

	cred.updateData({ value: 'new-val', newlyAdded: 'yes' }, ['extra']);
	assert.deepEqual(cred.getData(), { name: 'X-Dummy', value: 'new-val', newlyAdded: 'yes' });
});

test('10. Credentials class: getDataToSave throws ApplicationError when data is undefined', () => {
	const cred = new Credentials({ id: 'c5', name: 'No Data' }, 'httpHeaderAuth');
	assert.throws(() => cred.getDataToSave(), (e) => e instanceof ApplicationError && e.message === 'No credentials were set to save.');
});

test('11. Redaction: replaces password fields with CREDENTIAL_BLANKING_VALUE and keeps non-password fields', () => {
	const properties = [
		{ name: 'name', type: 'string' },
		{ name: 'value', type: 'string', typeOptions: { password: true } },
		{ name: 'port', type: 'number' },
	];

	const data = { name: 'Authorization', value: 'super-secret-token', port: 8080 };
	const redacted = redactCredentials(data, properties);

	assert.deepEqual(redacted, {
		name: 'Authorization',
		value: CREDENTIAL_BLANKING_VALUE,
		port: 8080,
	});
});

test('12. Redaction: redacts oauthTokenData and csrfSecret automatically', () => {
	const properties = [{ name: 'name', type: 'string' }];
	const data = {
		name: 'Test OAuth',
		oauthTokenData: { access_token: 'tok-123', refresh_token: 'ref-456' },
		csrfSecret: 'csrf-xyz',
	};

	const redacted = redactCredentials(data, properties);
	assert.equal(redacted.name, 'Test OAuth');
	assert.equal(redacted.oauthTokenData, CREDENTIAL_BLANKING_VALUE);
	assert.equal(redacted.csrfSecret, CREDENTIAL_BLANKING_VALUE);
});

test('13. Redaction: handles nested fixedCollection options', () => {
	const properties = [
		{
			name: 'parameters',
			type: 'fixedCollection',
			options: [
				{
					name: 'values',
					values: [
						{ name: 'key', type: 'string' },
						{ name: 'secret', type: 'string', typeOptions: { password: true } },
					],
				},
			],
		},
	];

	const data = {
		parameters: {
			values: [
				{ key: 'param1', secret: 'secret1' },
				{ key: 'param2', secret: 'secret2' },
			],
		},
	};

	const redacted = redactCredentials(data, properties);
	assert.deepEqual(redacted, {
		parameters: {
			values: [
				{ key: 'param1', secret: CREDENTIAL_BLANKING_VALUE },
				{ key: 'param2', secret: CREDENTIAL_BLANKING_VALUE },
			],
		},
	});
});

test('14. Unredaction: restores blanked fields from stored plaintext', () => {
	const stored = {
		name: 'X-Dummy',
		value: 'my-stored-secret',
		nested: { innerSecret: 'nested-secret', publicField: 'pub' },
	};

	const incomingRedacted = {
		name: 'X-Dummy-Renamed',
		value: CREDENTIAL_BLANKING_VALUE,
		nested: { innerSecret: CREDENTIAL_BLANKING_VALUE, publicField: 'new-pub' },
	};

	const unredacted = unredactCredentials(incomingRedacted, stored);
	assert.deepEqual(unredacted, {
		name: 'X-Dummy-Renamed',
		value: 'my-stored-secret',
		nested: { innerSecret: 'nested-secret', publicField: 'new-pub' },
	});
});

test('15. Unredaction: does not overwrite newly provided actual values', () => {
	const stored = { name: 'X-Dummy', value: 'old-secret' };
	const incomingNew = { name: 'X-Dummy', value: 'newly-provided-secret' };

	const unredacted = unredactCredentials(incomingNew, stored);
	assert.deepEqual(unredacted, { name: 'X-Dummy', value: 'newly-provided-secret' });
});

test('16. Overwrites: applies overwrites only when existing value is null, undefined, or empty string', () => {
	const data = {
		host: 'custom.domain.com',
		port: null,
		user: '',
		token: undefined,
	};

	const overwrites = {
		host: 'overwrite.domain.com',
		port: 5432,
		user: 'admin',
		token: 'default-token',
	};

	const merged = applyCredentialOverwrites(data, overwrites);
	assert.deepEqual(merged, {
		host: 'custom.domain.com', // Kept because already set
		port: 5432,
		user: 'admin',
		token: 'default-token',
	});
});

test('17. CredentialsHelper: resolves credential by id first, then by name', () => {
	const helper = new CredentialsHelper();
	helper.registerCredential({ id: 'id-01', name: 'Slack Bot', type: 'slackApi' });
	helper.registerCredential({ id: 'id-02', name: 'id-01', type: 'differentType' });

	// Resolves by ID first
	const byId = helper.findCredential('id-01');
	assert.equal(byId.name, 'Slack Bot');

	// Resolves by name when ID does not match
	const byName = helper.findCredential('Slack Bot');
	assert.equal(byName.id, 'id-01');

	// Throws 404 when not found
	assert.throws(
		() => helper.findCredential('non-existent'),
		(e) => e instanceof CredentialNotFoundError && e.httpStatusCode === 404,
	);
});

test('18. CredentialsHelper: validates declared types and supports inheritance', () => {
	const helper = new CredentialsHelper();
	helper.registerType({ name: 'githubOAuth2Api', extends: ['oAuth2Api'] });

	// Node declaring githubOAuth2Api passes
	assert.doesNotThrow(() => helper.validateCredentialType(['githubOAuth2Api'], 'githubOAuth2Api'));

	// Node declaring base oAuth2Api passes for extended githubOAuth2Api
	assert.doesNotThrow(() => helper.validateCredentialType(['oAuth2Api'], 'githubOAuth2Api'));

	// Undeclared type throws NodeOperationError
	assert.throws(
		() => helper.validateCredentialType(['slackApi'], 'githubOAuth2Api'),
		(e) => e instanceof NodeOperationError && e.message === 'Node does not have credential type "githubOAuth2Api"',
	);
});

test('19. CredentialsHelper: authenticate helper applies header and basic auth', () => {
	const helper = new CredentialsHelper();

	// httpHeaderAuth
	const headerAuth = helper.authenticate(
		{ url: 'https://example.com' },
		{ name: 'X-API-KEY', value: 'secret-val' },
		'httpHeaderAuth',
	);
	assert.deepEqual(headerAuth.headers, { 'X-API-KEY': 'secret-val' });

	// httpBasicAuth
	const basicAuth = helper.authenticate(
		{ url: 'https://example.com' },
		{ user: 'admin', password: 'secretpassword' },
		'httpBasicAuth',
	);
	const expectedToken = Buffer.from('admin:secretpassword').toString('base64');
	assert.equal(basicAuth.headers.Authorization, `Basic ${expectedToken}`);
});

test('20. Reference Golden: validates exact constants and expectations from credentials.golden.json', () => {
	const root = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
	const goldenRaw = readFileSync(join(root, 'tests/reference/agent-4/golden/credentials.golden.json'), 'utf8');
	const golden = JSON.parse(goldenRaw);

	// Check sentinel constants match golden exactly
	assert.equal(golden.constants.CREDENTIAL_BLANKING_VALUE, CREDENTIAL_BLANKING_VALUE);
	assert.equal(golden.constants.CREDENTIAL_EMPTY_VALUE, CREDENTIAL_EMPTY_VALUE);

	// Verify notFound error format
	const notFoundErr = new CredentialNotFoundError('does-not-exist');
	assert.equal(notFoundErr.message, golden.cases.notFound.expected.body.message);
	assert.equal(notFoundErr.httpStatusCode, golden.cases.notFound.expected.status);

	// Verify redaction on golden sample
	const properties = [
		{ name: 'name', type: 'string' },
		{ name: 'value', type: 'string', typeOptions: { password: true } },
	];
	const redacted = redactCredentials({ name: 'X-Dummy', value: 'not-a-real-secret-0000' }, properties);
	assert.deepEqual(redacted, golden.cases.getWithDataIsRedacted.expected.data);

	// Verify unredaction restores original secret
	const unredacted = unredactCredentials(redacted, { name: 'X-Dummy', value: 'not-a-real-secret-0000' });
	assert.equal(unredacted.value, 'not-a-real-secret-0000');
});

test('21. Negative control: wrong key derivation (SHA-256 instead of EVP_BytesToKey MD5) fails decrypt', () => {
	const cipher = new Cipher({ encryptionKey: DUMMY_KEY });
	const payload = { test: 123 };
	const enc = cipher.encrypt(payload);
	const raw = Buffer.from(enc, 'base64');
	const salt = raw.subarray(8, 16);
	const ciphertext = raw.subarray(16);

	// Attempt SHA-256 derivation instead of EVP_BytesToKey MD5
	const wrongKey = createHash('sha256').update(DUMMY_KEY).digest();
	const wrongIv = createHash('sha256').update(salt).digest().subarray(0, 16);
	const decipher = createDecipheriv('aes-256-cbc', wrongKey, wrongIv);

	assert.throws(() => {
		Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	});
});

test('22. Negative control: corrupt ciphertext or wrong prefix is rejected', () => {
	const cipher = new Cipher({ encryptionKey: DUMMY_KEY });
	const payload = { test: 456 };
	const enc = cipher.encrypt(payload);
	const raw = Buffer.from(enc, 'base64');

	// Corrupt the ciphertext bytes
	raw[20] ^= 0xff;
	const corrupted = raw.toString('base64');

	assert.throws(() => cipher.decrypt(corrupted));
});
