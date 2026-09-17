/**
 * Type-only surface consumed by the Connection LEGO (contract dependency **CD-07**,
 * `contracts/connection.contract.md` §6).
 *
 * The authoritative declarations live in
 * `reference/n8n/packages/workflow/src/interfaces.ts` (read-only, hash-pinned):
 *
 * | symbol | reference location |
 * | :--- | :--- |
 * | `IConnection` | `interfaces.ts:89-98` |
 * | `NodeInputConnections` | `interfaces.ts:404` |
 * | `INodeConnections` | `interfaces.ts:411-414` |
 * | `IConnections` | `interfaces.ts:416-419` |
 * | `NodeConnectionTypes` | `interfaces.ts:2249-2263` |
 * | `NodeConnectionType` | `interfaces.ts:2265` |
 *
 * They are re-declared structurally (not imported) because `interfaces.ts` is a **shared,
 * read-only** file that the Connection LEGO consumes but does not own. The declarations below
 * are byte-for-byte equivalent in shape; `tests/compatibility/contract_conformance.mjs` and
 * `packages/connection-lego/test/conformance.test.mjs` assert the runtime behaviour that
 * depends on them against the pinned reference runtime.
 *
 * `INode` / `INodes` are deliberately minimal: this LEGO only ever reads `node.name`
 * (`get-node-by-name.ts`). Widening them here would claim ownership this LEGO does not have.
 */

/** A node, as far as connection routing is concerned. Reference: `interfaces.ts` `INode`. */
export interface INode {
	name: string;
	[key: string]: unknown;
}

/** Name-keyed node map. Reference: `interfaces.ts` `INodes`. */
export interface INodes {
	[key: string]: INode;
}

/**
 * The node the connection points to, the input type on that node, and the index of that
 * input. Reference: `interfaces.ts:89-98`.
 */
export interface IConnection {
	/** The node the connection is to */
	node: string;

	/** The type of the input on destination node (for example "main") */
	type: NodeConnectionType;

	/** The output/input-index of destination node (if node has multiple inputs/outputs of the same type) */
	index: number;
}

/**
 * One input slot may hold several connections, and a slot may be absent (`null`) — the
 * reference keeps sparse slots instead of compacting them. Reference: `interfaces.ts:404`.
 */
export type NodeInputConnections = Array<IConnection[] | null>;

/** Input name → slots. Reference: `interfaces.ts:411-414`. */
export interface INodeConnections {
	// Input name
	[key: string]: NodeInputConnections;
}

/** Source node name → its outgoing connections. Reference: `interfaces.ts:416-419`. */
export interface IConnections {
	// Node name
	[key: string]: INodeConnections;
}

/** Reference: `interfaces.ts:2249-2263`. Values copied verbatim. */
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

/** Reference: `interfaces.ts:2265`. */
export type NodeConnectionType = (typeof NodeConnectionTypes)[keyof typeof NodeConnectionTypes];

/** Reference: `interfaces.ts:2269`. */
export const nodeConnectionTypes: NodeConnectionType[] = Object.values(NodeConnectionTypes);
