/**
 * OFFLINE A/B EVIDENCE — recorded reference vectors.
 *
 * `04-parity.test.mjs` diffs against the live reference runtime, which is
 * gitignored and excluded from workspace snapshots: a fresh session would have
 * no A/B evidence at all (see the agent-2 advisory, POOL-002-R1).
 *
 * These vectors were produced by the REAL n8n-core 2.9.1 and committed under
 * `fixtures/`, so the differential claim stays provable offline. Regenerate with
 * `node packages/credentials-lego/tools/record-reference-vectors.mjs`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { Cipher } from '../src/cipher.mjs';
import { CREDENTIAL_ERRORS, Credentials } from '../src/credentials.mjs';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/reference-vectors.json');
const vectors = JSON.parse(readFileSync(FIXTURE, 'utf8'));

const cipher = () => new Cipher({ encryptionKey: vectors.encryptionKey });

test('the recorded vectors really came from the pinned reference build', () => {
	assert.equal(vectors.reference['n8n-core'], '2.9.1');
	assert.ok(vectors.cipher.length >= 5);
	assert.ok(vectors.objectLiteral.length >= 10);
});

test('the port decrypts every ciphertext the reference encrypted', () => {
	for (const vector of vectors.cipher) {
		assert.equal(
			cipher().decrypt(vector.ciphertext, vector.key),
			vector.plaintext,
			`vector "${vector.label}"`,
		);
	}
});

test('the port re-encrypts to a readable envelope for every recorded payload', () => {
	for (const vector of vectors.cipher) {
		const blob = cipher().encrypt(vector.input, vector.key);
		assert.equal(cipher().decrypt(blob, vector.key), vector.plaintext, vector.label);
		assert.ok(blob.startsWith('U2FsdGVkX1'));
	}
});

/** Rebuilds the value a recorded `kind` stands for. */
function valueFor(kind) {
	switch (kind) {
		case 'plain-empty':
			return {};
		case 'plain':
			return { a: 1 };
		case 'nested-plain':
			return { a: { b: 1 } };
		case 'array-empty':
			return [];
		case 'array':
			return [1];
		case 'null':
			return null;
		case 'undefined':
			return undefined;
		case 'number':
			return 1;
		case 'string':
			return 's';
		case 'date':
			return new Date('2026-01-02T03:04:05.000Z');
		case 'null-prototype':
			return Object.create(null);
		case 'class-instance': {
			class Instance {
				constructor() {
					this.a = 1;
				}
			}
			return new Instance();
		}
		default:
			throw new Error(`unknown recorded kind: ${kind}`);
	}
}

test('setData accepts exactly the values the reference accepted', () => {
	for (const entry of vectors.objectLiteral) {
		const credentials = new Credentials({ id: 'cred-1', name: 'n' }, 'httpHeaderAuth', undefined, {
			cipher: cipher(),
		});
		let mine;
		try {
			credentials.setData(valueFor(entry.kind));
			mine = { accepted: true, storedType: typeof credentials.data };
		} catch (error) {
			mine = { accepted: false, error: error.constructor.name };
		}
		assert.deepEqual(
			mine,
			{ accepted: entry.accepted, ...(entry.accepted ? { storedType: entry.storedType } : { error: entry.error }) },
			`isObjectLiteral divergence for "${entry.kind}"`,
		);
	}
});

test('the recorded error messages are the ones the port raises', () => {
	assert.equal(vectors.messages.noData, CREDENTIAL_ERRORS.NO_DATA);
	assert.equal(vectors.messages.decryptionFailed, CREDENTIAL_ERRORS.DECRYPTION_FAILED);
	assert.equal(vectors.messages.invalidJson, CREDENTIAL_ERRORS.INVALID_JSON);
	assert.equal(vectors.messages.noDataToSave, 'No credentials were set to save.');

	const empty = new Credentials({ id: 'cred-1', name: 'n' }, 'httpHeaderAuth', undefined, {
		cipher: cipher(),
	});
	assert.throws(() => empty.getData(), { message: vectors.messages.noData });
	assert.throws(() => empty.getDataToSave(), { message: vectors.messages.noDataToSave });
	assert.throws(
		() =>
			new Credentials({ id: 'cred-1', name: 'n' }, 't', Buffer.alloc(32, 7).toString('base64'), {
				cipher: cipher(),
			}).getData(),
		{ message: vectors.messages.decryptionFailed },
	);
	assert.throws(
		() =>
			new Credentials({ id: 'cred-1', name: 'n' }, 't', cipher().encrypt('not json'), {
				cipher: cipher(),
			}).getData(),
		{ message: vectors.messages.invalidJson },
	);
});

test('getDataToSave matches the recorded shape', () => {
	const credentials = new Credentials({ id: 'cred-1', name: 'My credential' }, 'httpHeaderAuth', undefined, {
		cipher: cipher(),
	});
	credentials.setData({ a: 1 });
	const saved = credentials.getDataToSave();
	assert.deepEqual(Object.keys(saved).sort(), vectors.getDataToSave.keys);
	assert.equal(saved.data.slice(0, 10), vectors.getDataToSave.dataPrefix);
});
