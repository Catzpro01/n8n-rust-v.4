/**
 * 1:1 port of:
 *   - reference/n8n/packages/@n8n/db/src/utils/generators.ts      (generateHostInstanceId)
 *   - reference/n8n/packages/@n8n/utils/src/workflowId.ts         (generateNanoId)
 *   - reference/n8n/packages/@n8n/constants/src/index.ts L130     (NANOID_ALPHABET pin)
 *
 * `customAlphabet` is the REAL nanoid@3.3.8 implementation (pnpm catalog pin of
 * n8n@2.9.4) consumed read-only — the RNG wiring is owned by that pinned package,
 * the alphabet + length are owned below, exactly as upstream.
 */

/**
 * PIN (kernel snapshot): packages/@n8n/constants/src/index.ts:130
 *   export const NANOID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
 */
export const NANOID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

import { customAlphabet } from '../consumed.mjs';

/**
 * Generates a unique 16-character nanoid.
 *
 * This is the canonical ID generator used across the entire n8n codebase for:
 * - Workflow IDs
 * - Project IDs
 * - Variable IDs
 * - API Key IDs
 * - And other entity IDs
 *
 * Both frontend and backend MUST use this function to ensure consistency.
 *
 * @returns A 16-character ID
 */
export const generateNanoId = customAlphabet(NANOID_ALPHABET, 16);

/**
 * 1:1 port of @n8n/db utils/generators.ts.
 * instanceType comes from @n8n/constants (e.g. 'main' | 'webhook' | 'worker').
 */
export function generateHostInstanceId(instanceType) {
	return `${instanceType}-${generateNanoId()}`;
}
