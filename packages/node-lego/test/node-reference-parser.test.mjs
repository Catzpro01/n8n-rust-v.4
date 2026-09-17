/**
 * Conformance suite for the node-reference parser (`node-reference-parser-utils.ts`, whole file)
 * plus the lodash subset it needs and its `OperationalError`.
 *
 * Oracles: `test/node-reference-parser-utils.test.ts` (`NodeReferenceParserUtils` L16 —
 * hasDotNotationBannedChar L17, backslashEscape L30, dollarEscape L42, applyAccessPatterns L54,
 * extractReferencesInNodeExpressions L143 with its 25 cases). The differential group `N25`
 * compares the same functions against the published build / lodash.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	OperationalError,
	applyAccessPatterns,
	backslashEscape,
	cloneDeep,
	dollarEscape,
	escapeRegExp,
	extractReferencesInNodeExpressions,
	hasDotNotationBannedChar,
	mapValues,
} from '../src/index.mjs';

/** The reference oracle's `makeNode` helper. */
const makeNode = (name, expressions) => ({
	name,
	type: 'n8n-nodes-base.set',
	parameters: Object.fromEntries(
		expressions.map((expression, index) => [`p${index}`, `={{ ${expression} }}`]),
	),
});

const run = (nodes, nodeNames, startNodeName = 'Start', graphInputNodeNames) => {
	const result = extractReferencesInNodeExpressions(nodes, nodeNames, startNodeName, graphInputNodeNames);
	return { nodes: result.nodes, variables: [...result.variables.entries()] };
};

test('hasDotNotationBannedChar: banned chars and leading digits (oracle L17-L29)', () => {
	assert.equal(hasDotNotationBannedChar('1abc'), true);
	assert.equal(hasDotNotationBannedChar('abc!'), true);
	assert.equal(hasDotNotationBannedChar('abc@'), true);
	assert.equal(hasDotNotationBannedChar('a b'), true);
	assert.equal(hasDotNotationBannedChar('a.b'), true);
	assert.equal(hasDotNotationBannedChar('a-b'), true);
	// pinned: the underscore is in the reference's banned set too
	assert.equal(hasDotNotationBannedChar('a_b'), true);
	assert.equal(hasDotNotationBannedChar('abc'), false);
	assert.equal(hasDotNotationBannedChar('validName'), false);
	assert.equal(hasDotNotationBannedChar('Né'), false);
});

test('backslashEscape / dollarEscape / escapeRegExp match the lodash semantics they replace (oracle L30-L53)', () => {
	assert.equal(backslashEscape('a.b*c'), 'a\\.b\\*c');
	assert.equal(backslashEscape('[x]'), '\\[x\\]');
	assert.equal(backslashEscape('plain'), 'plain');
	assert.equal(dollarEscape('a$b'), 'a$$b');
	assert.equal(dollarEscape('plain'), 'plain');
	assert.equal(escapeRegExp('a.b*c'), 'a\\.b\\*c');
	assert.equal(escapeRegExp('^$.*+?()[]{}|'), '\\^\\$\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|');
});

test('applyAccessPatterns rewrites every accessor form (oracle L54-L142)', () => {
	assert.equal(applyAccessPatterns('$node["oldName"].data', 'oldName', 'newName'), '$node["newName"].data');
	assert.equal(applyAccessPatterns('$node.oldName.data', 'oldName', 'new.Name'), '$node["new.Name"].data');
	// a matching name that is not the pattern's target is left alone
	assert.equal(applyAccessPatterns('$node["someOtherName"].data', 'oldName', 'newName'), '$node["someOtherName"].data');
	assert.equal(
		applyAccessPatterns('$node["oldName"].data + $node["oldName"].info', 'oldName', 'newName'),
		'$node["newName"].data + $node["newName"].info',
	);
	assert.equal(applyAccessPatterns('$items("oldName", 0)', 'oldName', 'newName'), '$items("newName", 0)');
	assert.equal(applyAccessPatterns("$items('oldName', 0)", 'oldName', 'newName'), "$items('newName', 0)");
	assert.equal(applyAccessPatterns("$('oldName')", 'oldName', 'newName'), "$('newName')");
	assert.equal(applyAccessPatterns('$("oldName")', 'oldName', 'newName'), '$("newName")');

	// the `$node.` dot-notation path needs the bracket rewrite when the new name bans dot notation
	assert.equal(applyAccessPatterns('$node.oldName.data', 'oldName', 'New Name'), '$node["New Name"].data');
	assert.equal(applyAccessPatterns('$node.oldName.method()', 'oldName', 'New Name'), '$node["New Name"].method()');
	// dollar signs in the new name are escaped for replace()
	assert.equal(applyAccessPatterns('$node.old$Name.data', 'old$Name', 'new$Name'), '$node["new$Name"].data');
	// ... including $-sequences that replace() would otherwise interpolate
	assert.equal(applyAccessPatterns('$("oldName")', 'oldName', 'new$1Name'), '$("new$1Name")');
	assert.equal(applyAccessPatterns('$node["oldName"].data', 'oldName', 'a$&b'), '$node["a$&b"].data');
	assert.equal(applyAccessPatterns('$items("oldName", 0)', 'oldName', 'x$`y'), '$items("x$`y", 0)');
	assert.equal(applyAccessPatterns('$node.oldName.data', 'oldName', "$'tail"), `$node["$'tail"].data`);

	// a cheap substring check short-circuits expressions that do not mention the old name
	assert.equal(applyAccessPatterns('noMatchHere', 'oldName', 'newName'), 'noMatchHere');
});

