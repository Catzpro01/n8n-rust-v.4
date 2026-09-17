/**
 * Kernel vocabulary for strict mode — the only values duplicated from the reference.
 * Copied verbatim from reference/n8n/packages/workflow/src/interfaces.ts L2249-2265 (n8n 2.9.4).
 * Verified against the reference source by test/01-boundary.test.mjs.
 */
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

/* interfaces.ts — IConnection / IConnections family (types only) */
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
