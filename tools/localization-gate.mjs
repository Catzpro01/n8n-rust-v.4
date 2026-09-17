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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import * as runtimeModule from '../packages/workflow-lego/src/localization-runtime.ts';
import * as serviceModule from '../packages/workflow-lego/src/backend-localization-service.ts';
import * as envelopeModule from '../packages/workflow-lego/src/localization-envelope.ts';
import * as vocabularyModule from '../packages/workflow-lego/src/localization-vocabulary.ts';
import * as recordModule from '../packages/workflow-lego/src/execution-log-record.ts';
import * as apiModule from '../packages/workflow-lego/src/api-error-response.ts';
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
const testFiles = [
	'06-localization-runtime.test.ts',
	'07-localization-envelope.test.ts',
	'08-localization-run-path.test.ts',
].map((f) => join(ROOT, 'packages', 'workflow-lego', 'test', f));
const started = Date.now();
const suite = spawnSync(process.execPath, ['--test', ...testFiles], { cwd: ROOT, encoding: 'utf8' });
const suiteDurationMs = Date.now() - started;
const suiteOut = `${suite.stdout ?? ''}${suite.stderr ?? ''}`;
const num = (label) => {
	const match = suiteOut.match(new RegExp(`^# ${label} (\\d+)$`, 'm'));
	return match ? Number(match[1]) : null;
};
const suiteSummary = {
	command: `node --test packages/workflow-lego/test/{06,07,08}-*.test.ts`,
	tests: num('tests'),
	pass: num('pass'),
	fail: num('fail'),
	exitCode: suite.status,
	durationMs: suiteDurationMs,
};

check('G1', 'localization test suites pass (4C runtime + 4E envelope + 4F run path)', () => {
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

/* --- G8/G9: Phase 4D surface promotion + runnable CLI ----------------------------------- */

/** Parse the `export { … } from '<specifier>'` blocks of a TS file (text-level, like gate 5). */
const exportBlocks = (source) => {
	const blocks = [];
	const re = /export\s*\{([\s\S]*?)\}\s*from\s*'([^']+)'/g;
	let match;
	while ((match = re.exec(source)) !== null) {
		const names = match[1]
			.split(',')
			.map((n) => n.trim())
			.filter((n) => n !== '')
			.map((n) => ({ text: n, typeOnly: n.startsWith('type '), name: n.replace(/^type\s+/, '') }));
		blocks.push({ names, specifier: match[2] });
	}
	return blocks;
};

const indexSource = readFileSync(join(ROOT, 'packages', 'workflow-lego', 'src', 'index.ts'), 'utf8');
const blocks = exportBlocks(indexSource);
const promoted = new Set();
for (const block of blocks) {
	if (
		block.specifier === './localization-runtime' ||
		block.specifier === './backend-localization-service' ||
		block.specifier === './localization-envelope' ||
		block.specifier === './localization-vocabulary' ||
		block.specifier === './execution-log-record' ||
		block.specifier === './api-error-response'
	) {
		for (const entry of block.names) promoted.add(`${entry.typeOnly ? 'type ' : ''}${entry.name}`);
	}
}
const runtimeValues = Object.keys(runtimeModule).filter((k) => k !== 'default');
const serviceValues = Object.keys(serviceModule).filter((k) => k !== 'default');
const envelopeValues = Object.keys(envelopeModule).filter((k) => k !== 'default');
const phase4fModules = {
	'localization-vocabulary.ts': vocabularyModule,
	'execution-log-record.ts': recordModule,
	'api-error-response.ts': apiModule,
};
const phase4fValues = Object.values(phase4fModules).flatMap((m) => Object.keys(m).filter((k) => k !== 'default'));
const promotedTypes = [...promoted].filter((n) => n.startsWith('type ')).map((n) => n.slice(5));

/** Declared type/class symbols of a module, read from its source (no tsc in this sandbox). */
const declaredTypes = (file) => {
	const source = readFileSync(join(ROOT, 'packages', 'workflow-lego', 'src', file), 'utf8');
	return new Set(
		[...source.matchAll(/export\s+(?:declare\s+)?(?:abstract\s+)?(?:interface|type|class|enum)\s+([A-Za-z0-9_]+)/g)].map(
			(m) => m[1],
		),
	);
};

