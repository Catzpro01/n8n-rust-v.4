/**
 * Field-type validation — the `validateFieldType` surface the parameter-issues engine
 * calls for every `validateType` parameter and every resource-mapper field.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/type-validation.ts
 *     - tryToParseNumber / tryToParseString / tryToParseAlphanumericString / tryToParseBoolean
 *       L15-70
 *     - tryToParseDateTime  L72-112   (luxon-backed in the reference)
 *     - tryToParseTime      L114-122
 *     - tryToParseArray     L124-143
 *     - tryToParseObject    L146-160   (jsonParse + parseJSObject)
 *     - tryToParseBinary    L162-168
 *     - ALLOWED_FORM_FIELDS_KEYS / ALLOWED_FIELD_TYPES / tryToParseJsonToFormFields L170-268
 *     - getValueDescription L272-280
 *     - ALLOWED_URL_PROTOCOLS / tryToParseUrl / tryToParseJwt L282-324
 *     - validateFieldType   L326-481
 *   reference/n8n/packages/workflow/src/utils.ts
 *     - jsonParse L152-180  (the `acceptJSObject` / `repairJSON` recovery options)
 *     - parseJSObject L123-130 (esprima-backed in the reference)
 *   reference/n8n/packages/workflow/src/type-guards.ts
 *     - isBinaryValue L168-174
 *
 * Deltas (contract §12.2):
 *   DELTA-04 — no `luxon` runtime dependency. `tryToParseDateTime` takes an injected
 *     `dateTimeFactory` implementing the luxon subset the reference uses
 *     (`isDateTime`, `fromJSDate`, `fromISO`, `fromHTTP`, `fromRFC2822`, `fromSQL`,
 *     `fromMillis`). The default factory is dependency-free and understands JS `Date`,
 *     ISO-8601, HTTP-date/RFC-2822 and `YYYY-MM-DD HH:mm:ss` strings; every other luxon
 *     format needs the injected factory. The differential injects the reference's own
 *     luxon factory, so the cascade below is compared bit-for-bit.
 *   DELTA-05 — no `esprima`/`jsonrepair`. `jsonParse`'s `acceptJSObject` and `repairJSON`
 *     recovery paths are delegated to injectable adapters; the default `parseJSObject`
 *     handles the common relaxed-JS-object shape (unquoted/-single-quoted keys and
 *     strings, trailing commas) instead of a full JS parser, and the default
 *     `repairJSONParser` is the dependency-free port of the exact `jsonrepair` version the
 *     reference bundles (`src/json-repair.mjs`), so the `repairJSON` path is no longer a no-op.
 *
 * Boundaries: leaf module — it depends only on `./errors.mjs` (ApplicationError, DELTA-02/03),
 * `./json-repair.mjs` and the injected adapters above. No package or JSON-parsing dependency
 * is imported.
 */

import { ApplicationError } from './errors.mjs';
import { jsonrepair } from './json-repair.mjs';
import { isObject } from './lodash-lite.mjs';

export const tryToParseNumber = (value) => {
	const isValidNumber = !Number.isNaN(Number(value));

	if (!isValidNumber) {
		throw new ApplicationError('Failed to parse value to number', { extra: { value } });
	}
	return Number(value);
};

export const tryToParseString = (value) => {
	if (typeof value === 'object') return JSON.stringify(value);
	if (typeof value === 'undefined') return '';
	if (
		typeof value === 'string' ||
		typeof value === 'bigint' ||
		typeof value === 'boolean' ||
		typeof value === 'number'
	) {
		return value.toString();
	}

	return String(value);
};

export const tryToParseAlphanumericString = (value) => {
	const parsed = tryToParseString(value);
	// We do not allow special characters, only letters, numbers and underscore
	// Numbers not allowed as the first character
	const regex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
	if (!regex.test(parsed)) {
		throw new ApplicationError('Value is not a valid alphanumeric string', { extra: { value } });
	}
	return parsed;
};

