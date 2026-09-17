#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const pkg = join(root, 'packages/api-lego');
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

gate('A01', 'zero runtime dependencies', () =>
	Object.keys(JSON.parse(readFileSync(join(pkg, 'package.json'))).dependencies ?? {}).length
		? (() => {
				throw new Error('dependencies found');
			})()
		: '0 dependencies',
);

gate('A02', 'source boundary is import-closed', () => {
	const files = walk(join(pkg, 'src')).filter((f) => f.endsWith('.mjs'));
	for (const file of files) {
		for (const m of readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
			if (!m[1].startsWith('.') && !m[1].startsWith('node:')) throw new Error(m[1]);
		}
	}
	return `${files.length} source files`;
});

gate('A03', 'api conformance suite', () => {
	const out = run(['--test', 'test/*.test.mjs'], pkg);
	const pass = /^# pass (\d+)$/m.exec(out)?.[1];
	const fail = /^# fail (\d+)$/m.exec(out)?.[1];
	if (pass !== '12' || fail !== '0') throw new Error(`${pass}/${fail}`);
	return '12 pass / 0 fail';
});

gate('A04', 'reference tree remains pinned', () =>
	run(['tools/workflow-reference-manifest.mjs', '--check']).trim().split('\n').at(-1),
);

gate('A05', 'formal api contract present', () => {
	const c = readFileSync(join(root, 'contracts/api.contract.md'), 'utf8');
	for (const s of [
		'ResponseError',
		'sendSuccessResponse',
		'sendErrorResponse',
		'BadRequestError',
		'NotFoundError',
		'ConflictError',
		'/healthz',
		'data',
	]) {
		if (!c.includes(s)) throw new Error(`missing ${s}`);
	}
	return '8/8 core symbols contracted';
});

gate('A06', 'reference golden parity check', () => {
	const golden = JSON.parse(
		readFileSync(join(root, 'tests/reference/agent-4/golden/api.golden.json'), 'utf8'),
	);
	if (golden.cases.healthz.expected.body.status !== 'ok') {
		throw new Error('mismatched healthz status');
	}
	if (golden.cases.unauthenticated.expected.body.message !== 'Unauthorized') {
		throw new Error('mismatched unauthenticated message');
	}
	return 'golden constants & cases verified';
});

const report = {
	generatedAt: new Date().toISOString(),
	task: 'TASK-418-phase3-api-lego',
	reference: 'n8n 2.9.4',
	totals: {
		passed: gates.filter((g) => g.status === 'PASS').length,
		gates: gates.length,
	},
	gates,
};

writeFileSync(
	join(root, 'docs/isolation/evidence/api-lego-gate.json'),
	`${JSON.stringify(report, null, 2)}\n`,
);

console.log(`\nAPI LEGO gate: ${report.totals.passed}/${report.totals.gates} PASS`);
process.exit(report.totals.passed === report.totals.gates ? 0 : 1);
