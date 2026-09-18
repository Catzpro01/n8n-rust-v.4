#!/usr/bin/env node
/**
 * AGENT-5 · LEGO PERSISTENCE — Localization leak gate (Zero Cross-Language Leak).
 *
 * Eleven machine checks. Every check that can fail the build is `severity:
 * block`. Informational findings are `severity: warn` and never change the exit
 * code.
 *
 *   G00 modules load  the four locale surfaces import cleanly on Node
 *   G01 syntax        every reconstructed JS/TS file parses (node --check on a
 *                     type-stripped copy — plain `node --check` is NOT a valid
 *                     syntax gate for .ts, it accepts `export const a = ;`)
 *   G02 parity        all six locales cover exactly the canonical key set
 *   G03 placeholders  {var} placeholders are identical across locales
 *   G04 script purity ar/zh/ru carry no Latin letters; id/jv/en carry no foreign script
 *   G05 script house  ar is Arabic, zh is Han, ru is Cyrillic
 *   G06 translation   ar/zh/ru never fall back to the English source string
 *   G07 leak free     rendering every key in every locale records zero misses
 *   G08 cross-module  the four locale surfaces expose the same six codes
 *   G09 zero rust     no Rust syntax / .rs file inside the JS-TS reconstruction
 *   G10 round trip    preference survives persist → hydrate, corrupt value → id
 *
 * usage: node tools/localization-leak-gate.mjs [--json <path>] [--quiet]
 * exit : 0 = all blocking checks pass, 1 = at least one blocking check fails
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, relative, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/* `stripTypeScriptTypes` is experimental on Node 22 — keep our own output clean. */
process.on('warning', (warning) => {
	if (warning.name === 'ExperimentalWarning' && warning.message.includes('stripTypeScriptTypes')) return;
	console.warn(warning.message);
});

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_EVIDENCE = join(REPO, 'docs/isolation/evidence/localization-leak-gate.json');

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

const git = (args) => spawnSync('git', args, { cwd: REPO, encoding: 'utf8' }).stdout.trim();

const PLACEHOLDER = /\{\w+\}/g;
const LATIN = /[A-Za-z]/;
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u0870-\u089F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF]/;
const CYRILLIC = /[\u0400-\u04FF\u0500-\u052F]/;

const stripPlaceholders = (value) => value.replace(PLACEHOLDER, '');
const placeholdersOf = (value) => (value.match(/\{\w+\}/g) ?? []).sort().join(',');

const WALK_ROOTS = ['packages', 'tools', 'tests', 'apps', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.runtime', '.extract', 'dist', 'coverage']);
const SOURCE_EXT = /\.(mjs|cjs|js|ts)$/;

function walk(dir, acc = []) {
	let entries = [];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return acc;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) walk(full, acc);
			continue;
		}
		acc.push(full);
	}
	return acc;
}

/**
 * Source inventory = walk of the reconstruction tree ∪ `git ls-files`.
 * The walk matters: a brand-new file is not in the index yet, and a leak in an
 * untracked file is still a leak. Only the read-only upstream tree
 * (`reference/n8n/**`) is excluded — `tests/reference/**` is our own golden
 * corpus and stays in scope.
 */
function sourceInventory() {
	const candidates = new Set();
	for (const root of WALK_ROOTS) {
		const abs = join(REPO, root);
		if (!existsSync(abs)) continue;
		for (const file of walk(abs)) candidates.add(relative(REPO, file));
	}
	for (const line of git(['ls-files', ...WALK_ROOTS]).split('\n')) {
		const trimmed = line.trim();
		if (trimmed) candidates.add(trimmed);
	}
	return [...candidates]
		.filter((file) => SOURCE_EXT.test(file))
		.filter((file) => !file.startsWith('reference/'))
		.filter((file) => !file.split('/').some((part) => SKIP_DIRS.has(part)))
		.sort();
}

