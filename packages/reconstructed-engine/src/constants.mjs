/**
 * Constants — reconstructed 1:1 from the pinned reference (n8n 2.9.4).
 *
 * Provenance (reference/n8n, upstream commit b6dc2787c45677a29a9612cd27eb911302961a83):
 *   packages/workflow/src/constants.ts:1-140     (COMPLETE port — every export, in order)
 *   packages/workflow/src/interfaces.ts:2249-2263 NodeConnectionTypes (runtime object behind a TS type)
 *   packages/workflow/src/workflow-data-proxy.ts  PAIRED_ITEM_METHOD (reserved paired-item accessor names)
 *
 * `constants.ts` is ported in full rather than pick-and-choose: it is a leaf with
 * no imports, so an exhaustive port costs nothing and removes a whole class of
 * "did the Rust port get the string right?" questions. `test/00-constants.test.mjs`
 * pins every value against the installed reference runtime and asserts the export
 * *set* is identical, so a rename or a dropped constant fails the gate.
 *
 * Values are duplicated on purpose: the reconstructed engine must be loadable
 * without the reference runtime in the module graph (LEGO rule 5, "no hidden
 * dependency"). Arrays/objects are NOT frozen, matching the compiled reference —
 * `Object.freeze` here would be a behaviour change (`NODES_WITH_RENAMABLE_CONTENT`
 * is a live `Set` in the reference, and some callers rely on that).
 */

// ---------------------------------------------------------------------------
// packages/workflow/src/constants.ts:1-6
// ---------------------------------------------------------------------------
export const DIGITS = '0123456789';
export const UPPERCASE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const LOWERCASE_LETTERS = UPPERCASE_LETTERS.toLowerCase();
export const ALPHABET = [DIGITS, UPPERCASE_LETTERS, LOWERCASE_LETTERS].join('');

// constants.ts:8-9
export const BINARY_ENCODING = 'base64';
export const WAIT_INDEFINITELY = new Date('3000-01-01T00:00:00.000Z');

// constants.ts:11
export const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'];

// constants.ts:13-14
export const CODE_LANGUAGES = ['javaScript', 'python', 'json', 'html'];
export const CODE_EXECUTION_MODES = ['runOnceForAllItems', 'runOnceForEachItem'];

// constants.ts:16-17 — Arbitrary value to represent an empty credential value
export const CREDENTIAL_EMPTY_VALUE = '__n8n_EMPTY_VALUE_7b1af746-3729-4c60-9b9b-e08eb29e58da';

// constants.ts:19
export const FORM_TRIGGER_PATH_IDENTIFIER = 'n8n-form';

// constants.ts:21-24
export const UNKNOWN_ERROR_MESSAGE = 'There was an unknown issue while executing the node';
export const UNKNOWN_ERROR_DESCRIPTION =
	'Double-check the node configuration and the service it connects to. Check the error details below and refer to the <a href="https://docs.n8n.io" target="_blank">n8n documentation</a> to troubleshoot the issue.';
export const UNKNOWN_ERROR_MESSAGE_CRED = 'UNKNOWN ERROR';

