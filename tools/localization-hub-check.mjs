#!/usr/bin/env node
/**
 * Phase 4B gate — Backend Native Localization Hub (6 locales).
 *
 * Runs the localization checks independently of the Phase-2 workflow gate and writes
 * `docs/isolation/evidence/localization-hub.json`:
 *
 *   L01 registry + parity — six locales, every one key-identical to the English base text
 *   L02 behaviour suite  — `node --test test/06-localization.test.mjs` (offline, no reference runtime)
 *   L03 boundary         — the hub imports nothing; the Phase 4A adapter imports only the hub
 *   L04 reference rule   — the pinned n8n tree is byte-identical (the Vue UI bundle is untouched)
 *   L05 single source    — the adapter carries no second language list of its own
 *
 * usage: node tools/localization-hub-check.mjs [--json] [--quiet]
 * exit code non-zero when any check fails.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, loadLocalizationHub } from './localization-module-loader.mjs';

const args = process.argv.slice(2);
const EVIDENCE = join(REPO, 'docs/isolation/evidence/localization-hub.json');
const PKG = join(REPO, 'packages/workflow-lego');

const hub = await loadLocalizationHub();
const { NativeLocalizationService, SUPPORTED_LOCALES, FALLBACK_LOCALE } = hub.service;
const checks = [];
const record = (id, title, fn) => {
	let status = 'PASS';
	let detail = '';
	try {
		detail = fn() ?? '';
	} catch (error) {
		status = 'FAIL';
		detail = error.message ?? String(error);
	}
	checks.push({ id, title, status, detail: String(detail).trim().slice(0, 800) });
	console.log(`[${status}] ${id} ${title}${detail ? ` — ${String(detail).split('\n')[0]}` : ''}`);
};

/* L01 — registry + parity ------------------------------------------------ */
record('L01', 'six locales registered and key-identical to the English base text', () => {
	const codes = Object.keys(SUPPORTED_LOCALES);
	if (codes.length !== 6) throw new Error(`expected 6 locales, found ${codes.length}: ${codes.join(', ')}`);
	const report = NativeLocalizationService.parityReport();
	if (!report.ok) {
		const broken = report.locales
			.filter((entry) => entry.missing.length || entry.extra.length)
			.map((entry) => `${entry.locale}: -${entry.missing.join('/') || '∅'} +${entry.extra.join('/') || '∅'}`);
		throw new Error(`key parity broken → ${broken.join(' | ')}`);
	}
	const rtl = report.locales
		.map((entry) => SUPPORTED_LOCALES[entry.locale])
		.filter((meta) => meta.direction === 'rtl')
		.map((meta) => meta.code);
	if (rtl.length !== 1 || rtl[0] !== 'ar') throw new Error(`expected exactly one RTL locale (ar), found: ${rtl.join(', ')}`);
	return `${codes.join(' · ')} — ${report.baseKeyCount} keys x 6 locales, fallback chain terminates at ${FALLBACK_LOCALE}`;
});

/* L02 — behaviour suite --------------------------------------------------- */
let suite = { pass: 0, fail: 0, raw: '' };
record('L02', 'behaviour suite PASS (resolution, fallback, interpolation, plural, RTL, persistence)', () => {
	const result = spawnSync(process.execPath, ['--test', 'test/06-localization.test.mjs'], {
		cwd: PKG,
		encoding: 'utf8',
		timeout: 300_000,
	});
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	suite = {
		pass: Number(/(?:^|\n)# pass (\d+)/.exec(output)?.[1] ?? 0),
		fail: Number(/(?:^|\n)# fail (\d+)/.exec(output)?.[1] ?? 0),
		raw: output.split('\n').filter((line) => /^# (tests|pass|fail|duration_ms)/.test(line)).join(' · '),
	};
	if (result.status !== 0 || suite.fail !== 0 || suite.pass === 0) {
		throw new Error(`suite exited ${result.status} (${suite.pass} pass / ${suite.fail} fail)\n${output.slice(-1200)}`);
	}
	return `node --test test/06-localization.test.mjs → ${suite.pass}/${suite.pass + suite.fail} PASS`;
});

/* L03 — boundary ---------------------------------------------------------- */
record('L03', 'boundary: the hub imports nothing, the adapter imports only the hub', () => {
	const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
	const hubSource = strip(readFileSync(hub.sources.service.path, 'utf8'));
	if (/^\s*import\s/m.test(hubSource)) throw new Error('the localization hub imports a module');
	const adapterSource = strip(readFileSync(hub.sources.adapter.path, 'utf8'));
	const specifiers = [...adapterSource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
	if (specifiers.length !== 1 || specifiers[0] !== './backend-localization-service') {
		throw new Error(`unexpected adapter imports: ${specifiers.join(', ') || '(none)'}`);
	}
	return `hub: 0 imports · adapter: 1 relative import (${specifiers[0]})`;
});

/* L04 — reference tree untouched ----------------------------------------- */
record('L04', 'the pinned reference tree is byte-identical (Vue UI bundle untouched)', () => {
	const result = spawnSync(process.execPath, [join(REPO, 'tools/workflow-reference-manifest.mjs'), '--check'], {
		cwd: REPO,
		encoding: 'utf8',
		timeout: 300_000,
	});
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
	if (result.status !== 0) throw new Error(output.slice(-800));
	return output.split('\n').filter((line) => line.trim()).slice(-1)[0];
});

/* L05 — no second language list ------------------------------------------ */
record('L05', 'the Phase 4A adapter holds no second language list (single source of truth)', () => {
	const source = readFileSync(hub.sources.adapter.path, 'utf8');
	for (const code of ['id', 'en', 'jv', 'ar', 'zh', 'ru']) {
		const literal = new RegExp(`label:\\s*'[^']*'\\s*,?\\s*code:\\s*'${code}'|code:\\s*'${code}'\\s*,\\s*label:`);
		if (literal.test(source)) throw new Error(`the adapter still hardcodes the '${code}' entry`);
	}
	if (!/SUPPORTED_LOCALES/.test(source)) throw new Error('the adapter does not read SUPPORTED_LOCALES');
	return 'language list derived from SUPPORTED_LOCALES';
});

/* evidence ---------------------------------------------------------------- */
const failed = checks.filter((check) => check.status === 'FAIL');
const evidence = {
	generatedAt: new Date().toISOString(),
	phase: 'phase-4b-localization',
	lego: 'localization-hub',
	referenceGrounding: 'reference/n8n/packages/frontend/@n8n/i18n (mechanism parity; the six translations are product-supplied)',
	sources: hub.sources,
	locales: Object.values(SUPPORTED_LOCALES).map((meta) => ({
		code: meta.code,
		name: meta.name,
		nativeName: meta.nativeName,
		direction: meta.direction,
		fallbacks: meta.fallbacks,
		aliases: meta.aliases.length,
	})),
	parity: NativeLocalizationService.parityReport(),
	suite: { pass: suite.pass, fail: suite.fail, summary: suite.raw },
	checks,
	verdict: failed.length === 0 ? 'PASS' : 'FAIL',
};
mkdirSync(join(REPO, 'docs/isolation/evidence'), { recursive: true });
writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');

if (!args.includes('--quiet')) {
	console.log(`\nlocalization hub: ${evidence.verdict} (${checks.length - failed.length}/${checks.length} checks)`);
	console.log(`evidence: docs/isolation/evidence/localization-hub.json`);
}
process.exit(failed.length === 0 ? 0 : 1);
