/**
 * `$secrets` proxy — reconstructed 1:1 from the pinned reference (n8n 2.9.4).
 *
 * Source:
 *   packages/core/src/execution-engine/node-execution-context/utils/get-secrets-proxy.ts:3-34 (buildSecretsValueProxy)
 *   packages/core/src/execution-engine/node-execution-context/utils/get-secrets-proxy.ts:36-83 (getSecretsProxy)
 *
 * Why this is ported even though the secret *stores* are not: the reference's
 * security boundary lives here, in the proxy, not in the store. A workflow can only
 * ever see a secret if `externalSecretsProxy.hasSecret()` says so, writes are
 * refused by `set() { return false }`, and enumeration is answered by the store
 * rather than by the object. Re-implementing that in the Rust port is mandatory;
 * reimplementing Vault/1Password itself is not.
 *
 * The only injected dependency is `additionalData.externalSecretsProxy`, which the
 * host supplies (methods: hasProvider, hasSecret, getSecret, listProviders,
 * listSecrets). Nothing here reads files, env or the network.
 */

import { ExpressionError } from './errors.mjs';

/** The reference message pair — distinct on purpose: one is "value missing", the other "store unreachable". */
const COULD_NOT_LOAD = 'Could not load secrets';

/** get-secrets-proxy.ts:3-24 */
function buildSecretsValueProxy(value) {
	return new Proxy(value, {
		get(_target, valueName) {
			if (typeof valueName !== 'string') {
				return;
			}
			if (!(valueName in value)) {
				throw new ExpressionError(COULD_NOT_LOAD, {
					description: 'The credential in use tries to use secret from an external store that could not be found',
				});
			}
			const retValue = value[valueName];
			if (typeof retValue === 'object' && retValue !== null) {
				return buildSecretsValueProxy(retValue);
			}
			return retValue;
		},
	});
}

/**
 * get-secrets-proxy.ts:36-83
 * @param {{externalSecretsProxy?: {hasProvider(n:string):boolean,hasSecret(p:string,n:string):boolean,getSecret(p:string,n:string):unknown,listProviders():string[],listSecrets(p:string):string[]}}} additionalData
 */
export function getSecretsProxy(additionalData) {
	const { externalSecretsProxy } = additionalData;
	return new Proxy(
		{},
		{
			get(_target, providerName) {
				if (typeof providerName !== 'string') {
					return {};
				}
				if (externalSecretsProxy.hasProvider(providerName)) {
					return new Proxy(
						{},
						{
							get(_target2, secretName) {
								if (typeof secretName !== 'string') {
									return;
								}
								if (!externalSecretsProxy.hasSecret(providerName, secretName)) {
									throw new ExpressionError(COULD_NOT_LOAD, {
										description:
											'The credential in use tries to use secret from an external store that could not be found',
									});
								}
								const retValue = externalSecretsProxy.getSecret(providerName, secretName);
								if (typeof retValue === 'object' && retValue !== null) {
									return buildSecretsValueProxy(retValue);
								}
								return retValue;
							},
							// A workflow must never be able to write a secret.
							set() {
								return false;
							},
							ownKeys() {
								return externalSecretsProxy.listSecrets(providerName);
							},
						},
					);
				}
				throw new ExpressionError(COULD_NOT_LOAD, {
					description: 'The credential in use pulls secrets from an external store that is not reachable',
				});
			},
			set() {
				return false;
			},
			ownKeys() {
				return externalSecretsProxy.listProviders();
			},
		},
	);
}
