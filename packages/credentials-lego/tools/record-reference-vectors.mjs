/**
 * Records reference-produced vectors so the A/B evidence survives a fresh
 * session, where `.runtime/` is absent (it is gitignored and excluded from
 * workspace snapshots).
 *
 * Everything captured here was produced by the REAL n8n 2.9.1 dependency set —
 * never by this port — so `test/06-reference-vectors.test.mjs` can diff the port
 * against it offline.
 *
 * Run: node packages/credentials-lego/tools/record-reference-vectors.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';

import {
	makeReferenceCipher,
	makeReferenceCredentials,
	RUNTIME,
} from '../test/helpers/reference.mjs';

const KEY = 'recorded-vector-key';
const CUSTOM_KEY = 'a-custom-key';

const corePkg = JSON.parse(readFileSync(path.join(RUNTIME, 'n8n-core/package.json'), 'utf8'));

// --- cipher vectors -------------------------------------------------------
const cipherPayloads = [
	{ label: 'flat object', input: { user: 'u', pass: 'p' }, key: KEY },
	{ label: 'empty object', input: {}, key: KEY },
	{ label: 'nested object', input: { a: { b: [1, 2, { c: null }] } }, key: KEY },
	{ label: 'raw string', input: 'plain text', key: KEY },
	{ label: 'unicode payload', input: { name: 'héllo → 世界' }, key: KEY },
	{ label: 'empty string', input: '', key: KEY },
	{ label: 'custom key', input: { token: 't' }, key: CUSTOM_KEY },
];

const cipher = cipherPayloads.map(({ label, input, key }) => {
	const ciphertext = makeReferenceCipher(KEY).encrypt(input, key);
	return {
		label,
		input,
		key,
		ciphertext,
		// The reference's own round-trip is the oracle.
		plaintext: makeReferenceCipher(KEY).decrypt(ciphertext, key),
	};
});

// --- isObjectLiteral acceptance table -------------------------------------
class Instance {
	constructor() {
		this.a = 1;
	}
}

const literalCases = [
	{ kind: 'plain-empty', describe: () => ({}) },
	{ kind: 'plain', describe: () => ({ a: 1 }) },
	{ kind: 'nested-plain', describe: () => ({ a: { b: 1 } }) },
	{ kind: 'array-empty', describe: () => [] },
	{ kind: 'array', describe: () => [1] },
	{ kind: 'null', describe: () => null },
	{ kind: 'undefined', describe: () => undefined },
	{ kind: 'number', describe: () => 1 },
	{ kind: 'string', describe: () => 's' },
	{ kind: 'date', describe: () => new Date('2026-01-02T03:04:05.000Z') },
	{ kind: 'null-prototype', describe: () => Object.create(null) },
	{ kind: 'class-instance', describe: () => new Instance() },
];

const objectLiteral = literalCases.map(({ kind, describe }) => {
	const value = describe();
	const credentials = makeReferenceCredentials({ encryptionKey: KEY });
	try {
		credentials.setData(value);
		return { kind, accepted: true, storedType: typeof credentials.data };
	} catch (error) {
		return { kind, accepted: false, error: error.constructor.name };
	}
});

// --- error messages -------------------------------------------------------
const messages = (() => {
	const empty = makeReferenceCredentials({ encryptionKey: KEY });
	let noData;
	try {
		empty.getData();
	} catch (error) {
		noData = error.message;
	}

	let noDataToSave;
	try {
		empty.getDataToSave();
	} catch (error) {
		noDataToSave = error.message;
	}

	const refCipher = makeReferenceCipher(KEY);
	let decryptionFailed;
	try {
		makeReferenceCredentials({
			encryptionKey: KEY,
			data: Buffer.alloc(32, 7).toString('base64'),
		}).getData();
	} catch (error) {
		decryptionFailed = error.message;
	}

	let invalidJson;
	try {
		makeReferenceCredentials({ encryptionKey: KEY, data: refCipher.encrypt('not json') }).getData();
	} catch (error) {
		invalidJson = error.message;
	}

	return { noData, noDataToSave, decryptionFailed, invalidJson };
})();

// --- getDataToSave shape --------------------------------------------------
const saved = (() => {
	const credentials = makeReferenceCredentials({ encryptionKey: KEY, id: 'cred-1' });
	credentials.setData({ a: 1 });
	const out = credentials.getDataToSave();
	return { keys: Object.keys(out).sort(), dataPrefix: out.data.slice(0, 10) };
})();

const fixture = {
	$comment:
		'Recorded from the real n8n 2.9.4 dependency set (n8n-core 2.9.1). Regenerate with: node packages/credentials-lego/tools/record-reference-vectors.mjs',
	recordedAt: new Date().toISOString(),
	reference: { 'n8n-core': corePkg.version, node: process.versions.node },
	encryptionKey: KEY,
	cipher,
	objectLiteral,
	messages,
	getDataToSave: saved,
};

const outPath = path.resolve(import.meta.dirname, '../fixtures/reference-vectors.json');
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${outPath}`);
console.log(`  cipher vectors: ${cipher.length}`);
console.log(`  objectLiteral cases: ${objectLiteral.length}`);
