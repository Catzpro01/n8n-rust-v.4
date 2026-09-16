/** P-KERNEL-OBSERVABLE — static-data change tracking (ObservableObject.create). */
import type { WorkflowLegoPorts } from './contracts';
import { impl } from './runtime';

export const create: WorkflowLegoPorts['observableObject']['create'] = (...args) =>
	impl<WorkflowLegoPorts>().observableObject.create(...args);
