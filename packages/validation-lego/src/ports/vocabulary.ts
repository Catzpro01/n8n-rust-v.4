/** P-KERNEL-TYPES — type vocabulary (erased at runtime). Mirrors reference interfaces.ts names used by the owned sources. */
export type FieldType = 'boolean' | 'number' | 'string' | 'string-alphanumeric' | 'dateTime' | 'time' | 'array' | 'object' | 'options' | 'url' | 'jwt' | 'form-fields';
export interface ValidationResult { valid: boolean; errorMessage?: string; newValue?: unknown }
export type NodeConnectionType = 'ai_agent' | 'ai_chain' | 'ai_document' | 'ai_embedding' | 'ai_languageModel' | 'ai_memory' | 'ai_outputParser' | 'ai_retriever' | 'ai_reranker' | 'ai_textSplitter' | 'ai_tool' | 'ai_vectorStore' | 'main';
export interface IBinaryData { mimeType: string; data?: string; id?: string; fileName?: string; fileExtension?: string; fileSize?: string; directory?: string }
export interface INodeLike { id: string; name: string; type: string; typeVersion: number; position: [number, number]; parameters: Record<string, unknown>; disabled?: boolean; [k: string]: unknown }