export const tryToParseBoolean = (value) => {
	if (typeof value === 'boolean') {
		return value;
	}

	if (typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase())) {
		return value.toLowerCase() === 'true';
	}

	// If value is not a empty string, try to parse it to a number
	if (!(typeof value === 'string' && value.trim() === '')) {
		const num = Number(value);
		if (num === 0) {
			return false;
		} else if (num === 1) {
			return true;
		}
	}

	throw new ApplicationError('Failed to parse value as boolean', {
		extra: { value },
	});
};

/**
 * The luxon-subset `tryToParseDateTime` needs, dependency-free (DELTA-04).
 *
 * Every factory method returns a value exposing `isValid`; a valid result also exposes
 * `toISO()`/`toMillis()` so callers can keep working with the parsed value. Inject a
 * luxon-compatible factory (`{ isDateTime, fromJSDate, fromISO, fromHTTP, fromRFC2822,
 * fromSQL, fromMillis }`) to get luxon's full format coverage — the differential does
 * exactly that, so this module's cascade is exercised identically on both sides.
 */
const parseZoneSuffix = (dateString) => {
	// `2024-01-02T03:04:05+07:00` / `...Z` are handled by Date.parse directly; luxon's
	// `setZone` semantics only matter for the zone metadata we do not keep (DELTA-04).
	return dateString;
};

const makeDateTime = (date) => ({
	isValid: !Number.isNaN(date.getTime()),
	toISO: () => date.toISOString(),
	toJSDate: () => date,
	toMillis: () => date.getTime(),
});

const ISO_PATTERN =
	/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const SQL_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/;

export const defaultDateTimeFactory = {
	isDateTime: (value) =>
		value instanceof Date ||
		(value !== null &&
			typeof value === 'object' &&
			typeof value.isValid === 'boolean' &&
			typeof value.toISO === 'function'),
	fromJSDate: (value) => makeDateTime(new Date(value.getTime())),
	fromISO: (value) =>
		ISO_PATTERN.test(String(value).trim())
			? makeDateTime(new Date(parseZoneSuffix(String(value).trim())))
			: { isValid: false },
	fromHTTP: (value) => makeDateTime(new Date(String(value).trim())),
	fromRFC2822: (value) => makeDateTime(new Date(String(value).trim())),
	fromSQL: (value) =>
		SQL_PATTERN.test(String(value).trim())
			? makeDateTime(new Date(String(value).trim().replace(' ', 'T')))
			: { isValid: false },
	fromMillis: (value) => makeDateTime(new Date(Number(value))),
};

export const tryToParseDateTime = (value, defaultZone, dateTimeFactory = defaultDateTimeFactory) => {
	if (dateTimeFactory.isDateTime(value) && value.isValid) {
		// Ignore the defaultZone if the value is already a DateTime
		// because DateTime objects already contain the zone information
		return value;
	}

	if (value instanceof Date) {
		const fromJSDate = dateTimeFactory.fromJSDate(value, { zone: defaultZone });
		if (fromJSDate.isValid) {
			return fromJSDate;
		}
	}

	const dateString = String(value).trim();

	// Rely on the injected factory to parse the different date formats
	const isoDate = dateTimeFactory.fromISO(dateString, { zone: defaultZone, setZone: true });
	if (isoDate.isValid) {
		return isoDate;
	}
	const httpDate = dateTimeFactory.fromHTTP(dateString, { zone: defaultZone, setZone: true });
	if (httpDate.isValid) {
		return httpDate;
	}
	const rfc2822Date = dateTimeFactory.fromRFC2822(dateString, { zone: defaultZone, setZone: true });
	if (rfc2822Date.isValid) {
		return rfc2822Date;
	}
	const sqlDate = dateTimeFactory.fromSQL(dateString, { zone: defaultZone, setZone: true });
	if (sqlDate.isValid) {
		return sqlDate;
	}

	const parsedDateTime = dateTimeFactory.fromMillis(Date.parse(dateString), { zone: defaultZone });
	if (parsedDateTime.isValid) {
		return parsedDateTime;
	}

	throw new ApplicationError('Value is not a valid date', { extra: { dateString } });
};

export const tryToParseTime = (value) => {
	const isTimeInput = /^\d{2}:\d{2}(:\d{2})?((\-|\+)\d{4})?((\-|\+)\d{1,2}(:\d{2})?)?$/s.test(
		String(value),
	);
	if (!isTimeInput) {
		throw new ApplicationError('Value is not a valid time', { extra: { value } });
	}
	return String(value);
};

