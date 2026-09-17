
/**
 * @lego/validation — Validation LEGO (Phase 2 structural isolation)
 */

export * from './type-validation';
export * from './type-guards';
export * from './schemas';
export * from './workflow-validation';
export * from './node-validation';

export interface ValidationError {
  code: 'DUPLICATE_NODE_NAME' | 'DANGLING_CONNECTION' | 'INVALID_CONNECTION_TYPE' | 'CYCLE_DETECTED' | 'INVALID_INPUT';
  message: string;
  node?: string;
  path?: string[];
}

export const LEGO_PROVENANCE = {
  lego: 'validation',
  phase: 'phase-2-isolation',
  referenceVersion: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  behaviorChange: 'none-detected',
  rustImplementation: 'not-started',
} as const;
