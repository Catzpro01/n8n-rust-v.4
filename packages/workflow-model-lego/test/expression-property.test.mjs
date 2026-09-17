// TASK-WORKFLOW-MODEL-04 — the last Workflow instance property: `expression`.
// Identity-asserted against the Expression LEGO's export (the same test shape CD-05
// uses for the Node port), never duck-typed. Reference anchors:
//   workflow.ts:72   `expression: Expression;` (between nodeTypes and active)
//   workflow.ts:134  `this.expression = new Expression(this);` — last constructor statement
//   expression.ts:181  `constructor(private readonly workflow: Workflow) {}`
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const laneRoot = resolve(here, '..');
const repoRoot = resolve(laneRoot, '..', '..');

const { createRequire } = await import('node:module');
const laneRequire = createRequire(join(laneRoot, 'package.json'));

const { Workflow } = await import(join(laneRoot, 'dist', 'index.js'));
const { Expression } = laneRequire('../expression-lego/src/expression.mjs');
const { resolveExpressionPort, resetExpressionPort } = await import(join(laneRoot, 'dist', 'expression-port.js'));

const NODE_TYPES = { getByNameAndVersion: () => undefined };
const build = () =>
	new Workflow({
		id: 'wf-expression',
		name: 'Expression Property',
		nodes: [],
		connections: {},
		active: false,
		nodeTypes: NODE_TYPES,
	});

test('expression is wired eagerly and holds the aggregate itself (workflow.ts:134, expression.ts:181)', () => {
	const wf = build();
	assert.ok(wf.expression, 'expression must not be undefined — the ISSUE-027 silent failure mode');
	assert.equal(wf.expression.workflow, wf);
});

test('workflow.expression is an instance of the Expression LEGO class (identity, not duck-typing)', () => {
	const wf = build();
	assert.ok(wf.expression instanceof Expression);
});

test('13/13 reference instance properties are present (workflow.ts class field list)', () => {
	// Verbatim reference field order (workflow.ts, `export class Workflow`):
	const REFERENCE_PROPERTIES = [
		'id',
		'name',
		'nodes',
		'connectionsBySourceNode',
		'connectionsByDestinationNode',
		'nodeTypes',
		'expression',
		'active',
		'settings',
		'timezone',
		'staticData',
		'testStaticData',
		'pinData',
	];
	const wf = build();
	const own = new Set(Object.keys(wf));
	for (const prop of REFERENCE_PROPERTIES) {
		assert.ok(own.has(prop), `missing reference property: ${prop}`);
	}
	// the reconstruction carries exactly two lane-internal ports the reference does not have
	const laneInternal = new Set(['graph', 'nodeHelpers']);
	const nonLaneOwn = [...own].filter((k) => !laneInternal.has(k));
	assert.deepEqual(nonLaneOwn.sort(), [...REFERENCE_PROPERTIES].sort());
});

test('failure mode is loud, never a silent undefined (option_c of the filed task)', async () => {
	resetExpressionPort();
	let message = '';
	try {
		resolveExpressionPort(undefined, () => {
			throw new Error('MODULE_NOT_FOUND (simulated bare clone)');
		});
	} catch (error) {
		message = error.message;
	}
	assert.match(message, /Expression LEGO \(expression port\) is not available/);
	assert.match(message, /npm install --prefix packages\/expression-lego/);
	// a resolved module missing the constructor is also rejected loudly
	assert.throws(
		() => resolveExpressionPort(undefined, () => ({ unexpected: true })),
		/did not export an `Expression` constructor/,
	);
	resetExpressionPort(); // leave the cache primed for the other tests' construction path
});

test('prerequisite documented in the lane README', () => {
	const readme = readFileSync(join(laneRoot, 'README.md'), 'utf8');
	assert.match(readme, /expression-lego/);
});
