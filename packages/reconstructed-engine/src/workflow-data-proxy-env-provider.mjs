/**
 * Environment provider used by `WorkflowDataProxy.$env`.
 *
 * Source: reference/n8n/packages/workflow/src/workflow-data-proxy-env-provider.ts
 * Ported from n8n 2.9.4 by Agent 2 (reconstructed-engine LEGO, task POOL-002-R1).
 *
 * The whole point of this module is that expression code never sees `process.env`:
 * the state is snapshotted once, and every property read on the proxy goes through
 * the block check. `N8N_BLOCK_ENV_ACCESS_IN_NODE !== 'false'` means access is blocked
 * by default, i.e. unless an instance explicitly opts in.
 */

import { ExpressionError } from './errors.mjs';

/**
 * reference: workflow-data-proxy-env-provider.ts:12-27
 * @returns {{isProcessAvailable: boolean, isEnvAccessBlocked: boolean, env: Record<string, string>}}
 */
export function createEnvProviderState() {
	// reference reads the live process.env here; the reconstruction keeps that
	// verbatim because the whole safety property is *which* snapshot is taken, not
	// where it comes from. Tests that need the other branch set the env var.
	const env = typeof process !== 'undefined' ? process.env : undefined;
	const isProcessAvailable = env !== undefined;
	const isEnvAccessBlocked = isProcessAvailable ? env.N8N_BLOCK_ENV_ACCESS_IN_NODE !== 'false' : false;
	const safeEnv = !isProcessAvailable || isEnvAccessBlocked ? {} : env;

	return {
		isProcessAvailable,
		isEnvAccessBlocked,
		env: safeEnv,
	};
}

/**
 * reference: workflow-data-proxy-env-provider.ts:41-72
 * @param {number} runIndex
 * @param {number} itemIndex
 * @param {{isProcessAvailable: boolean, isEnvAccessBlocked: boolean, env: Record<string, string>}} providerState
 * @returns {Record<string, string>} a proxy: every read is checked, `in` always answers true
 */
export function createEnvProvider(runIndex, itemIndex, providerState) {
	return new Proxy(
		{},
		{
			has() {
				return true;
			},

			get(_, name) {
				if (name === 'isProxy') return true;

				if (!providerState.isProcessAvailable) {
					throw new ExpressionError('not accessible via UI, please run node', {
						runIndex,
						itemIndex,
					});
				}
				if (providerState.isEnvAccessBlocked) {
					throw new ExpressionError('access to env vars denied', {
						causeDetailed:
							'If you need access please contact the administrator to remove the environment variable ‘N8N_BLOCK_ENV_ACCESS_IN_NODE‘',
						runIndex,
						itemIndex,
					});
				}

				return providerState.env[name.toString()];
			},
		},
	);
}
