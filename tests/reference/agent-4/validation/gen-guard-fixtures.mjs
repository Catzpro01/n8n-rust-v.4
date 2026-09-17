/**
 * Records type-guards.ts behaviour from the real n8n-workflow 2.9.4 runtime (public barrel exports only —
 * isValidResourceLocatorParameterValue / isAssignmentValue are internal, see validation.md §3.2).
 * Output: fixtures/guard-*.json  { id, fn, input:{ value }, expected: boolean | { throws:{name,message} } }
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const w = createRequire(resolve(process.env.N8N_RUNTIME ?? '/home/user/n8n-runtime', 'package.json'))('n8n-workflow');
const out = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const GUARDS = ['isINodeProperties', 'isINodePropertyOptions', 'isINodePropertyCollection', 'isINodePropertiesList', 'isINodePropertyOptionsList', 'isINodePropertyCollectionList', 'isResourceMapperValue', 'isResourceLocatorValue', 'isFilterValue', 'isNodeConnectionType', 'isBinaryValue'];
const rl = { __rl: true, mode: 'id', value: '1' };
const M = {
	null: null, undef: { $undefined: true }, str: 'main', strAi: 'ai_tool', strBogus: 'nope', num: 1, bool: true, emptyArr: [], emptyObj: {},
	prop: { displayName: 'D', name: 'n', type: 'string', default: '' }, propWithValue: { name: 'n', type: 'string', value: 'v' },
	option: { name: 'n', value: 'v' }, optionWithDisplay: { displayName: 'D', name: 'n', value: 'v' },
	collection: { displayName: 'D', name: 'n', values: [] }, collectionNoValues: { displayName: 'D', name: 'n' },
	propList: [{ displayName: 'D', name: 'n', type: 'string', default: '' }], optionList: [{ name: 'a', value: 'a' }], collectionList: [{ displayName: 'D', name: 'n', values: [] }], mixedList: [{ name: 'a', value: 'a' }, { displayName: 'D', name: 'n', type: 'string', default: '' }],
	rl, rlNoFlag: { mode: 'id', value: '1' }, rlFalseFlag: { __rl: false, mode: 'id', value: '1' }, rlOnlyFlag: { __rl: true },
	mapper: { mappingMode: 'defineBelow', value: { a: 1 }, schema: [] }, mapperNoSchema: { mappingMode: 'defineBelow', value: {} },
	filter: { conditions: [], combinator: 'and', options: {} }, filterNoOptions: { conditions: [], combinator: 'and' }, filterBadCombinator: { conditions: [], combinator: 'xor', options: {} },
	binId: { mimeType: 'a', id: '1' }, binData: { mimeType: 'a', data: 'x' }, binNoMime: { id: '1' }, binMimeOnly: { mimeType: 'a' },
};
let n = 0;
for (const fn of GUARDS) for (const [k, raw] of Object.entries(M)) {
	const v = raw && typeof raw === 'object' && raw.$undefined ? undefined : raw;
	let expected; try { expected = w[fn](v); } catch (e) { expected = { throws: { name: e.constructor.name, message: e.message } }; }
	const id = `guard-${fn}-${k}`; writeFileSync(resolve(out, `${id}.json`), JSON.stringify({ id, fn, input: { value: raw }, expected }, null, 2) + '\n'); n++;
}
console.log(`recorded ${n} guard fixtures (${GUARDS.length} guards × ${Object.keys(M).length} inputs)`);
