/**
 * 1:1 port of reference/n8n/packages/@n8n/db/src/utils/is-string-array.ts
 */
export function isStringArray(value) {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
