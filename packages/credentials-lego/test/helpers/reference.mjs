/**
 * Loads the **real** n8n 2.9.4 dependency set from `.runtime/node_modules` so
 * the parity suite can drive this port and the reference side by side.
 *
 * Nothing here is imported by `src/**` — the LEGO itself stays dependency-free.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export const RUNTIME = path.resolve(import.meta.dirname, '../../../../.runtime/node_modules');

export const REFERENCE_AVAILABLE = existsSync(path.join(RUNTIME, 'n8n-core'));

/** Value for node:test's `{ skip }` option — `false` when the runtime is there. */
export const skip = REFERENCE_AVAILABLE
	? false
	: '.runtime/node_modules is missing — run: bash scripts/setup-reference-runtime.sh';

/**
 * Returns `{ core, di, Cipher, Credentials }` from the pinned reference build.
 */
export function loadReference() {
	if (!REFERENCE_AVAILABLE) {
		throw new Error(`reference runtime not installed at ${RUNTIME}`);
	}
	const require = createRequire(path.join(RUNTIME, 'noop.js'));
	const core = require('n8n-core');
	const di = require('@n8n/di');
	return { core, di, Cipher: core.Cipher, Credentials: core.Credentials };
}

/**
 * `Credentials` resolves its cipher through the DI container
 * (`Container.get(Cipher)`), so a real `Cipher` has to be registered before the
 * reference class can be constructed.
 */
export function makeReferenceCipher(encryptionKey) {
	const { Cipher } = loadReference();
	return new Cipher({ encryptionKey });
}

export function makeReferenceCredentials({
	encryptionKey = 'test-encryption-key',
	id = 'cred-1',
	name = 'My credential',
	type = 'httpHeaderAuth',
	data = undefined,
} = {}) {
	const { di, Cipher, Credentials } = loadReference();
	di.Container.set(Cipher, new Cipher({ encryptionKey }));
	return new Credentials({ id, name }, type, data);
}

/** The httpHeaderAuth credential type properties, taken from the reference. */
export const HTTP_HEADER_AUTH_PROPERTIES = [
	{ displayName: 'Name', name: 'name', type: 'string', default: '' },
	{
		displayName: 'Value',
		name: 'value',
		type: 'string',
		typeOptions: { password: true },
		default: '',
	},
	{
		displayName: 'To send multiple headers, use a "Custom Auth" credential instead',
		name: 'useCustomAuth',
		type: 'notice',
		default: '',
	},
];
