#!/usr/bin/env node
/**
 * Validation LEGO — Rust port conformance fixtures.
 *
 * The Phase-3 Rust crate (`crates/n8n-validation`) must reproduce the NEW
 * CAPABILITY rules (`workflow-rules.ts`, contracts/validation.contract.md
 * §4.4/§10). This script executes the D-case inputs (mirroring
 * validation.test.ts Part 2, plus X-probes for guard-branch parity) against
 * workflow-rules.ts itself and writes the *expected* reports as golden JSON,
 * so a Rust test can assert against the same values without a Node host in
 * the loop. Fixtures are GENERATED, never hand-transcribed.
 *
 * Usage:
 *   node tests/reference/agent-4/validation/build-fixtures.mjs           # derive + write
 *   node tests/reference/agent-4/validation/build-fixtures.mjs --check   # re-derive + compare (exit 1 on drift)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorkflow, detectCycles, checkNodeUniqueness, checkDanglingConnections } from './workflow-rules.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'fixtures.json');
const ref = (name) => JSON.parse(readFileSync(resolve(HERE, '..', '..', name, 'workflow.json'), 'utf8'));

const node = (name, extra = {}) => ({ id: name, name, type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {}, ...extra });
const edge = (to, type = 'main') => [[{ node: to, type, index: 0 }]];

const FNS = { validateWorkflow, detectCycles, checkNodeUniqueness, checkDanglingConnections };
const cases = [];
const add = (id, fn, workflow, options) => {
	const impl = FNS[fn];
	if (!impl) throw new Error(`unknown fn ${fn}`);
	const out = fn === 'validateWorkflow' ? impl(workflow, options ?? {}) : impl(workflow);
	const expect = fn === 'validateWorkflow' ? out : { errors: out };
	cases.push({ id, fn, ...(options ? { options } : {}), workflow, expect });
};

// --- D1/D2: reference golden workflows are valid ---
add('D1-empty-valid', 'validateWorkflow', ref('01-empty-workflow'));
add('D2-linear-valid', 'validateWorkflow', ref('03-linear'));
add('D2-linear-strict', 'validateWorkflow', ref('03-linear'), { allowCycles: false });

// --- D3/D9: uniqueness (disabled nodes still count) ---
add('D3-duplicate-disabled', 'validateWorkflow', { nodes: [node('Code'), node('Code', { disabled: true })], connections: {} });
add('D3b-uniqueness-clean', 'checkNodeUniqueness', { nodes: [node('A'), node('B')] });

// --- D4/D5: dangling + invalid connection type ---
add('D4-dangling-ghost', 'validateWorkflow', { nodes: [node('Trigger')], connections: { Trigger: { main: edge('Ghost') } } });
add('D5-bad-type-key', 'validateWorkflow', { nodes: [node('A'), node('B')], connections: { A: { foo: edge('B', 'foo') } } });
add('D5b-unknown-source', 'checkDanglingConnections', { nodes: [node('A')], connections: { Nope: { main: edge('A') } } });

// --- D6/D7/D8: cycles opt-in, main-only, deterministic path ---
const cyclic = { nodes: [node('A'), node('B')], connections: { A: { main: edge('B') }, B: { main: edge('A') } } };
add('D6-cycle-default-allowed', 'validateWorkflow', cyclic);
add('D6b-cycle-strict', 'validateWorkflow', cyclic, { allowCycles: false });
add('D7-ai-cycle-ignored', 'validateWorkflow', { nodes: [node('A'), node('B')], connections: { A: { ai_tool: edge('B', 'ai_tool') }, B: { ai_tool: edge('A', 'ai_tool') } } }, { allowCycles: false });
add('D8a-self-loop', 'detectCycles', { nodes: [node('A')], connections: { A: { main: edge('A') } } });
add('D8b-three-cycle', 'detectCycles', { nodes: [node('A'), node('B'), node('C')], connections: { A: { main: edge('B') }, B: { main: edge('C') }, C: { main: edge('A') } } });
add('D8c-diamond', 'detectCycles', { nodes: [node('A'), node('B'), node('C'), node('D')], connections: { A: { main: [[{ node: 'B', type: 'main', index: 0 }, { node: 'C', type: 'main', index: 0 }]] }, B: { main: edge('D') }, C: { main: edge('D') } } });

// --- D10: malformed input never throws ---
add('D10a-garbage-string', 'validateWorkflow', 'garbage');
add('D10b-nodes-not-array', 'validateWorkflow', { nodes: 'x' });
add('D10c-connections-not-object', 'validateWorkflow', { nodes: [], connections: [] });
add('D10d-unnamed-node', 'validateWorkflow', { nodes: [{ name: 1 }] });
add('D10e-empty-nodes-valid', 'validateWorkflow', { nodes: [] });

// --- X-probes: guard-branch parity beyond the D-cases ---
add('X1-malformed-target', 'validateWorkflow', { nodes: [node('A'), node('B')], connections: { A: { main: [[{ node: 7 }]] } } });
add('X2-null-output-slot', 'validateWorkflow', { nodes: [node('A'), node('B')], connections: { A: { main: [null, [{ node: 'B', type: 'main', index: 0 }]] } } });
add('X3-nonobject-bytype', 'validateWorkflow', { nodes: [node('A')], connections: { A: 42 } });
add('X4-missing-connections-key', 'validateWorkflow', { nodes: [node('A')] });
add('X5-mixed-types-main-only', 'validateWorkflow', { nodes: [node('A'), node('B')], connections: { A: { main: edge('B'), ai_tool: edge('A', 'ai_tool') } } }, { allowCycles: false });
add('X6-triple-duplicate', 'validateWorkflow', { nodes: [node('A'), node('A'), node('A')], connections: {} });
add('X7-target-type-bad-only', 'validateWorkflow', { nodes: [node('A'), node('B')], connections: { A: { main: edge('B', 'foo') } } });
add('X8-root-order-deterministic', 'detectCycles', { nodes: [node('B'), node('A')], connections: { A: { main: edge('B') }, B: { main: edge('A') } } });
add('X9-connections-null', 'validateWorkflow', { nodes: [], connections: null });
add('X10-null-workflow', 'validateWorkflow', null);
add('X11-null-node-entry', 'validateWorkflow', { nodes: [null] });
add('X12-main-not-array', 'validateWorkflow', { nodes: [node('A')], connections: { A: { main: 'x' } } });
add('X13-null-target', 'validateWorkflow', { nodes: [node('A')], connections: { A: { main: [[null]] } } });
add('X14-missing-nodes-key', 'validateWorkflow', {});
add('X15-collect-all-insertion-order', 'validateWorkflow', { nodes: [node('Z'), node('A'), node('B')], connections: { Z: { zzz: [[{ node: 'B', type: 'main', index: 0 }]], main: edge('GhostZ') }, A: { main: edge('GhostA') } } });

const payload = { generator: 'build-fixtures.mjs', source: 'workflow-rules.ts', cases };
const json = JSON.stringify(payload, null, 1) + '\n';

if (process.argv.includes('--check')) {
	let committed;
	try {
		committed = readFileSync(OUT, 'utf8');
	} catch {
		console.error(`MISSING: ${OUT} does not exist; run without --check to generate it`);
		process.exit(1);
	}
	if (committed !== json) {
		const a = committed.split('\n');
		const b = json.split('\n');
		const at = a.findIndex((line, i) => line !== b[i]);
		console.error(`DRIFT: fixtures differ from workflow-rules.ts (first difference at line ${at + 1})`);
		console.error(`  committed:  ${a[at]}`);
		console.error(`  recomputed: ${b[at]}`);
		process.exit(1);
	}
	console.log(`fixtures match workflow-rules.ts: ${cases.length} cases`);
	process.exit(0);
}

writeFileSync(OUT, json);
console.log(`wrote ${OUT}: ${cases.length} cases`);
