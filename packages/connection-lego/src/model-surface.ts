/**
 * Connection Model LEGO — public surface (the seam).
 *
 * This is what downstream LEGOs (Workflow, Validation) and the future
 * Rust implementation consume. Nothing else of this package is part of the boundary.
 *
 * PHASE 3 STATUS
 *   - Connection owns graph/** + connections-diff behind port P-CONNECTION-GRAPH
 *   - Workflow re-exports these symbols via its barrel for backward compatibility
 *   - Running implementation is still pinned reference runtime (n8n-workflow@2.9.1)
 *   - RUST IMPLEMENTATION: NOT STARTED. Isolated does not mean replaced.
 *
 * Surface parity is enforced by test/surface-parity.test.mjs
 */

export { compareConnections, type ConnectionsDiff, type INodeConnectionsDiff } from 'n8n-workflow/dist/cjs/connections-diff';

export {
  buildAdjacencyList,
  getInputEdges,
  getLeafNodes,
  getOutputEdges,
  getRootNodes,
  hasPath,
  parseExtractableSubgraphSelection,
  type IConnectionAdjacencyList,
  type ExtractableErrorResult,
  type ExtractableSubgraphData,
} from 'n8n-workflow/dist/cjs/graph/graph-utils';

export {
  getChildNodes,
  getConnectedNodes,
  getNodeByName,
  getParentNodes,
  mapConnectionsByDestination,
} from 'n8n-workflow/dist/cjs/common/index.js';

// Re-export types for consumers (shared kernel, P-KERNEL-TYPES)
export type {
  IConnection,
  IConnections,
  INodeConnection,
  NodeConnectionType,
} from 'n8n-workflow';

/**
 * Provenance of the isolation layer itself.
 */
export const LEGO_PROVENANCE = {
  lego: 'connection',
  phase: 'phase-3-ownership-transfer',
  referenceVersion: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  behaviorChange: 'none-detected',
  rustImplementation: 'not-started',
  port: 'P-CONNECTION-GRAPH',
} as const;
