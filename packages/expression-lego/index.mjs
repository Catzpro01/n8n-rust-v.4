/**
 * Expression LEGO — public surface (boundary barrel).
 * Implements contracts/expression.contract.md §1.
 */
export { Expression, isExpression, createEmptyRunExecutionData, evaluateExpression } from './src/expression.mjs';
export { WorkflowDataProxy } from './src/data-proxy.mjs';
export {
	SCRIPTING_NODE_TYPES,
	BINARY_MODE_COMBINED,
	PAIRED_ITEM_METHOD,
	isScriptingNode,
	getPinDataIfManualExecution,
	createEnvProvider,
	createEnvProviderState,
	isResourceLocatorValue,
	getGlobalState,
	setGlobalState,
} from './src/support.mjs';
export {
	ExpressionError,
	ApplicationError,
	ExpressionExtensionError,
	ExpressionClassExtensionError,
	ExpressionWithStatementError,
	ExpressionDestructuringError,
	ExpressionComputedDestructuringError,
	ExpressionReservedVariableError,
} from './src/errors.mjs';
export { WorkflowGraphAdapter, getConnectedNodes, getNodeConnectionIndexes, mapConnectionsByDestination } from './src/graph-adapter.mjs';
export { isSafeObjectProperty, sanitizer, sanitizerName, DOLLAR_SIGN_ERROR } from './src/sandbox.mjs';
export { augmentObject, augmentArray } from './src/augment-object.mjs';
export { extend, extendOptional, extendedFunctions, extendSyntax, hasExpressionExtension, EXTENSION_OBJECTS } from './src/extensions.mjs';
