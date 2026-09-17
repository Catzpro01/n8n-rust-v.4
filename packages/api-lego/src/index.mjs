/**
 * `@n8n-reconstructed/api-lego` (POOL-008)
 *
 * 1:1 reconstruction of the **pure** n8n 2.9.4 REST response core:
 *
 *   errors.mjs           ResponseError + subclasses, NodeApiError
 *   response-helper.mjs  send / sendSuccessResponse / sendErrorResponse /
 *                        isResponseError / isUniqueConstraintError / reportError
 *   health.mjs           /healthz and /healthz/readiness payloads
 *
 * Zero runtime dependencies (node:stream only). No Rust, per PROJECT_RULES
 * rule 1. `reference/n8n/**` is read-only and untouched.
 *
 * EVIDENCE NOTE: this LEGO has **no A/B surface** — `@n8n/api-types` and
 * `express` are not part of the pinned `.runtime` dependency set, so there is
 * no reference implementation to diff against. It is verified by golden
 * conformance (`tests/reference/agent-4/golden/api.golden.json`) and by
 * mutation testing, and it claims no parity it cannot show.
 */

export * from './errors.mjs';
export * from './response-helper.mjs';
export * from './health.mjs';
