#!/usr/bin/env node
/**
 * Execution LEGO gate — Phase 3 (reconstruction).
 *
 * Verifies the reconstructed engine in `packages/execution-engine` and writes:
 *   docs/isolation/evidence/execution-engine-gate.json
 *   docs/isolation/execution-verification.md
 *
 * Gates
 *   E01 zero runtime dependencies (plain Node.js ESM, no install step)
 *   E02 package boundary: sources import nothing from reference/ or n8n packages
 *   E03 Rust guard: this LEGO adds no Rust; crates/ + apps/ stay frozen
 *   E04 reference tree still byte-identical to the pinned hashes
 *   E05 POOL-001 suite — core workflow execute loop
 *   E06 POOL-002 suite — node execution context + data proxy
 *   E07 POOL-003 suite — error & retry handling
 *   E08 the declared public surface is documented in contracts/execution.contract.md
 *
 * usage: node tools/execution-engine-gate.mjs [--json]
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PKG = join(REPO, 'packages/execution-engine');
const CONTRACT = join(REPO, 'contracts/execution.contract.md');
const EVIDENCE = join(REPO, 'docs/isolation/evidence/execution-engine-gate.json');
const REPORT_MD = join(REPO, 'docs/isolation/execution-verification.md');
const args = process.argv.slice(2);

const results = [];
function gate(id, title, fn, requirement) {
	const started = Date.now();
	let status = 'PASS';
	let detail = '';
	try {
		detail = fn() ?? '';
	} catch (error) {
		status = 'FAIL';
		detail = error.message;
	}
	results.push({ id, title, requirement, status, detail: String(detail).trim().slice(0, 1200), ms: Date.now() - started });
	console.log(`[${status}] ${id} ${title}${detail ? ` — ${String(detail).split('\n')[0]}` : ''}`);
}

function walk(dir, filter, found = []) {
	if (!existsSync(dir)) return found;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walk(path, filter, found);
		else if (!filter || filter(path)) found.push(path);
	}
	return found;
}

function runNodeTest(pattern, cwd) {
	const out = spawnSync(process.execPath, ['--test', pattern], { cwd, encoding: 'utf8', timeout: 300_000 });
	const text = `${out.stdout ?? ''}\n${out.stderr ?? ''}`;
	const pass = Number(/^# pass (\d+)$/m.exec(text)?.[1] ?? -1);
	const fail = Number(/^# fail (\d+)$/m.exec(text)?.[1] ?? -1);
	if (out.status !== 0 || fail !== 0) {
		throw new Error(`exit ${out.status}, pass ${pass}, fail ${fail}\n${text.slice(-900)}`);
	}
	return `${pass} pass / ${fail} fail`;
}

/* E01 — zero dependencies -------------------------------------------------- */
gate('E01', 'execution-engine has no runtime dependencies', () => {
	const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
	const deps = Object.keys(pkg.dependencies ?? {});
	const devDeps = Object.keys(pkg.devDependencies ?? {});
	if (deps.length > 0) throw new Error(`runtime dependencies declared: ${deps.join(', ')}`);
	if (devDeps.length > 0) throw new Error(`devDependencies declared: ${devDeps.join(', ')}`);
	return 'no dependencies, no devDependencies, no install step (node:test only)';
});

/* E02 — package boundary --------------------------------------------------- */
gate('E02', 'sources are import-closed (no reference/ or n8n package imports)', () => {
	const sources = walk(join(PKG, 'src'), (path) => path.endsWith('.mjs'));
	const offenders = [];
	for (const file of sources) {
		const raw = readFileSync(file, 'utf8');
		// Comments are allowed to cite the reference provenance; only *code* must be closed.
		const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
		const imports = [...code.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
		for (const specifier of imports) {
			if (!specifier.startsWith('.') && !specifier.startsWith('node:')) {
				offenders.push(`${relative(REPO, file)} → ${specifier}`);
			}
		}
		if (/reference\/n8n/.test(code)) offenders.push(`${relative(REPO, file)} references reference/n8n in code`);
	}
	if (offenders.length > 0) throw new Error(offenders.join('; '));
	return `${sources.length} source files, all imports relative or node: builtins`;
});

/* E03 — Rust guard -------------------------------------------------------- */
gate('E03', 'Rust guard: no Rust added by this LEGO, crates/apps frozen', () => {
	const rustInPackage = walk(PKG, (path) => path.endsWith('.rs') || path.endsWith('Cargo.toml'));
	if (rustInPackage.length > 0) throw new Error(`Rust files inside the package: ${rustInPackage.join(', ')}`);

	const frozenFiles = [...walk(join(REPO, 'crates')), ...walk(join(REPO, 'apps'))].map((path) => relative(REPO, path)).sort();
	const digest = createHash('sha256').update(frozenFiles.join('\n')).digest('hex').slice(0, 32);
	mkdirSync(join(PKG, 'manifest'), { recursive: true });
	const pinPath = join(PKG, 'manifest/rust-freeze.json');
	if (existsSync(pinPath)) {
		const pinned = JSON.parse(readFileSync(pinPath, 'utf8'));
		if (pinned.digest !== digest) {
			throw new Error(`crates/ + apps/ changed: pinned ${pinned.digest}, actual ${digest}`);
		}
	} else {
		writeFileSync(pinPath, `${JSON.stringify({ digest, fileCount: frozenFiles.length, note: 'Frozen at the Phase-3 baseline of the execution LEGO. crates/ is legacy and must not grow.' }, null, '\t')}\n`);
	}
	return `${rustInPackage.length} Rust files in the package; crates/+apps/ frozen at ${digest} (${frozenFiles.length} files)`;
});

/* E04 — reference integrity ---------------------------------------------- */
gate('E04', 'reference/n8n tree still matches the pinned hashes', () => {
	const out = spawnSync(process.execPath, [join(REPO, 'tools/workflow-reference-manifest.mjs'), '--check'], {
		cwd: REPO,
		encoding: 'utf8',
		timeout: 300_000,
	});
	if (out.status !== 0) throw new Error(`${out.stdout}\n${out.stderr}`.trim().slice(-600));
	return (out.stdout ?? '').trim().split('\n').pop();
});

/* E05-E07 — the three pool suites ----------------------------------------- */
gate('E05', 'POOL-001 suite: core workflow execute loop', () =>
	runNodeTest('test/01-execution-loop.test.mjs', PKG),
	'packages/execution-engine/test/01-execution-loop.test.mjs',
);

gate('E06', 'POOL-002 suite: node execution context + data proxy', () =>
	runNodeTest('test/02-node-context-data-proxy.test.mjs', PKG),
	'packages/execution-engine/test/02-node-context-data-proxy.test.mjs',
);

gate('E07', 'POOL-003 suite: error & retry handling', () =>
	runNodeTest('test/03-error-retry.test.mjs', PKG),
	'packages/execution-engine/test/03-error-retry.test.mjs',
);

/* E08 — contract coverage of the public surface --------------------------- */
gate('E08', 'public surface is documented in contracts/execution.contract.md', () => {
	if (!existsSync(CONTRACT)) throw new Error('contracts/execution.contract.md missing');
	const contract = readFileSync(CONTRACT, 'utf8');
	const index = readFileSync(join(PKG, 'src/index.mjs'), 'utf8');

	const exported = new Set();
	for (const block of index.matchAll(/export\s*{([^}]*)}/g)) {
		for (const raw of block[1].split(',')) {
			const entry = raw.trim();
			if (!entry) continue;
			const name = entry.includes(' as ') ? entry.split(' as ')[1].trim() : entry;
			exported.add(name);
		}
	}

	const undocumented = [...exported].filter((name) => !contract.includes(name));
	if (undocumented.length > 0) throw new Error(`not documented: ${undocumented.join(', ')}`);
	return `${exported.size} exported symbols documented`;
});

