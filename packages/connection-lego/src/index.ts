/**
 * Connection Model LEGO — Phase 3 Node.js/TypeScript reconstruction.
 *
 * Reconstruction target: `reference/n8n/packages/workflow/src` @ n8n `2.9.4`
 * (commit `b6dc2787c45677a29a9612cd27eb911302961a83`), restricted to the files the Connection
 * LEGO owns per `contracts/connection.contract.md` §7:
 *
 * | reconstruction | reference source | lines |
 * | :--- | :--- | ---: |
 * | `get-node-by-name.ts` | `common/get-node-by-name.ts` | 19 |
 * | `get-connected-nodes.ts` | `common/get-connected-nodes.ts` | 98 |
 * | `get-child-nodes.ts` | `common/get-child-nodes.ts` | 12 |
 * | `get-parent-nodes.ts` | `common/get-parent-nodes.ts` | 18 |
 * | `map-connections-by-destination.ts` | `common/map-connections-by-destination.ts` | 49 |
 * | `graph-utils.ts` | `graph/graph-utils.ts` | 273 |
 * | `connections-diff.ts` | `connections-diff.ts` | 100 |
 *
 * **Not** reconstructed here (owned by other LEGOs, consumed read-only):
 * the `Workflow` aggregate and its methods (`getNodeConnectionIndexes`, `getHighestNode`,
 * `getStartNode`, `getParentMainInputNode`, `getParentNodesByDepth`) — Workflow LEGO,
 * contract dependencies CD-01/CD-04; and declared port counts — Node LEGO, CD-05.
 */

export * from './interfaces';
export * from './get-node-by-name';
export * from './get-connected-nodes';
export * from './get-child-nodes';
export * from './get-parent-nodes';
export * from './map-connections-by-destination';
export * from './graph-utils';
export * from './connections-diff';
