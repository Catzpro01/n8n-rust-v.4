/**
 * 1:1 port of reference/n8n/packages/@n8n/db/src/utils/separate.ts
 */
export const separate = (array, test) => {
	const pass = [];
	const fail = [];

	array.forEach((i) => (test(i) ? pass : fail).push(i));

	return [pass, fail];
};
