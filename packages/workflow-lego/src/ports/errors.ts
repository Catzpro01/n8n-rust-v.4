/** P-KERNEL-ERRORS — error kernel (n8n error classes with tags/extra/level). */
import type { WorkflowLegoPorts } from './contracts';
import { impl } from './runtime';

export const ApplicationError: WorkflowLegoPorts['errors']['ApplicationError'] =
	impl<WorkflowLegoPorts>().errors.ApplicationError;

export const UserError: WorkflowLegoPorts['errors']['UserError'] =
	impl<WorkflowLegoPorts>().errors.UserError;
