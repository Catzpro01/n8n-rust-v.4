/**
 * @lego/execution-engine — reconstructed n8n 2.9.4 workflow execution engine.
 *
 * Public surface (the seam for later LEGOs / Rust):
 *   - WorkflowExecute          the core execute loop            (POOL-001)
 *   - ExecuteContext           node context + data proxy        (POOL-002)
 *   - WorkflowDataProxy        `$json`/`$node`/`$items`/…       (POOL-002)
 *   - retry / error policy     retry.mjs, error-handling.mjs    (POOL-003)
 *
 * The package has no runtime dependencies and runs on plain Node.js ESM.
 */

export { WorkflowExecute, getMainOutputCount, getNodeOutputs, LOOP_ERRORS } from './workflow-execute.mjs';
export {
	ExecuteContext,
	NO_OP_LOGGER,
	constructExecutionMetaData,
	copyInputItems,
	getParameterValue,
	normalizeItems,
	returnJsonArray,
} from './node-execution-context.mjs';
export { DataProxyDateTime, WorkflowDataProxy, resolvePairedItemJson } from './data-proxy.mjs';
export {
	RETRY_LIMITS,
	resolveRetryPolicy,
	sleep,
	withRetry,
} from './retry.mjs';
export {
	ERROR_STRATEGIES,
	buildErrorItem,
	continuesOnError,
	errorPassThrough,
	mergeErrorInformation,
	resolveErrorStrategy,
	splitErrorOutputs,
} from './error-handling.mjs';
export {
	addNodeToBeExecuted,
	incomingConnectionIsEmpty,
	isLegacyExecutionOrder,
	prepareWaitingToExecution,
} from './execution-stack.mjs';
export {
	createDestinationNode,
	createEmptyRunExecutionData,
	createErrorExecutionData,
	createRunExecutionData,
	RUN_EXECUTION_DATA_VERSION,
} from './run-execution-data.mjs';
export {
	ApplicationError,
	NodeApiError,
	NodeOperationError,
	UnexpectedError,
	errorMessageOf,
	isSoftFailure,
	toExecutionError,
} from './errors.mjs';
export { ExpressionError, evaluateCode, evaluateExpressionValue, isExpression, resolveParameterValue } from './expression.mjs';
export { NodeTypesRegistry, ReconstructedWorkflow, isTriggerLike } from './workflow.mjs';
