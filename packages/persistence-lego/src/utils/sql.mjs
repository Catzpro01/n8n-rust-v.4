/**
 * 1:1 port of n8n db package: utils/sql.ts
 *
 * Provides syntax highlighting for embedded SQL queries in template strings.
 */
export function sql(strings, ...values) {
	let result = '';

	// Interleave the strings with the values
	for (let i = 0; i < values.length; i++) {
		result += strings[i];
		result += values[i];
	}

	// Add the last string
	result += strings[strings.length - 1];

	return result;
}
