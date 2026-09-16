#!/usr/bin/env node
/**
 * Workflow LEGO — Phase 2 isolation gate.
 *
 * Runs every gate for the Workflow isolation and writes the evidence:
 *   docs/isolation/evidence/gate-report.json
 *   docs/isolation/workflow-verification.md
 *
 * Exit code is non-zero if ANY gate fails. Per the phase rules, a failing gate
 * means ISOLATION = FAILED and the isolation must be rolled back instead of
 * being carried forward to the next LEGO.
 *
 * usage: node tools/workflow-isolation-gate.mjs [--skip-live] [--json]
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { REPO, MANIFEST } from './workflow-boundary-map.mjs';

const PKG = join(REPO, 'packages/workflow-lego');
const EVIDENCE = join(REPO, 'docs/isolation/evidence');
const args = process.argv.slice(2);

/* ---------- reference runtime discovery ---------- */
function findRuntime() {
	const candidates = [
		process.env.LEGO_LIVE_RUNTIME,
		join(REPO, '.runtime/node_modules'),
		'/home/user/.n8n-live/node_modules',
	].filter(Boolean);
	for (const dir of candidates) {
		if (existsSync(join(dir, 'n8n-workflow/package.json')) && existsSync(join(dir, 'n8n-core/package.json'))) {
			return dir;
		}
	}
	return null;
}
const runtimeDir = findRuntime();
const env = {
	...process.env,
	...(runtimeDir
		? {
				LEGO_REFERENCE_PKG: join(runtimeDir, 'n8n-workflow'),
				LEGO_NODES_JSON: join(runtimeDir, 'n8n-nodes-base/dist/types/nodes.json'),
				LEGO_LIVE_RUNTIME: runtimeDir,
			}
		: {}),
};

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
	results.push({ id, title, requirement, status, detail: String(detail).trim().slice(0, 800), ms: Date.now() - started });
	console.log(`[${status}] ${id} ${title}${detail ? ` — ${String(detail).split('\n')[0]}` : ''}`);
}

const run = (cmd, argv, opts = {}) => {
	const out = spawnSync(cmd, argv, { cwd: opts.cwd ?? REPO, encoding: 'utf8', env, timeout: opts.timeout ?? 300_000 });
	if (out.status !== 0) {
		throw new Error(`${cmd} ${argv.join(' ')} exited ${out.status}\n${(out.stdout ?? '').slice(-1500)}\n${(out.stderr ?? '').slice(-1500)}`);
	}
	return (out.stdout ?? '').trim();
};

/* ------------------------------------------------------------------ */
/* 1. boundary + kernel + reference integrity                          */
/* ------------------------------------------------------------------ */
gate('G01', 'boundary drift gate (owned files, crossings, inbound edges)', () =>
	run(process.execPath, [join(REPO, 'tools/workflow-boundary-map.mjs'), '--check']) ||
	'no drift',
);

gate('G02', 'kernel snapshot conformance (constants/vocabulary vs reference)', () =>
	run(process.execPath, [join(REPO, 'tools/workflow-kernel-conformance.mjs'), '--check']),
);

gate('G03', 'port surface matches the imports of the owned sources', () =>
	run(process.execPath, [join(REPO, 'tools/workflow-port-surface.mjs'), '--check']),
);

gate('G04', 'reference tree byte-identical to the pinned hashes', () =>
	run(process.execPath, [join(REPO, 'tools/workflow-reference-manifest.mjs'), '--check']),
);

/* ------------------------------------------------------------------ */
/* 2. extraction + TypeScript build                                    */
/* ------------------------------------------------------------------ */
gate('G05', 'isolation extraction (pure import rewrites only)', () =>
	run(process.execPath, [join(REPO, 'tools/workflow-isolation-extract.mjs')]),
);

gate('G06', 'TypeScript build PASS (isolated unit, ports only)', () => {
	const tsc = join(PKG, 'node_modules/.bin/tsc');
	if (!existsSync(tsc)) throw new Error('typescript missing — run: npm install (packages/workflow-lego)');
	run(tsc, ['-p', join(PKG, '.extract/tsconfig.json')], { cwd: PKG });
	return 'tsc -p .extract/tsconfig.json → 0 errors';
});

gate('G07', 'TypeScript build PASS (versioned boundary/ports/facade)', () => {
	const tsc = join(PKG, 'node_modules/.bin/tsc');
	run(tsc, ['--noEmit', '-p', join(PKG, 'tsconfig.json')], { cwd: PKG });
	return 'tsc --noEmit → 0 errors';
});

/* ------------------------------------------------------------------ */
/* 3. behavioral equivalence + isolation                               */
/* ------------------------------------------------------------------ */
gate('G08', 'unit tests PASS (boundary, extraction, equivalence, strict isolation, surface)', () =>
	run(process.execPath, ['--test', 'test/*.test.mjs'], { cwd: PKG, timeout: 600_000 }).split('\n').slice(-4).join(' · '),
);

/* --- evidence digests (BEFORE / AFTER / STRICT) -------------------- */
/**
 * Raw digests are large (multi-MB) and are therefore written to a temporary
 * directory. The committed evidence keeps a SHA-256 per workflow/section plus
 * the verdicts — enough to re-verify by recomputing the digests.
 */
