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
 * Not reconstructed in this slice (contract §12.2.6): the execution half of the same file —
 * `arrayContainsValue`, `executeFilterCondition`, `executeFilter`, `parseRegexPattern` —
 * which evaluates conditions against data and needs the luxon-backed date operators. The
 * `validateFilterParameter` path never calls them.
 *
 * Boundaries: leaf-ish module — `./errors.mjs` (ApplicationError, DELTA-03) and
 * `./type-validation.mjs` (validateFieldType). No logging adapter: the reference's
 * `LoggerProxy.warn` sits in `executeFilter`, which is not reconstructed here.
 */

import { ApplicationError } from './errors.mjs';
import { validateFieldType } from './type-validation.mjs';

export class FilterError extends ApplicationError {
	constructor(message, description) {
		super(message, { level: 'warning' });
		this.description = description;
	}
}

function parseSingleFilterValue(value, type, strict = false, version = 1) {
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

	return validateFieldType('filter', value, type, { strict, parseStrings: true });
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
	);
	const parsedRightValue = parseSingleFilterValue(condition.rightValue, rightType, strict, version);
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
