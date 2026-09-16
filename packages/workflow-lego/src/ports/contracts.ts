/**
 * Workflow LEGO — port contract (Phase 2 isolation).
 *
 * This file is the *declared outer boundary* of the Workflow Model LEGO.
 *
 * It lists every capability the model needs from the outside world. Inside the
 * LEGO, the model may only reach the outside through these ports — the boundary
 * gate (`tools/workflow-boundary-map.mjs --check`) fails the build otherwise.
 *
 * Ownership map (see manifest/ownership.json):
 *   P-KERNEL-*        shared kernel (type vocabulary, constants, errors, utils, config, observability)
 *   P-NODE-*          peer LEGOs (Node Model = LEGO 02, Validation = LEGO 04)
 *   P-EXPRESSION-*    runtime concerns, explicitly out of scope for Phase 2
 *   P-EXTERNAL-*      third-party libraries the model depends on directly
 */

import type {
	IConnections,
	IConnection,
	IDataObject,
	INode,
	INodeParameters,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	IObservableObject,
	IPinData,
	IWorkflowSettings,
	NodeConnectionType,
	NodeParameterValueType,
} from './vocabulary';

/* ------------------------------------------------------------------ */
/* P-KERNEL-TYPES — vocabulary (types are erased; the value below is real) */
/* ------------------------------------------------------------------ */
export interface VocabularyPort {
	/** Connection-type vocabulary shared by every LEGO. */
	NodeConnectionTypes: {
		readonly Main: 'main';
		readonly AiTool: 'ai_tool';
		readonly AiAgent: 'ai_agent';
		readonly AiChain: 'ai_chain';
		readonly AiDocument: 'ai_document';
		readonly AiEmbedding: 'ai_embedding';
		readonly AiLanguageModel: 'ai_languageModel';
		readonly AiMemory: 'ai_memory';
		readonly AiOutputParser: 'ai_outputParser';
		readonly AiRetriever: 'ai_retriever';
		readonly AiReranker: 'ai_reranker';
		readonly AiTextSplitter: 'ai_textSplitter';
		readonly AiVectorStore: 'ai_vectorStore';
	};
}

/* ------------------------------------------------------------------ */
/* P-KERNEL-CONSTANTS                                                  */
/* ------------------------------------------------------------------ */
export interface ConstantsPort {
	STARTING_NODE_TYPES: string[];
	MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE: string;
	NODES_WITH_RENAMABLE_CONTENT: Set<string>;
	NODES_WITH_RENAMABLE_FORM_HTML_CONTENT: Set<string>;
	NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT: Set<string>;
}

/* ------------------------------------------------------------------ */
/* P-KERNEL-ERRORS                                                     */
/* ------------------------------------------------------------------ */
export interface ErrorLike extends Error {
	tags?: Record<string, string>;
	extra?: unknown;
	level?: string;
	description?: string;
}

export interface ErrorsPort {
	ApplicationError: new (message: string, options?: unknown) => ErrorLike;
	UserError: new (message: string, options?: unknown) => ErrorLike;
}

/* ------------------------------------------------------------------ */
/* P-KERNEL-UTILS                                                      */
/* ------------------------------------------------------------------ */
export interface UtilsPort {
	dedupe<T>(arr: T[]): T[];
	isObject(value: unknown): value is Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* P-KERNEL-OBSERVABLE                                                 */
/* ------------------------------------------------------------------ */
export interface ObservableObjectPort {
	create(
		target: IDataObject,
		parent?: IObservableObject,
		options?: { ignoreEmptyOnFirstChild?: boolean },
		depth?: number,
	): IDataObject;
}

/* ------------------------------------------------------------------ */
/* P-KERNEL-CONFIG                                                     */
/* ------------------------------------------------------------------ */
export interface ConfigPort {
	getGlobalState(): { defaultTimezone: string; [key: string]: unknown };
}

/* ------------------------------------------------------------------ */
/* P-NODE-MODEL — peer LEGO 02                                         */
/* ------------------------------------------------------------------ */
export interface NodeModelPort {
	getNodeParameters(
		nodePropertiesArray: INodeProperties[],
		nodeValues: INodeParameters | null,
		returnDefaults: boolean,
		returnNoneDisplayed: boolean,
		node: Pick<INode, 'typeVersion'> | null,
		nodeTypeDescription: INodeTypeDescription | null,
		options?: unknown,
	): INodeParameters | null;

	getNodeOutputs(
		workflow: unknown,
		node: INode,
		nodeTypeData: INodeTypeDescription,
	): Array<NodeConnectionType | { type: NodeConnectionType; displayName?: string }>;
}

/* ------------------------------------------------------------------ */
/* P-NODE-RENAME — peer LEGO 02                                        */
/* ------------------------------------------------------------------ */
export interface NodeRenamePort {
	renameFormFields(node: INode, rename: (value: NodeParameterValueType) => NodeParameterValueType): void;
}

/* ------------------------------------------------------------------ */
/* P-NODE-REFERENCE — peer LEGO 02                                     */
/* ------------------------------------------------------------------ */
export interface NodeReferencePort {
	applyAccessPatterns(value: NodeParameterValueType, currentName: string, newName: string): NodeParameterValueType;
}

/* ------------------------------------------------------------------ */
/* P-EXPRESSION-RUNTIME — runtime, out of scope for Phase 2            */
/* ------------------------------------------------------------------ */
/**
 * Instance shape of the expression runtime. Deliberately opaque: the LEGO only
 * stores it (`workflow.expression`), it does not call into it. Consumers that do
 * (node output resolution) go through the node-model port instead.
 */
export type ExpressionLike = object;

export interface ExpressionRuntimePort {
	Expression: new (workflow?: unknown) => ExpressionLike;
}

/* ------------------------------------------------------------------ */
/* P-EXTERNAL-JSSHA — SHA-256 fallback used by workflow-checksum       */
/* ------------------------------------------------------------------ */
export interface ChecksumDigestPort {
	jsSHA: new (variant: string, inputType: string, options?: { encoding?: string }) => {
		update(input: string): void;
		getHash(format: string): string;
	};
}

/* ------------------------------------------------------------------ */
/* The complete port surface                                           */
/* ------------------------------------------------------------------ */
export interface WorkflowLegoPorts {
	vocabulary: VocabularyPort;
	constants: ConstantsPort;
	errors: ErrorsPort;
	utils: UtilsPort;
	observableObject: ObservableObjectPort;
	config: ConfigPort;
	nodeModel: NodeModelPort;
	nodeRename: NodeRenamePort;
	nodeReference: NodeReferencePort;
	expressionRuntime: ExpressionRuntimePort;
	checksumDigest: ChecksumDigestPort;
}

/** Everything a host must hand to the model: the chosen node-type registry. */
export interface HostContext {
	nodeTypes: { getByNameAndVersion(type: string, version?: number): INodeType | undefined };
}

export type { IConnection, IConnections, IPinData, INode, IWorkflowSettings };