check('G8', 'Phase 4D: index.ts re-exports every runtime symbol of the localization line', () => {
	for (const name of [...runtimeValues, ...serviceValues, ...envelopeValues, ...phase4fValues]) {
		assert(promoted.has(name), `src/index.ts does not re-export runtime symbol "${name}"`);
	}
	assert(
		promoted.has('Direction') || promoted.has('type Direction'),
		'src/index.ts does not re-export the Direction type',
	);
	assert(
		![...blocks].some((b) => b.specifier.includes('settings-localization-adapter')),
		'the UI-phase module (settings-localization-adapter) must not enter the package surface',
	);
	const declared = new Set([
	...declaredTypes('localization-runtime.ts'),
	...declaredTypes('backend-localization-service.ts'),
	...declaredTypes('localization-envelope.ts'),
	...declaredTypes('localization-vocabulary.ts'),
	...declaredTypes('execution-log-record.ts'),
	...declaredTypes('api-error-response.ts'),
]);
	for (const name of promotedTypes) {
		assert(declared.has(name), `src/index.ts promotes type "${name}" which the module does not declare`);
	}
	return `${runtimeValues.length + serviceValues.length + envelopeValues.length + phase4fValues.length} runtime + ${promotedTypes.length} type symbols promoted`;
});

check('G9', 'the promoted surface is runnable from a checkout (localization-inspect)', () => {
	const cli = join(ROOT, 'tools', 'localization-inspect.mjs');
	const run = spawnSync(process.execPath, [cli, '--json', '--lang', 'jv', '--key', 'node.error'], {
		cwd: ROOT,
		encoding: 'utf8',
	});
	assert(run.status === 0, `inspect exited ${run.status}: ${run.stderr}`);
	const payload = JSON.parse(run.stdout);
	assert(payload.locale === 'jv', `locale ${payload.locale}`);
	assert(payload.value === NATIVE_DICTIONARIES['jv']['node.error'], `value ${payload.value}`);
	assert(payload.direction === 'ltr', `direction ${payload.direction}`);
	const bad = spawnSync(process.execPath, [cli, '--lang', 'de', '--key', 'settings.title'], {
		cwd: ROOT,
		encoding: 'utf8',
	});
	assert(bad.status === 2, `an unsupported locale must exit 2, got ${bad.status}`);
	assert(/unsupported locale "de"/.test(bad.stderr), `stderr: ${bad.stderr}`);
	return `${runtimeValues.length} symbols loadable, unknown locale rejected with exit 2`;
});

/* --- G10/G11: Phase 4E envelope ---------------------------------------------------------- */

const envelopeParity = envelopeModule.envelopeDictionaryParity('en');

check('G10', 'engine/API vocabulary: six locales, identical key sets, no empty values', () => {
	assert(envelopeParity.consistent, `inconsistent vocabulary: ${JSON.stringify(envelopeParity)}`);
	for (const locale of SUPPORTED_LOCALE_CODES) {
		assert((envelopeParity.missingByLocale[locale] ?? []).length === 0, `missing keys in ${locale}`);
		assert((envelopeParity.extraByLocale[locale] ?? []).length === 0, `extra keys in ${locale}`);
	}
	assert(
		JSON.stringify([...envelopeModule.envelopeLocales()]) === JSON.stringify([...SUPPORTED_LOCALE_CODES]),
		'vocabulary locales do not cover the catalog exactly',
	);
	const keys = envelopeModule.extensionKeys('en');
	assert(keys.length >= 10, `only ${keys.length} vocabulary keys`);
	for (const locale of SUPPORTED_LOCALE_CODES) {
		const rt = envelopeModule.createEnvelopeRuntime({ localeSource: { getLocale: () => locale } });
		for (const key of keys) {
			assert(rt.t(key, { count: 1, ms: 5 }, locale) !== key, `${locale}:${key} untranslated`);
		}
		assert(rt.getMissingKeys().length === 0, `${locale}: unexpected diagnostics ${rt.getMissingKeys()}`);
	}
	return `${keys.length} keys x ${SUPPORTED_LOCALE_CODES.length} locales`;
});

