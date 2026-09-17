/**
 * Additional keys for expressions ($execution / $vars / $secrets) —
 * reconstructed 1:1 from the pinned reference (n8n 2.9.4).
 *
 * Provenance:
 *   packages/core/src/execution-engine/node-execution-context/utils/get-additional-keys.ts:19-78
 *   packages/core/src/constants.ts:2                                PLACEHOLDER_EMPTY_EXECUTION_ID
 *   packages/core/src/execution-engine/node-execution-context/utils/get-secrets-proxy.ts
 *     → ported in ./get-secrets-proxy.mjs, so $secrets is REAL here; the external
 *       secret stores behind `additionalData.externalSecretsProxy` are host-injected
 *       and belong to the credentials LEGO.
 *
 * `options.secretsEnabled === false` yields `$secrets: undefined` — that is the
 * reference's own behaviour, not a gap: the key exists so `'x' in $execution`-style
 * checks and the sandbox key set match n8n exactly.
 */

import { getSecretsProxy } from './get-secrets-proxy.mjs';
import {
	getAllWorkflowExecutionMetadata,
	getWorkflowExecutionMetadata,
	setAllWorkflowExecutionMetadata,
	setWorkflowExecutionMetadata,
} from './execution-metadata.mjs';

/** packages/core/src/constants.ts:2 */
export const PLACEHOLDER_EMPTY_EXECUTION_ID = '__UNKNOWN__';

/** get-additional-keys.ts:19 */
export function getAdditionalKeys(additionalData, mode, runExecutionData, options) {
	const executionId = additionalData.executionId ?? PLACEHOLDER_EMPTY_EXECUTION_ID;
	const resumeUrl = `${additionalData.webhookWaitingBaseUrl}/${executionId}`;
	const resumeFormUrl = `${additionalData.formWaitingBaseUrl}/${executionId}`;
	return {
		$execution: {
			id: executionId,
			mode: mode === 'manual' ? 'test' : 'production',
			resumeUrl,
			resumeFormUrl,
			customData: runExecutionData
				? {
						set(key, value) {
							try {
								setWorkflowExecutionMetadata(runExecutionData, key, value);
							} catch (e) {
								if (mode === 'manual') {
									throw e;
								}
								// reference: LoggerProxy.debug(e.message) — no behaviour branches on it
							}
						},
						setAll(obj) {
							try {
								setAllWorkflowExecutionMetadata(runExecutionData, obj);
							} catch (e) {
								if (mode === 'manual') {
									throw e;
								}
							}
						},
						get(key) {
							return getWorkflowExecutionMetadata(runExecutionData, key);
						},
						getAll() {
							return getAllWorkflowExecutionMetadata(runExecutionData);
						},
					}
				: undefined,
		},
		$vars: additionalData.variables,
		// get-additional-keys.ts:69/87 — the proxy itself is ported (see
		// ./get-secrets-proxy.mjs); the SECRET STORES behind externalSecretsProxy are
		// host-injected and belong to the credentials LEGO. `undefined` when disabled
		// is the reference's own behaviour, not a gap.
		$secrets: options?.secretsEnabled ? getSecretsProxy(additionalData) : undefined,

		// deprecated
		$executionId: executionId,
		$resumeWebhookUrl: resumeUrl,
	};
}

/** get-additional-keys.ts:85 */
export function getNonWorkflowAdditionalKeys(additionalData, options) {
	return {
		$vars: additionalData.variables,
		// get-additional-keys.ts:69/87 — the proxy itself is ported (see
		// ./get-secrets-proxy.mjs); the SECRET STORES behind externalSecretsProxy are
		// host-injected and belong to the credentials LEGO. `undefined` when disabled
		// is the reference's own behaviour, not a gap.
		$secrets: options?.secretsEnabled ? getSecretsProxy(additionalData) : undefined,
	};
}
