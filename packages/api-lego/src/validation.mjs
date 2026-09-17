/**
 * Formats a validation error into the raw first issue object (no {code,message} envelope),
 * matching n8n 2.9.4 zod validation middleware behavior.
 */
export function formatZodIssue(issue) {
	const res = {
		code: issue.code,
	};

	if (issue.expected !== undefined) res.expected = issue.expected;
	if (issue.received !== undefined) res.received = issue.received;
	if (issue.minimum !== undefined) res.minimum = issue.minimum;
	if (issue.type !== undefined) res.type = issue.type;
	if (issue.inclusive !== undefined) res.inclusive = issue.inclusive;
	if (issue.exact !== undefined) res.exact = issue.exact;
	if (issue.fatal !== undefined) res.fatal = issue.fatal;
	if (issue.path !== undefined) res.path = issue.path;
	if (issue.message !== undefined) res.message = issue.message;

	return res;
}

/**
 * Validates request data against defined schema rules.
 * Returns { valid: true } or { valid: false, error: formattedIssue }.
 */
export function validateDto(rules, data) {
	if (!rules || typeof rules !== 'object') {
		return { valid: true };
	}

	for (const [field, rule] of Object.entries(rules)) {
		const val = data?.[field];

		if (rule.required && (val === undefined || val === null)) {
			return {
				valid: false,
				error: formatZodIssue({
					code: 'invalid_type',
					expected: rule.type ?? 'string',
					received: val === null ? 'null' : 'undefined',
					path: [field],
					message: 'Required',
				}),
			};
		}

		if (val !== undefined && val !== null) {
			if (rule.type === 'string') {
				if (typeof val !== 'string') {
					return {
						valid: false,
						error: formatZodIssue({
							code: 'invalid_type',
							expected: 'string',
							received: typeof val,
							path: [field],
							message: 'Expected string',
						}),
					};
				}
				if (rule.minLength !== undefined && val.length < rule.minLength) {
					return {
						valid: false,
						error: formatZodIssue({
							code: 'too_small',
							minimum: rule.minLength,
							type: 'string',
							inclusive: true,
							exact: false,
							message: rule.minLengthMessage ?? `${field} is required`,
							path: [field],
						}),
					};
				}
			}

			if (rule.type === 'array') {
				if (!Array.isArray(val)) {
					return {
						valid: false,
						error: formatZodIssue({
							code: 'custom',
							message: rule.message ?? `${field} must be an array`,
							fatal: true,
							path: [field],
						}),
					};
				}
			}
		}
	}

	return { valid: true };
}
