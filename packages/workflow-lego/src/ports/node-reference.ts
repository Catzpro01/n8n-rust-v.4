/** P-NODE-REFERENCE — peer LEGO 02 (Node Model): node reference access patterns. */
import type { WorkflowLegoPorts } from './contracts';
import { impl } from './runtime';

export const applyAccessPatterns: WorkflowLegoPorts['nodeReference']['applyAccessPatterns'] = (...args) =>
	impl<WorkflowLegoPorts>().nodeReference.applyAccessPatterns(...args);