const trackedSources = () => sourceInventory();

const RUST_MARKERS = [
	{ id: 'fn-decl', re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+\w+\s*\(/m },
	{ id: 'crate-attr', re: /#!\[/ },
	{ id: 'derive', re: /#\[derive\(/ },
	{ id: 'let-mut', re: /\blet\s+mut\s/ },
	{ id: 'rust-arrow', re: /->\s*(?:i8|i16|i32|i64|u8|u16|u32|u64|usize|isize|String|Vec<|Result<)/ },
	{ id: 'impl-block', re: /\bimpl\s+[A-Z]\w*/ },
	{ id: 'println-macro', re: /\bprintln!\s*\(/ },
	{ id: 'use-crate', re: /\buse\s+crate::/ },
];

/* -------------------------------------------------------------------------- */
/* module loading (dynamic so a broken module is a failing gate, not a crash)   */
/* -------------------------------------------------------------------------- */

let PERSISTENCE_DICTIONARIES = {};
let PERSISTENCE_TEXT_KEYS = [];
let PERSISTENCE_KEY_PROVENANCE = {};
let PERSISTENCE_LOCALE_CODES = [];
let EXECUTION_STATUSES = [];
let MemoryStorage;
let PersistenceLocaleStore;
let UniversalLocaleEnforcer;
let SUPPORTED_LOCALES = {};
let SUPPORTED_LANGUAGES = [];
let SettingsLocalizationAdapter;

const checks = [];
const warnings = [];
const record = (id, name, severity, status, details = {}) => {
	checks.push({ id, name, severity, status, ...details });
};

async function loadModules() {
	try {
		const store = await import('../packages/reconstructed-engine/src/persistence-locale-store.ts');
		const enforcer = await import('../packages/reconstructed-engine/src/universal-locale-enforcer.ts');
		const native = await import('../packages/workflow-lego/src/backend-localization-service.ts');
		const settings = await import('../packages/workflow-lego/src/settings-localization-adapter.ts');
		PERSISTENCE_DICTIONARIES = store.PERSISTENCE_DICTIONARIES;
		PERSISTENCE_TEXT_KEYS = store.PERSISTENCE_TEXT_KEYS;
		PERSISTENCE_KEY_PROVENANCE = store.PERSISTENCE_KEY_PROVENANCE;
		PERSISTENCE_LOCALE_CODES = store.PERSISTENCE_LOCALE_CODES;
		EXECUTION_STATUSES = store.EXECUTION_STATUSES;
		MemoryStorage = store.MemoryStorage;
		PersistenceLocaleStore = store.PersistenceLocaleStore;
		UniversalLocaleEnforcer = enforcer.UniversalLocaleEnforcer;
		SUPPORTED_LOCALES = native.SUPPORTED_LOCALES;
		SUPPORTED_LANGUAGES = settings.SUPPORTED_LANGUAGES;
		SettingsLocalizationAdapter = settings.SettingsLocalizationAdapter;
		record('G00', 'localization modules load on Node', 'block', 'PASS', {
			modules: 4,
		});
		return true;
	} catch (error) {
		record('G00', 'localization modules load on Node', 'block', 'FAIL', {
			error: String(error && error.message ? error.message : error),
		});
		return false;
	}
}

/* -------------------------------------------------------------------------- */
/* checks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Syntax gate. `node --check file.ts` is NOT a syntax gate for TypeScript
 * (it happily accepts `export const a = ;`), so .ts files are type-stripped
 * first and the resulting ESM is checked; .mjs stays ESM, .js/.cjs are checked
 * as CommonJS.
 */
function g01Syntax() {
	const files = trackedSources();
	const failed = [];
	const stripped = [];
	for (const file of files) {
		const source = readFileSync(join(REPO, file), 'utf8');
		let code = source;
		let ext = file.endsWith('.mjs') ? '.mjs' : '.cjs';
		if (file.endsWith('.ts')) {
			try {
				code = stripTypeScriptTypes(source, { mode: 'strip' });
				ext = '.mjs';
				stripped.push(file);
			} catch (error) {
				failed.push({ file, stage: 'strip-types', error: String(error.message).split('\n')[0] });
				continue;
			}
		}
		const tmp = join(
			tmpdir(),
			`leak-gate-${createHash('sha1').update(file).digest('hex').slice(0, 16)}${ext}`,
		);
		writeFileSync(tmp, code, 'utf8');
		const res = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
		rmSync(tmp, { force: true });
		if (res.status !== 0) {
			failed.push({
				file,
				stage: 'node --check',
				error: (res.stderr || '').split('\n').slice(0, 3).join(' ').trim(),
			});
		}
	}
	record('G01', 'every reconstructed JS/TS file parses', 'block', failed.length === 0 ? 'PASS' : 'FAIL', {
		filesChecked: files.length,
		typeStripped: stripped.length,
		failed,
	});
}

function g02Parity() {
	const canonical = [...PERSISTENCE_TEXT_KEYS];
	const problems = [];
	for (const locale of PERSISTENCE_LOCALE_CODES) {
		const table = PERSISTENCE_DICTIONARIES[locale];
		if (!table) {
			problems.push({ locale, issue: 'missing dictionary' });
			continue;
		}
		const keys = Object.keys(table);
		const missing = canonical.filter((key) => !(key in table));
		const extra = keys.filter((key) => !canonical.includes(key));
		const empty = canonical.filter((key) => key in table && String(table[key]).trim() === '');
		if (missing.length) problems.push({ locale, issue: 'missing keys', keys: missing });
		if (extra.length) problems.push({ locale, issue: 'unknown keys', keys: extra });
		if (empty.length) problems.push({ locale, issue: 'empty values', keys: empty });
	}
	record('G02', 'six-locale dictionary parity', 'block', problems.length === 0 ? 'PASS' : 'FAIL', {
		canonicalKeys: canonical.length,
		locales: PERSISTENCE_LOCALE_CODES.length,
		problems,
	});
}

function g03Placeholders() {
	const problems = [];
	for (const key of PERSISTENCE_TEXT_KEYS) {
		const signature = placeholdersOf(PERSISTENCE_DICTIONARIES.en[key] ?? '');
		for (const locale of PERSISTENCE_LOCALE_CODES) {
			const value = PERSISTENCE_DICTIONARIES[locale][key] ?? '';
			const mine = placeholdersOf(value);
			if (mine !== signature) {
				problems.push({ key, locale, expected: signature, found: mine });
			}
		}
	}
	record('G03', 'interpolation placeholder parity', 'block', problems.length === 0 ? 'PASS' : 'FAIL', {
		problems,
	});
}

function g04ScriptPurity() {
	const problems = [];
	for (const locale of PERSISTENCE_LOCALE_CODES) {
		for (const key of PERSISTENCE_TEXT_KEYS) {
			const value = stripPlaceholders(PERSISTENCE_DICTIONARIES[locale][key] ?? '');
			if (locale === 'ar' || locale === 'zh' || locale === 'ru') {
				if (LATIN.test(value)) problems.push({ locale, key, issue: 'latin letters', value });
			} else {
				if (ARABIC.test(value)) problems.push({ locale, key, issue: 'arabic script', value });
				if (HAN.test(value)) problems.push({ locale, key, issue: 'han script', value });
				if (CYRILLIC.test(value)) problems.push({ locale, key, issue: 'cyrillic script', value });
			}
		}
	}
	record('G04', 'no foreign script inside a locale string', 'block', problems.length === 0 ? 'PASS' : 'FAIL', {
		problems,
	});
}

function g05ScriptHouse() {
	const expectations = { ar: ARABIC, zh: HAN, ru: CYRILLIC };
	const problems = [];
	for (const [locale, re] of Object.entries(expectations)) {
		for (const key of PERSISTENCE_TEXT_KEYS) {
			const value = stripPlaceholders(PERSISTENCE_DICTIONARIES[locale][key] ?? '');
			if (!re.test(value)) problems.push({ locale, key, value });
		}
	}
	record('G05', 'ar = Arabic, zh = Han, ru = Cyrillic', 'block', problems.length === 0 ? 'PASS' : 'FAIL', {
		problems,
	});
}

function g06NoEnglishFallback() {
	const problems = [];
	for (const locale of ['ar', 'zh', 'ru']) {
		for (const key of PERSISTENCE_TEXT_KEYS) {
			if (PERSISTENCE_DICTIONARIES[locale][key] === PERSISTENCE_DICTIONARIES.en[key]) {
				problems.push({ locale, key, value: PERSISTENCE_DICTIONARIES[locale][key] });
			}
		}
	}
	record('G06', 'no untranslated English fallback in ar/zh/ru', 'block', problems.length === 0 ? 'PASS' : 'FAIL', {
		problems,
	});
}

function g07LeakFreeRender() {
	const problems = [];
	const rendered = {};
	for (const locale of PERSISTENCE_LOCALE_CODES) {
		const store = new PersistenceLocaleStore(new MemoryStorage(), locale);
		rendered[locale] = store.renderAll(locale);
		for (const status of EXECUTION_STATUSES) {
			const label = store.status(status);
			if (!label || label === status) problems.push({ locale, issue: 'unmapped status', status, label });
		}
		for (const mode of ['manual', 'trigger', 'webhook', 'integrated', 'retry', 'error']) {
			const label = store.mode(mode);
			if (!label || label === `executionsList.modes.${mode}`) {
				problems.push({ locale, issue: 'unmapped mode', mode, label });
			}
		}
		const confirm = store.text('executionsList.confirmMessage.message', { count: 3 }, locale);
		if (/\{|\}/.test(confirm)) problems.push({ locale, issue: 'unfilled placeholder', value: confirm });
		if (store.leaks().length) problems.push({ locale, issue: 'missing translations', keys: store.leaks() });
	}
	UniversalLocaleEnforcer.clearLeaks();
	record('G07', 'full render records zero translation misses', 'block', problems.length === 0 ? 'PASS' : 'FAIL', {
		keysRendered: PERSISTENCE_TEXT_KEYS.length * PERSISTENCE_LOCALE_CODES.length,
		problems,
	});
	return rendered;
}

function g08CrossModuleParity() {
	const persistence = [...PERSISTENCE_LOCALE_CODES].sort().join(',');
	const native = Object.keys(SUPPORTED_LOCALES).sort().join(',');
	const enforcer = [...UniversalLocaleEnforcer.SUPPORTED_LOCALES].sort().join(',');
	const settings = SUPPORTED_LANGUAGES.map((entry) => entry.code).sort().join(',');
	const surfaces = { persistence, native, enforcer, settings };
	const distinct = new Set(Object.values(surfaces));
	record('G08', 'all four locale surfaces expose the same codes', 'block', distinct.size === 1 ? 'PASS' : 'FAIL', {
		surfaces,
		distinct: [...distinct],
	});
}

function g09ZeroRust() {
	const files = trackedSources();
	const offenders = [];
	for (const file of files) {
		const source = readFileSync(join(REPO, file), 'utf8');
		for (const marker of RUST_MARKERS) {
			if (marker.re.test(source)) offenders.push({ file, marker: marker.id });
		}
	}
	const rustFiles = files.filter((file) => file.endsWith('.rs'));
	record('G09', 'zero Rust inside the JS/TS reconstruction', 'block',
		offenders.length === 0 && rustFiles.length === 0 ? 'PASS' : 'FAIL', {
			filesScanned: files.length,
			rustFiles,
			offenders,
		});
}

function g10RoundTrip() {
	const problems = [];
	const storage = new MemoryStorage();

	const first = new PersistenceLocaleStore(storage, 'id');
	if (first.getLocale() !== 'id') problems.push({ step: 'default', expected: 'id', got: first.getLocale() });
	first.setLocale('ar');
	const second = new PersistenceLocaleStore(storage);
	if (second.getLocale() !== 'ar') problems.push({ step: 'rehydrate', expected: 'ar', got: second.getLocale() });
	if (second.status('running') !== PERSISTENCE_DICTIONARIES.ar['execution.status.running']) {
		problems.push({ step: 'render-after-rehydrate', got: second.status('running') });
	}

	// a corrupt persisted value must fall back to `id`, never to English
	storage.setItem('n8n.persistence.locale', 'de-AT');
	const third = new PersistenceLocaleStore(storage);
	if (third.getLocale() !== 'id') problems.push({ step: 'corrupt-fallback', expected: 'id', got: third.getLocale() });
	if (third.unsupportedLocales().indexOf('de-AT') === -1) {
		problems.push({ step: 'corrupt-fallback', issue: 'unsupported locale not recorded' });
	}

	// the settings surface shares the same key and must agree with the store
	SettingsLocalizationAdapter.useStorage(storage);
	SettingsLocalizationAdapter.setLanguage('ru');
	const ruState = SettingsLocalizationAdapter.getState().currentLanguage;
	if (ruState !== 'ru') problems.push({ step: 'settings-persist', expected: 'ru', got: ruState });
	const fourth = new PersistenceLocaleStore(storage);
	if (fourth.getLocale() !== 'ru') problems.push({ step: 'settings-shared-storage', expected: 'ru', got: fourth.getLocale() });
	if (SettingsLocalizationAdapter.getDirection() !== 'ltr') {
		problems.push({ step: 'direction', expected: 'ltr', got: SettingsLocalizationAdapter.getDirection() });
	}
	SettingsLocalizationAdapter.setLanguage('ar');
	if (SettingsLocalizationAdapter.getDirection() !== 'rtl') {
		problems.push({ step: 'rtl-direction', expected: 'rtl', got: SettingsLocalizationAdapter.getDirection() });
	}
	SettingsLocalizationAdapter.setLanguage('klingon');
	const fallback = SettingsLocalizationAdapter.getState().currentLanguage;
	if (fallback !== 'id') problems.push({ step: 'settings-fallback', expected: 'id', got: fallback });

	fourth.reset();
	if (fourth.getLocale() !== 'id') problems.push({ step: 'reset', expected: 'id', got: fourth.getLocale() });

	record('G10', 'preference round-trips through storage', 'block', problems.length === 0 ? 'PASS' : 'FAIL', {
		problems,
	});
}

/* -------------------------------------------------------------------------- */
/* warnings                                                                   */
/* -------------------------------------------------------------------------- */

function collectWarnings() {
	for (const locale of PERSISTENCE_LOCALE_CODES) {
		const seen = new Map();
		for (const key of PERSISTENCE_TEXT_KEYS) {
			const value = PERSISTENCE_DICTIONARIES[locale][key];
			if (seen.has(value)) {
				warnings.push({
					id: 'W01',
					level: 'info',
					locale,
					message: `duplicate value "${value}" for ${seen.get(value)} and ${key}`,
				});
			}
			seen.set(value, key);
		}
	}
	for (const locale of ['id', 'jv']) {
		for (const key of PERSISTENCE_TEXT_KEYS) {
			if (PERSISTENCE_DICTIONARIES[locale][key] === PERSISTENCE_DICTIONARIES.en[key]) {
				warnings.push({
					id: 'W02',
					level: 'info',
					locale,
					message: `"${key}" is identical to the English source (loanword — acceptable)`,
				});
			}
		}
	}
	for (const key of PERSISTENCE_TEXT_KEYS) {
		if (!PERSISTENCE_KEY_PROVENANCE[key]) {
			warnings.push({ id: 'W03', level: 'warn', message: `no provenance recorded for "${key}"` });
		}
	}
}

/* -------------------------------------------------------------------------- */
/* main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
	const args = process.argv.slice(2);
	const quiet = args.includes('--quiet');
	const jsonIdx = args.indexOf('--json');
	const evidencePath = jsonIdx === -1 ? DEFAULT_EVIDENCE : args[jsonIdx + 1];

	const modulesLoaded = await loadModules();
	g01Syntax();
	g09ZeroRust();
	let rendered = {};
	if (modulesLoaded) {
		g02Parity();
		g03Placeholders();
		g04ScriptPurity();
		g05ScriptHouse();
		g06NoEnglishFallback();
		rendered = g07LeakFreeRender();
		g08CrossModuleParity();
		g10RoundTrip();
		collectWarnings();
	}

	const failed = checks.filter((check) => check.severity === 'block' && check.status !== 'PASS');
	const report = {
		gate: 'localization-leak-gate',
		agent: 'agent-5',
		lego: 'persistence',
		task: process.env.AGENT_TASK_ID ?? 'TASK-LANG-B5',
		generated_at: new Date().toISOString(),
		branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
		head_commit: git(['rev-parse', '--short', 'HEAD']),
		node: process.version,
		reference: {
			n8n: '2.9.4',
			upstream_commit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
			english_source: 'reference/n8n/packages/frontend/@n8n/i18n/src/locales/en.json',
			english_source_sha256:
				'1367f71aacc45ca656b88a058564637965967d672fd3b14b70cacf3793d5bef4',
			status_vocabulary: 'reference/n8n/packages/workflow/src/execution-status.ts',
		},
		summary: {
			checks: checks.length,
			passed: checks.filter((check) => check.status === 'PASS').length,
			failed: failed.length,
			verdict: failed.length === 0 ? 'PASS' : 'FAIL',
			warnings: warnings.length,
			keys: PERSISTENCE_TEXT_KEYS.length,
			locales: PERSISTENCE_LOCALE_CODES.length,
			strings: PERSISTENCE_TEXT_KEYS.length * PERSISTENCE_LOCALE_CODES.length,
		},
		checks,
		warnings,
		sample: {
			status_running: Object.fromEntries(
				PERSISTENCE_LOCALE_CODES.map((locale) => [locale, (rendered[locale] ?? {})['execution.status.running']]),
			),
			pruned: Object.fromEntries(
				PERSISTENCE_LOCALE_CODES.map((locale) => [locale, (rendered[locale] ?? {})['persistence.execution.pruned']]),
			),
		},
	};

	mkdirSync(dirname(evidencePath), { recursive: true });
	writeFileSync(evidencePath, JSON.stringify(report, null, 2) + '\n');

	if (!quiet) {
		for (const check of checks) {
			const mark = check.status === 'PASS' ? '✓' : '✗';
			console.log(`${mark} ${check.id} ${check.name} [${check.severity}]`);
			if (check.status !== 'PASS') {
				const body = JSON.stringify(check.problems ?? check.error ?? check, null, 2)
					.split('\n')
					.join('\n    ');
				console.log(`    ${body}`);
			}
		}
		for (const warning of warnings) {
			console.log(`! ${warning.id} ${warning.message}`);
		}
		console.log(
			`\nLOCALIZATION GATE: ${report.summary.passed}/${report.summary.checks} PASS · ` +
				`${report.summary.failed} FAIL · ${report.summary.warnings} warning(s) · ` +
				`${report.summary.strings} strings · VERDICT ${report.summary.verdict}`,
		);
		console.log(`evidence: ${relative(REPO, evidencePath)}`);
	}

	process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
	console.error(`localization-leak-gate crashed: ${error && error.stack ? error.stack : error}`);
	process.exit(1);
});
