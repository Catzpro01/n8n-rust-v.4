/**
 * @lego/connection — Connection LEGO (Module 03): input/output port mapping,
 * typed graph traversal, main-graph utilities, connection diff.
 *
 * OWNERSHIP (manifest/ownership.json, contracts/connection.contract.md)
 *   owns         : graph/graph-utils, connections-diff; consumes common/** traversal (transfer pending, MSG-18)
 *   does NOT own : Workflow members (LEGO 01), declared port counts (LEGO 02),
 *                  cycle detection / topological sort (LEGO 04 + core), kernel types
 *
 * ENTRY POINT: ./model-surface (the seam). Nothing else is public.
 *
 * RUST: not started inside this package. The Rust port is crates/n8n-connection (orchestrator-owned),
 * gated by tests/reference/harness/rust and docs/isolation/connection-rust-conformance.md.
 */
export * from './model-surface.ts';
export { portMode, referencePackage, type PortMode } from './ports/runtime.ts';
export type { ConnectionLegoPorts, ConnectionTraversalPort, ConnectionGraphPort, ConnectionDiffPort } from './ports/contracts.ts';

export const LEGO = Object.freeze({
	name: 'connection',
	module: '03',
	pinnedReference: 'n8n@2.9.4',
	rustImplementation: 'not-started',
	seam: 'src/model-surface.ts',
});