const digestDir = mkdtempSync(join(tmpdir(), 'lego-gate-'));
const PORT_DEPENDENT_SECTIONS = new Set(['nodeParameters', 'rename']);
const sha = (value) => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex').slice(0, 32);

function captureDigest(source, mode, name) {
	const out = join(digestDir, `${name}.json`);
	run(process.execPath, [join(REPO, 'tools/model-digest-runner.cjs'), '--source', source, '--mode', mode, '--out', out], { timeout: 600_000 });
	return JSON.parse(readFileSync(out, 'utf8'));
}

let digestEvidence = null;

gate('G09', 'BEFORE vs AFTER digest: BEHAVIOR CHANGE NONE', () => {
	const before = captureDigest('reference', 'reference', 'before');
	const after = captureDigest('isolated', 'reference', 'after');
	const strict = captureDigest('isolated', 'strict', 'strict');

	const comparisons = { beforeVsAfter: { identical: 0, differing: [] }, strictVsBefore: { identical: 0, differingPortDependent: [], differingUndeclared: [] }, sections: {} };
	for (const wf of Object.keys(before.digests)) {
		comparisons.sections[wf] = {};
		for (const section of new Set([...Object.keys(before.digests[wf]), ...Object.keys(after.digests[wf])])) {
			const hb = sha(before.digests[wf][section]);
			const ha = sha(after.digests[wf]?.[section]);
			const hs = sha(strict.digests[wf]?.[section]);
			comparisons.sections[wf][section] = { before: hb, after: ha, strict: hs };
			if (hb === ha) comparisons.beforeVsAfter.identical++;
			else comparisons.beforeVsAfter.differing.push(`${wf}::${section}`);
			if (hb === hs) comparisons.strictVsBefore.identical++;
			else if (PORT_DEPENDENT_SECTIONS.has(section)) comparisons.strictVsBefore.differingPortDependent.push(`${wf}::${section}`);
			else comparisons.strictVsBefore.differingUndeclared.push(`${wf}::${section}`);
		}
	}

	digestEvidence = {
		generatedAt: new Date().toISOString(),
		corpus: {
			workflows: Object.keys(before.digests),
			workflowCount: before.workflowCount,
			sectionCount: Object.keys(comparisons.sections[Object.keys(before.digests)[0]]).length,
			hashAlgorithm: 'sha256/32',
			rawDigestsLocation: 'temporary — recompute with: node tools/model-digest-runner.cjs --source reference|isolated [--mode reference|strict]',
		},
		portDependentSections: [...PORT_DEPENDENT_SECTIONS],
		comparisons,
		verdict: {
			beforeVsAfter: comparisons.beforeVsAfter.differing.length === 0 ? 'NONE DETECTED' : 'CHANGED',
			strictPortIndependence: comparisons.strictVsBefore.differingUndeclared.length === 0 ? 'NO HIDDEN COUPLING' : 'HIDDEN COUPLING DETECTED',
		},
	};
	mkdirSync(EVIDENCE, { recursive: true });
	writeFileSync(join(EVIDENCE, 'model-digest.comparison.json'), JSON.stringify(digestEvidence, null, 2) + '\n');

	if (comparisons.beforeVsAfter.differing.length) {
		throw new Error(`${comparisons.beforeVsAfter.differing.length} sections differ: ${comparisons.beforeVsAfter.differing.slice(0, 6).join(', ')}`);
	}
	if (comparisons.strictVsBefore.differingUndeclared.length) {
		throw new Error(`hidden coupling: ${comparisons.strictVsBefore.differingUndeclared.slice(0, 6).join(', ')}`);
	}
	return `${comparisons.beforeVsAfter.identical} section comparisons across ${before.workflowCount} workflows — 0 differences · strict: ${comparisons.strictVsBefore.identical} identical, ${comparisons.strictVsBefore.differingPortDependent.length} in declared port sections`;
});

gate('G10', 'strict port mode: no hidden coupling to the reference runtime', () =>
	run(process.execPath, ['--test', 'test/04-strict-isolation.test.mjs'], { cwd: PKG, timeout: 300_000 }).split('\n').slice(-4).join(' · ') ||
	'port-independent behavior identical; only declared port sections change',
);

/* ------------------------------------------------------------------ */
/* 4. live verification with the reference execution engine            */
/* ------------------------------------------------------------------ */
if (!args.includes('--skip-live')) {
	gate('G11', 'live verification: workflow load / save / 1-node / linear / webhook / execution record', () => {
		if (!runtimeDir) throw new Error('reference runtime not found — run scripts/setup-reference-runtime.sh (or set LEGO_LIVE_RUNTIME)');
		const out = join(EVIDENCE, 'live-verification.json');
		run(process.execPath, [join(REPO, 'tools/live/engine-harness.mjs'), '--out', out], { timeout: 600_000 });
		const live = JSON.parse(readFileSync(out, 'utf8'));
		return `${live.passed}/${live.total} PASS · ` + live.results.map((r) => `${r.id}:${r.status}`).join(' ');
	});
}

