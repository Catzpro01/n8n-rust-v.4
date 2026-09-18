/**
 * @lego/workflow-recon — Workflow Model LEGO, reconstructed (Phase 3).
 *
 * STATUS: IMPLEMENTED (TypeScript) for the Workflow LEGO graph surface.
 * This package does not replace the pinned reference runtime; it is a
 * source-verified reconstruction whose every graph answer must equal the
 * answer `n8n-workflow@2.9.1` gives for the same input.
 *
 * OWNERSHIP
 *   owns     : node collection, connection indexes, traversals, highest-node
 *              resolution, start-node selection, connection indexes
 *   ports    : node type registry + parameter defaults -> Node Model LEGO (02)
 *   not owned: execution, expression runtime, persistence, webhooks, scheduler
 *
 * RUST: none. PROJECT_RULES.md rule 1 keeps `crates/` and `apps/` Rust-free;
 * this reconstruction is pure TypeScript with an erasable-syntax-only surface,
 * so `node --test` runs it without a build step.
 */
export { WorkflowRecon, type NodeParameterDefaultsPort } from './workflow.ts';
export {
	getChildNodes,
	getConnectedNodes,
	getNodeByName,
	getParentNodes,
	mapConnectionsByDestination,
} from './connections.ts';
export {
	MAIN_CONNECTION_TYPE,
	MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE,
	STARTING_NODE_TYPES,
} from './constants.ts';
export type {
	IConnectedNode,
	IConnection,
	IConnections,
	INode,
	INodeConnection,
	INodeConnections,
	INodes,
	INodeType,
	INodeTypes,
	IPinData,
	IWorkflowSettings,
	NodeConnectionType,
	WorkflowReconParameters,
} from './types.ts';

/** Provenance of the reconstruction itself. */
export const RECON_PROVENANCE = {
	lego: 'workflow',
	phase: 'phase-3-reconstruction',
	language: 'typescript',
	referenceVersion: '2.9.4',
	referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
	referenceRuntime: 'n8n-workflow@2.9.1',
	oracle: 'tests/reference/04-disabled-node/expected.json',
	rust: 'none',
} as const;
