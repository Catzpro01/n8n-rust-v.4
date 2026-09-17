import { parse as esprimaParse, Syntax } from 'esprima-next';
import type { Node as SyntaxNode, ExpressionStatement } from 'esprima-next';
import { jsonrepair } from 'jsonrepair';
import { ApplicationError } from './errors';

export function syntaxNodeToValue(expression?: SyntaxNode | null): unknown {
	switch (expression?.type) {
		case Syntax.ObjectExpression:
			return Object.fromEntries(
				(expression.properties as any[])
					.filter((prop) => prop.type === Syntax.Property)
					.map(({ key, value }) => [syntaxNodeToValue(key), syntaxNodeToValue(value)]),
			);
		case Syntax.Identifier:
			return expression.name;
		case Syntax.Literal:
			return expression.value;
		case Syntax.ArrayExpression:
			return expression.elements.map((exp: any) => syntaxNodeToValue(exp));
		case Syntax.UnaryExpression: {
			const value = syntaxNodeToValue(expression.argument);
			if (typeof value === 'number' && expression.operator === '-') {
				return -value;
			}
			return value;
		}
		default:
			return undefined;
	}
}

/**
 * Parse any JavaScript ObjectExpression, including:
 * - single quoted keys
 * - unquoted keys
 */
export function parseJSObject(objectAsString: string): object {
	const jsExpression = esprimaParse(`(${objectAsString})`).body.find(
		(node): node is ExpressionStatement =>
			node.type === Syntax.ExpressionStatement && node.expression.type === Syntax.ObjectExpression,
	);

	return syntaxNodeToValue(jsExpression?.expression) as object;
}

type MutuallyExclusive<T, U> =
	| (T & { [k in Exclude<keyof U, keyof T>]?: never })
	| (U & { [k in Exclude<keyof T, keyof U>]?: never });

export type JSONParseOptions<T> = { acceptJSObject?: boolean; repairJSON?: boolean } & MutuallyExclusive<
	{ errorMessage?: string },
	{ fallbackValue?: T }
>;

/**
 * Parses a JSON string into an object with optional error handling and recovery mechanisms.
 *
 * @param {string} jsonString - The JSON string to parse.
 * @param {Object} [options] - Optional settings for parsing the JSON string.
 */
export const jsonParse = <T>(jsonString: string, options?: JSONParseOptions<T>): T => {
	try {
		return JSON.parse(jsonString) as T;
	} catch (error) {
		if (options?.acceptJSObject) {
			try {
				const jsonStringCleaned = parseJSObject(jsonString);
				return jsonStringCleaned as T;
			} catch (e) {
				// Ignore this error and return the original error or the fallback value
			}
		}
		if (options?.repairJSON) {
			try {
				const jsonStringCleaned = jsonrepair(jsonString);
				return JSON.parse(jsonStringCleaned) as T;
			} catch (e) {
				// Ignore this error and return the original error or the fallback value
			}
		}
		if (options?.fallbackValue !== undefined) {
			if (options.fallbackValue instanceof Function) {
				return options.fallbackValue();
			}
			return options.fallbackValue;
		} else if (options?.errorMessage) {
			throw new ApplicationError(options.errorMessage);
		}

		throw error;
	}
};
