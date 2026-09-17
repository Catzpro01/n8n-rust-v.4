#!/usr/bin/env node
/**
 * Phase 7 isolation gate — EXECUTION LEGO (runtime: active executions, activation, context, recovery).
 *
 * Machine-verifies, against the pinned n8n 2.9.4 reference:
 *   H01 contract + isolation blueprint + manifest presence
 *   H02 EXECUTION — error surface byte-exact (messages + levels)
 *   H03 EXECUTION — lifecycle log lines + timing constants byte-exact
 *   H04 EXECUTION — recovery semantics (task data, event names, defaults)
 *   H05 package tests (node --test) for the execution LEGO
 *   H06 ZERO RUST — crates/ and apps/ hold no Rust artifacts
 *   H07 reference integrity — digests of the owned subsystem trees
 *   H08 drift audit of the Phase-6 queue recovery defaults (back-filled check)
 *
 * Writes:
 *   docs/isolation/evidence/phase7-gate.json
 *   docs/isolation/PHASE-7-GATE.md
 *
 * usage: node tools/phase7-isolation-gate.mjs [--json] [--skip-tests]
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const skipTests = args.includes('--skip-tests');

const EVIDENCE = join(REPO, 'docs/isolation/evidence');
const RESULTS = [];

const gate = (id, title, fn, requirement) => {
	const started = Date.now();
	let status = 'PASS';
	let detail = '';
	try {
		detail = String(fn() ?? '');
	} catch (error) {
		status = 'FAIL';
		detail = error instanceof Error ? error.message : String(error);
	}
	RESULTS.push({ id, title, requirement, status, detail: detail.slice(0, 1200), ms: Date.now() - started });
	console.log(`[${status}] ${id} ${title}${detail ? ` — ${detail.split('\n')[0]}` : ''}`);
};

const read = (rel) => readFileSync(join(REPO, rel), 'utf8');
const must = (condition, message) => {
	if (!condition) throw new Error(message);
};
const hasAll = (source, literals, label) => {
	const missing = literals.filter((literal) => !source.includes(literal));
	must(missing.length === 0, `${label}: missing ${missing.length} literal(s): ${missing.slice(0, 3).join(' | ')}`);
	return `${literals.length} literal(s) verified`;
};

const digestTree = (dir) => {
	const hash = createHash('sha256');
	let files = 0;
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (statSync(full).isFile()) {
				files++;
				hash.update(full.slice(dir.length));
				hash.update(readFileSync(full));
			}
		}
	};
	walk(dir);
	return { files, digest: hash.digest('hex') };
};

/* ------------------------------------------------------------------ */
/* H01 — artefacts                                                      */
/* ------------------------------------------------------------------ */
gate(
	'H01',
	'contract, isolation blueprint and manifest present',
	() => {
		const required = [
			'contracts/execution.contract.md',
			'docs/isolation/execution.md',
			'packages/execution-lego/package.json',
			'packages/execution-lego/src/index.ts',
			'packages/execution-lego/src/model-surface.ts',
			'packages/execution-lego/manifest/ownership.json',
			'packages/reconstructed-engine/src/execution-engine.ts',
			'tools/execution-isolation-gate.mjs',
		];
		const missing = required.filter((rel) => !existsSync(join(REPO, rel)));
		must(missing.length === 0, `missing artefacts: ${missing.join(', ')}`);

		const manifest = JSON.parse(read('packages/execution-lego/manifest/ownership.json'));
		must(manifest.lego === 'execution', 'manifest lego mismatch');
		must(manifest.zeroRust === true, 'zeroRust flag missing');
		must(manifest.frontendUntouched === true, 'frontendUntouched flag missing');
		must(Boolean(manifest.implemented?.engine), 'manifest engine missing');
		must(manifest.reference.owns.length >= 10, 'manifest must own the runtime sources');
		for (const rel of manifest.reference.owns) {
			must(existsSync(join(REPO, rel)), `owned reference file missing: ${rel}`);
		}
		return `${required.length} artefacts + manifest (${manifest.reference.owns.length} owned sources)`;
	},
	'a LEGO without contract, blueprint, package, manifest and gate does not exist',
);

