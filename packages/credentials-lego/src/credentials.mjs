import { Cipher } from './cipher.mjs';
import { CREDENTIAL_ERRORS } from './constants.mjs';
import { CredentialDataError, ApplicationError } from './errors.mjs';

function isObjectLiteral(val) {
	return (
		val !== null &&
		typeof val === 'object' &&
		(Object.getPrototypeOf(val) === Object.prototype || Object.getPrototypeOf(val) === null)
	);
}

export class Credentials {
	constructor(details, type, data, cipher) {
		this.id = details?.id ?? '';
		this.name = details?.name ?? '';
		this.type = type;
		this.data = data;
		this.cipher = cipher ?? new Cipher();
	}

	setCipher(cipher) {
		this.cipher = cipher;
	}

	setData(data) {
		if (!isObjectLiteral(data)) {
			throw new Error('Data must be an object literal');
		}
		this.data = this.cipher.encrypt(data);
	}

	updateData(toUpdate, toDelete = []) {
		const current = this.getData();
		const updated = { ...current, ...toUpdate };
		for (const k of toDelete) {
			delete updated[k];
		}
		this.setData(updated);
	}

	getData() {
		if (this.data === undefined) {
			throw new CredentialDataError(this, CREDENTIAL_ERRORS.NO_DATA);
		}

		let decrypted;
		try {
			decrypted = this.cipher.decrypt(this.data);
		} catch (cause) {
			throw new CredentialDataError(this, CREDENTIAL_ERRORS.DECRYPTION_FAILED, cause);
		}

		try {
			return JSON.parse(decrypted);
		} catch (cause) {
			throw new CredentialDataError(this, CREDENTIAL_ERRORS.INVALID_JSON, cause);
		}
	}

	getDataToSave() {
		if (this.data === undefined) {
			throw new ApplicationError('No credentials were set to save.');
		}
		return {
			id: this.id,
			name: this.name,
			type: this.type,
			data: this.data,
		};
	}
}
