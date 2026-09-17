/**
 * Contract conformance — contracts/execution-engine.contract.md vs the implementation.
 *
 * PROJECT_RULES.md #5 requires every module to have a formal contract. A contract nobody checks is
 * documentation, so this test parses the machine-readable blocks of the contract and asserts the
 * code still matches: the exported surface, the result shape, the status vocabulary, the declared
 * non-goals, and — the part that usually rots first — every `file:line` provenance citation, which
 * is checked against the real files in reference/n8n/.
 *
 * run: npm run engine:test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as engine from '../runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const REPO = join(PKG, '..', '..');
const CONTRACT = join(REPO, 'contracts', 'execution-engine.contract.md');

const contractText = readFileSync(CONTRACT, 'utf8');

/** Read a fenced block between CONTRACT-<NAME>:BEGIN / :END markers. */
function contractBlock(name) {
	const begin = `<!-- CONTRACT-${name}:BEGIN -->`;
	const end = `<!-- CONTRACT-${name}:END -->`;
	const start = contractText.indexOf(begin);
	assert.notEqual(start, -1, `contract is missing the ${name} block`);
	const stop = contractText.indexOf(end, start);
	assert.notEqual(stop, -1, `contract ${name} block is not closed`);
	const body = contractText.slice(start + begin.length, stop);
	const fenced = body.match(/```json\s*([\s\S]*?)```/);
	assert.ok(fenced, `${name} block must contain a fenced json block`);
	return JSON.parse(fenced[1]);
}

/** Strip comments so non-goal checks cannot be satisfied by mentioning a word in prose. */
function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const runnerSource = readFileSync(join(PKG, 'runner.mjs'), 'utf8');
const graphSource = readFileSync(join(PKG, 'graph.mjs'), 'utf8');
const partialSource = readFileSync(join(PKG, 'partial.mjs'), 'utf8');

test('contract: the document exists and carries every required section', () => {
	assert.ok(existsSync(CONTRACT), 'contracts/execution-engine.contract.md is missing');
	for (const heading of [
		'## 1. Scope and boundary',
		'## 2. Public surface',
		'## 3. Result shape',
		'## 4. Behavioural guarantees',
		'## 5. Determinism',
		'## 6. Failure contract',
		'## 7. Non-goals',
		'## 8. Provenance',
		'## 9. Verification hooks',
	]) {
		assert.ok(contractText.includes(heading), `contract is missing "${heading}"`);
	}
	for (const marker of ['PROJECT_RULES.md', 'workflow-execute.ts']) {
		assert.ok(contractText.includes(marker), `contract must reference ${marker}`);
	}
});

test('contract §2: the exported surface matches the implementation exactly', () => {
	const declared = contractBlock('SURFACE');

	assert.deepEqual(Object.keys(engine).sort(), [...declared.exports].sort(), 'module exports drifted');

	const instance = new engine.WorkflowExecutionEngine({});
	const proto = Object.getPrototypeOf(instance);
	const declaredMethods = [...declared.engineMethods, ...declared.engineAccessors].sort();

	assert.deepEqual(
		Object.getOwnPropertyNames(proto)
			.filter((n) => n !== 'constructor')
			.sort(),
		declaredMethods,
		'engine methods/accessors drifted from the contract',
	);
	assert.deepEqual(
		Object.keys(instance).sort(),
		[...declared.instanceFields].sort(),
		'engine instance fields drifted from the contract',
	);
	assert.ok(
		Object.getOwnPropertyDescriptor(proto, 'executionOrder')?.get !== undefined,
		'executionOrder must stay an accessor',
	);
});

