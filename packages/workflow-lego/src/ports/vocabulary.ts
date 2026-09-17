/**
 * P-KERNEL-TYPES — shared vocabulary.
 *
 * Types come from the pinned reference runtime (compile-time only, erased at
 * runtime). `NodeConnectionTypes` is a real value and therefore routed through
 * the port adapter (reference object / kernel snapshot in strict mode).
 */
import type { WorkflowLegoPorts } from './contracts';
import { impl } from './runtime';

export type {
	IConnectedNode,
	IConnection,
	IConnections,
	IDataObject,
	INode,
	INodeConnection,
	INodeExecutionData,
	INodeParameters,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	INodeTypes,
	INodes,
	IObservableObject,
	IPinData,
	IWorkflowSettings,
	NodeConnectionType,
	NodeParameterValueType,
} from 'n8n-workflow';

export const NodeConnectionTypes: WorkflowLegoPorts['vocabulary']['NodeConnectionTypes'] =
	impl<WorkflowLegoPorts>().vocabulary.NodeConnectionTypes;
