/**
 * @lego/validation — Validation LEGO.
 *
 * Phase 3 pure TypeScript reconstruction of n8n 2.9.4 schema and type validation:
 *   - parameter type validation & parsing (type-validation.ts)
 *   - parameter and structural type guards (type-guards.ts)
 *   - Zod runtime schemas mirroring interfaces 1:1 (schemas.ts)
 *   - rule enforcement: NodeUniqueness, DanglingConnections, CycleDetection (workflow-rules.ts)
 *
 * Conforms to contracts/validation.contract.md §10.
 */

export * from './type-validation';
export * from './type-guards';
export * from './schemas';
export * from './workflow-rules';
export { ApplicationError, type ApplicationErrorOptions } from './errors';
export { jsonParse, type JSONParseOptions } from './utils';
export * from './interfaces';
