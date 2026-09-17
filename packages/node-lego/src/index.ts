
export * from './node-helpers';
export * from './node-validation';
export { VersionedNodeType } from './versioned-node-type';

export const LEGO_PROVENANCE = {
  lego: 'node',
  phase: 'phase-2-isolation',
  referenceVersion: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  behaviorChange: 'none-detected',
  rustImplementation: 'not-started',
} as const;