// ---------------------------------------------------------------------------
// constants.ts:26-50 — n8n-nodes-base node type ids
// ---------------------------------------------------------------------------
export const STICKY_NODE_TYPE = 'n8n-nodes-base.stickyNote';
export const NO_OP_NODE_TYPE = 'n8n-nodes-base.noOp';
export const HTTP_REQUEST_NODE_TYPE = 'n8n-nodes-base.httpRequest';
export const WEBHOOK_NODE_TYPE = 'n8n-nodes-base.webhook';
export const MANUAL_TRIGGER_NODE_TYPE = 'n8n-nodes-base.manualTrigger';
export const EVALUATION_TRIGGER_NODE_TYPE = 'n8n-nodes-base.evaluationTrigger';
export const EVALUATION_NODE_TYPE = 'n8n-nodes-base.evaluation';
export const ERROR_TRIGGER_NODE_TYPE = 'n8n-nodes-base.errorTrigger';
export const EXECUTE_WORKFLOW_NODE_TYPE = 'n8n-nodes-base.executeWorkflow';
export const EXECUTE_WORKFLOW_TRIGGER_NODE_TYPE = 'n8n-nodes-base.executeWorkflowTrigger';
export const CODE_NODE_TYPE = 'n8n-nodes-base.code';
export const FUNCTION_NODE_TYPE = 'n8n-nodes-base.function';
export const FUNCTION_ITEM_NODE_TYPE = 'n8n-nodes-base.functionItem';
export const MERGE_NODE_TYPE = 'n8n-nodes-base.merge';
export const AI_TRANSFORM_NODE_TYPE = 'n8n-nodes-base.aiTransform';
export const FORM_NODE_TYPE = 'n8n-nodes-base.form';
export const FORM_TRIGGER_NODE_TYPE = 'n8n-nodes-base.formTrigger';
export const WAIT_NODE_TYPE = 'n8n-nodes-base.wait';
export const RESPOND_TO_WEBHOOK_NODE_TYPE = 'n8n-nodes-base.respondToWebhook';
export const HTML_NODE_TYPE = 'n8n-nodes-base.html';
export const MAILGUN_NODE_TYPE = 'n8n-nodes-base.mailgun';
export const POSTGRES_NODE_TYPE = 'n8n-nodes-base.postgres';
export const MYSQL_NODE_TYPE = 'n8n-nodes-base.mySql';
export const MICROSOFT_AGENT365_TRIGGER_NODE_TYPE =
	'@n8n/n8n-nodes-langchain.microsoftAgent365Trigger';
export const SCHEDULE_TRIGGER_NODE_TYPE = 'n8n-nodes-base.scheduleTrigger';
export const DATA_TABLE_TOOL_NODE_TYPE = 'n8n-nodes-base.dataTableTool';

// constants.ts:52-68
export const STARTING_NODE_TYPES = [
	MANUAL_TRIGGER_NODE_TYPE,
	EXECUTE_WORKFLOW_TRIGGER_NODE_TYPE,
	ERROR_TRIGGER_NODE_TYPE,
	EVALUATION_TRIGGER_NODE_TYPE,
	FORM_TRIGGER_NODE_TYPE,
];

export const SCRIPTING_NODE_TYPES = [
	FUNCTION_NODE_TYPE,
	FUNCTION_ITEM_NODE_TYPE,
	CODE_NODE_TYPE,
	AI_TRANSFORM_NODE_TYPE,
];

export const ADD_FORM_NOTICE = 'addFormPage';

/**
 * Nodes whose parameter values may refer to other nodes without expressions.
 * Their content may need to be updated when the referenced node is renamed.
 * constants.ts:70-80
 */
export const NODES_WITH_RENAMABLE_CONTENT = new Set([
	CODE_NODE_TYPE,
	FUNCTION_NODE_TYPE,
	FUNCTION_ITEM_NODE_TYPE,
	AI_TRANSFORM_NODE_TYPE,
]);
export const NODES_WITH_RENAMABLE_FORM_HTML_CONTENT = new Set([FORM_NODE_TYPE]);
export const NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT = new Set([
	MAILGUN_NODE_TYPE,
	HTML_NODE_TYPE,
]);

// ---------------------------------------------------------------------------
// constants.ts:82-100 — @n8n/n8n-nodes-langchain node type ids
// ---------------------------------------------------------------------------
export const MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.manualChatTrigger';
export const AGENT_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.agent';
export const CHAIN_LLM_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.chainLlm';
export const OPENAI_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.openAi';
export const OPENAI_CHAT_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
export const CHAIN_SUMMARIZATION_LANGCHAIN_NODE_TYPE =
	'@n8n/n8n-nodes-langchain.chainSummarization';
