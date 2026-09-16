/** P-KERNEL-CONSTANTS — workflow-model constants owned by the shared kernel. */
import type { WorkflowLegoPorts } from './contracts';
import { impl } from './runtime';

export const STARTING_NODE_TYPES: WorkflowLegoPorts['constants']['STARTING_NODE_TYPES'] =
	impl<WorkflowLegoPorts>().constants.STARTING_NODE_TYPES;

export const MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE: WorkflowLegoPorts['constants']['MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE'] =
	impl<WorkflowLegoPorts>().constants.MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE;

export const NODES_WITH_RENAMABLE_CONTENT: WorkflowLegoPorts['constants']['NODES_WITH_RENAMABLE_CONTENT'] =
	impl<WorkflowLegoPorts>().constants.NODES_WITH_RENAMABLE_CONTENT;

export const NODES_WITH_RENAMABLE_FORM_HTML_CONTENT: WorkflowLegoPorts['constants']['NODES_WITH_RENAMABLE_FORM_HTML_CONTENT'] =
	impl<WorkflowLegoPorts>().constants.NODES_WITH_RENAMABLE_FORM_HTML_CONTENT;

export const NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT: WorkflowLegoPorts['constants']['NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT'] =
	impl<WorkflowLegoPorts>().constants.NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT;
