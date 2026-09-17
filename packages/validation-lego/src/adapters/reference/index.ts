/**
 * Reference adapter — binds the owned surface 1:1 to the pinned runtime artifact (n8n-workflow@2.9.1,
 * the artifact n8n 2.9.4 ships). No algorithm is rewritten here; every symbol is the original one.
 */
import { referenceRequire } from '../../ports/runtime.ts';
const w = referenceRequire()('n8n-workflow');

export const TYPE_VALIDATION = ['validateFieldType', 'tryToParseNumber', 'tryToParseString', 'tryToParseAlphanumericString', 'tryToParseBoolean', 'tryToParseDateTime', 'tryToParseTime', 'tryToParseArray', 'tryToParseObject', 'tryToParseUrl', 'tryToParseJwt', 'getValueDescription'] as const;
export const TYPE_GUARDS = ['isINodeProperties', 'isINodePropertyOptions', 'isINodePropertyCollection', 'isINodePropertiesList', 'isINodePropertyOptionsList', 'isINodePropertyCollectionList', 'isResourceMapperValue', 'isResourceLocatorValue', 'isFilterValue', 'isNodeConnectionType', 'isBinaryValue'] as const;

function pick<K extends string>(names: readonly K[]): Record<K, any> {
	const out = {} as Record<K, any>;
	for (const n of names) { if (typeof w[n] !== 'function') throw new Error(`reference runtime lacks ${n}`); out[n] = w[n]; }
	return out;
}
export const typeValidation = pick(TYPE_VALIDATION);
export const typeGuards = pick(TYPE_GUARDS);
/** exactly the zod schemas OWNED by this LEGO = `export const *Schema` in the pinned schemas.ts (45 in 2.9.4), frozen in
 *  manifest/schema-surface.json and drift-checked against the source by test/01-boundary. The barrel also exposes 7 schemas
 *  from execution-context / message-event-bus files — execution concerns, NOT part of this seam. */
import schemaSurface from '../../../manifest/schema-surface.json' with { type: 'json' };
export const OWNED_SCHEMA_NAMES: string[] = schemaSurface.names;
export const schemas: Record<string, any> = Object.fromEntries(OWNED_SCHEMA_NAMES.map((k) => { if (!w[k] || typeof w[k].safeParse !== 'function') throw new Error(`reference runtime lacks schema ${k}`); return [k, w[k]]; }));