test('extractReferencesInNodeExpressions: basic extraction and variables (oracle L155)', () => {
	const result = run(
		[makeNode('B', ['$("A").item.json.myField']), makeNode('C', ['$("A").first().json.myField.anotherField'])],
		['A', 'B', 'C'],
		'Start',
	);
	assert.deepEqual(result.variables, [
		['myField', '$("A").item.json.myField'],
		['myField_anotherField_firstItem', '$("A").first().json.myField.anotherField'],
	]);
	assert.deepEqual(result.nodes, [
		{ name: 'B', type: 'n8n-nodes-base.set', parameters: { p0: "={{ $('Start').item.json.myField }}" } },
		{
			name: 'C',
			type: 'n8n-nodes-base.set',
			parameters: { p0: "={{ $('Start').first().json.myField_anotherField_firstItem }}" },
		},
	]);
});

test('extractReferencesInNodeExpressions: metadata functions (oracle L172)', () => {
	const result = run(
		[makeNode('B', ['$("A").isExecuted ? 1 : 2']), makeNode('C', ['someFunction($("D").params["resource"])'])],
		['A', 'B', 'C', 'D'],
	);
	assert.deepEqual(result.variables, [
		['A_isExecuted', '$("A").isExecuted'],
		['D_params', '$("D").params'],
	]);
	assert.equal(result.nodes[0].parameters.p0, "={{ $('Start').first().json.A_isExecuted ? 1 : 2 }}");
	assert.equal(result.nodes[1].parameters.p0, '={{ someFunction($(\'Start\').first().json.D_params["resource"]) }}');
});

test('extractReferencesInNodeExpressions: standalone / non-existent / invalid references are untouched (oracle L195-L247)', () => {
	// a bare node reference collapses upstream, so it is left alone
	assert.deepEqual(run([makeNode('B', ['$("D")'])], ['B', 'D'], 'Start', ['B']), {
		nodes: [{ name: 'B', type: 'n8n-nodes-base.set', parameters: { p0: '={{ $("D") }}' } }],
		variables: [],
	});
	// unknown node name: the pattern never matches
	assert.deepEqual(run([makeNode('B', ['$("E").item.json.x'])], ['B'], 'Start', ['B']).variables, []);
	// pinned: a bracket access after the data accessor still extracts, but yields an EMPTY
	// variable name (the candidate stops before `[`, so the path joins to nothing)
	assert.deepEqual(run([makeNode('B', ['$("A").item.json["x"]'])], ['A', 'B'], 'Start', ['B']).variables, [
		['', '$("A").item.json'],
	]);
	// pinned: a trailing function call after a known data accessor still extracts the dotted
	// path (the accessor stops before `(`), so `foo.bar()` becomes the variable `foo_bar`
	const trailingCall = run([makeNode('B', ['$("A").item.json.foo.bar()'])], ['A', 'B'], 'Start', ['B']);
	assert.deepEqual(trailingCall.variables, [['foo_bar', '$("A").item.json.foo.bar']]);
	assert.equal(trailingCall.nodes[0].parameters.p0, "={{ $('Start').item.json.foo_bar() }}");
	// an unknown accessor on the node is left untouched
	assert.deepEqual(run([makeNode('B', ['$("D").thisIsNotAField.json.x.y.z'])], ['B', 'D'], 'Start').variables, []);
	// a malformed reference never matches the pattern
	assert.deepEqual(run([makeNode('B', ['$("D)'])], ['B', 'D'], 'Start').variables, []);
});

test('extractReferencesInNodeExpressions: $json only for graph-input nodes (oracle L248/L265)', () => {
	const untouched = run([makeNode('B', ['$json.c.d'])], ['A', 'B'], 'Start', ['A']);
	assert.deepEqual(untouched.variables, []);

	const extracted = run([makeNode('B', ['$json.a.b'])], ['A', 'B'], 'Start', ['B']);
	assert.deepEqual(extracted.variables, [['a_b', '$json.a.b']]);
	assert.equal(extracted.nodes[0].parameters.p0, "={{ $json.a_b }}");
});