export const tryToParseArray = (value) => {
	try {
		if (typeof value === 'object' && Array.isArray(value)) {
			return value;
		}

		let parsed;
		try {
			parsed = JSON.parse(String(value));
		} catch (e) {
			parsed = JSON.parse(String(value).replace(/'/g, '"'));
		}

		if (!Array.isArray(parsed)) {
			throw new ApplicationError('Value is not a valid array', { extra: { value } });
		}
		return parsed;
	} catch (e) {
		throw new ApplicationError('Value is not a valid array', { extra: { value } });
	}
};

/**
 * Dependency-free stand-in for the reference's esprima-backed `parseJSObject` (DELTA-05).
 *
 * It accepts the relaxed JS object literal shapes the editor produces: unquoted keys,
 * single-quoted keys/strings and trailing commas. Anything requiring a real JavaScript
 * parser (comments, unquoted non-identifier keys, nested JS expressions) needs the
 * injected adapter.
 */
export const defaultParseJSObject = (objectAsString) => {
	let source = objectAsString.trim();
	if (!(source.startsWith('{') && source.endsWith('}'))) {
		throw new Error('Not an object literal');
	}

	// Single-quoted strings -> JSON strings (only outside of double-quoted strings)
	source = source.replace(/"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/g, (match) =>
		match.startsWith('"') ? match : `"${match.slice(1, -1).replace(/"/g, '\\"')}"`,
	);
	// Unquoted keys -> quoted keys
	source = source.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3');
	// Trailing commas
	source = source.replace(/,(\s*[}\]])/g, '$1');

	return JSON.parse(source);
};

export const jsonParse = (
	jsonString,
	{
		acceptJSObject = false,
		repairJSON = false,
		fallbackValue,
		errorMessage,
		parseJSObject = defaultParseJSObject,
		// DELTA-05: the reference calls the `jsonrepair` package directly; the default here is
		// the dependency-free port of the exact version it bundles (`src/json-repair.mjs`).
		// An injected adapter still wins, so a caller may supply its own repairer.
		repairJSONParser = jsonrepair,
	} = {},
) => {
	try {
		return JSON.parse(jsonString);
	} catch (error) {
		if (acceptJSObject) {
			try {
				const jsonStringCleaned = parseJSObject(jsonString);
				return jsonStringCleaned;
			} catch (e) {
				// Ignore this error and return the original error or the fallback value
			}
		}
		if (repairJSON) {
			try {
				const jsonStringCleaned = repairJSONParser(jsonString);
				return JSON.parse(jsonStringCleaned);
			} catch (e) {
				// Ignore this error and return the original error or the fallback value
			}
		}
		if (fallbackValue !== undefined) {
			if (fallbackValue instanceof Function) {
				return fallbackValue();
			}
			return fallbackValue;
		} else if (errorMessage) {
			throw new ApplicationError(errorMessage);
		}

		throw error;
	}
};

export const tryToParseObject = (value) => {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value;
	}
	try {
		const o = jsonParse(String(value), { acceptJSObject: true });

		if (typeof o !== 'object' || Array.isArray(o)) {
			throw new ApplicationError('Value is not a valid object', { extra: { value } });
		}
		return o;
	} catch (e) {
		throw new ApplicationError('Value is not a valid object', { extra: { value } });
	}
};

/** type-guards.ts L168-174 */
export const isBinaryValue = (value) =>
	typeof value === 'object' && value !== null && 'mimeType' in value && ('data' in value || 'id' in value);

export const tryToParseBinary = (value) => {
	if (!value || typeof value !== 'object' || Array.isArray(value) || !isBinaryValue(value)) {
		throw new ApplicationError('Value is not a valid binary data object', { extra: { value } });
	}

	return value;
};

const ALLOWED_FORM_FIELDS_KEYS = [
	'fieldLabel',
	'fieldType',
	'placeholder',
	'defaultValue',
	'fieldOptions',
	'multiselect',
	'multipleFiles',
	'acceptFileTypes',
	'formatDate',
	'requiredField',
	'fieldValue',
	'elementName',
	'html',
	'fieldName',
	'limitSelection',
	'numberOfSelections',
	'minSelections',
	'maxSelections',
];

