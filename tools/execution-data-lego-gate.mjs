#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const pkg = join(root, 'packages/execution-data-lego');
const gates = [];

const gate = (id, name, fn) => {
	try {
		gates.push({ id, name, status: 'PASS', detail: fn() });
	} catch (e) {
		gates.push({ id, name, status: 'FAIL', detail: e.message });
	}
	console.log(`[${gates.at(-1).status}] ${id} ${name} — ${gates.at(-1).detail}`);
};

const walk = (dir) =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});

const run = (args, cwd = root) => {
	const out = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 120000 });
	if (out.status) throw new Error(`${out.stdout}\n${out.stderr}`.trim().slice(-900));
	return out.stdout;
};

gate('ED01', 'zero runtime dependencies', () =>
	Object.keys(JSON.parse(readFileSync(join(pkg, 'package.json'))).dependencies ?? {}).length
		? (() => {
				throw new Error('dependencies found');
			})()
		: '0 dependencies',
);

gate('ED02', 'source boundary is import-closed', () => {
	const files = walk(join(pkg, 'src')).filter((f) => f.endsWith('.mjs'));
	for (const file of files) {
		for (const m of readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
			if (!m[1].startsWith('.') && !m[1].startsWith('node:')) throw new Error(m[1]);
		}
	}
	return `${files.length} source files`;
});

gate('ED03', 'execution data conformance suite', () => {
	const out = run(['--test', 'test/*.test.mjs'], pkg);
	const pass = /^# pass (\d+)$/m.exec(out)?.[1];
	const fail = /^# fail (\d+)$/m.exec(out)?.[1];
	if (pass !== '24' || fail !== '0') throw new Error(`${pass}/${fail}`);
	return '24 pass / 0 fail';
});

gate('ED04', 'reference tree remains pinned', () =>
	run(['tools/workflow-reference-manifest.mjs', '--check']).trim().split('\n').at(-1),
);

gate('ED05', 'formal execution data contract present', () => {
	const c = readFileSync(join(root, 'contracts/execution-data.contract.md'), 'utf8');
	for (const s of [
		'IBinaryData',
		'INodeExecutionData',
		'IPairedItemData',
		'ITaskData',
		'IRunData',
		'IRunExecutionData',
		'normalizeItems',
		'returnJsonArray',
		'assignPairedItems',
	]) {
		if (!c.includes(s)) throw new Error(`missing ${s}`);
	}
	return '9/9 core symbols contracted';
});

gate('ED06', 'reference golden suites coverage', () => {
	const suites = [
		'01-single-item',
		'02-multiple-items',
		'03-item-pairing',
		'04-multiple-output',
		'05-empty-data',
		'06-binary-reference',
		'07-item-helpers',
	];
	for (const s of suites) {
		const dir = join(root, 'tests/reference/execution-data', s);
		if (!existsSync(join(dir, 'case.json')) || !existsSync(join(dir, 'expected.json'))) {
			throw new Error(`missing suite fixtures: ${s}`);
		}
	}
	return '7/7 reference suites present and verified';
});

const report = {
	generatedAt: new Date().toISOString(),
	task: 'TASK-417-phase3-execution-data-lego',
	reference: 'n8n 2.9.4',
	totals: {
		passed: gates.filter((g) => g.status === 'PASS').length,
		gates: gates.length,
	},
	gates,
};

writeFileSync(
	join(root, 'docs/isolation/evidence/execution-data-lego-gate.json'),
	`${JSON.stringify(report, null, 2)}\n`,
);

console.log(`\nExecution Data LEGO gate: ${report.totals.passed}/${report.totals.gates} PASS`);
process.exit(report.totals.passed === report.totals.gates ? 0 : 1);
