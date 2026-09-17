/**
 * 1:1 port of n8n db package: utils/is-string-array.ts
 */
export function isStringArray(value) {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