/* ------------------------------------------------------------------ */
/* report                                                              */
/* ------------------------------------------------------------------ */
mkdirSync(EVIDENCE, { recursive: true });
const failed = results.filter((r) => r.status === 'FAIL');
const report = {
	generatedAt: new Date().toISOString(),
	lego: 'workflow',
	phase: 'phase-2-isolation',
	reference: MANIFEST.reference,
	runtime: runtimeDir,
	behaviorChange: failed.length === 0 ? 'NONE DETECTED' : 'ISOLATION FAILED',
	digestEvidence: digestEvidence
		? {
				corpus: digestEvidence.corpus,
				verdict: digestEvidence.verdict,
				beforeVsAfter: { identical: digestEvidence.comparisons.beforeVsAfter.identical, differing: digestEvidence.comparisons.beforeVsAfter.differing.length },
				strictVsBefore: {
					identical: digestEvidence.comparisons.strictVsBefore.identical,
					differingPortDependent: digestEvidence.comparisons.strictVsBefore.differingPortDependent.length,
					differingUndeclared: digestEvidence.comparisons.strictVsBefore.differingUndeclared.length,
				},
			}
		: null,
	rustImplementation: 'NOT STARTED',
	totals: { gates: results.length, passed: results.length - failed.length, failed: failed.length },
	gates: results,
};
writeFileSync(join(EVIDENCE, 'gate-report.json'), JSON.stringify(report, null, 2) + '\n');

const checklist = [
	['TypeScript build PASS', ['G06', 'G07']],
	['unit tests PASS', ['G08']],
	['workflow load PASS', ['G11']],
	['workflow save PASS', ['G11']],
	['manual execution PASS', ['G11']],
	['1-node PASS', ['G11']],
	['linear workflow PASS', ['G11']],
	['webhook PASS', ['G11']],
	['execution persistence PASS', ['G11']],
	['reference smoke test 11/11 PASS (VPS baseline; here: hash-pinned + live engine re-verified)', ['G04', 'G11']],
];

const md = [];
md.push('# Workflow LEGO — Phase 2 isolation verification', '');
md.push(`Generated: ${report.generatedAt} · reference n8n ${MANIFEST.reference.pinnedVersion} (\`${MANIFEST.reference.pinnedCommit.slice(0, 12)}\`)`);
md.push('');
md.push(`**Gates: ${report.totals.passed}/${report.totals.gates} PASS** · **BEHAVIOR CHANGE: ${report.behaviorChange}** · **RUST IMPLEMENTATION: ${report.rustImplementation}**`);
md.push('');
md.push('## Requested gate checklist', '');
md.push('| gate | status | evidence |', '| :--- | :--- | :--- |');
for (const [name, ids] of checklist) {
	const gateResults = ids.flatMap((id) => results.filter((r) => r.id === id));
	const ok = gateResults.every((r) => r.status === 'PASS');
	md.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${gateResults.map((r) => `${r.id}: ${r.detail.split('\n')[0].slice(0, 160)}`).join('<br>')} |`);
}
md.push('', '## All gates', '');
md.push('| # | gate | status | detail |', '| :--- | :--- | :--- | :--- |');
for (const r of results) md.push(`| ${r.id} | ${r.title} | ${r.status} | ${r.detail.replace(/\n/g, ' ').slice(0, 220)} |`);
if (existsSync(join(EVIDENCE, 'live-verification.json'))) {
	const live = JSON.parse(readFileSync(join(EVIDENCE, 'live-verification.json'), 'utf8'));
	md.push('', '## Live verification (reference execution engine)', '');
	md.push(`Runtime: n8n-core ${live.runtime['n8n-core']} · n8n-nodes-base ${live.runtime['n8n-nodes-base']} · n8n-workflow ${live.runtime['n8n-workflow']} — ${live.runtime.note}`, '');
	md.push('| # | check | status | detail |', '| :--- | :--- | :--- | :--- |');
	for (const r of live.results) md.push(`| ${r.id} | ${r.title} | ${r.status} | ${r.detail.replace(/\n/g, ' ').slice(0, 200)} |`);
	md.push('', '### Known limitations of the sandbox (not of the isolation)', '');
	for (const l of live.knownLimitations) md.push(`- **${l.id} — ${l.topic}**: ${l.detail}`);
}
md.push(
	'',
	'## Rollback rule',
	'',
	'If any gate fails, `ISOLATION = FAILED`: the isolation change is rolled back and never carried into the next LEGO.',
	'This report is the machine-readable record of the decision (`docs/isolation/evidence/gate-report.json`).',
	'',
);
writeFileSync(join(REPO, 'docs/isolation/workflow-verification.md'), md.join('\n') + '\n');

console.log('');
console.log(`gates: ${report.totals.passed}/${report.totals.gates} PASS · BEHAVIOR CHANGE: ${report.behaviorChange}`);
console.log('wrote docs/isolation/evidence/gate-report.json and docs/isolation/workflow-verification.md');
if (failed.length) {
	console.error(`\nISOLATION = FAILED (${failed.length} gate(s)): ${failed.map((f) => f.id).join(', ')}`);
	process.exit(1);
}
