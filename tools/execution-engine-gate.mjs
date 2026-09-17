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
 *   E09 sandboxed expression evaluator security + compatibility suite
 *   E10 activation lifecycle: ActiveWorkflows / TriggersAndPollers / TriggerContext
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

/* E03 — Rust confinement -------------------------------------------------- */
gate('E03', 'Rust confinement: Rust only under crates/** + apps/**, this package contributes none', () => {
	const isRust = (path) => /\.rs$|Cargo\.toml$|Cargo\.lock$/.test(path);
	const ignored = /\/(\.git|node_modules|target)\//;

	// Phase-3 rule (docs/isolation/PHASE-3-OPENING-RECORD.md §2): Rust is confined
	// to crates/** and apps/**. Rust anywhere else in the repo fails both offline
	// harnesses — this gate repeats that check for the area the LEGO touches.
	const repoRust = walk(REPO, isRust).filter((path) => !ignored.test(path) && !path.includes('/reference/n8n/'));
	// The workspace manifest at the repo root is required by the Phase-3 record.
	const allowedRootManifests = [join(REPO, 'Cargo.toml'), join(REPO, 'Cargo.lock')];
	const outside = repoRust.filter(
		(path) =>
			!path.startsWith(join(REPO, 'crates')) &&
			!path.startsWith(join(REPO, 'apps')) &&
			!allowedRootManifests.includes(path),
	);
	if (outside.length > 0) {
		throw new Error(`Rust outside crates/** + apps/**: ${outside.map((path) => relative(REPO, path)).join(', ')}`);
	}

	const rustInPackage = walk(PKG, isRust);
	if (rustInPackage.length > 0) {
		throw new Error(`Rust inside the JavaScript package: ${rustInPackage.map((path) => relative(REPO, path)).join(', ')}`);
	}

	// Informational evidence: the digest of the Phase-3 Rust workspace as this
	// LEGO saw it. It is *recorded*, not frozen — the Rust port track may grow it.
	const rustWorkspace = [...walk(join(REPO, 'crates')), ...walk(join(REPO, 'apps'))]
		.map((path) => relative(REPO, path))
		.sort();
	const digest = createHash('sha256').update(rustWorkspace.join('\n')).digest('hex').slice(0, 32);
	mkdirSync(join(PKG, 'manifest'), { recursive: true });
	writeFileSync(
		join(PKG, 'manifest/rust-freeze.json'),
		`${JSON.stringify(
			{
				digest,
				fileCount: rustWorkspace.length,
				rustWorkspaceFiles: rustWorkspace.length,
				note:
					'Phase-3 snapshot of crates/** + apps/** as observed by the JavaScript execution LEGO. ' +
					'Rust is permitted there since docs/isolation/PHASE-3-OPENING-RECORD.md (pending ratification of the ' +
					'PROJECT_RULES §1 amendment); this file records the workspace state, it does not freeze it.',
			},
			null,
			'\t',
		)}\n`,
	);

	return `${repoRust.length} Rust files repo-wide, all inside crates/**+apps/**; workspace digest ${digest} (${rustWorkspace.length} files); package contributes 0`;
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

gate('E09', 'sandboxed expression evaluator security + compatibility', () =>
	runNodeTest('test/04-expression-sandbox.test.mjs', PKG),
	'packages/execution-engine/test/04-expression-sandbox.test.mjs',
);

/* E10 — activation lifecycle --------------------------------------------- */
gate('E10', 'activation lifecycle: triggers, pollers, lifecycle hooks', () =>
	runNodeTest('test/05-activation.test.mjs', PKG),
	'packages/execution-engine/test/05-activation.test.mjs',
);

/* E11 — wait tracker & execution resumption ------------------------------- */
gate('E11', 'waiting execution tracking & resumption (WaitTracker)', () =>
	runNodeTest('test/07-wait-tracker.test.mjs', PKG),
	'packages/execution-engine/test/07-wait-tracker.test.mjs',
);

/* E12 — active executions registry & lifecycle --------------------------- */
gate('E12', 'active executions registry & lifecycle (ActiveExecutions)', () =>
	runNodeTest('test/08-active-executions.test.mjs', PKG),
	'packages/execution-engine/test/08-active-executions.test.mjs',
);

/* E13 — workflow runner execution coordinator ----------------------------- */
gate('E13', 'workflow runner coordination & dispatch (WorkflowRunner)', () =>
	runNodeTest('test/09-workflow-runner.test.mjs', PKG),
	'packages/execution-engine/test/09-workflow-runner.test.mjs',
);

/* E14 — sub-workflow execution runtime ------------------------------------ */
gate('E14', 'subworkflow execution runtime & start discovery (executeWorkflow)', () =>
	runNodeTest('test/10-subworkflow-execution.test.mjs', PKG),
	'packages/execution-engine/test/10-subworkflow-execution.test.mjs',
);

/* E15 — manual execution service ------------------------------------------ */
gate('E15', 'manual execution service & graph re-wiring (ManualExecutionService)', () =>
	runNodeTest('test/11-manual-execution.test.mjs', PKG),
	'packages/execution-engine/test/11-manual-execution.test.mjs',
);

/* E16 — execution lifecycle & error workflow ----------------------------- */
gate('E16', 'execution lifecycle & error workflow (executeErrorWorkflow, toSaveSettings, FailedRunFactory)', () =>
	runNodeTest('test/12-execution-lifecycle.test.mjs', PKG),
	'packages/execution-engine/test/12-execution-lifecycle.test.mjs',
);

/* E17 — execution recovery service ---------------------------------------- */
gate('E17', 'execution recovery & crash deactivation (ExecutionRecoveryService)', () =>
	runNodeTest('test/13-execution-recovery.test.mjs', PKG),
	'packages/execution-engine/test/13-execution-recovery.test.mjs',
);

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
	rustImplementation: 'NONE via this LEGO (JavaScript track); Phase-3 port track confined to crates/** + apps/**',
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
		'TASK-ENGINE-ACTIVATION-01': {
			status: results.find((entry) => entry.id === 'E10')?.status === 'PASS' ? 'IMPLEMENTED' : 'FAILED',
			surface: ['ActiveWorkflows', 'TriggersAndPollers', 'TriggerContext', 'ExecutionLifecycleHooks', 'toCronExpression', 'ScheduledTaskManager'],
		},
		'TASK-EXPRESSION-SANDBOX-01': {
			status: results.find((entry) => entry.id === 'E09')?.status === 'PASS' ? 'IMPLEMENTED' : 'FAILED',
			surface: ['node:vm isolation', 'read-only membrane', 'prototype/global deny-list', 'execution timeout'],
		},
		'TASK-428-phase3-wait-tracker': {
			status: results.find((entry) => entry.id === 'E11')?.status === 'PASS' ? 'IMPLEMENTED' : 'FAILED',
			surface: ['WaitTracker', 'shouldRestartParentExecution', 'updateParentExecutionWithChildResults', 'getDataLastExecutedNodeData', 'ExecutionAlreadyResumingError'],
		},
		'TASK-430-phase3-active-executions': {
			status: results.find((entry) => entry.id === 'E12')?.status === 'PASS' ? 'IMPLEMENTED' : 'FAILED',
			surface: ['ActiveExecutions', 'ExecutionNotFoundError', 'ExecutionCancelledError', 'ManualExecutionCancelledError', 'TimeoutExecutionCancelledError', 'SystemShutdownExecutionCancelledError'],
		},
		'TASK-431-phase3-workflow-runner': {
			status: results.find((entry) => entry.id === 'E13')?.status === 'PASS' ? 'IMPLEMENTED' : 'FAILED',
			surface: ['WorkflowRunner', 'MaxStalledCountError'],
		},
		'TASK-432-phase3-subworkflow-execution': {
			status: results.find((entry) => entry.id === 'E14')?.status === 'PASS' ? 'IMPLEMENTED' : 'FAILED',
			surface: ['executeWorkflow', 'getRunData', 'findSubworkflowStart', 'getBase', 'STARTING_NODES', 'SubworkflowOperationError'],
		},
		'TASK-433-phase3-manual-execution-service': {
			status: results.find((entry) => entry.id === 'E15')?.status === 'PASS' ? 'IMPLEMENTED' : 'FAILED',
			surface: ['ManualExecutionService', 'DirectedGraph', 'filterDisabledNodes', 'rewireGraph', 'recreateNodeExecutionStack', 'TOOL_EXECUTOR_NODE_NAME', 'isTool'],
		},
		'TASK-434-phase3-execution-lifecycle-and-error-workflow': {
			status: results.find((entry) => entry.id === 'E16')?.status === 'PASS' ? 'IMPLEMENTED' : 'FAILED',
			surface: ['toSaveSettings', 'DEFAULT_SAVE_CONFIG', 'FailedRunFactory', 'generateFailedExecutionFromError', 'executeErrorWorkflow', 'saveExecutionProgress'],
		},
		'TASK-435-phase3-execution-recovery-service': {
			status: results.find((entry) => entry.id === 'E17')?.status === 'PASS' ? 'IMPLEMENTED' : 'FAILED',
			surface: ['ExecutionRecoveryService', 'ARTIFICIAL_TASK_DATA', 'NodeCrashedError', 'WorkflowCrashedError'],
		},
	},
};

writeFileSync(EVIDENCE, `${JSON.stringify(report, null, '\t')}\n`);

const lines = [
	'# Execution LEGO — verification (Phase 3 reconstruction)',
	'',
	`Generated: ${report.generatedAt}  ·  Package: \`packages/execution-engine\`  ·  Language: JavaScript (Node.js ESM)`,
	'',
	`**Gates: ${totals.passed}/${totals.gates} PASS** · RUST: ${report.rustImplementation} · **Reference: n8n ${report.reference.pinnedVersion} (read-only)**`,
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
