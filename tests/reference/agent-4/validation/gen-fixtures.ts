/**
 * Generates language-neutral parity fixtures for the Validation rule capability (golden D1–D10).
 * Output: tests/reference/agent-4/validation/fixtures/*.json with shape
 *   { id, description, input: { workflow, options }, expected: ValidationReport }
 * `expected` is produced by the TS reference implementation (workflow-rules.ts), which is the
 * contract-conformant oracle. Any port (e.g. crates/n8n-validation) must reproduce `expected`
 * byte-for-byte after JSON canonicalisation (sorted keys).
 *
 * Run: node tests/reference/agent-4/validation/gen-fixtures.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorkflow } from './workflow-rules.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'fixtures');
mkdirSync(out, { recursive: true });
const ref = (name: string) => JSON.parse(readFileSync(resolve(here, '..', '..', name, 'workflow.json'), 'utf8'));
const node = (name: string, extra: object = {}) => ({ id: name, name, type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {}, ...extra });
const edge = (to: string, type = 'main') => [[{ node: to, type, index: 0 }]];

const cases: Array<{ id: string; description: string; workflow: unknown; options?: { allowCycles?: boolean } }> = [
	{ id: 'D01-empty-workflow', description: 'reference golden 01: empty workflow is valid', workflow: ref('01-empty-workflow') },
	{ id: 'D02-linear', description: 'reference golden 03: Trigger → Code is valid (also with allowCycles=false)', workflow: ref('03-linear'), options: { allowCycles: false } },
	{ id: 'D03-duplicate-node-name', description: 'two nodes named Code → DUPLICATE_NODE_NAME', workflow: { nodes: [node('Code'), node('Code')], connections: {} } },
	{ id: 'D04-dangling-target', description: 'Trigger → Ghost, Ghost missing → DANGLING_CONNECTION with path', workflow: { nodes: [node('Trigger')], connections: { Trigger: { main: edge('Ghost') } } } },
	{ id: 'D05-invalid-connection-type', description: 'connection type foo → INVALID_CONNECTION_TYPE (both on the type key and the target)', workflow: { nodes: [node('A'), node('B')], connections: { A: { foo: edge('B', 'foo') } } } },
	{ id: 'D06-cycle-default-allowed', description: 'A→B→A on main, default options → valid (reference parity, allowCycles defaults true)', workflow: { nodes: [node('A'), node('B')], connections: { A: { main: edge('B') }, B: { main: edge('A') } } } },
	{ id: 'D07-cycle-strict', description: 'A→B→A on main, allowCycles=false → CYCLE_DETECTED with deterministic path', workflow: { nodes: [node('A'), node('B')], connections: { A: { main: edge('B') }, B: { main: edge('A') } } }, options: { allowCycles: false } },
	{ id: 'D08-ai-edges-ignored', description: 'A↔B via ai_tool only, allowCycles=false → valid (only main edges considered)', workflow: { nodes: [node('A'), node('B')], connections: { A: { ai_tool: edge('B', 'ai_tool') }, B: { ai_tool: edge('A', 'ai_tool') } } }, options: { allowCycles: false } },
	{ id: 'D09-disabled-duplicate', description: 'disabled node with duplicate name still reported (disabled-handling is not validation)', workflow: { nodes: [node('Code'), node('Code', { disabled: true })], connections: {} } },
	{ id: 'D10-malformed-input', description: 'string instead of workflow → INVALID_INPUT, never throws', workflow: 'garbage' },
	{ id: 'D11-diamond-dag', description: 'A→{B,C}→D diamond, allowCycles=false → valid (no false positive on shared descendant)', workflow: { nodes: [node('A'), node('B'), node('C'), node('D')], connections: { A: { main: [[{ node: 'B', type: 'main', index: 0 }, { node: 'C', type: 'main', index: 0 }]] }, B: { main: edge('D') }, C: { main: edge('D') } } }, options: { allowCycles: false } },
	{ id: 'D12-self-loop-and-3-cycle', description: 'C→A back-edge in A→B→C, allowCycles=false → path A → B → C → A', workflow: { nodes: [node('A'), node('B'), node('C')], connections: { A: { main: edge('B') }, B: { main: edge('C') }, C: { main: edge('A') } } }, options: { allowCycles: false } },
	{ id: 'D13-unknown-source-and-multiple-errors', description: 'errors accumulate: duplicate + unknown source + dangling target in one report', workflow: { nodes: [node('A'), node('A')], connections: { Nope: { main: edge('A') }, A: { main: edge('Ghost') } } } },
	{ id: 'D14-malformed-output-slot', description: 'output slot that is neither null nor array (number / object) → DANGLING_CONNECTION "Malformed connection output", never throws', workflow: { nodes: [node('A')], connections: { A: { main: [1, null, {}, [{ node: 'A', type: 'main', index: 0 }]] } } } },
];

const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as any)[k])])) : v;
const index: string[] = [];
for (const c of cases) {
	const expected = validateWorkflow(c.workflow, c.options ?? {});
	const fixture = canon({ id: c.id, description: c.description, input: { workflow: c.workflow, options: c.options ?? {} }, expected });
	writeFileSync(resolve(out, `${c.id}.json`), JSON.stringify(fixture, null, 2) + '\n');
	index.push(c.id);
}
writeFileSync(resolve(out, 'index.json'), JSON.stringify({ oracle: 'tests/reference/agent-4/validation/workflow-rules.ts', contract: 'contracts/validation.contract.md', canonicalisation: 'JSON with recursively sorted object keys; arrays keep order', cases: index }, null, 2) + '\n');
console.log(`wrote ${cases.length} fixtures → ${out}`);