check('G10b', 'run envelope: shape, direction and API error coverage', () => {
	const rt = envelopeModule.createEnvelopeRuntime({ localeSource: { getLocale: () => 'id' } });
	const envelope = envelopeModule.buildRunEnvelope(
		{
			executionId: 'GATE-EX',
			workflowName: 'gate',
			status: 'success',
			nodes: [
				{ nodeName: 'Webhook', status: 'success', itemCount: 3, durationMs: 12 },
				{ nodeName: 'Code', status: 'error' },
			],
			itemCount: 3,
			durationMs: 25,
		},
		rt,
	);
	assert(envelope.locale === 'id' && envelope.direction === 'ltr', `locale/direction ${envelope.locale}/${envelope.direction}`);
	assert(envelope.message === 'Eksekusi selesai', `message ${envelope.message}`);
	assert(envelope.labels.items === '3 item' && envelope.labels.nodes === '2 node', `labels ${JSON.stringify(envelope.labels)}`);
	assert(envelope.nodeLines[1] === '[Code] Gagal dieksekusi', `node line ${envelope.nodeLines[1]}`);
	assert(envelope.diagnostics.missingKeys.length === 0, `diagnostics ${envelope.diagnostics.missingKeys}`);

	const ar = envelopeModule.buildRunEnvelope(
		{ executionId: 'GATE-EX-AR', workflowName: 'gate', status: 'error', locale: 'ar' },
		envelopeModule.createEnvelopeRuntime(),
	);
	assert(ar.direction === 'rtl', `arabic direction ${ar.direction}`);

	for (const code of envelopeModule.API_ERROR_CODES) {
		const localized = envelopeModule.localizeApiError(code, envelopeModule.createEnvelopeRuntime());
		assert(localized.fallbackUsed === false, `api error ${code} fell back`);
		assert(localized.message !== code, `api error ${code} returned the raw code`);
	}
	const unknown = envelopeModule.localizeApiError('teapot', rt);
	assert(unknown.fallbackUsed === true && unknown.message === 'teapot', 'unknown codes must be echoed');
	return `${envelope.nodeLines.length} node lines, ${envelopeModule.API_ERROR_CODES.length} API error codes`;
});

check('G11', 'envelope module boundary: only the two in-package collaborators', () => {
	const source = readFileSync(join(ROOT, 'packages', 'workflow-lego', 'src', 'localization-envelope.ts'), 'utf8');
	const specifiers = [...source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g)].map((m) => m[1]);
	assert(
		JSON.stringify([...specifiers].sort()) ===
			JSON.stringify(['./backend-localization-service.ts', './localization-runtime.ts']),
		`unexpected imports: ${specifiers.join(', ')}`,
	);
	assert(!/process\.env/.test(source), 'the envelope layer must not read the environment directly');
	return `imports: ${specifiers.join(', ')}`;
});

/* --- G12/G13/G14: Phase 4F run path ------------------------------------------------------ */

check('G12', 'execution-log record: reference field names, derived duration, localized block', () => {
	const rt = vocabularyModule.createProductRuntime({ localeSource: { getLocale: () => 'id' } });
	const record = recordModule.buildExecutionLogRecord(
		{
			executionId: 'GATE-EX',
			workflowId: 'GATE-WF',
			workflowName: 'gate',
			mode: 'webhook',
			status: 'success',
			startedAt: '2026-09-17T10:00:00.000Z',
			stoppedAt: '2026-09-17T10:00:00.025Z',
			nodes: [
				{ nodeName: 'Webhook', status: 'success', itemCount: 3, durationMs: 12 },
				{ nodeName: 'Code', status: 'success' },
			],
			itemCount: 3,
		},
		rt,
	);
	assert(record.durationMs === 25, `derived duration ${record.durationMs}`);
	assert(record.localized.locale === 'id' && record.localized.direction === 'ltr', 'locale/direction');
	assert(record.localized.summary === 'Selesai dalam 25 ms — 2 node, 3 item', `summary ${record.localized.summary}`);
	assert(record.localized.trigger === 'Dipicu webhook', `trigger ${record.localized.trigger}`);
	assert(record.localized.nodeLines.length === 2, 'node lines');
	assert(record.localized.missingKeys.length === 0, `diagnostics ${record.localized.missingKeys}`);
	const arabic = recordModule.buildExecutionLogRecord(
		{
			executionId: 'GATE-EX-AR',
			workflowId: 'GATE-WF',
			workflowName: 'gate',
			mode: 'schedule',
			status: 'error',
			startedAt: '2026-09-17T10:00:00.000Z',
			stoppedAt: '2026-09-17T10:00:02.000Z',
			locale: 'ar',
		},
		vocabularyModule.createProductRuntime(),
	);
	assert(arabic.localized.direction === 'rtl', `arabic direction ${arabic.localized.direction}`);
	assert(arabic.localized.trigger === 'تم التشغيل بالجدولة', `arabic trigger ${arabic.localized.trigger}`);
	return `${record.nodeRuns.length} node runs, summary + trigger localized, deterministic`;
});