test('extractReferencesInNodeExpressions: every accessor pattern (oracle L290)', () => {
	const result = run(
		[
			makeNode('N', ['$("A").item.json.myField']),
			makeNode('O', ['$node["B"].item.json.myField']),
			makeNode('P', ['$node.C.item.json.myField']),
		],
		['A', 'B', 'C', 'N', 'O', 'P'],
	);
	assert.deepEqual(result.variables, [
		['myField', '$("A").item.json.myField'],
		['B_myField', '$node["B"].item.json.myField'],
		['C_myField', '$node.C.item.json.myField'],
	]);
	assert.deepEqual(result.nodes.map((n) => n.parameters.p0), [
		"={{ $('Start').item.json.myField }}",
		"={{ $('Start').item.json.B_myField }}",
		"={{ $('Start').item.json.C_myField }}",
	]);
});

test('extractReferencesInNodeExpressions: simple and complex name clashes (oracle L319/L348)', () => {
	const simple = run(
		[
			makeNode('B', ['$("A").item.json.myField']),
			makeNode('C', ['$("D").item.json.myField']),
			makeNode('E', ['$("F").item.json.myField']),
		],
		['A', 'B', 'C', 'D', 'E', 'F'],
	);
	assert.deepEqual(simple.variables, [
		['myField', '$("A").item.json.myField'],
		['D_myField', '$("D").item.json.myField'],
		['F_myField', '$("F").item.json.myField'],
	]);

	const complex = run(
		[
			makeNode('F', ['$("A").item.json.myField']),
			makeNode('B', ['$("A").item.json.Node_Name_With_Gap_myField']),
			makeNode('C', ['$("D").item.json.Node_Name_With_Gap_myField']),
			makeNode('E', ['$("Node_Name_With_Gap").item.json.myField']),
		],
		['A', 'B', 'C', 'D', 'E', 'F', 'Node_Name_With_Gap'],
	);
	assert.deepEqual(complex.variables, [
		['myField', '$("A").item.json.myField'],
		['Node_Name_With_Gap_myField', '$("A").item.json.Node_Name_With_Gap_myField'],
		['D_Node_Name_With_Gap_myField', '$("D").item.json.Node_Name_With_Gap_myField'],
		// clashes with A.myField (node prefix), then with B.Node_Name_With_Gap_myField (`_1`)
		['Node_Name_With_Gap_myField_1', '$("Node_Name_With_Gap").item.json.myField'],
	]);
});

test('extractReferencesInNodeExpressions: Code node jsCode is parsed without the `=` prefix (oracle L383)', () => {
	const result = run(
		[
			{
				parameters: {
					jsCode:
						"for (const item of $input.all()) {\n  item.json.myNewField = $('DebugHelper').first().json.uid;\n}\n\nreturn $input.all();",
				},
				type: 'n8n-nodes-base.code',
				typeVersion: 2,
				position: [660, 0],
				id: 'c9de02d0-982a-4f8c-9af7-93f63795aa9b',
				name: 'Code',
			},
		],
		['DebugHelper', 'Code'],
	);
	assert.deepEqual(result.variables, [['uid_firstItem', "$('DebugHelper').first().json.uid"]]);
	assert.equal(
		result.nodes[0].parameters.jsCode,
		"for (const item of $input.all()) {\n  item.json.myNewField = $('Start').first().json.uid_firstItem;\n}\n\nreturn $input.all();",
	);
});

test('extractReferencesInNodeExpressions: Set-node assignments and unrelated properties survive (oracle L655/L718)', () => {
	const assignments = run(
		[
			{
				parameters: {
					assignments: {
						assignments: [
							{
								id: 'cf8bd6cb-f28a-4a73-b141-02e5c22cfe74',
								name: 'ghApiBaseUrl',
								value: '={{ $("A").item.json.x.y.z }}',
								type: 'string',
							},
						],
					},
					options: {},
				},
				type: 'n8n-nodes-base.set',
				typeVersion: 3.4,
				position: [80, 80],
				id: '6e2fd284-2aba-4dee-8921-18be9a291484',
				name: 'Params',
			},
		],
		['A', 'Params'],
	);
	assert.deepEqual(assignments.variables, [['x_y_z', '$("A").item.json.x.y.z']]);
	assert.equal(assignments.nodes[0].parameters.assignments.assignments[0].value, "={{ $('Start').item.json.x_y_z }}");

	const carried = run(
		[{ parameters: { a: 3, b: { c: 4, d: true }, d: 'hello', e: "={{ $('goodbye').item.json.f }}" }, name: 'A' }],
		['A', 'goodbye'],
	);
	assert.deepEqual(carried.variables, [['f', "$('goodbye').item.json.f"]]);
	assert.deepEqual(carried.nodes[0].parameters, {
		a: 3,
		b: { c: 4, d: true },
		d: 'hello',
		e: "={{ $('Start').item.json.f }}",
	});
});

