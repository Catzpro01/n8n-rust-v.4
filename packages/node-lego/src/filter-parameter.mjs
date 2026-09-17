/**
 * Filter-parameter VALIDATION — the `validateFilterParameter` surface the
 * parameter-issues engine calls for every displayed `filter` parameter.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/node-parameters/filter-parameter.ts
 *     - FilterError                     L23-30
 *     - parseSingleFilterValue          L32-64
 *     - withIndefiniteArticle           L66-69
 *     - parseFilterConditionValues      L71-194
 *     - validateFilterParameter         L427-450
 *
 * Pinned reference quirk (differentially verified, do NOT "fix"): `validateFilterParameter`
 * iterates the conditions and catches `FilterError`, but `parseFilterConditionValues`
 * *returns* a `{ ok: false, error }` Result instead of throwing. The catch block is
 * therefore unreachable and the function returns `{}` for every input — and it would throw
 * a TypeError (`issues[key].push` on `undefined`) if it ever were reached.
 *
 *   reference/n8n/packages/workflow/src/node-parameters/filter-parameter.ts (execution half)
 *     - parseRegexPattern               L196-207
 *     - arrayContainsValue              L209-220
 *     - executeFilterCondition          L222-404
 *     - executeFilter                   L409-424
 *
 * DELTA-06: the reference logs through the `LoggerProxy` module singleton. A LEGO must not own
 * a logging transport, so the two `warn` call sites (`unknown operator` and
 * `unknown filter combinator`) go through an injected logger carried on the `metadata` object /
 * the `executeFilter` options — default is a no-op, matching rule E01 elsewhere. The same
 * metadata carries the DELTA-04 `dateTimeFactory` into `parseSingleFilterValue`, so date
 * conditions are parsed by the same factory as everywhere else in this package.
 *
 * Boundaries: leaf-ish module — `./errors.mjs` (ApplicationError, DELTA-03) and
 * `./type-validation.mjs` (validateFieldType). Date operators compare via the `toMillis()` of
 * whatever the DELTA-04 date-time factory returned, so no date library is imported here.
 */

import { ApplicationError } from './errors.mjs';
import { validateFieldType } from './type-validation.mjs';

const NOOP_LOGGER = { warn: () => {} };

export class FilterError extends ApplicationError {
	constructor(message, description) {
		super(message, { level: 'warning' });
		this.description = description;
	}
}

function parseSingleFilterValue(value, type, strict = false, version = 1, dateTimeFactory) {
	if (type === 'any' || value === null || value === undefined) {
		return { valid: true, newValue: value };
	}

	if (type === 'boolean' && !strict) {
		if (version >= 2) {
			const result = validateFieldType('filter', value, type);
			if (result.valid) return result;
		}

		return { valid: true, newValue: Boolean(value) };
	}

	if (type === 'number') {
		if (Number.isNaN(value)) {
			return { valid: true, newValue: value };
		}
		const isEmptyString = typeof value === 'string' && value.trim() === '';
		const isEmptyArray = Array.isArray(value) && value.length === 0;
		// Number('') and Number([]) convert to 0 in validateFieldType, which is not intuitive, consider them empty values
		if ((isEmptyString || isEmptyArray) && version >= 3) {
			return { valid: true, newValue: null };
		}
	}

	return validateFieldType('filter', value, type, { strict, parseStrings: true, dateTimeFactory });
}

const withIndefiniteArticle = (noun) => {
	const article = 'aeiou'.includes(noun.charAt(0)) ? 'an' : 'a';
	return `${article} ${noun}`;
};

