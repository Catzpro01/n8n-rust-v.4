
export * from './expression';
export * from './workflow-data-proxy';
export * from './augment-object';
export * from './expression-evaluator-proxy';
export * from './expression-sandboxing';
export * from './workflow-data-proxy-helpers';
export * from './workflow-data-proxy-env-provider';

export const LEGO_PROVENANCE = {
  lego: 'expression',
  phase: 'phase-2-isolation',
  referenceVersion: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  behaviorChange: 'none-detected',
  rustImplementation: 'not-started',
} as const;