test('extractReferencesInNodeExpressions: unexpected code after the accessor, itemMatching, spaces (oracle L539/L623/L704)', () => {
	const afterAccessor = run([makeNode('A', ['$("B").all()[0].json.first_node_variable'])], ['A', 'B']);
	assert.deepEqual(afterAccessor.variables, [['B_allItems', '$("B").all()']]);
	assert.equal(
		afterAccessor.nodes[0].parameters.p0,
		"={{ $('Start').first().json.B_allItems[0].json.first_node_variable }}",
	);

	const itemMatching = run(
		[makeNode('B', ['$("A").itemMatching(20).json.x + $("A").itemMatching(2).json.y'])],
		['A', 'B'],
	);
	assert.deepEqual(
		itemMatching.variables.map(([name]) => name),
		['x_itemMatching_20', 'y_itemMatching_2'],
	);

	// pinned: a non-trivial itemMatching argument is *not* handled — but the reference still
	// extracts the truncated `$("A").itemMatching` accessor and the inner `$("C")` reference
	assert.deepEqual(
		run([makeNode('B', ['$("A").itemMatching($("C").item.json.idx).json.x'])], ['A', 'B', 'C']).variables,
		[
			['idx', '$("C").item.json.idx'],
			['A_itemMatching_unknown', '$("A").itemMatching'],
		],
	);

	// the variable name is the field path; the node name is only prefixed on a clash, so a
	// special-character node name does not appear in the variable name at all
	const special = run([makeNode('B', ['$("Node Name!").item.json.x'])], ['Node Name!', 'B']);
	assert.deepEqual(special.variables, [['x', '$("Node Name!").item.json.x']]);
	assert.equal(special.nodes[0].parameters.p0, "={{ $('Start').item.json.x }}");
});

test('extractReferencesInNodeExpressions: Split Out fieldToSplitOut (oracle L746)', () => {
	const result = run(
		[
			{
				parameters: { fieldToSplitOut: 'foo,bar' },
				type: 'n8n-nodes-base.splitOut',
				typeVersion: 1,
				position: [200, 200],
				id: 'splitOutNodeId',
				name: 'A',
			},
		],
		['A', 'B'],
		'Start',
		['A'],
	);
	assert.deepEqual(
		result.variables.map(([name]) => name),
		['foo', 'bar'],
	);

	// an expression is rejected: the fields are only known at execution time
	assert.throws(
		() =>
			run(
				[{ parameters: { fieldToSplitOut: '={{ $json.a }}' }, type: 'n8n-nodes-base.splitOut', name: 'A' }],
				['A', 'B'],
				'Start',
				['A'],
			),
		(error) => {
			assert.ok(error instanceof OperationalError);
			assert.equal(error.name, 'Error', 'DELTA-03 quirk: the base error never sets `name`');
			assert.equal(error.level, 'warning');
			assert.match(error.message, /is not supported\.$/);
			return true;
		},
	);
});

test('extractReferencesInNodeExpressions: invariants throw OperationalError (oracle L435/L454)', () => {
	assert.throws(
		() => run([makeNode('Start', ['$("A").item.json.x'])], ['A', 'Start'], 'Start'),
		{ name: 'Error', level: 'warning' },
	);
	assert.throws(
		() => run([makeNode('Z', ['$("A").item.json.x'])], ['A'], 'Start'),
		{ message: /whose name is not in provided 'nodeNames' list/ },
	);
	// nothing to do
	assert.deepEqual(run([], ['A'], 'Start'), { nodes: [], variables: [] });
});

test('lodash subset: cloneDeep preserves Date/RegExp/Map/Set and cycles; mapValues mirrors lodash', () => {
	const source = { d: new Date(1000), r: /ab/gi, m: new Map([['k', { n: 1 }]]), s: new Set([1, 2]), nested: { a: [1, { b: 2 }] } };
	source.self = source;
	const copy = cloneDeep(source);
	assert.ok(copy.d instanceof Date);
	assert.equal(copy.d.getTime(), 1000);
	assert.equal(copy.r.source, 'ab');
	assert.equal(copy.r.flags, 'gi');
	assert.equal(copy.m.get('k').n, 1);
	assert.equal(copy.s.size, 2);
	assert.deepEqual(copy.nested, { a: [1, { b: 2 }] });
	assert.equal(copy.self, copy, 'cycles are preserved');
	assert.notEqual(copy.self, source);
	// unlike `deepCopy`, a Date is NOT stringified
	assert.equal(typeof copy.d, 'object');

	assert.deepEqual(mapValues({ a: 1, b: 2 }, (value) => value * 2), { a: 2, b: 4 });
	assert.deepEqual(Object.keys(mapValues({ z: 1, a: 2 }, (value) => value)), ['z', 'a']);
});
