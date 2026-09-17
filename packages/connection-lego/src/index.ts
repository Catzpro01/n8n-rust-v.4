/**
 * @lego/connection — Connection Model LEGO (Phase 3 ownership transfer).
 *
 * OWNERSHIP (see manifest/ownership.json)
 *   owns         : IConnections orientation, sparse-slot rules, inversion,
 *                  traversal (child/parent/connected), adjacency list,
 *                  roots/leaves, edges, hasPath, extractable selection,
 *                  connection diffing
 *   does NOT own : Workflow wrapper methods, NodeHelpers port counts,
 *                  item routing, DirectedGraph, cycle validation
 *
 * ENTRY POINTS
 *   ./model-surface  the public surface downstream LEGOs may consume
 *   ./ports          the declared outer boundary (contract + adapters)
 *
 * RUST: NOT STARTED. This package currently binds to the pinned reference
 * runtime; it does not replace it.
 */
export * from './model-surface';
export {
  portMode,
  referencePackage,
  type PortMode,
} from './ports/runtime';
export type {
  ConnectionLegoPorts,
  GraphPort,
  DiffPort,
  CommonPort,
  VocabularyPort,
} from './ports/contracts';
export { NODE_CONNECTION_TYPES } from './kernel/snapshots';

/** Provenance */
export const LEGO_PROVENANCE = {
  lego: 'connection',
  phase: 'phase-3-ownership-transfer',
  referenceVersion: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  behaviorChange: 'none-detected',
  rustImplementation: 'not-started',
  port: 'P-CONNECTION-GRAPH',
} as const;
