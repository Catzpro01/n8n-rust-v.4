import type { INode, NodeParameterValueType } from './interfaces';

/**
 * The node types whose *content* parameters are rewritten by `Workflow.renameNode` even when the
 * string is not an expression (`hasRenamableContent: true`).
 *
 * 1:1 from `reference/n8n/packages/workflow/src/constants.ts:35-45, 74-84`.
 */

export const CODE_NODE_TYPE = 'n8n-nodes-base.code';
export const FUNCTION_NODE_TYPE = 'n8n-nodes-base.function';
export const FUNCTION_ITEM_NODE_TYPE = 'n8n-nodes-base.functionItem';
export const AI_TRANSFORM_NODE_TYPE = 'n8n-nodes-base.aiTransform';
export const FORM_NODE_TYPE = 'n8n-nodes-base.form';
export const HTML_NODE_TYPE = 'n8n-nodes-base.html';
export const MAILGUN_NODE_TYPE = 'n8n-nodes-base.mailgun';

export const NODES_WITH_RENAMABLE_CONTENT = new Set([
	CODE_NODE_TYPE,
	FUNCTION_NODE_TYPE,
	FUNCTION_ITEM_NODE_TYPE,
	AI_TRANSFORM_NODE_TYPE,
]);

export const NODES_WITH_RENAMABLE_FORM_HTML_CONTENT = new Set([FORM_NODE_TYPE]);

export const NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT = new Set([
	MAILGUN_NODE_TYPE,
	HTML_NODE_TYPE,
]);

/**
 * 1:1 reconstruction of
 * `reference/n8n/packages/workflow/src/node-parameters/rename-node-utils.ts` (29 lines).
 *
 * Mutates in place (returns `void`): only `formFields.values[].html` entries whose `fieldType`
 * is `'html'` are rewritten. The defensive `Array.isArray(formFields.values)` guard and the
 * `continue` on non-object entries are kept as written.
 */
export function renameFormFields(
	node: INode,
	renameField: (v: NodeParameterValueType) => NodeParameterValueType,
): void {
	const formFields = node.parameters?.formFields as Record<string, unknown> | undefined;

	const values =
		formFields &&
		typeof formFields === 'object' &&
		'values' in formFields &&
		typeof formFields.values === 'object' &&
		Array.isArray(formFields.values)
			? (formFields.values ?? [])
			: [];

	for (const formFieldValue of values as Array<Record<string, unknown> | undefined>) {
		if (!formFieldValue || typeof formFieldValue !== 'object') continue;
		if ('fieldType' in formFieldValue && formFieldValue.fieldType === 'html') {
			if ('html' in formFieldValue) {
				formFieldValue.html = renameField(formFieldValue.html as NodeParameterValueType);
			}
		}
	}
}
