#!/usr/bin/env node
/**
 * Phase 4C — native localization gate (offline, zero dependencies).
 *
 * Runs the localization runtime test suite and re-derives the machine-checkable facts from the
 * Phase 4A/4B/4C modules themselves, then writes a single evidence record:
 *
 *   docs/isolation/evidence/localization-gate.json
 *
 * Checks (all must hold for the gate to PASS):
 *   G1  the test suite passes (node --test, no failures)
 *   G2  runtime catalog == Phase 4B SUPPORTED_LOCALES (drift between contract and data)
 *   G3  runtime catalog == the dictionary key set (no language without strings)
 *   G4  dictionary parity across all six locales (missing/extra/empty keys)
 *   G5  every locale translates a probe key (real strings, not fallbacks)
 *   G6  Arabic resolves to rtl, the other five to ltr
 *   G7  the engine-status overlay covers every locale and every status key
 *
 * usage: node tools/localization-gate.mjs [--json <path>] [--quiet]
 * exit:  0 = PASS, 1 = FAIL
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	ENGINE_STATUS_OVERLAY,
	LOCALE_CATALOG,
	STATUS_MESSAGE_KEYS,
	SUPPORTED_LOCALE_CODES,
	createLocalizationRuntime,
	dictionaryParity,
	directionOf,
} from '../packages/workflow-lego/src/localization-runtime.ts';
import {
	NATIVE_DICTIONARIES,
	NativeLocalizationService,
	SUPPORTED_LOCALES,
} from '../packages/workflow-lego/src/backend-localization-service.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const jsonFlag = argv.indexOf('--json');
const OUT = jsonFlag >= 0 ? argv[jsonFlag + 1] : join(ROOT, 'docs', 'isolation', 'evidence', 'localization-gate.json');
const QUIET = argv.includes('--quiet');

const checks = [];
const check = (id, name, fn) => {
	try {
		const detail = fn();
		checks.push({ id, name, ok: true, detail: detail ?? '' });
	} catch (error) {
		checks.push({ id, name, ok: false, detail: error.message });
	}
};
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

/* --- G1: the test suite ---------------------------------------------------------------- */
const testFile = join(ROOT, 'packages', 'workflow-lego', 'test', '06-localization-runtime.test.ts');
const started = Date.now();
const suite = spawnSync(process.execPath, ['--test', testFile], { cwd: ROOT, encoding: 'utf8' });
const suiteDurationMs = Date.now() - started;
const suiteOut = `${suite.stdout ?? ''}${suite.stderr ?? ''}`;
const num = (label) => {
	const match = suiteOut.match(new RegExp(`^# ${label} (\\d+)$`, 'm'));
	return match ? Number(match[1]) : null;
};
const suiteSummary = {
	command: `node --test packages/workflow-lego/test/06-localization-runtime.test.ts`,
	tests: num('tests'),
	pass: num('pass'),
	fail: num('fail'),
	exitCode: suite.status,
	durationMs: suiteDurationMs,
};

check('G1', 'localization test suite passes', () => {
	assert(suiteSummary.tests !== null, 'could not parse the test-runner summary');
	assert(suiteSummary.fail === 0 && suite.status === 0, `${suiteSummary.fail} failing test(s)`);
	return `${suiteSummary.pass}/${suiteSummary.tests} PASS in ${suiteDurationMs}ms`;
});

/* --- G2/G3: catalog parity ------------------------------------------------------------- */
const serviceLocales = Object.values(SUPPORTED_LOCALES).map(
	(l) => `${l.code}|${l.name}|${l.nativeName}|${l.direction}`,
);
check('G2', 'runtime catalog == Phase 4B SUPPORTED_LOCALES', () => {
	const expected = [...serviceLocales].sort();
	const actual = LOCALE_CATALOG.map((l) => `${l.code}|${l.name}|${l.nativeName}|${l.direction}`).sort();
	assert(JSON.stringify(actual) === JSON.stringify(expected), `catalog drift: ${actual}`);
	return `${actual.length} locales identical`;
});

check('G3', 'runtime catalog == dictionary key set', () => {
	const catalogCodes = [...SUPPORTED_LOCALE_CODES];
	const dictionaryCodes = Object.keys(NATIVE_DICTIONARIES);
	assert(
		JSON.stringify(catalogCodes) === JSON.stringify(dictionaryCodes),
		`catalog ${catalogCodes} vs dictionaries ${dictionaryCodes}`,
	);
	return `${catalogCodes.length} locales, ${Object.keys(NATIVE_DICTIONARIES['en']).length} keys each`;
});

