/**
 * P-NODE-MODEL — peer LEGO 02 (Node Model).
 *
 * Consumed as a namespace import by the Workflow aggregate:
 *   NodeHelpers.getNodeParameters(...)  → parameter defaults
 *   NodeHelpers.getNodeOutputs(...)     → output/connection resolution
 */
import type { WorkflowLegoPorts } from './contracts';
import { impl } from './runtime';

export const getNodeParameters: WorkflowLegoPorts['nodeModel']['getNodeParameters'] = (...args) =>
	impl<WorkflowLegoPorts>().nodeModel.getNodeParameters(...args);

export const getNodeOutputs: WorkflowLegoPorts['nodeModel']['getNodeOutputs'] = (...args) =>
	impl<WorkflowLegoPorts>().nodeModel.getNodeOutputs(...args);
