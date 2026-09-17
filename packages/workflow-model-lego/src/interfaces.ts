/**
 * Type-only surface consumed by the Workflow Model LEGO (contract dependency **CD-07**,
 * `contracts/connection.contract.md` §6 / `contracts/workflow.contract.md`).
 *
 * Authoritative declarations: `reference/n8n/packages/workflow/src/interfaces.ts`
 * (read-only, hash-pinned). Re-declared structurally because `interfaces.ts` is a shared,
 * read-only file this LEGO consumes but does not own.
 *
 * | symbol | reference location |
 * | :--- | :--- |
 * | `IConnection` | `interfaces.ts:89-98` |
 * | `NodeInputConnections` | `interfaces.ts:404` |
 * | `INodeConnections` / `IConnections` | `interfaces.ts:411-419` |
 * | `NodeConnectionTypes` / `NodeConnectionType` | `interfaces.ts:2249-2265` |
 * | `IPinData` | `interfaces.ts:1329-1331` |
 * | `INodes` | `interfaces.ts:1333-1335` |
 * | `IWorkflowSettings` | `interfaces.ts:2944+` |
 * | `isObject` | `utils.ts:29-35` |
 */

/** Reference: `interfaces.ts` `INode`. Structural subset used by this LEGO. */
export interface INode {
	id: string;
	name: string;
	type: string;
	typeVersion: number;
	position: [number, number] | [number, number, number];
	parameters: INodeParameters;
	disabled?: boolean;
	[key: string]: unknown;
}

/** Name-keyed node map. Reference: `interfaces.ts:1333-1335`. */
export interface INodes {
	[key: string]: INode;
}

export interface IConnection {
	node: string;
	type: NodeConnectionType;
	index: number;
}

export type NodeInputConnections = Array<IConnection[] | null>;

export interface INodeConnections {
	[key: string]: NodeInputConnections;
}

export interface IConnections {
	[key: string]: INodeConnections;
}

export const NodeConnectionTypes = {
	AiAgent: 'ai_agent',
	AiChain: 'ai_chain',
	AiDocument: 'ai_document',
	AiEmbedding: 'ai_embedding',
	AiLanguageModel: 'ai_languageModel',
	AiMemory: 'ai_memory',
	AiOutputParser: 'ai_outputParser',
	AiRetriever: 'ai_retriever',
	AiReranker: 'ai_reranker',
	AiTextSplitter: 'ai_textSplitter',
	AiTool: 'ai_tool',
	AiVectorStore: 'ai_vectorStore',
	Main: 'main',
} as const;

export type NodeConnectionType = (typeof NodeConnectionTypes)[keyof typeof NodeConnectionTypes];

export type GenericValue = string | object | number | boolean | undefined | null;

export interface IDataObject {
	[key: string]: GenericValue | IDataObject | GenericValue[] | IDataObject[];
}

export interface IObservableObject extends IDataObject {
	__dataChanged: boolean;
}

/** Node parameter bag. Reference: `interfaces.ts` `INodeParameters`. */
export interface INodeParameters {
	[key: string]: NodeParameterValueType;
}

export type NodeParameterValueType =
	| string
	| number
	| boolean
	| undefined
	| null
	| NodeParameterValueType[]
	| INodeParameters
	| IDataObject;

export interface IPinData {
	[nodeName: string]: Array<Record<string, unknown>>;
}

/**
 * Reference: `interfaces.ts:2944+`. The reference declares named fields; at runtime the object
 * is an **open bag** — unknown keys (`executionOrder` from a language server, future fields) are
 * preserved verbatim. Pinned by the `toJSON/settings-and-static-data` fixture.
 */
export interface IWorkflowSettings {
	timezone?: 'DEFAULT' | string;
	errorWorkflow?: 'DEFAULT' | string;
	callerIds?: string;
	callerPolicy?: string;
	saveDataErrorExecution?: string;
	saveDataSuccessExecution?: string;
	saveManualExecutions?: 'DEFAULT' | boolean;
	saveExecutionProgress?: 'DEFAULT' | boolean;
	executionTimeout?: number;
	executionOrder?: 'v0' | 'v1';
	binaryMode?: string;
	timeSavedPerExecution?: number;
	timeSavedMode?: 'fixed' | 'dynamic';
	availableInMCP?: boolean;
	[key: string]: unknown;
}

/** Structural subset of `INodeType` — only what the constructor asks the registry for. */
export interface INodeType {
	description?: unknown;
	[key: string]: unknown;
}

/** Structural subset of `INodeTypes` (the Node LEGO's registry, dependency CD-05). */
export interface INodeTypes {
	getByNameAndVersion(type: string, version?: number): INodeType | undefined;
	[key: string]: unknown;
}

/**
 * Port to the Node LEGO (`contracts/node.contract.md` §2 — `NodeHelpers.getNodeParameters`).
 * The reference constructor calls it to fill in default parameter values for every node whose
 * type the registry resolves. See `src/workflow.ts` for why it is a port and not inlined.
 */
export type NodeParametersPort = (
	node: INode,
	nodeType: INodeType,
) => INodeParameters | null;

/**
 * Port to the Connection LEGO (`contracts/connection.contract.md` §7, dependency CD-02):
 * `common/**` + `map-connections-by-destination`. Implemented by `packages/connection-lego`.
 */
export interface GraphPort {
	getConnectedNodes(
		connections: IConnections,
		nodeName: string,
		type?: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN',
		depth?: number,
		checked?: string[],
	): string[];
	getChildNodes(
		connectionsBySourceNode: IConnections,
		nodeName: string,
		type?: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN',
		depth?: number,
	): string[];
	getParentNodes(
		connectionsByDestinationNode: IConnections,
		nodeName: string,
		type?: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN',
		depth?: number,
	): string[];
	mapConnectionsByDestination(connections: IConnections): IConnections;
}

/** Reference: `interfaces.ts:406-409` — one entry of a `compareConnections`/index lookup result. */
export interface INodeConnection {
	sourceIndex: number;
	destinationIndex: number;
}

/** Reference: `interfaces.ts:3136-3140` — what `searchNodesBFS` returns per visited node. */
export interface IConnectedNode {
	name: string;
	indicies: number[];
	depth: number;
}

/**
 * Port to the Node LEGO (`contracts/node.contract.md` §2, dependency CD-05) for the two
 * `NodeHelpers` calls the Workflow aggregate makes:
 *
 * - `getNodeParameters` — the constructor fills in default parameter values;
 * - `getNodeOutputs`    — `getParentMainInputNode` needs the declared outputs to find the
 *   non-main connection types.
 *
 * Implemented by `packages/node-lego` (see `node-port.ts`).
 */
export interface NodeHelpersPort {
	getNodeParameters?(node: INode, nodeType: INodeType): INodeParameters | null;
	getNodeOutputs(
		workflow: unknown,
		node: INode,
		nodeTypeData: { outputs?: unknown; [key: string]: unknown },
	): Array<string | { type: NodeConnectionType; [key: string]: unknown }>;
}

/** Reference: `utils.ts:29-35`. Copied verbatim — the checksum's key sort depends on it. */
export function isObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object') return false;
	if (Array.isArray(value)) return false;
	if (Object.prototype.toString.call(value) !== '[object Object]') return false;

	return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}
