/** P-KERNEL-UTILS — pure helpers used by the model. */
import type { WorkflowLegoPorts } from './contracts';
import { impl } from './runtime';

export const dedupe: WorkflowLegoPorts['utils']['dedupe'] = (...args) => impl<WorkflowLegoPorts>().utils.dedupe(...args);

export const isObject: WorkflowLegoPorts['utils']['isObject'] = (value) =>
	impl<WorkflowLegoPorts>().utils.isObject(value);
