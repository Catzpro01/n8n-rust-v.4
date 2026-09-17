#!/usr/bin/env node
/**
 * ISSUE-027 falsification harness (Phase 4H verification for lane PR #19).
 *
 * `npm run verify` G06 failed with TS5097 on the isolated unit because the LEGO sources use
 * `.ts`-extension relative specifiers (valid under Node's type-stripping loader, which is how this
 * lane's tests run) while `.extract/tsconfig.json` is CommonJS + `declaration: true` and therefore
 * cannot enable `allowImportingTsExtensions` (TS5096). The extractor fix normalizes those specifiers
 * when building the isolated copy.
 *
 * This harness proves BOTH directions with a real `tsc`, so the green is not vacuous:
 *   1. build the isolated unit           → tsc must exit 0
 *   2. build a control copy and UNDO exactly the normalization the extractor performs
 *      (restore `.ts` on the relative specifiers the LEGO sources actually carry) → tsc must fail
 *      with the same TS5097 the review reported
 *
 * usage: node tools/issuez027-falsify.mjs [--json <path>]
 * exit:  0 = behaviour as expected (green with the fix, red without it), 1 = unexpected
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PKG = join(ROOT, 'packages', 'workflow-lego');
const TSC = join(PKG, 'node_modules', '.bin', 'tsc');
// The control must live under the package so `types: ["node"]` resolves through
// packages/workflow-lego/node_modules — the isolated unit's tsconfig expects that. It stays inside
// the git-ignored `.extract/` tree and is removed by this script (and by the next extraction).
const TMP = join(PKG, '.extract', 'control');

const argv = process.argv.slice(2);
const jsonIdx = argv.indexOf('--json');
const OUT = jsonIdx >= 0 ? argv[jsonIdx + 1] : join(ROOT, 'docs', 'isolation', 'evidence', 'issuez027-verification.json');

if (!existsSync(TSC)) {
	console.error(`typescript missing at ${TSC} — run: npm --prefix packages/workflow-lego install`);
	process.exit(2);
}

const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8' });

/* --- 1. build the isolated unit (extractor, with the ISSUE-027 normalization) ----------- */
const extract = run(process.execPath, [join(ROOT, 'tools', 'workflow-isolation-extract.mjs')], ROOT);
if (extract.status !== 0) {
	console.error('extraction failed:\n' + (extract.stdout + extract.stderr).slice(-2000));
	process.exit(1);
}
const rewrites = JSON.parse(readFileSync(join(PKG, '.extract', 'rewrites.json'), 'utf8'));
const normalizations = rewrites.legoSpecifierNormalizations ?? [];

const after = run(TSC, ['-p', join(PKG, '.extract', 'tsconfig.json')], PKG);
const afterErrors = (after.stdout + after.stderr)
	.split('\n')
	.filter((line) => /error TS\d+/.test(line));

/* --- 2. control: undo the normalization, exactly and only where the sources carry `.ts` -- */
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
cpSync(join(PKG, '.extract', 'src'), join(TMP, 'src'), { recursive: true });
cpSync(join(PKG, '.extract', 'tsconfig.json'), join(TMP, 'tsconfig.json'));

/** Relative specifiers ending in `.ts` in one LEGO source file. */
function tsSpecifiers(source) {
	const found = new Set();
	const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)(['"])(\.\/[^'"]*?\.ts)\1/g;
	for (const match of source.matchAll(re)) found.add(match[2]);
	return [...found];
}

const legoSrc = join(PKG, 'src');
const controls = [];
const walk = (dir) => {
	for (const entry of readdirSync(dir)) {
		const abs = join(dir, entry);
		if (statSync(abs).isDirectory()) walk(abs);
		else if (entry.endsWith('.ts')) {
			const specifiers = tsSpecifiers(readFileSync(abs, 'utf8'));
			if (specifiers.length > 0) controls.push({ file: abs.slice(legoSrc.length + 1), specifiers });
		}
	}
};
walk(legoSrc);

let restored = 0;
for (const control of controls) {
	const target = join(TMP, 'src', 'lego', control.file);
	let source = readFileSync(target, 'utf8');
	for (const specifier of control.specifiers) {
		const bare = specifier.replace(/\.ts$/, '');
		const re = new RegExp(`(['"])${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'g');
		const next = source.replace(re, `$1${specifier}$1`);
		if (next !== source) restored++;
		source = next;
	}
	writeFileSync(target, source);
}

const before = run(TSC, ['-p', join(TMP, 'tsconfig.json')], PKG);
const beforeErrors = (before.stdout + before.stderr)
	.split('\n')
	.filter((line) => /error TS\d+/.test(line));

const report = {
	tool: 'issuez027-falsify',
	generatedAt: new Date().toISOString(),
	issue: 'ISSUE-027 — TS5097 in the isolated unit (npm run verify G06/G08)',
	rootCause:
		'LEGO sources use .ts-extension relative specifiers (valid under Node type-stripping); .extract/tsconfig.json is CommonJS + declaration:true and cannot set allowImportingTsExtensions (TS5096).',
	fix: 'tools/workflow-isolation-extract.mjs normalizes those specifiers in the copied LEGO sources (cherry-picked from arena/01a0b101 @ 1f86b03e).',
	fixed: {
		command: 'tsc -p packages/workflow-lego/.extract/tsconfig.json',
		exitCode: after.status,
		errorCount: afterErrors.length,
		normalizedSpecifiers: normalizations.reduce((sum, entry) => sum + entry.specifiers, 0),
		normalizedFiles: normalizations,
	},
	control: {
		description: 'same isolated unit with the normalization undone (extensions restored exactly where the sources carry them)',
		command: 'tsc -p packages/workflow-lego/.extract/control/tsconfig.json',
		exitCode: before.status,
		errorCount: beforeErrors.length,
		firstErrors: beforeErrors.slice(0, 4),
		restoredSpecifierSites: restored,
		files: controls.map((c) => c.file),
	},
	verdict:
		after.status === 0 && afterErrors.length === 0 && before.status !== 0 && beforeErrors.every((line) => line.includes('TS5097'))
			? 'CONFIRMED — green with the fix, TS5097 without it'
			: 'UNEXPECTED — see exit codes above',
};

rmSync(TMP, { recursive: true, force: true });
mkdirSync(join(ROOT, 'docs', 'isolation', 'evidence'), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, '\t')}\n`);

console.log('=== ISSUE-027 FALSIFICATION ===');
console.log(`fixed   : tsc exit ${report.fixed.exitCode} · ${report.fixed.errorCount} errors · ${report.fixed.normalizedSpecifiers} specifier(s) normalized in ${normalizations.length} file(s)`);
console.log(`control : tsc exit ${report.control.exitCode} · ${report.control.errorCount} errors (${report.control.firstErrors.length > 0 ? 'first: ' + report.control.firstErrors[0].trim() : 'none'})`);
console.log(`verdict : ${report.verdict}`);
console.log(`evidence: ${OUT}`);
process.exit(report.verdict.startsWith('CONFIRMED') ? 0 : 1);
