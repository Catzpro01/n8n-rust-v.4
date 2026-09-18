'use strict';
/**
 * @lego/expression — Agent 4.
 * 1:1 JavaScript port of n8n@2.9.4 Expression / WorkflowDataProxy.
 * ZERO Rust.
 */
const { Expression, isExpression, WorkflowDataProxy } = require('./expression');
const { ExpressionError, ExpressionExtensionError, ApplicationError } = require('./errors');

module.exports = {
	Expression,
	isExpression,
	WorkflowDataProxy,
	ExpressionError,
	ExpressionExtensionError,
	ApplicationError,
};
