/**
 * Vocabulary snapshot for the Workflow LEGO reconstruction.
 *
 * These values are copied verbatim from the pinned reference so the
 * reconstruction cannot drift from them silently:
 *   `reference/n8n/packages/workflow/src/constants.ts:25-59,87`
 *
 * The snapshot is asserted against the real `n8n-workflow@2.9.1` export in
 * `test/01-graph-parity.test.ts`, so a reference upgrade breaks a test instead
 * of silently changing start-node selection.
 */

export const MANUAL_TRIGGER_NODE_TYPE = 'n8n-nodes-base.manualTrigger';
export const EXECUTE_WORKFLOW_TRIGGER_NODE_TYPE = 'n8n-nodes-base.executeWorkflowTrigger';
export const ERROR_TRIGGER_NODE_TYPE = 'n8n-nodes-base.errorTrigger';
export const EVALUATION_TRIGGER_NODE_TYPE = 'n8n-nodes-base.evaluationTrigger';
export const FORM_TRIGGER_NODE_TYPE = 'n8n-nodes-base.formTrigger';

/** `constants.ts:53-59` — ordering is significant: `__getStartNode` sorts by index. */
export const STARTING_NODE_TYPES: string[] = [
	MANUAL_TRIGGER_NODE_TYPE,
	EXECUTE_WORKFLOW_TRIGGER_NODE_TYPE,
	ERROR_TRIGGER_NODE_TYPE,
	EVALUATION_TRIGGER_NODE_TYPE,
	FORM_TRIGGER_NODE_TYPE,
];

/** `constants.ts:87`. */
export const MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE =
	'@n8n/n8n-nodes-langchain.manualChatTrigger';

/** `interfaces.ts` — `NodeConnectionTypes.Main`. */
export const MAIN_CONNECTION_TYPE = 'main';
