#!/usr/bin/env node
/**
 * Node LEGO gate (TASK-409-phase3-node-lego).
 *
 *   N01  zero runtime dependencies
 *   N02  source boundary import-closed (relative + node: only)
 *   N03  node-model conformance suite (66 tests)
 *   N04  reference tree pinned (workflow-reference-manifest --check)
 *   N05  differential vs the published reference build: 0 divergences
 *   N06  formal contract + isolation doc present
 *
 * Writes docs/isolation/evidence/node-lego-gate.json.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const pkg = join(root, 'packages/node-lego');
const gates = [];
const gate = async (id, name, fn) => {
	try {
		gates.push({ id, name, status: 'PASS', detail: await fn() });
	} catch (e) {
		gates.push({ id, name, status: 'FAIL', detail: e.message });
	}
	console.log(`[${gates.at(-1).status}] ${id} ${name} — ${gates.at(-1).detail}`);
};
const walk = (dir) => readdirSync(dir).flatMap((name) => {
	const path = join(dir, name);
	return statSync(path).isDirectory() ? walk(path) : [path];
});
const run = (args, cwd = root) => {
	const out = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 300000 });
	if (out.status) throw new Error(`${out.stdout}\n${out.stderr}`.trim().slice(-900));
	return out.stdout;
};

await gate('N01', 'zero runtime dependencies', () => {
	const dependencies = JSON.parse(readFileSync(join(pkg, 'package.json'))).dependencies ?? {};
	const count = Object.keys(dependencies).length;
	if (count) throw new Error(`dependencies found: ${Object.keys(dependencies).join(', ')}`);
	return '0 dependencies';
});

await await gate('N02', 'source boundary is import-closed', () => {
	const files = walk(join(pkg, 'src')).filter((file) => file.endsWith('.mjs'));
	for (const file of files) {
		for (const match of readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
			if (!match[1].startsWith('.') && !match[1].startsWith('node:')) throw new Error(`${file}: ${match[1]}`);
		}
	}
	return `${files.length} source files, no cross-LEGO imports`;
});

await await gate('N03', 'node-model conformance suite', () => {
	const out = run(['--test', 'test/*.test.mjs'], pkg);
	const pass = /^# pass (\d+)$/m.exec(out)?.[1];
	const fail = /^# fail (\d+)$/m.exec(out)?.[1];
	if (pass !== '66' || fail !== '0') throw new Error(`${pass} pass / ${fail} fail`);
	return `${pass} pass / 0 fail`;
});

await gate('N04', 'reference tree remains pinned', () =>
	run([join(root, 'tools/workflow-reference-manifest.mjs'), '--check']).trim().split('\n').at(-1));

await gate('N05', 'differential vs the published reference build', () => {
	const out = run([join(root, 'tools/node-lego-differential.mjs')]);
	const summary = /NODE LEGO DIFFERENTIAL: (\d+) agree \/ (\d+) diverge \/ (\d+) comparisons \(([^)]*)\)/.exec(out);
	if (!summary) throw new Error('no differential summary');
	const [, agree, diverge, comparisons, extra] = summary;
	if (Number(diverge) !== 0) throw new Error(`${diverge} DIVERGE — ${out.split('\n').filter((l) => l.startsWith('[DIVERGE]')).join(' | ')}`);
	return `${agree} agree / 0 diverge across ${comparisons} comparisons (${extra})`;
});

await gate('N06', 'formal contract + isolation doc present', () => {
	const contract = readFileSync(join(root, 'contracts/node.contract.md'), 'utf8');
	for (const section of ['## 12. Phase-3 reconstruction', 'NodeHelpers', 'validateNodeParameters', 'resolveRelativePath']) {
		if (!contract.includes(section)) throw new Error(`contracts/node.contract.md missing ${section}`);
	}
	const doc = readFileSync(join(root, 'docs/isolation/node.md'), 'utf8');
	for (const id of ['N01', 'N05', 'TASK-409']) {
		if (!doc.includes(id)) throw new Error(`docs/isolation/node.md missing ${id}`);
	}
	return 'contract §12 + docs/isolation/node.md §5';
});

await gate('N07', 'every exported symbol is documented in the contract', async () => {
	const module = await import(join(pkg, 'src/index.mjs'));
	const contract = readFileSync(join(root, 'contracts/node.contract.md'), 'utf8');
	const names = Object.keys(module);
	const missing = names.filter((name) => !contract.includes(name));
	if (missing.length) throw new Error(`${missing.length} undocumented: ${missing.join(', ')}`);
	return `${names.length} exported symbols documented`;
});

const report = {
	generatedAt: new Date().toISOString(),
	task: 'TASK-409-phase3-node-lego',
	reference: 'n8n 2.9.4',
	totals: { passed: gates.filter((g) => g.status === 'PASS').length, gates: gates.length },
	gates,
};
writeFileSync(join(root, 'docs/isolation/evidence/node-lego-gate.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nNode LEGO gate: ${report.totals.passed}/${report.totals.gates} PASS`);
process.exit(report.totals.passed === report.totals.gates ? 0 : 1);
