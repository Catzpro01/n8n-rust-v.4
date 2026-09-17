/**
 * Kernel snapshots — values the LEGO needs even when reference runtime is absent.
 *
 * GENERATED FILE — do not edit by hand.
 *   source    : reference/n8n/packages/workflow/src (n8n 2.9.4, commit b6dc2787c45677a29a9612cd27eb911302961a83)
 *   verify    : node tools/connection-kernel-conformance.mjs --check
 */

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

export const CONNECTION_INVARIANTS = {
  sparseSlotAllowed: true,
  destinationPadded: true,
  inversionLossless: true,
  traversalFarthestFirst: true,
  cyclesLegal: true,
  graphUtilsMainOnly: true,
  pureFunctions: true,
} as const;