const ALLOWED_FIELD_TYPES = [
	'date',
	'dropdown',
	'email',
	'file',
	'number',
	'password',
	'text',
	'textarea',
	'checkbox',
	'radio',
	'html',
	'hiddenField',
];

export const tryToParseJsonToFormFields = (value) => {
	const fields = [];

	try {
		const rawFields = jsonParse(value, { acceptJSObject: true });

		for (const [index, field] of rawFields.entries()) {
			for (const key of Object.keys(field)) {
				if (!ALLOWED_FORM_FIELDS_KEYS.includes(key)) {
					throw new ApplicationError(`Key '${key}' in field ${index} is not valid for form fields`);
				}
				if (key !== 'fieldOptions' && !['string', 'number', 'boolean'].includes(typeof field[key])) {
					field[key] = String(field[key]);
				} else if (typeof field[key] === 'string' && key !== 'html') {
					field[key] = field[key].replace(/</g, '&lt;').replace(/>/g, '&gt;');
				}

				if (key === 'fieldType' && !ALLOWED_FIELD_TYPES.includes(field[key])) {
					throw new ApplicationError(
						`Field type '${field[key]}' in field ${index} is not valid for form fields`,
					);
				}

				if (key === 'fieldOptions') {
					if (Array.isArray(field[key])) {
						field[key] = { values: field[key] };
					}

					if (typeof field[key] !== 'object' || !field[key].values) {
						throw new ApplicationError(
							`Field dropdown in field ${index} does has no 'values' property that contain an array of options`,
						);
					}

					for (const [optionIndex, option] of field[key].values.entries()) {
						if (Object.keys(option).length !== 1 || typeof option.option !== 'string') {
							throw new ApplicationError(
								`Field dropdown in field ${index} has an invalid option ${optionIndex}`,
							);
						}
					}
				}
			}

			fields.push(field);
		}
	} catch (error) {
		if (error instanceof ApplicationError) throw error;

		throw new ApplicationError('Value is not valid JSON');
	}
	return fields;
};

export const getValueDescription = (value) => {
	if (typeof value === 'object') {
		if (value === null) return "'null'";
		if (Array.isArray(value)) return 'array';
		return 'object';
	}

	return `'${String(value)}'`;
};

const ALLOWED_URL_PROTOCOLS = ['http:', 'https:', 'ftp:', 'file:'];

export const tryToParseUrl = (value) => {
	if (typeof value === 'string' && !value.includes('://')) {
		value = `https://${value}`;
	}

	try {
		const parsed = new URL(String(value));
		if (!ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) {
			throw new ApplicationError(`The value "${String(value)}" is not a valid url.`, {
				extra: { value },
			});
		}
		return String(value);
	} catch (e) {
		if (e instanceof ApplicationError) throw e;
		throw new ApplicationError(`The value "${String(value)}" is not a valid url.`, {
			extra: { value },
		});
	}
};

export const tryToParseJwt = (value) => {
	const error = new ApplicationError(`The value "${String(value)}" is not a valid JWT token.`, {
		extra: { value },
	});

	if (!value) throw error;

	const jwtPattern = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/;

	if (!jwtPattern.test(String(value))) throw error;

	return String(value);
};

/**
 * Validates a field against the schema and tries to parse it to the correct type.
 *
 * The reference reads `strict` / `parseStrings` / `valueOptions` from its options bag;
 * this port adds the DELTA-04 `dateTimeFactory` pass-through (not a reference option).
 */
