import { NodeOperationError, CredentialNotFoundError } from './errors.mjs';
import { applyCredentialOverwrites } from './overwrites.mjs';

export class CredentialsHelper {
	constructor(options = {}) {
		this.store = options.store ?? new Map();
		this.typeRegistry = options.typeRegistry ?? new Map();
		this.overwrites = options.overwrites ?? {};
		this.cipher = options.cipher;
	}

	registerCredential(entity) {
		this.store.set(entity.id, entity);
	}

	registerType(typeDef) {
		this.typeRegistry.set(typeDef.name, typeDef);
	}

	findCredential(idOrName, type) {
		if (this.store.has(idOrName)) {
			const cred = this.store.get(idOrName);
			if (type && cred.type !== type) {
				throw new CredentialNotFoundError(idOrName, type);
			}
			return cred;
		}

		for (const cred of this.store.values()) {
			if (cred.name === idOrName) {
				if (type && cred.type !== type) {
					throw new CredentialNotFoundError(idOrName, type);
				}
				return cred;
			}
		}

		throw new CredentialNotFoundError(idOrName, type);
	}

	validateCredentialType(nodeDeclaredTypes = [], credentialType) {
		if (!nodeDeclaredTypes.includes(credentialType)) {
			const typeDef = this.typeRegistry.get(credentialType);
			const extendsTypes = typeDef?.extends ?? [];
			const matches = extendsTypes.some((ext) => nodeDeclaredTypes.includes(ext));
			if (!matches) {
				throw new NodeOperationError(
					`Node does not have credential type "${credentialType}"`,
				);
			}
		}
	}

	authenticate(requestOptions, credentialData, credentialType) {
		const opts = { ...requestOptions };
		opts.headers = { ...(opts.headers ?? {}) };

		if (credentialType === 'httpHeaderAuth') {
			if (credentialData?.name && credentialData?.value) {
				opts.headers[credentialData.name] = credentialData.value;
			}
		} else if (credentialType === 'httpBasicAuth') {
			if (credentialData?.user && credentialData?.password) {
				const token = Buffer.from(
					`${credentialData.user}:${credentialData.password}`,
				).toString('base64');
				opts.headers.Authorization = `Basic ${token}`;
			}
		}

		return opts;
	}
}
