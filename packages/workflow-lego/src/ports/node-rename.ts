/** P-NODE-RENAME — peer LEGO 02 (Node Model): form-field renaming. */
import type { WorkflowLegoPorts } from './contracts';
import { impl } from './runtime';

export const renameFormFields: WorkflowLegoPorts['nodeRename']['renameFormFields'] = (...args) =>
	impl<WorkflowLegoPorts>().nodeRename.renameFormFields(...args);