test('contract §2: the partial-graph module surface matches partial.mjs', { timeout: 30000 }, async () => {
	const declared = contractBlock('SURFACE').partialGraphModule;
	assert.ok(declared, 'the contract must declare the partial-graph module surface');

	const actual = await import('../partial.mjs');

	// exports
	assert.deepEqual(
		Object.keys(actual).sort(),
		[...declared.exports].sort(),
		'contract §2 partialGraphModule.exports drifted from partial.mjs',
	);
	const packageJson = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
	assert.equal(
		packageJson.exports?.[declared.packageExport],
		`./${declared.file}`,
		'the declared partial module must be reachable through the package exports map',
	);
	const viaPackageSubpath = await import(`${packageJson.name}${declared.packageExport.slice(1)}`);
	assert.deepEqual(
		Object.keys(viaPackageSubpath).sort(),
		[...declared.exports].sort(),
		'the partial package subpath must resolve to the declared module',
	);

	// class surface: the port is allowed to omit only what the contract says it omits
	const actualMethods = Object.getOwnPropertyNames(actual.DirectedGraph.prototype).filter(
		(name) => name !== 'constructor',
	);
	const actualStatics = Object.getOwnPropertyNames(actual.DirectedGraph).filter(
		(name) => !['length', 'name', 'prototype'].includes(name),
	);
	assert.deepEqual(
		actualMethods.sort(),
		[...declared.directedGraphMethods].sort(),
		'contract §2 directedGraphMethods drifted from the implementation',
	);
	assert.deepEqual(
		actualStatics.sort(),
		[...declared.directedGraphStatics].sort(),
		'contract §2 directedGraphStatics drifted from the implementation',
	);

	// what the contract says is omitted really is
	for (const name of declared.deliberatelyOmitted) {
		assert.equal(actual.DirectedGraph.prototype[name], undefined, `${name} must stay unimplemented`);
	}
});

test('contract §3: the result shape matches what runWorkflow actually returns', async () => {
	const declared = contractBlock('RESULT');

	const e = new engine.WorkflowExecutionEngine({
		nodes: [
			{ name: 'T', type: 'x.manualTrigger' },
			{ name: 'S', type: 'x.set' },
		],
		connections: { T: { main: [[{ node: 'S', type: 'main', index: 0 }]] } },
	});
	e.registerNodeType('x.manualTrigger', async () => [{ json: { a: 1 } }]);
	e.registerNodeType('x.set', async (_n, items) => items);

	const result = await e.runWorkflow('T');
	const task = result.resultData.runData.T[0];

	assert.deepEqual(Object.keys(result).sort(), [...declared.resultKeys].sort());
	assert.deepEqual(Object.keys(result.resultData).sort(), [...declared.resultDataKeys].sort());
	assert.deepEqual(Object.keys(result.executionLog[0]).sort(), [...declared.logEntryKeys].sort());

	// `error` only appears on a failed node, so required/optional are checked separately.
	for (const key of declared.taskDataRequired) {
		assert.ok(key in task, `ITaskData is missing the required key "${key}"`);
	}
	assert.deepEqual(
		Object.keys(task).sort(),
		[...declared.taskDataRequired].sort(),
		'a successful task must not carry the optional keys',
	);
	assert.equal('error' in task, false);
});