/* --- G4: dictionary parity ------------------------------------------------------------- */
const parity = dictionaryParity(NATIVE_DICTIONARIES, 'en');
check('G4', 'dictionary parity across all six locales', () => {
	assert(parity.consistent, `inconsistent: ${JSON.stringify(parity)}`);
	return `${parity.locales.length} locales consistent, 0 empty values`;
});

/* --- G5: real translations ------------------------------------------------------------- */
check('G5', 'every locale returns a real translation for the probe key', () => {
	const rt = createLocalizationRuntime({ dictionaries: NativeLocalizationService, fallbackLocale: 'en' });
	const probe = 'settings.title';
	const values = {};
	for (const locale of SUPPORTED_LOCALE_CODES) {
		const value = rt.t(probe, undefined, locale);
		assert(value !== probe, `${locale}: ${probe} fell back to the key`);
		assert(value.trim() !== '', `${locale}: ${probe} is empty`);
		values[locale] = value;
	}
	assert(new Set(Object.values(values)).size === SUPPORTED_LOCALE_CODES.length, 'locales share a string');
	return JSON.stringify(values);
});

/* --- G6: direction --------------------------------------------------------------------- */
check('G6', 'direction table matches the catalog (Arabic rtl)', () => {
	for (const locale of SUPPORTED_LOCALE_CODES) {
		const expected = LOCALE_CATALOG.find((l) => l.code === locale)?.direction;
		assert(directionOf(locale) === expected, `${locale} expected ${expected}`);
		assert(directionOf(`${locale}-XX`) === expected, `${locale}-XX expected ${expected}`);
	}
	assert(directionOf('ar') === 'rtl', 'ar must be rtl');
	return SUPPORTED_LOCALE_CODES.map((l) => `${l}:${directionOf(l)}`).join(', ');
});

/* --- G7: engine status overlay ---------------------------------------------------------- */
check('G7', 'engine status overlay covers every locale and status', () => {
	const localeKeys = Object.keys(ENGINE_STATUS_OVERLAY);
	assert(
		JSON.stringify([...localeKeys].sort()) === JSON.stringify([...SUPPORTED_LOCALE_CODES].sort()),
		`overlay locales ${localeKeys} vs catalog ${SUPPORTED_LOCALE_CODES}`,
	);
	const referenceKeys = Object.keys(ENGINE_STATUS_OVERLAY['en']).sort();
	for (const [locale, keys] of Object.entries(ENGINE_STATUS_OVERLAY)) {
		assert(JSON.stringify(Object.keys(keys).sort()) === JSON.stringify(referenceKeys), `overlay drift in ${locale}`);
	}
	const rt = createLocalizationRuntime({ dictionaries: NativeLocalizationService });
	for (const [status, key] of Object.entries(STATUS_MESSAGE_KEYS)) {
		for (const locale of SUPPORTED_LOCALE_CODES) {
			const value = rt.t(key, undefined, locale);
			assert(value !== key, `${locale}: status ${status} -> ${key} untranslated`);
		}
	}
	return `${Object.keys(STATUS_MESSAGE_KEYS).length} statuses x ${localeKeys.length} locales`;
});

/* --- evidence + verdict ----------------------------------------------------------------- */
const failed = checks.filter((c) => !c.ok);
const record = {
	gate: 'phase-4c-native-localization',
	generatedAt: new Date().toISOString(),
	node: process.version,
	modules: [
		'packages/workflow-lego/src/settings-localization-adapter.ts (phase 4A)',
		'packages/workflow-lego/src/backend-localization-service.ts (phase 4B)',
		'packages/workflow-lego/src/localization-runtime.ts (phase 4C)',
	],
	localizationTestFile: 'packages/workflow-lego/test/06-localization-runtime.test.ts',
	locales: [...SUPPORTED_LOCALE_CODES],
	suite: suiteSummary,
	checks,
	verdict: failed.length === 0 ? 'PASS' : 'FAIL',
	failed: failed.map((c) => `${c.id} ${c.name}`),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);

if (QUIET) {
	console.log(
		`NATIVE LOCALIZATION GATE: ${record.verdict} (${checks.length - failed.length}/${checks.length} checks` +
			`${failed.length ? `, failed: ${record.failed.join(' | ')}` : ''}) — evidence ${OUT}`,
	);
} else {
	console.log('=== [AGENT 5] NATIVE LOCALIZATION GATE (Phase 4C) ===');
	for (const c of checks) console.log(`${c.ok ? '[PASS]' : '[FAIL]'} ${c.id} ${c.name} — ${c.detail}`);
	console.log('-------------------------------------------------------');
	console.log(`evidence: ${OUT}`);
	console.log(`RESULT: ${record.verdict} (${checks.length - failed.length}/${checks.length} checks)`);
}

process.exit(failed.length === 0 ? 0 : 1);