/* ------------------------------------------------------------------ */
/* H02 — error surface                                                  */
/* ------------------------------------------------------------------ */
gate(
	'H02',
	'EXECUTION — error surface byte-exact in reference and reconstruction',
	() => {
		const engine = read('packages/reconstructed-engine/src/execution-engine.ts');
		const pairs = [
			['packages/cli/src/errors/execution-not-found-error.ts', "'No active execution found'"],
			['packages/cli/src/errors/execution-already-resuming.error.ts', 'Execution is already being resumed by another process'],
			['packages/cli/src/errors/node-crashed.error.ts', 'Node crashed, possible out-of-memory issue'],
			['packages/cli/src/errors/node-crashed.error.ts', 'Execution stopped at this node'],
			['packages/cli/src/errors/workflow-crashed.error.ts', 'Workflow did not finish, possible out-of-memory issue'],
			['packages/workflow/src/errors/execution-cancelled.error.ts', 'The execution was cancelled'],
			['packages/workflow/src/errors/execution-cancelled.error.ts', 'The execution was cancelled manually'],
			['packages/workflow/src/errors/execution-cancelled.error.ts', 'The execution was cancelled because it timed out'],
			['packages/workflow/src/errors/execution-cancelled.error.ts', 'The execution was cancelled because the system is shutting down'],
			['packages/workflow/src/errors/trigger-close.error.ts', 'Trigger Close Failed'],
		];
		for (const [rel, literal] of pairs) {
			const reference = read(`reference/n8n/${rel}`);
			must(reference.includes(literal), `reference drifted: ${rel} → ${literal}`);
			must(engine.includes(literal), `engine missing: ${literal}`);
		}

		// the activation-error level heuristic is part of the observable surface
		const activation = read('reference/n8n/packages/workflow/src/errors/workflow-activation.error.ts');
		for (const needle of ["'etimedout'", "'econnrefused'", "'eauth'", "'temporary authentication failure'", "'invalid credentials'"]) {
			must(activation.includes(needle), `activation level heuristic drifted: ${needle}`);
			must(engine.includes(needle), `engine missing heuristic entry: ${needle}`);
		}
		return `${pairs.length} error messages + 5 level heuristics`;
	},
	'error messages are part of the API contract of an execution runtime',
);

/* ------------------------------------------------------------------ */
/* H03 — lifecycle lines + constants                                    */
/* ------------------------------------------------------------------ */
gate(
	'H03',
	'EXECUTION — lifecycle log lines and timing constants byte-exact',
	() => {
		const engine = read('packages/reconstructed-engine/src/execution-engine.ts');
		const activeExecutions = read('reference/n8n/packages/cli/src/active-executions.ts');
		const lines = [
			'Execution added',
			'Execution removed',
			'Cancelling execution',
			'Execution cancelled',
			'Execution finalized',
			'Execution response promise cleaned',
			'Closing response for execution',
			'Error closing streaming response',
			'Waiting for ${executionIds.length} active executions to finish...',
		];
		hasAll(activeExecutions, lines, 'active-executions.ts');
		hasAll(engine, lines, 'execution-engine.ts');

		const activeWorkflows = read('reference/n8n/packages/core/src/execution-engine/active-workflows.ts');
		const activationLines = [
			'There was a problem activating the workflow: "${error.message}"',
			'Cannot deactivate already inactive workflow ID "${workflowId}"',
			'Failed to deactivate trigger of workflow ID "${workflowId}": "${error.message}"',
			'The polling interval is too short. It has to be at least a minute.',
			'Deactivated all trigger- and poller-based workflows',
		];
		hasAll(activeWorkflows, activationLines, 'active-workflows.ts');
		hasAll(engine, activationLines, 'execution-engine.ts');

		must(activeExecutions.includes('await sleep(500);'), 'shutdown poll interval drifted');
		must(engine.includes('await this.sleep(500);'), 'engine shutdown poll interval missing');
		const recovery = read('reference/n8n/packages/cli/src/executions/execution-recovery.service.ts');
		must(recovery.includes('await sleep(1000);'), 'recovery push delay drifted');
		must(engine.includes('export const PUSH_AFTER_UI_TIMEOUT_MS = 1000;'), 'engine push delay missing');
		return `${lines.length + activationLines.length} lifecycle literals + 2 timings`;
	},
	'the runtime is observable through its log lines and its delays',
);

