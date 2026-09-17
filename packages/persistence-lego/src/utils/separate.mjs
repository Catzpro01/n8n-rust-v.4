/**
 * 1:1 port of n8n db package: utils/separate.ts
 */
export const separate = (array, test) => {
	const pass = [];
	const fail = [];

	array.forEach((i) => (test(i) ? pass : fail).push(i));

	return [pass, fail];
};