check('G13', 'API responses: reference-exact statuses/bodies with localized text', () => {
	const expectedStatus = { badRequest: 400, unauthorized: 401, notFound: 404, conflict: 409, internal: 500 };
	assert(
		JSON.stringify(apiModule.HTTP_STATUS_BY_ERROR_CODE) === JSON.stringify(expectedStatus),
		`status map ${JSON.stringify(apiModule.HTTP_STATUS_BY_ERROR_CODE)}`,
	);
	for (const code of envelopeModule.API_ERROR_CODES) {
		for (const locale of SUPPORTED_LOCALE_CODES) {
			const response = apiModule.buildApiErrorResponse(
				{ code },
				vocabularyModule.createProductRuntime({ localeSource: { getLocale: () => locale } }),
			);
			assert(response.statusCode === expectedStatus[code], `${code}/${locale} status`);
			assert(response.body.code === code, `${code}/${locale} body.code`);
			assert(response.body.message !== code, `${code}/${locale} message not localized`);
			assert(/^[^\u0000-\u007F]*$|./.test(response.body.message), 'message present');
			const hintKey = apiModule.HINT_KEY_BY_ERROR_CODE[code];
			if (hintKey === null) assert(response.body.hint === undefined, `${code} must not carry a hint`);
			else assert(typeof response.body.hint === 'string' && response.body.hint !== hintKey, `${code} hint`);
		}
	}
	const generic = apiModule.buildApiErrorResponse(
		{ code: 'teapot' },
		vocabularyModule.createProductRuntime({ localeSource: { getLocale: () => 'ru' } }),
	);
	assert(generic.statusCode === 500 && generic.body.code === 0, `generic shape ${JSON.stringify(generic.body)}`);
	assert(generic.localized.rawCode === 'teapot', 'the raw code must survive');
	const success = apiModule.buildApiSuccessResponse({ ok: true });
	assert(success.statusCode === 200 && 'data' in success.body, 'success envelope { data }');

	// Reference numeric code (`code: <errorCode || httpStatusCode>`) must survive untouched.
	const numeric = apiModule.buildApiErrorResponse({ code: 401, httpStatusCode: 401, rawMessage: 'Wrong username or password. Do you have caps lock on?' });
	assert(numeric.statusCode === 401 && numeric.body.code === 401, `numeric code ${JSON.stringify(numeric.body)}`);
	assert(numeric.body.message === 'Wrong username or password. Do you have caps lock on?', 'caller message wins');
	const golden = JSON.parse(
		readFileSync(join(ROOT, 'tests', 'reference', 'agent-4', 'golden', 'api.golden.json'), 'utf8'),
	);
	const goldenLogin = golden.cases.loginWrongPassword.expected;
	assert(
		JSON.stringify(numeric.body) === JSON.stringify(goldenLogin.body) && numeric.statusCode === goldenLogin.status,
		`golden login payload ${JSON.stringify(goldenLogin.body)}`,
	);
	assert(
		apiModule.buildHealthResponse('ready', undefined, 'en').body.status === golden.cases.healthz.expected.body.status,
		'health machine field matches the golden',
	);
	const health = apiModule.buildHealthResponse('ready', undefined, 'en');
	assert(health.body.status === 'ok' && health.body.label === 'Healthy', `health ${JSON.stringify(health)}`);
	const notReady = apiModule.buildHealthResponse('not-ready', undefined, 'en');
	assert(notReady.statusCode === 503 && notReady.body.status === 'error', 'readiness failure shape');
	return `${envelopeModule.API_ERROR_CODES.length} codes x ${SUPPORTED_LOCALE_CODES.length} locales + success/health + golden login payload`;
});

