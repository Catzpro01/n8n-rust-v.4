/**
 * Node-type vocabulary used by `Workflow.__getStartNode`.
 * 1:1 from `reference/n8n/packages/workflow/src/constants.ts:29-59` and `:87`.
 */

export const MANUAL_TRIGGER_NODE_TYPE = 'n8n-nodes-base.manualTrigger';
export const EVALUATION_TRIGGER_NODE_TYPE = 'n8n-nodes-base.evaluationTrigger';
export const ERROR_TRIGGER_NODE_TYPE = 'n8n-nodes-base.errorTrigger';
export const EXECUTE_WORKFLOW_TRIGGER_NODE_TYPE = 'n8n-nodes-base.executeWorkflowTrigger';
export const FORM_TRIGGER_NODE_TYPE = 'n8n-nodes-base.formTrigger';

/** Reference: `constants.ts:53-59` — the fallback start-node search order. */
export const STARTING_NODE_TYPES = [
	MANUAL_TRIGGER_NODE_TYPE,
	EXECUTE_WORKFLOW_TRIGGER_NODE_TYPE,
	ERROR_TRIGGER_NODE_TYPE,
	EVALUATION_TRIGGER_NODE_TYPE,
	FORM_TRIGGER_NODE_TYPE,
];

/** Reference: `constants.ts:87`. */
export const MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE =
	'@n8n/n8n-nodes-langchain.manualChatTrigger';
