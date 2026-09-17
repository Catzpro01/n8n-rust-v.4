/**
 * Records schemas.ts (45 zod schemas, all barrel-public) behaviour from the real n8n-workflow 2.9.4 runtime.
 * Output: fixtures/schema-cases.jsonl — one { id, schema, input:{ value }, expected:{ success, data? | issues:[{path,code}] } } per line
 * (1125 cases in a single file to keep the tree small),
 * plus fixtures/schema-enums.json with the exact enum value lists (FieldTypeSchema, NodeConnectionTypeSchema,
 * OnErrorSchema, FilterOperatorTypeSchema, FilterTypeCombinatorSchema) — frozen vocabularies for any port.
 */
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const w = createRequire(resolve(process.env.N8N_RUNTIME ?? '/home/user/n8n-runtime', 'package.json'))('n8n-workflow');
const out = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SCHEMAS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../reference/n8n/packages/workflow/src/schemas.ts'), 'utf8').match(/^export const ([A-Za-z0-9_]+Schema)/gm).map((l) => l.split(' ')[2]);
const rl = { __rl: true, mode: 'id', value: '1' };
const node = { id: '1', name: 'A', type: 't', typeVersion: 1, position: [0, 0], parameters: {} };
const M = {
	null: null, undef: { $undefined: true }, emptyStr: '', str: 'main', num: 1, bool: true, emptyArr: [], emptyObj: {}, nested: { a: { b: [1, 'x', null] } },
	rl, rlBadMode: { __rl: true, mode: 5, value: '1' }, node, nodes: [node], onError: 'stopWorkflow', fieldType: 'string', fieldTypeBad: 'strin',
	filter: { conditions: [{ id: 'c', leftValue: 'a', rightValue: 'b', operator: { type: 'string', operation: 'equals' } }], combinator: 'and', options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 } },
	filterBadCombinator: { conditions: [], combinator: 'xor', options: {} },
	assignmentCollection: { assignments: [{ id: 'a', name: 'n', value: 'v', type: 'string' }] },
	mapper: { mappingMode: 'defineBelow', value: { a: 1 }, schema: [{ id: 'a', displayName: 'A', defaultMatch: false, canBeUsedToMatch: true, required: false, display: true, type: 'string' }] },
	displayOptions: { show: { resource: ['a'] }, hide: { '@version': [{ _cnd: { gte: 2 } }] } },
	binary: { mimeType: 'a', data: 'x' }, icon: 'fa:bolt', iconLight: { light: 'a.svg', dark: 'b.svg' }, emoji: '🚀',
};
const enc = (v) => v === undefined ? { $undefined: true } : v;
const lines = [];
for (const s of SCHEMAS) for (const [k, raw] of Object.entries(M)) {
	const v = raw && typeof raw === 'object' && raw.$undefined ? undefined : raw;
	const r = w[s].safeParse(v);
	const expected = r.success ? { success: true, data: enc(r.data) } : { success: false, issues: r.error.issues.map((i) => ({ path: i.path, code: i.code })) };
	lines.push(JSON.stringify({ id: `schema-${s}-${k}`, schema: s, input: { value: raw }, expected }));
}
writeFileSync(resolve(out, 'schema-cases.jsonl'), lines.join('\n') + '\n');
const n = lines.length;
const enums = {};
for (const s of ['FieldTypeSchema', 'NodeConnectionTypeSchema', 'OnErrorSchema', 'FilterOperatorTypeSchema', 'FilterTypeCombinatorSchema']) {
	const def = w[s]._def; enums[s] = def.values ?? def.innerType?._def?.values ?? (def.typeName === 'ZodUnion' ? def.options.map((o) => o._def.value ?? o._def.values).flat() : null);
}
writeFileSync(resolve(out, 'schema-enums.json'), JSON.stringify({ source: 'n8n-workflow 2.9.4 runtime', enums }, null, 2) + '\n');
console.log(`recorded ${n} schema fixtures (${SCHEMAS.length} schemas × ${Object.keys(M).length} inputs); enums: ${Object.entries(enums).map(([k, v]) => k + '=' + (v ? v.length : 'null')).join(', ')}`);
