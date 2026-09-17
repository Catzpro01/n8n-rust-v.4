/**
 * Node-type vocabulary used by `Workflow.__getStartNode`.
 * 1:1 from `reference/n8n/packages/workflow/src/constants.ts:29-59` and `:87`.
 *
 * `STARTING_NODE_TYPES` and `MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE` are **re-exported** from
 * `./start-node-navigation` rather than redefined: that module (landed by TASK-DGRAPH-01) owns
 * them, and `index.ts` re-exports both files, so a second definition here would be an ambiguous
 * export and a second copy of the same reference table. The five named constants below are the
 * per-type aliases the reference declares at `constants.ts:29-51`; they are additive.
 */

export {
	STARTING_NODE_TYPES,
	MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE,
} from './start-node-navigation';

export const MANUAL_TRIGGER_NODE_TYPE = 'n8n-nodes-base.manualTrigger';
export const EVALUATION_TRIGGER_NODE_TYPE = 'n8n-nodes-base.evaluationTrigger';
export const ERROR_TRIGGER_NODE_TYPE = 'n8n-nodes-base.errorTrigger';
export const EXECUTE_WORKFLOW_TRIGGER_NODE_TYPE = 'n8n-nodes-base.executeWorkflowTrigger';
export const FORM_TRIGGER_NODE_TYPE = 'n8n-nodes-base.formTrigger';
