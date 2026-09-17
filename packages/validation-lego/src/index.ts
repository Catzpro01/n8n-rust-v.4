/**
 * @lego/validation — Validation LEGO (module 04, Phase 2 structural isolation).
 *
 * OWNERSHIP (manifest/ownership.json)
 *   owns         : type-validation, type-guards, schemas (1:1 from the pinned runtime) + rules/ (opt-in enforcement)
 *   does NOT own : node-parameter validation (LEGO 02), graph traversal (LEGO 01), execution, expression, persistence
 *
 * ENTRY POINTS
 *   ./validation-surface  the public seam downstream LEGOs may consume
 *   ./ports               the declared outer boundary
 */
export * from './validation-surface.ts';
export { referencePackage } from './ports/runtime.ts';
export const LEGO_PROVENANCE = {
	lego: 'validation',
	module: '04',
	phase: 'phase-2-isolation',
	referenceVersion: '2.9.4',
	referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
	behaviorChange: 'none-detected (229+352+1125 recorded fixtures re-executed)',
	newCapability: 'rules/workflow-rules.ts (ISSUE-003 Option A, opt-in)',
	rustImplementation: 'not-started',
} as const;
