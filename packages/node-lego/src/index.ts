/**
 * @lego/node — Node Model LEGO (Phase 2 structural isolation)
 *
 * OWNERSHIP:
 *   owns         : node-helpers.ts, versioned-node-type.ts, node-validation.ts, node-parameters/**
 *   does NOT own : workflow.ts, interfaces.ts (shared kernel), execution, persistence
 *
 * This LEGO owns the definition surface of a node: identity, type/version,
 * parameter schema & values, input/output definitions, metadata, configuration/display rules,
 * issues, and the lifecycle interface a node implements.
 *
 * Reference: n8n 2.9.4, n8n-workflow@2.9.1
 */

export * from './node-helpers';
export { VersionedNodeType } from './versioned-node-type';
export { validateNodeCredentials, isNodeConnected, isTriggerLikeNode } from './node-validation';
export * from './node-parameters/filter-parameter';
export * from './node-parameters/parameter-type-validation';
export * from './node-parameters/node-parameter-value-type-guard';
export * from './node-parameters/path-utils';
export { renameFormFields } from './node-parameters/rename-node-utils';

// Re-export for boundary compatibility
export const NODE_MODEL_BOUNDARY = {
  ownedFiles: [
    'node-helpers.ts',
    'versioned-node-type.ts',
    'node-validation.ts',
    'node-parameters/filter-parameter.ts',
    'node-parameters/parameter-type-validation.ts',
    'node-parameters/node-parameter-value-type-guard.ts',
    'node-parameters/path-utils.ts',
    'node-parameters/rename-node-utils.ts',
  ],
  sharedKernel: ['interfaces.ts', 'constants.ts', 'errors/**', 'utils.ts'],
  ports: {
    'P-WORKFLOW': 'Workflow model (type-only)',
    'P-EXPRESSION': 'Expression evaluator (type-only)',
  },
} as const;

export const LEGO_PROVENANCE = {
  lego: 'node',
  phase: 'phase-2-isolation',
  referenceVersion: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  behaviorChange: 'none-detected',
  rustImplementation: 'not-started',
} as const;
