/**
 * Validation LEGO — public surface (the seam).
 *
 * What downstream LEGOs (01 Workflow, 02 Node Model, 05 Execution Runner) and the future Rust
 * implementation consume. Nothing else of this package is part of the boundary.
 *
 * PHASE 2 STATUS
 *   - type-validation / type-guards / schemas are bound 1:1 to the pinned reference runtime
 *     (n8n-workflow@2.9.1, the artifact n8n 2.9.4 ships) — no algorithm rewritten.
 *   - rules/ is the NEW opt-in capability from ISSUE-003 Option A (standalone TS, zero imports).
 *   - RUST IMPLEMENTATION: NOT STARTED (spec: docs/isolation/validation-rust-port-spec.md).
 */
import { typeValidation, typeGuards, schemas } from './adapters/reference/index.ts';

// --- type-validation.ts (reference, 1:1) ---
export const validateFieldType = typeValidation.validateFieldType;
export const tryToParseNumber = typeValidation.tryToParseNumber;
export const tryToParseString = typeValidation.tryToParseString;
export const tryToParseAlphanumericString = typeValidation.tryToParseAlphanumericString;
export const tryToParseBoolean = typeValidation.tryToParseBoolean;
export const tryToParseDateTime = typeValidation.tryToParseDateTime;
export const tryToParseTime = typeValidation.tryToParseTime;
export const tryToParseArray = typeValidation.tryToParseArray;
export const tryToParseObject = typeValidation.tryToParseObject;
export const tryToParseUrl = typeValidation.tryToParseUrl;
export const tryToParseJwt = typeValidation.tryToParseJwt;
export const getValueDescription = typeValidation.getValueDescription;

// --- type-guards.ts (reference, 1:1; the 11 barrel-public guards) ---
export const isINodeProperties = typeGuards.isINodeProperties;
export const isINodePropertyOptions = typeGuards.isINodePropertyOptions;
export const isINodePropertyCollection = typeGuards.isINodePropertyCollection;
export const isINodePropertiesList = typeGuards.isINodePropertiesList;
export const isINodePropertyOptionsList = typeGuards.isINodePropertyOptionsList;
export const isINodePropertyCollectionList = typeGuards.isINodePropertyCollectionList;
export const isResourceMapperValue = typeGuards.isResourceMapperValue;
export const isResourceLocatorValue = typeGuards.isResourceLocatorValue;
export const isFilterValue = typeGuards.isFilterValue;
export const isNodeConnectionType = typeGuards.isNodeConnectionType;
export const isBinaryValue = typeGuards.isBinaryValue;

// --- schemas.ts (reference, 1:1; 45 zod schemas) ---
export { schemas };
export const INodeSchema = schemas.INodeSchema;
export const INodesSchema = schemas.INodesSchema;
export const INodeParametersSchema = schemas.INodeParametersSchema;
export const NodeConnectionTypeSchema = schemas.NodeConnectionTypeSchema;
export const FieldTypeSchema = schemas.FieldTypeSchema;
export const OnErrorSchema = schemas.OnErrorSchema;

// --- rules (NEW capability, ISSUE-003 Option A) ---
export { validateWorkflow, checkNodeUniqueness, checkDanglingConnections, detectCycles, NODE_CONNECTION_TYPES } from './rules/workflow-rules.ts';
export type { ValidationReport, ValidationError, ValidationErrorCode, ValidateWorkflowOptions } from './rules/workflow-rules.ts';
