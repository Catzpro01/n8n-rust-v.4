/** P-KERNEL-CONFIG — global configuration the model reads (default timezone). */
import type { WorkflowLegoPorts } from './contracts';
import { impl } from './runtime';

export const getGlobalState: WorkflowLegoPorts['config']['getGlobalState'] = () =>
	impl<WorkflowLegoPorts>().config.getGlobalState();