check('G14', 'product vocabulary: parity, no key collisions, run-path modules stay in-package', () => {
	const keys = vocabularyModule.productKeys('en');
	assert(keys.length >= 10, `only ${keys.length} product keys`);
	const product4b = new Set(Object.keys(NATIVE_DICTIONARIES['en']));
	const engine4e = new Set(Object.keys(envelopeModule.ENVELOPE_DICTIONARY_EXTENSION['en']));
	for (const key of keys) {
		assert(!product4b.has(key), `product key ${key} collides with Phase 4B`);
		assert(!engine4e.has(key), `product key ${key} collides with Phase 4E`);
	}
	for (const locale of SUPPORTED_LOCALE_CODES) {
		const localeKeys = vocabularyModule.productKeys(locale);
		assert(JSON.stringify([...localeKeys].sort()) === JSON.stringify([...keys].sort()), `key drift in ${locale}`);
		for (const key of keys) {
			const value = vocabularyModule.PRODUCT_DICTIONARY_EXTENSION[locale]?.[key];
			assert(typeof value === 'string' && value.trim() !== '', `${locale}:${key} empty`);
		}
	}
	for (const [file, module] of Object.entries(phase4fModules)) {
		const source = readFileSync(join(ROOT, 'packages', 'workflow-lego', 'src', file), 'utf8');
		const specifiers = [...source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g)].map((m) => m[1]);
		for (const specifier of specifiers) {
			assert(specifier.startsWith('./') && specifier.endsWith('.ts'), `${file} imports ${specifier}`);
		}
		assert(!/process\.env|Date\.now\(\)|new Date\(\)|globalThis/.test(source), `${file} is not self-contained`);
		void module;
	}
	return `${keys.length} product keys x ${SUPPORTED_LOCALE_CODES.length} locales, ${Object.keys(phase4fModules).length} modules checked`;
});

/* --- G15: catalogue ownership / superset tolerance --------------------------------------- */

check('G15', 'catalogue ownership: a superset 4B keeps its keys, divergence is reported', () => {
	const envelopeOverlay = envelopeModule.ENVELOPE_DICTIONARY_EXTENSION;
	const real = vocabularyModule.catalogueOverlaps(envelopeOverlay);
	assert(
		real.every((o) => o.identical),
		`overlay/catalogue divergence: ${JSON.stringify(real.filter((o) => !o.identical))}`,
	);

	// Prove the rule (and this check) can go red, with a catalogue that already owns an overlay key.
	const grown = {
		translate: (key, locale) => (key === 'execution.started' ? { en: 'Started (catalogue)' }[locale] ?? key : key),
	};
	const overlaps = vocabularyModule.catalogueOverlaps(envelopeOverlay, grown);
	assert(
		overlaps.length === 1 && overlaps[0].key === 'execution.started' && overlaps[0].identical === false,
		`grown-catalogue overlap not reported: ${JSON.stringify(overlaps)}`,
	);
	const runtime = vocabularyModule.createProductRuntime({ dictionaries: grown, localeSource: { getLocale: () => 'en' } });
	assert(runtime.t('execution.started') === 'Started (catalogue)', 'the catalogue must win, not the overlay');
	assert(runtime.t('execution.failed') !== 'execution.failed', 'gaps are still filled');
	return `${real.length} overlaps with the current 4B, rule proven against a grown catalogue`;
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
		'packages/workflow-lego/src/localization-envelope.ts (phase 4E)',
		'packages/workflow-lego/src/localization-vocabulary.ts (phase 4F)',
		'packages/workflow-lego/src/execution-log-record.ts (phase 4F)',
		'packages/workflow-lego/src/api-error-response.ts (phase 4F)',
		'packages/workflow-lego/src/localization-vocabulary.ts (phase 4G: catalogue ownership)',
	],
	localizationTestFiles: [
		'packages/workflow-lego/test/06-localization-runtime.test.ts',
		'packages/workflow-lego/test/07-localization-envelope.test.ts',
		'packages/workflow-lego/test/08-localization-run-path.test.ts',
	],
	locales: [...SUPPORTED_LOCALE_CODES],
	vocabulary: {
		engineKeys: envelopeModule.extensionKeys('en').length,
		productKeys: vocabularyModule.productKeys('en').length,
		locales: [...envelopeModule.envelopeLocales()],
		apiErrorCodes: [...envelopeModule.API_ERROR_CODES],
	},
	promotedSymbols: [...promoted].sort(),
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