/* ---------------- evidence + human-readable report ----------------------- */
const totals = {
	gates: results.length,
	passed: results.filter((entry) => entry.status === 'PASS').length,
	failed: results.filter((entry) => entry.status === 'FAIL').length,
};

const report = {
	generatedAt: new Date().toISOString(),
	lego: 'execution',
	phase: 'phase-3-reconstruction',
	language: 'JavaScript (Node.js ESM)',
	rustImplementation: 'NOT ALLOWED / NOT STARTED',
	package: 'packages/execution-engine',
	contract: 'contracts/execution.contract.md',
	reference: {
		pinnedVersion: '2.9.4',
		pinnedCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
		sourceRoot: 'reference/n8n/packages/core/src/execution-engine',
		rules: [
			'reference/n8n/** is read-only; the reconstruction never imports or edits it.',
			'PROJECT_RULES.md v2.9.4: ZERO RUST — the execution LEGO is JavaScript.',
		],
	},
	gates: results,
	totals,
	pools: {
		'POOL-001-core-workflow-execute-loop': {
			status: results.find((entry) => entry.id === 'E05')?.status === 'PASS' ? 'IMPLEMENTED' : 'FAILED',
			surface: ['WorkflowExecute', 'addNodeToBeExecuted', 'ensureInputData', 'assignPairedItems', 'routeOutputData'],
		},
		'POOL-002-node-execution-context-data-proxy': {
			status: results.find((entry) => entry.id === 'E06')?.status === 'PASS' ? 'IMPLEMENTED' : 'FAILED',
			surface: ['ExecuteContext', 'WorkflowDataProxy', 'expression resolution', 'helpers'],
		},
		'POOL-003-error-retry-handling': {
			status: results.find((entry) => entry.id === 'E07')?.status === 'PASS' ? 'IMPLEMENTED' : 'FAILED',
			surface: ['resolveRetryPolicy', 'resolveErrorStrategy', 'splitErrorOutputs', 'error classes'],
		},
	},
};

writeFileSync(EVIDENCE, `${JSON.stringify(report, null, '\t')}\n`);

const lines = [
	'# Execution LEGO — verification (Phase 3 reconstruction)',
	'',
	`Generated: ${report.generatedAt}  ·  Package: \`packages/execution-engine\`  ·  Language: JavaScript (Node.js ESM)`,
	'',
	`**Gates: ${totals.passed}/${totals.gates} PASS** · **RUST: ${report.rustImplementation}** · **Reference: n8n ${report.reference.pinnedVersion} (read-only)**`,
	'',
	'| Gate | Requirement | Result | Detail |',
	'| :--- | :--- | :--- | :--- |',
	...results.map(
		(entry) =>
			`| ${entry.id} | ${entry.title} | ${entry.status === 'PASS' ? '✅ PASS' : '❌ FAIL'} | ${entry.detail.replace(/\n/g, ' ').slice(0, 300)} |`,
	),
	'',
	`Machine-readable evidence: \`docs/isolation/evidence/execution-engine-gate.json\``,
	'',
];

writeFileSync(REPORT_MD, lines.join('\n'));

if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
console.log(`\nExecution LEGO gate: ${totals.passed}/${totals.gates} PASS → ${relative(REPO, EVIDENCE)}`);
process.exit(totals.failed === 0 ? 0 : 1);