function parseFilterConditionValues(condition, options, metadata) {
	const index = metadata.index ?? 0;
	const itemIndex = metadata.itemIndex ?? 0;
	const errorFormat = metadata.errorFormat ?? 'full';
	const strict = options.typeValidation === 'strict';
	const version = options.version ?? 1;
	const { operator } = condition;
	const rightType = operator.rightType ?? operator.type;
	const parsedLeftValue = parseSingleFilterValue(
		condition.leftValue,
		operator.type,
		strict,
		version,
		metadata.dateTimeFactory,
	);
	const parsedRightValue = parseSingleFilterValue(
		condition.rightValue,
		rightType,
		strict,
		version,
		metadata.dateTimeFactory,
	);
	const leftValid =
		parsedLeftValue.valid ||
		(metadata.unresolvedExpressions &&
			typeof condition.leftValue === 'string' &&
			condition.leftValue.startsWith('='));
	const rightValid =
		parsedRightValue.valid ||
		!!operator.singleValue ||
		(metadata.unresolvedExpressions &&
			typeof condition.rightValue === 'string' &&
			condition.rightValue.startsWith('='));
	const leftValueString = String(condition.leftValue);
	const rightValueString = String(condition.rightValue);
	const suffix =
		errorFormat === 'full' ? `[condition ${index}, item ${itemIndex}]` : `[item ${itemIndex}]`;

	const composeInvalidTypeMessage = (type, fromType, value) => {
		fromType = fromType.toLocaleLowerCase();
		if (strict) {
			return `Wrong type: '${value}' is ${withIndefiniteArticle(
				fromType,
			)} but was expecting ${withIndefiniteArticle(type)} ${suffix}`;
		}
		return `Conversion error: the ${fromType} '${value}' can't be converted to ${withIndefiniteArticle(
			type,
		)} ${suffix}`;
	};

	const getTypeDescription = (isStrict) => {
		if (isStrict)
			return "Try changing the type of comparison. Alternatively you can enable 'Convert types where required'.";
		return 'Try changing the type of the comparison.';
	};

	const composeInvalidTypeDescription = (type, fromType, valuePosition) => {
		fromType = fromType.toLocaleLowerCase();
		const expectedType = withIndefiniteArticle(type);

		let convertionFunction = '';
		if (type === 'string') {
			convertionFunction = '.toString()';
		} else if (type === 'number') {
			convertionFunction = '.toNumber()';
		} else if (type === 'boolean') {
			convertionFunction = '.toBoolean()';
		}

		if (strict && convertionFunction) {
			const suggestFunction = ` by adding <code>${convertionFunction}</code>`;
			return `
<p>Try either:</p>
<ol>
  <li>Enabling 'Convert types where required'</li>
  <li>Converting the ${valuePosition} field to ${expectedType}${suggestFunction}</li>
</ol>
			`;
		}

		return getTypeDescription(strict);
	};

	if (!leftValid && !rightValid && typeof condition.leftValue === typeof condition.rightValue) {
		return {
			ok: false,
			error: new FilterError(
				`Comparison type expects ${withIndefiniteArticle(operator.type)} but both fields are ${withIndefiniteArticle(
					typeof condition.leftValue,
				)}`,
				getTypeDescription(strict),
			),
		};
	}

	if (!leftValid) {
		return {
			ok: false,
			error: new FilterError(
				composeInvalidTypeMessage(operator.type, typeof condition.leftValue, leftValueString),
				composeInvalidTypeDescription(operator.type, typeof condition.leftValue, 'first'),
			),
		};
	}

	if (!rightValid) {
		return {
			ok: false,
			error: new FilterError(
				composeInvalidTypeMessage(rightType, typeof condition.rightValue, rightValueString),
				composeInvalidTypeDescription(rightType, typeof condition.rightValue, 'second'),
			),
		};
	}

	return {
		ok: true,
		result: {
			left: parsedLeftValue.valid ? parsedLeftValue.newValue : undefined,
			right: parsedRightValue.valid ? parsedRightValue.newValue : undefined,
		},
	};
}

export const validateFilterParameter = (nodeProperties, value) => {
	return value.conditions.reduce((issues, condition, index) => {
		const key = `${nodeProperties.name}.${index}`;

		try {
			parseFilterConditionValues(condition, value.options, {
				index,
				unresolvedExpressions: true,
				errorFormat: 'inline',
			});
		} catch (error) {
			if (error instanceof FilterError) {
				issues[key].push(error.message);
			}
		}

		return issues;
	}, {});
};

function parseRegexPattern(pattern) {
	const regexMatch = (pattern || '').match(new RegExp('^/(.*?)/([gimusy]*)$'));
	let regex;

	if (!regexMatch) {
		regex = new RegExp((pattern || '').toString());
	} else {
		regex = new RegExp(regexMatch[1], regexMatch[2]);
	}

	return regex;
}

export function arrayContainsValue(array, value, ignoreCase) {
	if (ignoreCase && typeof value === 'string') {
		return array.some((item) => {
			if (typeof item !== 'string') {
				return false;
			}
			return item.toString().toLocaleLowerCase() === value.toLocaleLowerCase();
		});
	}
	return array.includes(value);
}