test('contract §3: the declared status vocabulary is a subset of n8n ExecutionStatus', () => {
	const declared = contractBlock('STATUS').statuses;

	// The reference vocabulary, read straight out of the pinned source.
	const statusSource = readFileSync(
		join(REPO, 'reference/n8n/packages/workflow/src/execution-status.ts'),
		'utf8',
	);
	const real = [...statusSource.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
	assert.ok(real.includes('success') && real.includes('error') && real.includes('canceled'));

	for (const status of declared) {
		assert.ok(real.includes(status), `"${status}" is not an n8n ExecutionStatus`);
	}

	// and the implementation must not invent any other value
	const code = stripComments(runnerSource);
	for (const status of ['success', 'error', 'canceled']) {
		assert.ok(code.includes(`'${status}'`), `the engine no longer produces "${status}"`);
	}
});

test('contract §7: declared non-goals are absent from the implementation (not just from prose)', () => {
	const { nonGoals } = contractBlock('NONGOALS');
	const code = stripComments(runnerSource) + stripComments(graphSource) + stripComments(partialSource);

	for (const token of nonGoals) {
		assert.equal(
			new RegExp(`\\b${token}\\b`, 'i').test(code),
			false,
			`"${token}" is declared a non-goal but appears in the implementation — update the contract`,
		);
	}
	// The prose is allowed (and expected) to name them, so the comments must still mention them.
	for (const token of ['waitTill', 'sourceOverwrite']) {
		assert.ok(runnerSource.includes(token), `the source should still document "${token}" as out of scope`);
	}
});

test('contract §8: every provenance citation points at real lines in reference/n8n', () => {
	const KNOWN = {
		'workflow-execute.ts': 'packages/core/src/execution-engine/workflow-execute.ts',
		'get-connected-nodes.ts': 'packages/workflow/src/common/get-connected-nodes.ts',
		'get-parent-nodes.ts': 'packages/workflow/src/common/get-parent-nodes.ts',
		'map-connections-by-destination.ts': 'packages/workflow/src/common/map-connections-by-destination.ts',
		'interfaces.ts': 'packages/workflow/src/interfaces.ts',
		'execution-status.ts': 'packages/workflow/src/execution-status.ts',
		'workflow.ts': 'packages/workflow/src/workflow.ts',
		'constants.ts': 'packages/workflow/src/constants.ts',
		'node-helpers.ts': 'packages/workflow/src/node-helpers.ts',
		'workflow-data-proxy.ts': 'packages/workflow/src/workflow-data-proxy.ts',
		'run-execution-data-factory.ts': 'packages/workflow/src/run-execution-data-factory.ts',
		'base-execute-context.ts':
			'packages/core/src/execution-engine/node-execution-context/base-execute-context.ts',
		'directed-graph.ts':
			'packages/core/src/execution-engine/partial-execution-utils/directed-graph.ts',
		'filter-disabled-nodes.ts':
			'packages/core/src/execution-engine/partial-execution-utils/filter-disabled-nodes.ts',
		'find-subgraph.ts':
			'packages/core/src/execution-engine/partial-execution-utils/find-subgraph.ts',
		'run-data-utils.ts':
			'packages/core/src/execution-engine/partial-execution-utils/run-data-utils.ts',
		'get-incoming-data.ts':
			'packages/core/src/execution-engine/partial-execution-utils/get-incoming-data.ts',
		'clean-run-data.ts':
			'packages/core/src/execution-engine/partial-execution-utils/clean-run-data.ts',
		'handle-cycles.ts':
			'packages/core/src/execution-engine/partial-execution-utils/handle-cycles.ts',
		'find-trigger-for-partial-execution.ts':
			'packages/core/src/execution-engine/partial-execution-utils/find-trigger-for-partial-execution.ts',
		'find-start-nodes.ts':
			'packages/core/src/execution-engine/partial-execution-utils/find-start-nodes.ts',
		'get-source-data-groups.ts':
			'packages/core/src/execution-engine/partial-execution-utils/get-source-data-groups.ts',
		'recreate-node-execution-stack.ts':
			'packages/core/src/execution-engine/partial-execution-utils/recreate-node-execution-stack.ts',
		'rewire-graph.ts':
			'packages/core/src/execution-engine/partial-execution-utils/rewire-graph.ts',
		'execution.ts': 'packages/@n8n/constants/src/execution.ts',
	};

	const citation = /([a-z-]+\.ts):(\d+)(?:-(\d+))?/g;
	const sources = {
		'runner.mjs': runnerSource,
		'graph.mjs': graphSource,
		'partial.mjs': partialSource,
	};
	const lineCounts = new Map();
	const unknown = [];
	const outOfRange = [];
	let checked = 0;

	// Collect every problem before asserting, so one run reports all of them.
	for (const [file, source] of Object.entries(sources)) {
		for (const match of source.matchAll(citation)) {
			const [, name, startText, endText] = match;
			const rel = KNOWN[name];
			if (!rel) {
				unknown.push(`${file} -> ${name}:${startText}`);
				continue;
			}

			const full = join(REPO, 'reference/n8n', rel);
			assert.ok(existsSync(full), `reference file missing: ${rel}`);
			if (!lineCounts.has(name)) {
				lineCounts.set(name, readFileSync(full, 'utf8').split('\n').length);
			}

			const lines = lineCounts.get(name);
			const start = Number(startText);
			const end = endText ? Number(endText) : start;
			if (!(start >= 1 && start <= lines && end >= start && end <= lines)) {
				outOfRange.push(`${file} -> ${name}:${startText}${endText ? `-${endText}` : ''} (file has ${lines} lines)`);
				continue;
			}
			checked += 1;
		}
	}

	assert.deepEqual(unknown, [], 'citations name reference files that are not registered in the contract test');
	assert.deepEqual(outOfRange, [], 'citations point outside the referenced file — the reference moved');
	assert.ok(checked >= 20, `expected the sources to carry their provenance, found only ${checked} citation(s)`);
});

test('contract §4: the guarantee table names a test file that exists', () => {
	const referenced = [...contractText.matchAll(/`([a-z-]+\.test\.mjs)`/g)].map((m) => m[1]);
	assert.ok(referenced.length >= 2, 'the guarantee table must point at real test files');
	for (const file of new Set(referenced)) {
		assert.ok(existsSync(join(HERE, file)), `contract references ${file}, which does not exist`);
	}
});