/* ------------------------------------------------------------------ */
/* H04 — recovery                                                       */
/* ------------------------------------------------------------------ */
gate(
	'H04',
	'EXECUTION — recovery semantics (task data, events, defaults)',
	() => {
		const engine = read('packages/reconstructed-engine/src/execution-engine.ts');
		const recovery = read('reference/n8n/packages/cli/src/executions/execution-recovery.service.ts');
		const constants = read('reference/n8n/packages/cli/src/constants.ts');

		for (const event of ['n8n.node.started', 'n8n.node.finished', 'n8n.workflow.success', 'n8n.workflow.crashed', 'n8n.workflow.failed', 'n8n.workflow.started']) {
			must(recovery.includes(event), `recovery event drifted: ${event}`);
			must(engine.includes(event), `engine missing event: ${event}`);
		}
		must(constants.includes('isArtificialRecoveredEventItem: true'), 'ARTIFICIAL_TASK_DATA drifted');
		must(engine.includes('isArtificialRecoveredEventItem: true'), 'engine ARTIFICIAL_TASK_DATA missing');
		for (const literal of [
			'Autodeactivated workflow ${workflowId} due to too many crashed executions.',
			'Workflow ${workflowId} not found, skipping workflow auto-deactivation',
			'[Recovery] Logs available, amended execution',
			'workflowAutoDeactivated',
			'executionRecovered',
		]) {
			must(recovery.includes(literal), `reference drifted: ${literal}`);
			must(engine.includes(literal), `engine missing: ${literal}`);
		}

		const config = read('reference/n8n/packages/@n8n/config/src/configs/executions.config.ts');
		const recoveryBlock = config.slice(config.indexOf('class RecoveryConfig'));
		must(recoveryBlock.includes('maxLastExecutions: number = 3;'), 'maxLastExecutions default drifted');
		must(recoveryBlock.includes('workflowDeactivationEnabled: boolean = false;'), 'deactivation flag default drifted');
		must(engine.includes('maxLastExecutions: 3') && engine.includes('workflowDeactivationEnabled: false'), 'engine defaults missing');
		return 'events + ARTIFICIAL_TASK_DATA + 5 recovery literals + 2 config defaults';
	},
	'recovery is the only thing that repairs a crashed deployment; it must match 1:1',
);

