/**
 * Gate 4 — strict isolation of the LEGO-owned capability.
 *
 * The rule engine (the only code this LEGO *authors*) must load and pass its full oracle in a child
 * process where the reference runtime is unreachable: LEGO_REFERENCE_PKG points at an empty dir and
 * `n8n-workflow` is blocked from the module graph. If anything in rules/ ever reached into n8n, this
 * fails — that is what licenses "independently testable" for module 04.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const PKG = join(fileURLToPath(import.meta.url), '..', '..');
const FX = join(PKG, '../../tests/reference/agent-4/validation/fixtures');

const script = `
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Module from 'node:module';
const origLoad = Module._load;
Module._load = function (req, ...rest) { if (/^n8n-workflow|luxon|zod|lodash/.test(req)) throw new Error('BLOCKED: ' + req); return origLoad.call(this, req, ...rest); };
const rules = await import(${JSON.stringify(join(PKG, 'src/rules/workflow-rules.ts'))});
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
let pass = 0, fail = [];
for (const f of readdirSync(${JSON.stringify(FX)}).filter((f) => /^D\\d\\d-/.test(f))) {
  const fx = JSON.parse(readFileSync(join(${JSON.stringify(FX)}, f), 'utf8'));
  JSON.stringify(canon(rules.validateWorkflow(fx.input.workflow, fx.input.options))) === JSON.stringify(fx.expected) ? pass++ : fail.push(f);
}
const loaded = Object.keys(process.moduleLoadList ?? {}).length;
const refLoaded = [...(Module._cache ? Object.keys(Module._cache) : [])].some((p) => /node_modules[\\/](n8n-workflow|luxon|zod)[\\/]/.test(p));
console.log(JSON.stringify({ pass, fail, refLoaded, exports: Object.keys(rules).sort() }));
`;

test('rules/ loads and passes D01–D14 with the reference runtime blocked from the module graph', () => {
	const dir = mkdtempSync(join(tmpdir(), 'lego-validation-strict-')); const file = join(dir, 'strict.mjs'); writeFileSync(file, script);
	const r = spawnSync(process.execPath, ['--no-warnings', file], { encoding: 'utf8', env: { PATH: process.env.PATH, LEGO_REFERENCE_PKG: dir, N8N_RUNTIME: dir } });
	assert.equal(r.status, 0, r.stderr);
	const out = JSON.parse(r.stdout.trim().split('\n').pop());
	assert.equal(out.refLoaded, false, 'reference runtime leaked into the strict module graph');
	assert.deepEqual(out.fail, []); assert.equal(out.pass, 14);
	assert.deepEqual(out.exports, ['NODE_CONNECTION_TYPES', 'checkDanglingConnections', 'checkNodeUniqueness', 'detectCycles', 'validateWorkflow']);
});

test('the reference-bound part of the seam is NOT loadable without the runtime (declared, not hidden)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'lego-validation-noref-'));
	const r = spawnSync(process.execPath, ['--no-warnings', '-e', `import(${JSON.stringify(join(PKG, 'src/index.ts'))}).then(() => { console.log('LOADED'); }, (e) => { console.log('REJECTED ' + e.code); })`], { encoding: 'utf8', env: { PATH: process.env.PATH, LEGO_REFERENCE_PKG: dir, N8N_RUNTIME: dir } });
	assert.match(r.stdout, /^REJECTED (MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND)/, 'seam must fail loudly without the pinned runtime, never fall back silently');
});
