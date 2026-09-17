/**
 * 1:1 reconstruction of the node-reference rewriting half of
 * `reference/n8n/packages/workflow/src/node-reference-parser-utils.ts`
 * (n8n 2.9.4, commit `b6dc2787c45677a29a9612cd27eb911302961a83`).
 *
 * Only the four symbols `Workflow.renameNode` reaches are reconstructed:
 * `hasDotNotationBannedChar`, `backslashEscape`, `dollarEscape`, `applyAccessPatterns`
 * (plus the private `ACCESS_PATTERNS` table). The rest of that 643-line file belongs to the
 * expression/parameter-extraction surface and is out of this LEGO's scope.
 *
 * Accepted by the `rename/parameter-references-rewritten` fixture:
 * `"={{ $('A').item.json.x }}"` → `"={{ $('Alpha').item.json.x }}"`, while a plain (non-`=`)
 * string `'A'` is left untouched by `renameNodeInParameterValue`.
 */

/**
 * Reference quirk, reproduced verbatim: the pattern carries the `g` flag and is used with
 * `.test()`, which makes it **stateful** (`lastIndex` advances between calls on the same regex
 * object). "Fixing" it to a non-global pattern would change results on repeated calls, and the
 * `$node.` access pattern below calls this inside `applyAccessPatterns`.
 */
export function hasDotNotationBannedChar(nodeName: string) {
	const DOT_NOTATION_BANNED_CHARS = /^(\d)|[\\ `!@#$%^&*()_+\-=[\]{};':"\\|,.<>?~]/g;

	return DOT_NOTATION_BANNED_CHARS.test(nodeName);
}

export function backslashEscape(nodeName: string) {
	const BACKSLASH_ESCAPABLE_CHARS = /[.*+?^${}()|[\]\\]/g;

	return nodeName.replace(BACKSLASH_ESCAPABLE_CHARS, (char) => `\\${char}`);
}

export function dollarEscape(nodeName: string) {
	return nodeName.replace(new RegExp('\\$', 'g'), '$$$$');
}

type AccessPattern = {
	checkPattern: string;
	replacePattern: (name: string) => string;
	customCallback?: (expression: string, newName: string, escapedNewName: string) => string;
};

const ACCESS_PATTERNS: AccessPattern[] = [
	{
		checkPattern: '$(',
		replacePattern: (s) => String.raw`(\$\(['"])${s}(['"]\))`,
	},
	{
		checkPattern: '$node[',
		replacePattern: (s) => String.raw`(\$node\[['"])${s}(['"]\])`,
	},
	{
		checkPattern: '$node.',
		replacePattern: (s) => String.raw`(\$node\.)${s}(\.?)`,
		customCallback: (expression: string, newName: string, escapedNewName: string) => {
			if (hasDotNotationBannedChar(newName)) {
				const regex = new RegExp(`.${backslashEscape(newName)}( |\\.)`, 'g');
				return expression.replace(regex, `["${escapedNewName}"]$1`);
			}
			return expression;
		},
	},
	{
		checkPattern: '$items(',
		replacePattern: (s) => String.raw`(\$items\(['"])${s}(['"],|['"]\))`,
	},
];

export function applyAccessPatterns(expression: string, previousName: string, newName: string) {
	// To not run the "expensive" regex stuff when it is not needed
	// make a simple check first if it really contains the node-name
	if (!expression.includes(previousName)) return expression;

	// Really contains node-name (even though we do not know yet if really as $node-expression)
	const escapedOldName = backslashEscape(previousName); // for match
	const escapedNewName = dollarEscape(newName); // for replacement

	for (const pattern of ACCESS_PATTERNS) {
		if (expression.includes(pattern.checkPattern)) {
			expression = expression.replace(
				new RegExp(pattern.replacePattern(escapedOldName), 'g'),
				`$1${escapedNewName}$2`,
			);

			if (pattern.customCallback) {
				expression = pattern.customCallback(expression, newName, escapedNewName);
			}
		}
	}
	return expression;
}