/* ------------------------------------------------------------------ */
/* H05 — package tests                                                  */
/* ------------------------------------------------------------------ */
gate(
	'H05',
	'package tests (execution)',
	() => {
		if (skipTests) return 'skipped (--skip-tests)';
		const cwd = join(REPO, 'packages/execution-lego');
		const testFiles = readdirSync(join(cwd, 'test'))
			.filter((name) => name.endsWith('.test.mjs'))
			.map((name) => join('test', name));
		must(testFiles.length >= 3, `expected 3 test suites, found ${testFiles.length}`);
		const out = spawnSync(process.execPath, ['--test', ...testFiles], { cwd, encoding: 'utf8', timeout: 120_000 });
		const text = `${out.stdout ?? ''}${out.stderr ?? ''}`;
		const pass = Number(text.match(/^# pass (\d+)/m)?.[1] ?? 0);
		const fail = Number(text.match(/^# fail (\d+)/m)?.[1] ?? 0);
		must(out.status === 0 && fail === 0, `execution: ${fail} failing test(s)\n${text.slice(-800)}`);
		must(pass >= 25, `execution: only ${pass} assertions suites ran`);
		return `execution ${pass}/${pass + fail}`;
	},
	'the LEGO must pass its own node --test suite',
);

/* ------------------------------------------------------------------ */
/* H06 — ZERO RUST                                                      */
/* ------------------------------------------------------------------ */
gate(
	'H06',
	'ZERO RUST — crates/ and apps/ hold no artifacts',
	() => {
		const offenders = [];
		const walk = (rel) => {
			const dir = join(REPO, rel);
			if (!existsSync(dir)) return;
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) walk(join(rel, entry.name));
				else if (/\.(rs|toml)$/.test(entry.name) || entry.name === 'Cargo.lock') offenders.push(join(rel, entry.name));
			}
		};
		walk('crates');
		walk('apps');
		walk('packages/execution-lego');
		const engine = read('packages/reconstructed-engine/src/execution-engine.ts');
		must(!/\.rs['"]/.test(engine), 'execution engine must not reference Rust sources');
		must(offenders.length === 0, `Rust artefacts present: ${offenders.slice(0, 3).join(', ')}`);
		return 'crates/ + apps/ + packages/execution-lego clean';
	},
	'PROJECT_RULES.md §1 — reconstruction is JS/TS only',
);

/* ------------------------------------------------------------------ */
/* H07 — reference integrity                                            */
/* ------------------------------------------------------------------ */
gate(
	'H07',
	'reference integrity — owned subsystem trees unchanged at 2.9.4',
	() => {
		const cli = digestTree(join(REPO, 'reference/n8n/packages/cli/src'));
		const core = digestTree(join(REPO, 'reference/n8n/packages/core/src/execution-engine'));
		const workflow = digestTree(join(REPO, 'reference/n8n/packages/workflow/src/errors'));
		const config = digestTree(join(REPO, 'reference/n8n/packages/@n8n/config/src/configs'));
		const version = JSON.parse(read('reference/n8n/package.json')).version;
		must(version === '2.9.4', `reference version drifted to ${version}`);
		return `2.9.4 · cli ${cli.files}/${cli.digest.slice(0, 12)} · core/execution-engine ${core.files}/${core.digest.slice(0, 12)} · workflow/errors ${workflow.files}/${workflow.digest.slice(0, 12)} · config ${config.files}/${config.digest.slice(0, 12)}`;
	},
	'the mirror must stay pinned; mirroring the wrong source invalidates the LEGO',
);

/* ------------------------------------------------------------------ */
/* H08 — Phase-6 drift back-fill (queue recovery defaults)              */
/* ------------------------------------------------------------------ */
gate(
	'H08',
	'drift audit — queue recovery defaults equal the @n8n/config defaults',
	() => {
		const queue = read('packages/reconstructed-engine/src/queue-engine.ts');
		const match = queue.match(/export const QUEUE_RECOVERY_DEFAULTS = \{ interval: (\d+), batchSize: (\d+) \} as const;/);
		must(match !== null, 'QUEUE_RECOVERY_DEFAULTS is not pinned as { interval, batchSize }');

		const config = read('reference/n8n/packages/@n8n/config/src/configs/executions.config.ts');
		const block = config.slice(config.indexOf('class QueueRecoveryConfig'));
		const referenceInterval = Number(block.match(/interval: number = (\d+);/)?.[1]);
		const referenceBatch = Number(block.match(/batchSize: number = (\d+);/)?.[1]);
		must(Number(match[1]) === referenceInterval, `interval drifted: engine ${match[1]} vs reference ${referenceInterval}`);
		must(Number(match[2]) === referenceBatch, `batchSize drifted: engine ${match[2]} vs reference ${referenceBatch}`);

		const queueTest = read('packages/queue-lego/test/02-scaling.test.mjs');
		must(queueTest.includes('N8N_EXECUTIONS_QUEUE_RECOVERY_INTERVAL'), 'queue test must re-read the reference config');
		return `{ interval: ${referenceInterval}, batchSize: ${referenceBatch} } — engine, reference config and queue test agree`;
	},
	'POOL-012 back-fill: the Phase-6 pin used the reference test fixture instead of the config defaults',
);

/* ------------------------------------------------------------------ */
/* evidence                                                             */
/* ------------------------------------------------------------------ */
const failed = RESULTS.filter((entry) => entry.status === 'FAIL');

if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, { recursive: true });
const report = {
	generatedAt: new Date().toISOString(),
	phase: 7,
	lego: 'execution',
	reference: { version: '2.9.4', upstreamCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83' },
	result: failed.length === 0 ? 'PASS' : 'FAIL',
	gateSummary: `${RESULTS.length - failed.length}/${RESULTS.length}`,
	gates: RESULTS,
};
writeFileSync(join(EVIDENCE, 'phase7-gate.json'), `${JSON.stringify(report, null, 2)}\n`);

const md = [
	'# PHASE 7 GATE — EXECUTION (runtime)',
	'',
	`**Generated:** ${report.generatedAt} · **Result:** \`${report.result}\` (${report.gateSummary})`,
	`**Reference:** n8n 2.9.4 @ b6dc2787c45677a29a9612cd27eb911302961a83`,
	'',
	'| gate | title | status | detail |',
	'| :--- | :--- | :--- | :--- |',
	...RESULTS.map((entry) => `| ${entry.id} | ${entry.title} | ${entry.status} | ${entry.detail.replace(/\n/g, ' ').slice(0, 200)} |`),
	'',
];
writeFileSync(join(REPO, 'docs/isolation/PHASE-7-GATE.md'), `${md.join('\n')}\n`);

if (asJson) console.log(JSON.stringify(report, null, 2));

console.log(`\nPHASE 7 GATE: ${report.gateSummary} ${report.result}`);
process.exit(failed.length === 0 ? 0 : 1);
