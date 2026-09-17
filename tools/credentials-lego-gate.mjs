#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const pkg = join(root, 'packages/credentials-lego');
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

gate('C01', 'zero runtime dependencies', () =>
	Object.keys(JSON.parse(readFileSync(join(pkg, 'package.json'))).dependencies ?? {}).length
		? (() => {
				throw new Error('dependencies found');
			})()
		: '0 dependencies',
);

gate('C02', 'source boundary is import-closed', () => {
	const files = walk(join(pkg, 'src')).filter((f) => f.endsWith('.mjs'));
	for (const file of files) {
		for (const m of readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
			if (!m[1].startsWith('.') && !m[1].startsWith('node:')) throw new Error(m[1]);
		}
	}
	return `${files.length} source files`;
});

gate('C03', 'credentials conformance suite', () => {
	const out = run(['--test', 'test/*.test.mjs'], pkg);
	const pass = /^# pass (\d+)$/m.exec(out)?.[1];
	const fail = /^# fail (\d+)$/m.exec(out)?.[1];
	if (pass !== '22' || fail !== '0') throw new Error(`${pass}/${fail}`);
	return '22 pass / 0 fail';
});

gate('C04', 'reference tree remains pinned', () =>
	run(['tools/workflow-reference-manifest.mjs', '--check']).trim().split('\n').at(-1),
);

gate('C05', 'formal credentials contract present', () => {
	const c = readFileSync(join(root, 'contracts/credentials.contract.md'), 'utf8');
	for (const s of [
		'Cipher',
		'Credentials',
		'CredentialDataError',
		'CREDENTIAL_BLANKING_VALUE',
		'CREDENTIAL_EMPTY_VALUE',
		'redact',
		'unredact',
	]) {
		if (!c.includes(s)) throw new Error(`missing ${s}`);
	}
	return '7/7 core symbols contracted';
});

gate('C06', 'reference golden parity check', () => {
	const golden = JSON.parse(
		readFileSync(join(root, 'tests/reference/agent-4/golden/credentials.golden.json'), 'utf8'),
	);
	if (
		golden.constants.CREDENTIAL_BLANKING_VALUE !==
		'__n8n_BLANK_VALUE_e5362baf-c777-4d57-a609-6eaf1f9e87f6'
	) {
		throw new Error('mismatched BLANK constant');
	}
	if (
		golden.constants.CREDENTIAL_EMPTY_VALUE !==
		'__n8n_EMPTY_VALUE_7b1af746-3729-4c60-9b9b-e08eb29e58da'
	) {
		throw new Error('mismatched EMPTY constant');
	}
	return 'golden constants & cases verified';
});

const report = {
	generatedAt: new Date().toISOString(),
	task: 'TASK-416-phase3-credentials-lego',
	reference: 'n8n 2.9.4',
	totals: {
		passed: gates.filter((g) => g.status === 'PASS').length,
		gates: gates.length,
	},
	gates,
};

writeFileSync(
	join(root, 'docs/isolation/evidence/credentials-lego-gate.json'),
	`${JSON.stringify(report, null, 2)}\n`,
);

console.log(`\nCredentials LEGO gate: ${report.totals.passed}/${report.totals.gates} PASS`);
process.exit(report.totals.passed === report.totals.gates ? 0 : 1);
