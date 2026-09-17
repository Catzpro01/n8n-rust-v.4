/**
 * 1:1 port of n8n db package: utils/transformers.ts
 * (full file, zero omissions).
 *
 * Deviations (boundary-only, behavior-preserving):
 *   D-PERSIST-01: `Container.get(GlobalConfig).database.type` inside `jsonColumn.to` is
 *                 resolved through port P-PERSIST-CONFIG (`getDbType()`), not the DI
 *                 Container. Default 'sqlite' = the reference default.
 *   D-PERSIST-02: `jsonParse` is consumed read-only from pinned n8n-workflow@2.9.1
 *                 (port P-PERSIST-WORKFLOW), not re-implemented.
 *
 * `FindOperator` values flowing into `idStringifier.to` pass through untouched,
 * exactly like the reference (non-string input is returned as-is).
 */
import { jsonParse } from '../consumed.mjs';
import { getDbType } from '../ports.mjs';

export const idStringifier = {
	from: (value) => value?.toString(),

	to: (value) => (typeof value === 'string' ? Number(value) : value),
};

export const lowerCaser = {
	from: (value) => value,

	to: (value) => (typeof value === 'string' ? value.toLowerCase() : value),
};

/**
 * Unmarshal JSON as JS object.
 */
export const objectRetriever = {
	to: (value) => value,

	from: (value) => (typeof value === 'string' ? jsonParse(value) : value),
};

/**
 * Transformer for sqlite JSON columns to mimic JSON-as-object behavior
 * from Postgres.
 */
const jsonColumn = {
	to: (value) => (getDbType() === 'sqlite' ? JSON.stringify(value) : value), // D-PERSIST-01

	from: (value) => (typeof value === 'string' ? jsonParse(value) : value),
};

export const sqlite = { jsonColumn };

/**
 * Transformer for bigint columns that returns strings from PostgreSQL.
 * Converts string values to numbers on read.
 */
export const bigintStringToNumber = {
	to: (value) => value,

	from: (value) => (typeof value === 'string' ? Number(value) : value),
};