export function validateFieldType(fieldName, value, type, options = {}) {
	if (value === null || value === undefined) return { valid: true };
	const strict = options.strict ?? false;
	const valueOptions = options.valueOptions ?? [];
	const parseStrings = options.parseStrings ?? false;
	const dateTimeFactory = options.dateTimeFactory ?? defaultDateTimeFactory;

	const defaultErrorMessage = `'${fieldName}' expects a ${type} but we got ${getValueDescription(value)}`;
	switch (type.toLowerCase()) {
		case 'string': {
			if (!parseStrings) return { valid: true, newValue: value };
			try {
				if (strict && typeof value !== 'string') {
					return { valid: false, errorMessage: defaultErrorMessage };
				}
				return { valid: true, newValue: tryToParseString(value) };
			} catch (e) {
				return { valid: false, errorMessage: defaultErrorMessage };
			}
		}
		case 'string-alphanumeric': {
			try {
				return { valid: true, newValue: tryToParseAlphanumericString(value) };
			} catch (e) {
				return {
					valid: false,
					errorMessage:
						'Value is not a valid alphanumeric string, only letters, numbers and underscore allowed',
				};
			}
		}
		case 'number': {
			try {
				if (strict && typeof value !== 'number') {
					return { valid: false, errorMessage: defaultErrorMessage };
				}
				return { valid: true, newValue: tryToParseNumber(value) };
			} catch (e) {
				return { valid: false, errorMessage: defaultErrorMessage };
			}
		}
		case 'boolean': {
			try {
				if (strict && typeof value !== 'boolean') {
					return { valid: false, errorMessage: defaultErrorMessage };
				}
				return { valid: true, newValue: tryToParseBoolean(value) };
			} catch (e) {
				return { valid: false, errorMessage: defaultErrorMessage };
			}
		}
		case 'datetime': {
			try {
				return { valid: true, newValue: tryToParseDateTime(value, undefined, dateTimeFactory) };
			} catch (e) {
				const luxonDocsURL =
					'https://moment.github.io/luxon/api-docs/index.html#datetimefromformat';
				const errorMessage = `${defaultErrorMessage} <br/><br/> Consider using <a href="${luxonDocsURL}" target="_blank"><code>DateTime.fromFormat</code></a> to work with custom date formats.`;
				return { valid: false, errorMessage };
			}
		}
		case 'time': {
			try {
				return { valid: true, newValue: tryToParseTime(value) };
			} catch (e) {
				return {
					valid: false,
					errorMessage: `'${fieldName}' expects time (hh:mm:(:ss)) but we got ${getValueDescription(value)}.`,
				};
			}
		}
		case 'binary': {
			try {
				return { valid: true, newValue: tryToParseBinary(value) };
			} catch (e) {
				const errorMessage = `${defaultErrorMessage}. Make sure the value is a valid binary data object with 'mimeType' and 'data' or 'id' property.`;
				return { valid: false, errorMessage };
			}
		}
		case 'object': {
			try {
				if (strict && !isObject(value)) {
					return { valid: false, errorMessage: defaultErrorMessage };
				}
				return { valid: true, newValue: tryToParseObject(value) };
			} catch (e) {
				return { valid: false, errorMessage: defaultErrorMessage };
			}
		}
		case 'array': {
			if (strict && !Array.isArray(value)) {
				return { valid: false, errorMessage: defaultErrorMessage };
			}
			try {
				return { valid: true, newValue: tryToParseArray(value) };
			} catch (e) {
				return { valid: false, errorMessage: defaultErrorMessage };
			}
		}
		case 'options': {
			const validOptions = valueOptions.map((option) => option.value).join(', ');
			const isValidOption = valueOptions.some((option) => option.value === value);

			if (!isValidOption) {
				return {
					valid: false,
					errorMessage: `'${fieldName}' expects one of the following values: [${validOptions}] but we got ${getValueDescription(
						value,
					)}`,
				};
			}
			return { valid: true, newValue: value };
		}
		case 'url': {
			try {
				return { valid: true, newValue: tryToParseUrl(value) };
			} catch (e) {
				return { valid: false, errorMessage: defaultErrorMessage };
			}
		}
		case 'jwt': {
			try {
				return { valid: true, newValue: tryToParseJwt(value) };
			} catch (e) {
				return {
					valid: false,
					errorMessage: 'Value is not a valid JWT token',
				};
			}
		}
		case 'form-fields': {
			try {
				return { valid: true, newValue: tryToParseJsonToFormFields(value) };
			} catch (e) {
				return {
					valid: false,
					errorMessage: e.message,
				};
			}
		}
		default: {
			return { valid: true, newValue: value };
		}
	}
}
