/**
 * @lego/connection — Connection Model LEGO (Phase 2 structural isolation)
 *
 * OWNERSHIP (see manifest/ownership.json)
 *   owns         : common/**, graph/graph-utils.ts, connections-diff.ts
 *   does NOT own : workflow.ts, interfaces.ts, node-helpers
 *
 * This LEGO is a pure, dependency-free leaf. All functions are pure and
 * have no side effects. Node references are by name only.
 *
 * Reference: n8n 2.9.4, n8n-workflow@2.9.1
 */

// Common traversal primitives
export { getChildNodes } from './common/get-child-nodes';
export { getParentNodes } from './common/get-parent-nodes';
export { getConnectedNodes } from './common/get-connected-nodes';
export { getNodeByName } from './common/get-node-by-name';
export { mapConnectionsByDestination } from './common/map-connections-by-destination';

// Graph utilities
export {
  getInputEdges,
  getOutputEdges,
  buildAdjacencyList,
  getRootNodes,
  getLeafNodes,
  hasPath,
  parseExtractableSubgraphSelection,
  type IConnectionAdjacencyList,
  type ExtractableSubgraphData,
  type ExtractableErrorResult,
} from './graph/graph-utils';

// Connection diffing
export {
  compareConnections,
  type ConnectionsDiff,
  type INodeConnectionsDiff,
} from './connections-diff';

// Re-export common barrel for compatibility
export * from './common';

export const LEGO_PROVENANCE = {
  lego: 'connection',
  phase: 'phase-2-isolation',
  referenceVersion: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  behaviorChange: 'none-detected',
  rustImplementation: 'not-started',
} as const;
