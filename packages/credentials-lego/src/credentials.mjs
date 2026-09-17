import nodeAssert from 'node:assert';
import nodeAssertStrict from 'node:assert/strict';

import { ApplicationError, isObjectLiteral, jsonParse } from './support.mjs';

/**
 * Verbatim copy of `packages/core/src/constants.ts` CREDENTIAL_ERRORS.
 * These strings are user-visible, so they are pinned exactly.
 */
export const CREDENTIAL_ERRORS = {
	NO_DATA: 'No data is set on this credentials.',
	DECRYPTION_FAILED:
		'Credentials could not be decrypted. The likely reason is that a different "encryptionKey" was used to encrypt the data.',
	INVALID_JSON: 'Decrypted credentials data is not valid JSON.',
	INVALID_DATA: 'Credentials data is not in a valid format.',
};

/** 1:1 port of `CredentialDataError` (`core/src/credentials.ts`). */
export class CredentialDataError extends ApplicationError {
	constructor(credentials, message, cause) {
		super(message, {
			extra: { name: credentials.name, type: credentials.type, id: credentials.id },
			cause,
		});
	}
}

/**
 * Abstract base mirroring `n8n-workflow`'s `ICredentials`:
 * `id` falls back to `undefined` when the caller omits it, `data` stays
 * `undefined` until `setData` is called.
 */
export class ICredentials {
	constructor(nodeCredentials, type, data) {
		this.id = nodeCredentials?.id ?? undefined;
		this.name = nodeCredentials?.name;
		this.type = type;
		this.data = data;
	}

	/* eslint-disable no-unused-vars */
	getData(nodeType) {
		throw new Error('not implemented');
	}

	getDataToSave() {
		throw new Error('not implemented');
	}

	setData(data) {
		throw new Error('not implemented');
	}
	/* eslint-enable no-unused-vars */
}

/**
 * 1:1 port of `packages/core/src/credentials.ts` (n8n 2.9.4).
 *
 * The only delta is injection: upstream resolves `Container.get(Cipher)`
 * through the `@n8n/di` container, here the cipher is supplied as
 * `deps.cipher` — the same pattern used for `CronJob` in the scheduler LEGO,
 * and what keeps this package dependency-free and unit-testable.
 *
 * K-01  `setData` **asserts** with `node:assert`'s `ok`, so a non-plain object
 *       (array, `Date`, `null`, class instance, null-prototype object) fails
 *       with an `AssertionError`, not a credential error.
 * K-02  `getData` throws `CredentialDataError` with three distinct messages:
 *       NO_DATA when `data` is undefined, DECRYPTION_FAILED when the cipher
 *       throws, INVALID_JSON when the plaintext is not JSON.
 * K-03  `updateData` is decrypt-modify-re-encrypt: it calls `getData()` first,
 *       so updating a credential with no data throws NO_DATA — and every update
 *       mints a **fresh salt** (C-05).
 * K-04  `getDataToSave` throws a plain `ApplicationError`
 *       ('No credentials were set to save.') rather than a `CredentialDataError`,
 *       and therefore carries **no** `extra` payload.
 * K-05  `extra` on a `CredentialDataError` snapshots `{name, type, id}` at throw
 *       time — it is not a live view of the entity.
 */
export class Credentials extends ICredentials {
	constructor(nodeCredentials, type, data, deps = {}) {
		super(nodeCredentials, type, data);
		const cipher = deps.cipher ?? deps.Container?.get?.(CIPHER_TOKEN);
		if (!cipher) {
			throw new TypeError('Credentials requires deps.cipher (upstream: Container.get(Cipher))');
		}
		this.cipher = cipher;
	}

	setData(data) {
		// K-01: upstream uses `a.ok(...)`, i.e. node:assert's loose ok.
		nodeAssert.ok(isObjectLiteral(data));
		this.data = this.cipher.encrypt(data);
	}

	updateData(toUpdate, toDelete = []) {
		const updatedData = { ...this.getData(), ...toUpdate };
		for (const key of toDelete) delete updatedData[key];
		this.setData(updatedData);
	}

	getData() {
		if (this.data === undefined) {
			throw new CredentialDataError(this, CREDENTIAL_ERRORS.NO_DATA); // K-02
		}

		let decryptedData;
		try {
			decryptedData = this.cipher.decrypt(this.data);
		} catch (cause) {
			throw new CredentialDataError(this, CREDENTIAL_ERRORS.DECRYPTION_FAILED, cause);
		}

		try {
			return jsonParse(decryptedData);
		} catch (cause) {
			throw new CredentialDataError(this, CREDENTIAL_ERRORS.INVALID_JSON, cause);
		}
	}

	getDataToSave() {
		if (this.data === undefined) {
			throw new ApplicationError('No credentials were set to save.'); // K-04
		}

		return {
			id: this.id,
			name: this.name,
			type: this.type,
			data: this.data,
		};
	}
}

/** Token used when a caller supplies a DI-like container instead of a cipher. */
export const CIPHER_TOKEN = Symbol('n8n-reconstructed/Cipher');

/** Re-exported so consumers can build their own strict assertions. */
export const assert = nodeAssertStrict;
