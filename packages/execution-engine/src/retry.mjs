/**
 * Retry policy — POOL-003 (error/retry handling).
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/core/src/execution-engine/workflow-execute.ts L1597-1612
 *
 * Verbatim semantics, including the hard-coded clamps that the reference source
 * itself marks as TODO ("Remove the hardcoded default-values here and also in
 * NodeSettings.vue"):
 *
 *   maxTries        = retryOnFail === true ? min(5, max(2, node.maxTries || 3)) : 1
 *   waitBetweenTries = retryOnFail === true ? min(5000, max(0, node.waitBetweenTries || 1000)) : 0
 *
 * Note the `||` (not `??`): `maxTries: 0` and `waitBetweenTries: 0` fall back to
 * the default **only** for `maxTries` (0 is falsy → 3 → clamped to 3), while
 * `waitBetweenTries: 0` also falls back to 1000. Passing 0 for "no wait" is
 * therefore not possible through the node settings — same as upstream.
 */

export const RETRY_LIMITS = Object.freeze({
	maxTriesDefault: 3,
	maxTriesMin: 2,
	maxTriesMax: 5,
	waitBetweenTriesDefault: 1000,
	waitBetweenTriesMin: 0,
	waitBetweenTriesMax: 5000,
});

export function resolveRetryPolicy(node = {}) {
	if (node.retryOnFail !== true) {
		return { maxTries: 1, waitBetweenTries: 0, retryOnFail: false };
	}

	const { maxTriesDefault, maxTriesMin, maxTriesMax, waitBetweenTriesDefault, waitBetweenTriesMin, waitBetweenTriesMax } =
		RETRY_LIMITS;

	return {
		retryOnFail: true,
		maxTries: Math.min(maxTriesMax, Math.max(maxTriesMin, node.maxTries || maxTriesDefault)),
		waitBetweenTries: Math.min(
			waitBetweenTriesMax,
			Math.max(waitBetweenTriesMin, node.waitBetweenTries || waitBetweenTriesDefault),
		),
	};
}

/** `sleep` from n8n-workflow (packages/workflow/src/utils.ts). */
export function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Runs `attempt` under a resolved retry policy. The engine itself drives retries
 * inline (to stay byte-for-byte with the loop); this helper exists for node
 * authors and for unit-testing the policy in isolation.
 *
 * `attempt` receives the 0-based try index and must throw to signal a hard
 * failure, or return a soft-failure payload for the engine to detect.
 */
export async function withRetry(node, attempt, { onRetry } = {}) {
	const { maxTries, waitBetweenTries } = resolveRetryPolicy(node);
	let lastError;
	let lastResult;

	for (let tryIndex = 0; tryIndex < maxTries; tryIndex++) {
		if (tryIndex !== 0 && waitBetweenTries !== 0) await sleep(waitBetweenTries);
		try {
			lastResult = await attempt(tryIndex);
			lastError = undefined;
			return { result: lastResult, tryIndex, attempts: tryIndex + 1 };
		} catch (error) {
			lastError = error;
			onRetry?.({ tryIndex, error, maxTries, waitBetweenTries });
		}
	}

	return { error: lastError, attempts: maxTries, exhausted: true };
}
