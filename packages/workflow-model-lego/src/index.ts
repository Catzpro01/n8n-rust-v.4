/**
 * Workflow Model LEGO — Phase 3 Node.js/TypeScript reconstruction.
 *
 * Reconstruction target: `reference/n8n/packages/workflow/src` @ n8n `2.9.4`
 * (commit `b6dc2787c45677a29a9612cd27eb911302961a83`), restricted to the Workflow LEGO's own
 * files. Everything the Connection LEGO owns is consumed through a port instead of being copied.
 *
 * | reconstruction | reference source | lines |
 * | :--- | :--- | ---: |
 * | `workflow.ts` (aggregate, frozen surface subset) | `workflow.ts` | 925 |
 * | `workflow-checksum.ts` | `workflow-checksum.ts` | 100 |
 * | `observable-object.ts` | `observable-object.ts` | 75 |
 * | `global-state.ts` | `global-state.ts` | 13 |
 * | `node-reference-utils.ts` | `node-reference-parser-utils.ts` (rewrite half) | 643 |
 * | `rename-constants.ts` | `constants.ts` + `node-parameters/rename-node-utils.ts` | 29 |
 * | `errors.ts` | `@n8n/errors` `UserError` (structural) | — |
 *
 * **Not** reconstructed here: `common/**`, `graph/graph-utils.ts` and `connections-diff.ts`
 * (Connection LEGO, port CD-02), `NodeHelpers.*` (Node LEGO, port CD-05), `Expression`
 * (Expression LEGO).
 */

export * from './interfaces';
export * from './errors';
export * from './global-state';
export * from './observable-object';
export * from './node-reference-utils';
export * from './rename-constants';
export * from './workflow-checksum';
export * from './graph-port';
export * from './workflow';
