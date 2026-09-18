/**
 * Workflow Model LEGO — reconstruction (Phase 3, TypeScript).
 *
 * TYPE SURFACE. Only the shapes the Workflow LEGO actually owns are declared
 * here; everything else (node parameter defaults, expression runtime, execution
 * data, persistence) is reached through ports and stays owned by its own LEGO.
 *
 * Reference: n8n 2.9.4 — `reference/n8n/packages/workflow/src/interfaces.ts`
 * (commit b6dc2787c45677a29a9612cd27eb911302961a83). The published runtime
 * artifact of that tree is `n8n-workflow@2.9.1`.
 */

/** `NodeConnectionType` — `interfaces.ts` (string union, `'main'` and the `ai_*` set). */
export type NodeConnectionType = string;

/** `IConnection` — one edge endpoint. */
export interface IConnection {
	node: string;
	type: NodeConnectionType;
	index: number;
}

/** `INodeConnections[type]` — output slots; a slot may be `null` (sparse). */
export type INodeConnections = Record<NodeConnectionType, Array<IConnection[] | null>>;

/** `IConnections` — keyed by source node name. */
export type IConnections = Record<string, INodeConnections>;

/** `INode` — the subset the Workflow LEGO reads. */
export interface INode {
	id: string;
	name: string;
	type: string;
	typeVersion: number;
	position: [number, number];
	parameters: Record<string, unknown>;
	/**
	 * Tri-state in practice: `true`, `false` or **absent**. n8n 2.9.4 distinguishes
	 * them — `workflow.ts:498` tests `disabled === false` while `:553` and `:839`
	 * test `disabled !== true` / `disabled === true`. Never normalise this.
	 */
	disabled?: boolean;
	[key: string]: unknown;
}

/** `INodes` — name-keyed node collection built by `setNodes`. */
export type INodes = Record<string, INode>;

/** Pinned data per node name (`IPinData`). */
export type IPinData = Record<string, unknown[]>;

/** `IWorkflowSettings` — the Workflow LEGO only reads `timezone`. */
export interface IWorkflowSettings {
	timezone?: string;
	[key: string]: unknown;
}

/** The slice of `INodeType` the Workflow LEGO consults. */
export interface INodeType {
	trigger?: unknown;
	poll?: unknown;
	description: {
		name: string;
		outputs?: unknown;
		[key: string]: unknown;
	};
}

/**
 * `INodeTypes` — provided by the Node Model LEGO (02). This package never
 * loads node descriptions itself; it is handed a registry.
 */
export interface INodeTypes {
	getByNameAndVersion(type: string, version?: number): INodeType | undefined;
}

/** `IConnectedNode` — BFS result row (the reference misspells `indicies`; kept). */
export interface IConnectedNode {
	name: string;
	depth: number;
	indicies: number[];
}

/** `INodeConnection` — how two nodes are wired. */
export interface INodeConnection {
	sourceIndex: number;
	destinationIndex: number;
}

/** Constructor parameters (a subset of `WorkflowParameters`). */
export interface WorkflowReconParameters {
	id?: string;
	name?: string;
	nodes: INode[];
	connections: IConnections;
	active?: boolean;
	nodeTypes: INodeTypes;
	settings?: IWorkflowSettings;
	pinData?: IPinData;
}
