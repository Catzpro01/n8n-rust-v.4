/**
 * P-EXPRESSION-RUNTIME — runtime concern, explicitly OUT OF SCOPE for Phase 2.
 *
 * The Workflow aggregate attaches an expression runtime to itself in its
 * constructor (`this.expression = new Expression(this)`). That dependency is
 * declared here so the boundary is explicit instead of hidden.
 */
import type { ExpressionLike, WorkflowLegoPorts } from './contracts';
import { impl } from './runtime';

/** Instance shape the model relies on. */
export interface Expression extends ExpressionLike {}

export const Expression: WorkflowLegoPorts['expressionRuntime']['Expression'] =
	impl<WorkflowLegoPorts>().expressionRuntime.Expression;
