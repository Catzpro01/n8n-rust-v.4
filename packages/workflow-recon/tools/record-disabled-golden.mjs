#!/usr/bin/env node
/**
 * Records a golden `expected.json` from the PINNED reference runtime.
 *
 *   node tools/record-disabled-golden.mjs [fixture-dir-name]
 *
 * Default fixture: tests/reference/04-disabled-node
 *
 * tests/reference/** is golden and `expected.json` files are never hand-written
 * (tests/reference/README.md). This script is the only thing that writes them:
 * every value below is an observed output of `n8n-workflow@2.9.1`, the runtime
 * artifact n8n 2.9.4 ships.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	buildRealNodeTypes,
	findRuntime,
	loadReference,
	nodeTypesOf,
	readJson,
	repoRoot,
} from './reference-runtime.mjs';
import { collectCalls } from './collect.mjs';

const fixtureName = process.argv[2] ?? '04-disabled-node';
const fixtureDir = join(repoRoot(), 'tests', 'reference', fixtureName);

const runtime = findRuntime();
if (!runtime) {
	console.error(
		'reference runtime not found — run: bash scripts/setup-reference-runtime.sh\n' +
			'(the golden file is never hand-written, so it cannot be produced without the oracle)',
	);
	process.exit(1);
}

const fixture = readJson(join(fixtureDir, 'workflow.json'));
const ref = loadReference(runtime);
const { realRegistry, index } = buildRealNodeTypes(runtime, nodeTypesOf(fixture));

const recorded = Object.keys(index).length;
if (recorded !== nodeTypesOf(fixture).length) {
	console.error(
		`node type registry is incomplete: ${recorded}/${nodeTypesOf(fixture).length} types resolved`,
	);
	process.exit(1);
}

const real = new ref.Workflow({
	id: fixture.id,
	name: fixture.name,
	nodes: structuredClone(fixture.nodes),
	connections: structuredClone(fixture.connections),
	active: false,
	nodeTypes: realRegistry,
});

const golden = {
	meta: {
		case: fixtureName,
		generator: 'packages/workflow-recon/tools/record-disabled-golden.mjs',
		recordedAt: new Date().toISOString(),
		oracle: {
			package: 'n8n-workflow',
			version: runtime.workflowVersion,
			nodeDescriptions: `n8n-nodes-base@${runtime.nodesBase}`,
			registryMode: 'real-node-classes',
		},
		provenance:
			'Recorded output of the pinned reference runtime. Never hand-written and never edited ' +
			'to make a test pass — regenerate with `npm run record:golden` in packages/workflow-recon.',
	},
	workflow: 'workflow.json',
	nodeTypeIndex: index,
	calls: collectCalls(real, fixture),
};

const out = join(fixtureDir, 'expected.json');
writeFileSync(out, `${JSON.stringify(golden, null, 2)}\n`);
console.log(
	`recorded ${Object.keys(golden.calls).length} calls -> tests/reference/${fixtureName}/expected.json ` +
		`(n8n-workflow ${runtime.workflowVersion}, ${recorded} node types from real classes)`,
);