export function executeFilterCondition(condition, filterOptions, metadata = {}) {
	const ignoreCase = !filterOptions.caseSensitive;
	const { operator } = condition;
	const parsedValues = parseFilterConditionValues(condition, filterOptions, metadata);

	if (!parsedValues.ok) {
		throw parsedValues.error;
	}

	let { left: leftValue, right: rightValue } = parsedValues.result;

	const exists = leftValue !== undefined && leftValue !== null && !Number.isNaN(leftValue);
	if (condition.operator.operation === 'exists') {
		return exists;
	} else if (condition.operator.operation === 'notExists') {
		return !exists;
	}

	switch (operator.type) {
		case 'string': {
			if (ignoreCase) {
				if (typeof leftValue === 'string') {
					leftValue = leftValue.toLocaleLowerCase();
				}

				if (
					typeof rightValue === 'string' &&
					!(condition.operator.operation === 'regex' || condition.operator.operation === 'notRegex')
				) {
					rightValue = rightValue.toLocaleLowerCase();
				}
			}

			const left = leftValue ?? '';
			const right = rightValue ?? '';

			switch (condition.operator.operation) {
				case 'empty':
					return left.length === 0;
				case 'notEmpty':
					return left.length !== 0;
				case 'equals':
					return left === right;
				case 'notEquals':
					return left !== right;
				case 'contains':
					return left.includes(right);
				case 'notContains':
					return !left.includes(right);
				case 'startsWith':
					return left.startsWith(right);
				case 'notStartsWith':
					return !left.startsWith(right);
				case 'endsWith':
					return left.endsWith(right);
				case 'notEndsWith':
					return !left.endsWith(right);
				case 'regex':
					return parseRegexPattern(right).test(left);
				case 'notRegex':
					return !parseRegexPattern(right).test(left);
			}

			break;
		}
		case 'number': {
			const left = leftValue;
			const right = rightValue;

			switch (condition.operator.operation) {
				case 'empty':
					return !exists;
				case 'notEmpty':
					return exists;
				case 'equals':
					return left === right;
				case 'notEquals':
					return left !== right;
				case 'gt':
					return left > right;
				case 'lt':
					return left < right;
				case 'gte':
					return left >= right;
				case 'lte':
					return left <= right;
			}
		}
		// eslint-disable-next-line no-fallthrough -- mirrors the reference's switch (no break)
		case 'dateTime': {
			const left = leftValue;
			const right = rightValue;

			if (condition.operator.operation === 'empty') {
				return !exists;
			} else if (condition.operator.operation === 'notEmpty') {
				return exists;
			}

			if (!left || !right) {
				return false;
			}

			switch (condition.operator.operation) {
				case 'equals':
					return left.toMillis() === right.toMillis();
				case 'notEquals':
					return left.toMillis() !== right.toMillis();
				case 'after':
					return left.toMillis() > right.toMillis();
				case 'before':
					return left.toMillis() < right.toMillis();
				case 'afterOrEquals':
					return left.toMillis() >= right.toMillis();
				case 'beforeOrEquals':
					return left.toMillis() <= right.toMillis();
			}
		}
		// eslint-disable-next-line no-fallthrough -- mirrors the reference's switch (no break)
		case 'boolean': {
			const left = leftValue;
			const right = rightValue;

			switch (condition.operator.operation) {
				case 'empty':
					return !exists;
				case 'notEmpty':
					return exists;
				case 'true':
					return left;
				case 'false':
					return !left;
				case 'equals':
					return left === right;
				case 'notEquals':
					return left !== right;
			}
		}
		// eslint-disable-next-line no-fallthrough -- mirrors the reference's switch (no break)
		case 'array': {
			const left = leftValue ?? [];
			const rightNumber = rightValue;

			switch (condition.operator.operation) {
				case 'contains':
					return arrayContainsValue(left, rightValue, ignoreCase);
				case 'notContains':
					return !arrayContainsValue(left, rightValue, ignoreCase);
				case 'lengthEquals':
					return left.length === rightNumber;
				case 'lengthNotEquals':
					return left.length !== rightNumber;
				case 'lengthGt':
					return left.length > rightNumber;
				case 'lengthLt':
					return left.length < rightNumber;
				case 'lengthGte':
					return left.length >= rightNumber;
				case 'lengthLte':
					return left.length <= rightNumber;
				case 'empty':
					return left.length === 0;
				case 'notEmpty':
					return left.length !== 0;
			}
		}
		// eslint-disable-next-line no-fallthrough -- mirrors the reference's switch (no break)
		case 'object': {
			const left = leftValue;

			switch (condition.operator.operation) {
				case 'empty':
					return !left || Object.keys(left).length === 0;
				case 'notEmpty':
					return !!left && Object.keys(left).length !== 0;
			}
		}
	}

	(metadata.logger ?? NOOP_LOGGER).warn(
		`Unknown filter parameter operator "${operator.type}:${operator.operation}"`,
	);

	return false;
}

export function executeFilter(value, { itemIndex, logger } = {}) {
	const conditionPass = (condition, index) =>
		executeFilterCondition(condition, value.options, { index, itemIndex, logger });

	if (value.combinator === 'and') {
		return value.conditions.every(conditionPass);
	} else if (value.combinator === 'or') {
		return value.conditions.some(conditionPass);
	}

	(logger ?? NOOP_LOGGER).warn(`Unknown filter combinator "${value.combinator}"`);

	return false;
}
