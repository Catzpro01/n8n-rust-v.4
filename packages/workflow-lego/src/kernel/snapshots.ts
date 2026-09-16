/**
 * Kernel snapshots — values the LEGO needs even when the reference runtime is
 * absent (strict port mode).
 *
 * GENERATED FILE — do not edit by hand.
 *   generator : tools/workflow-kernel-conformance.mjs
 *   source    : reference/n8n/packages/workflow/src (n8n 2.9.4, commit b6dc2787c45677a29a9612cd27eb911302961a83)
 *   verify    : node tools/workflow-kernel-conformance.mjs --check
 *
 * These are the only duplicated values in the isolation layer. The drift gate
 * re-parses the reference source and fails when they diverge.
 */

/** from src/interfaces.ts — `NodeConnectionTypes` */
export const NODE_CONNECTION_TYPES = {
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

/** from src/constants.ts — `STARTING_NODE_TYPES` (references resolved) */
export const STARTING_NODE_TYPES: string[] = [
	'n8n-nodes-base.manualTrigger',
	'n8n-nodes-base.executeWorkflowTrigger',
	'n8n-nodes-base.errorTrigger',
	'n8n-nodes-base.evaluationTrigger',
	'n8n-nodes-base.formTrigger',
];

/** from src/constants.ts */
export const MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.manualChatTrigger';

/** from src/constants.ts */
export const NODES_WITH_RENAMABLE_CONTENT = new Set<string>([
	'n8n-nodes-base.code',
	'n8n-nodes-base.function',
	'n8n-nodes-base.functionItem',
	'n8n-nodes-base.aiTransform',
]);

/** from src/constants.ts */
export const NODES_WITH_RENAMABLE_FORM_HTML_CONTENT = new Set<string>([
	'n8n-nodes-base.form',
]);

/** from src/constants.ts */
export const NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT = new Set<string>([
	'n8n-nodes-base.mailgun',
	'n8n-nodes-base.html',
]);

/** from src/global-state.ts — initial value of `globalState.defaultTimezone` */
export const DEFAULT_TIMEZONE = 'America/New_York';