export const AGENT_TOOL_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.agentTool';
export const CODE_TOOL_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.toolCode';
export const WORKFLOW_TOOL_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.toolWorkflow';
export const HTTP_REQUEST_TOOL_LANGCHAIN_NODE_TYPE = '@n8n/n8n-nodes-langchain.toolHttpRequest';
export const CHAT_TRIGGER_NODE_TYPE = '@n8n/n8n-nodes-langchain.chatTrigger';
export const CHAT_NODE_TYPE = '@n8n/n8n-nodes-langchain.chat';
export const CHAT_TOOL_NODE_TYPE = '@n8n/n8n-nodes-langchain.chatTool';
export const MEMORY_MANAGER_NODE_TYPE = '@n8n/n8n-nodes-langchain.memoryManager';
export const MEMORY_BUFFER_WINDOW_NODE_TYPE = '@n8n/n8n-nodes-langchain.memoryBufferWindow';
export const GUARDRAILS_NODE_TYPE = '@n8n/n8n-nodes-langchain.guardrails';
export const MCP_CLIENT_TOOL_NODE_TYPE = '@n8n/n8n-nodes-langchain.mcpClientTool';
export const MCP_CLIENT_NODE_TYPE = '@n8n/n8n-nodes-langchain.mcpClient';

export const LANGCHAIN_CUSTOM_TOOLS = [
	CODE_TOOL_LANGCHAIN_NODE_TYPE,
	WORKFLOW_TOOL_LANGCHAIN_NODE_TYPE,
	HTTP_REQUEST_TOOL_LANGCHAIN_NODE_TYPE,
];

// ---------------------------------------------------------------------------
// constants.ts:110-140
// ---------------------------------------------------------------------------
export const SEND_AND_WAIT_OPERATION = 'sendAndWait';
export const AI_TRANSFORM_CODE_GENERATED_FOR_PROMPT = 'codeGeneratedForPrompt';
export const AI_TRANSFORM_JS_CODE = 'jsCode';

/**
 * Key for an item standing in for a manual execution data item too large to be
 * sent live via pubsub. See {@link TRIMMED_TASK_DATA_CONNECTIONS} in constants
 * in `cli` package. (constants.ts:114-118)
 */
export const TRIMMED_TASK_DATA_CONNECTIONS_KEY = '__isTrimmedManualExecutionDataItem';

export const OPEN_AI_API_CREDENTIAL_TYPE = 'openAiApi';
export const FREE_AI_CREDITS_ERROR_TYPE = 'free_ai_credits_request_error';
export const FREE_AI_CREDITS_USED_ALL_CREDITS_ERROR_CODE = 400;

export const FROM_AI_AUTO_GENERATED_MARKER = '/*n8n-auto-generated-fromAI-override*/';

/**
 * constants.ts:128. Yes, the reference value is the string '0' — it is the
 * GraphQL/`ID` placeholder, not a path. Copied verbatim; a "fix" here would be
 * a deviation.
 */
export const PROJECT_ROOT = '0';

export const WAITING_FORMS_EXECUTION_STATUS = 'n8n-execution-status';

export const CHAT_WAIT_USER_REPLY = 'waitUserReply';
export const FREE_TEXT_CHAT_RESPONSE_TYPE = 'freeTextChat';

export const BINARY_IN_JSON_PROPERTY = '_files';

export const BINARY_MODE_SEPARATE = 'separate';
export const BINARY_MODE_COMBINED = 'combined';

// ---------------------------------------------------------------------------
// Additions on top of constants.ts — declared in manifest/port-surface.json
// under `myAdditions`, asserted against the reference by test/00.
// ---------------------------------------------------------------------------

/**
 * packages/workflow/src/interfaces.ts:2249-2263. In TypeScript this is a union
 * type plus a `NodeConnectionTypes` const object; the const object is the part
 * with a runtime existence, so it is ported here. Order is the reference order.
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
};

/**
 * The paired-item accessor names `WorkflowDataProxy` reserves on `$('node')` and
 * `$input` (workflow-data-proxy.ts, PAIRED_ITEM_METHOD). Ported for surface
 * parity: the *resolution algorithm* behind them is declared NOT PORTED, but the
 * names have to be known so the stub can refuse them instead of returning
 * undefined (the inert-field pattern of CROSS-AGENT-ISSUES ISSUE-016).
 */
export const PAIRED_ITEM_METHOD = {
	PAIRED_ITEM: 'pairedItem',
	ITEM_MATCHING: 'itemMatching',
	ITEM: 'item',
	$GET_PAIRED_ITEM: '$getPairedItem',
};
