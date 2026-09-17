/**
 * Phase 4E — Localization envelope tests (Gate 7).
 *
 * Machine-verified properties asserted here:
 *   E1  engine/API vocabulary parity across all six locales (no key missing, none empty)
 *   E2  every extension key resolves in every locale, without diagnostics
 *   E3  run envelope shape: locale, direction, messages, labels, node lines, diagnostics
 *   E4  per-node status lines, with and without item counts / durations
 *   E5  API error mapping for every declared code; unknown codes are echoed and diagnosed
 *   E6  isolation: the Phase 4B dictionaries are untouched and runtimes never share locale state
 *   E7  module boundary read from the source text: two relative imports, nothing else
 *   E8  determinism: identical input produces a byte-identical envelope
 *   E9  vocabulary coverage: the extension covers exactly the Phase 4B catalog locales
 *   E10 RTL survives the envelope, and an explicit per-run locale overrides the runtime
 *
 * Run: node --test packages/workflow-lego/test/07-localization-envelope.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ENVELOPE_DICTIONARY_EXTENSION,
	EXECUTION_LIFECYCLE,
	EXECUTION_MESSAGE_KEYS,
	API_ERROR_CODES,
	buildRunEnvelope,
	createEnvelopeRuntime,
	envelopeDictionaryParity,
	envelopeLocales,
	extensionKeys,
	localizeApiError,
	localizeNodeStatus,
	type NodeRunResult,
} from '../src/localization-envelope.ts';
import { SUPPORTED_LOCALE_CODES, normalizeLocale } from '../src/localization-runtime.ts';
import { NATIVE_DICTIONARIES, NativeLocalizationService } from '../src/backend-localization-service.ts';

const HERE = fileURLToPath(import.meta.url);
const PKG = join(HERE, '..', '..');

const ENVELOPE_LOCALES = ['id', 'en', 'jv', 'ar', 'zh', 'ru'] as const;

const sampleNodes: NodeRunResult[] = [
	{ nodeName: 'Webhook', status: 'success', itemCount: 3, durationMs: 12 },
	{ nodeName: 'Code', status: 'error' },
];

/* --- E1 vocabulary parity --------------------------------------------------------------- */

test('E1 the engine/API vocabulary is consistent across all six locales', () => {
	const report = envelopeDictionaryParity('en');
	assert.equal(report.consistent, true, JSON.stringify(report));
	assert.deepEqual(report.locales, [...ENVELOPE_LOCALES].sort());
	assert.deepEqual(report.emptyValues, []);
	for (const locale of ENVELOPE_LOCALES) {
		assert.deepEqual(report.missingByLocale[locale], [], `missing keys in ${locale}`);
		assert.deepEqual(report.extraByLocale[locale], [], `extra keys in ${locale}`);
	}
});

test('E1 extensionKeys() matches the table and never invents a locale', () => {
	const keys = extensionKeys('en');
	assert.equal(keys.length, 14);
	assert.deepEqual([...keys].sort(), Object.keys(ENVELOPE_DICTIONARY_EXTENSION['en']).sort());
	assert.deepEqual(extensionKeys('de'), [], 'an unknown locale has no keys, and does not throw');
});

/* --- E2 coverage ------------------------------------------------------------------------ */

test('E2 every extension key resolves in every locale and leaves no diagnostics', () => {
	for (const locale of SUPPORTED_LOCALE_CODES) {
		const rt = createEnvelopeRuntime({ localeSource: { getLocale: () => locale } });
		for (const key of extensionKeys('en')) {
			const value = rt.t(key, { count: 1, ms: 5 }, locale);
			assert.notEqual(value, key, `${locale}:${key} fell back to the key`);
			assert.notEqual(value.trim(), '', `${locale}:${key} is empty`);
			assert.equal(rt.has(key, locale), true, `${locale}:${key} reports as missing`);
		}
		assert.deepEqual([...rt.getMissingKeys()], [], `unexpected diagnostics in ${locale}`);
	}
});

/* --- E3 envelope shape ------------------------------------------------------------------ */

test('E3 the run envelope carries locale, direction, messages, labels and node lines', () => {
	const rt = createEnvelopeRuntime({ localeSource: { getLocale: () => 'id' } });
	const envelope = buildRunEnvelope(
		{
			executionId: 'EX-1',
			workflowName: 'SMOKETEST001TEST',
			status: 'success',
			nodes: sampleNodes,
			itemCount: 3,
			durationMs: 25,
		},
		rt,
	);

	assert.equal(envelope.executionId, 'EX-1');
	assert.equal(envelope.workflowName, 'SMOKETEST001TEST');
	assert.equal(envelope.status, 'success');
	assert.equal(envelope.locale, 'id');
	assert.equal(envelope.direction, 'ltr');
	assert.equal(envelope.message, 'Eksekusi selesai');
	assert.equal(envelope.messages.started, 'Eksekusi dimulai');
	assert.equal(envelope.messages.failed, 'Eksekusi gagal');
	assert.equal(envelope.labels.items, '3 item');
	assert.equal(envelope.labels.nodes, '2 node');
	assert.equal(envelope.labels.duration, '25 ms');
	assert.deepEqual(envelope.nodeLines, [
		'[Webhook] Berhasil dieksekusi (3 item, 12 ms)',
		'[Code] Gagal dieksekusi',
	]);
	assert.deepEqual([...envelope.diagnostics.missingKeys], []);
	assert.equal(envelope.fallbackLocale, 'en');
	assert.deepEqual([...envelope.supportedLocales], [...SUPPORTED_LOCALE_CODES]);
});

test('E3 optional labels are omitted, never replaced by a placeholder', () => {
	const rt = createEnvelopeRuntime();
	const envelope = buildRunEnvelope({ executionId: 'EX-2', workflowName: 'wf', status: 'running' }, rt);
	assert.equal(envelope.labels.items, undefined);
	assert.equal(envelope.labels.nodes, undefined);
	assert.equal(envelope.labels.duration, undefined);
	assert.equal(envelope.message, 'Execution started');
	assert.deepEqual([...envelope.nodeLines], []);
});

/* --- E4 node status lines --------------------------------------------------------------- */

test('E4 status lines combine the localized status with item count and duration', () => {
	const jv = createEnvelopeRuntime({ localeSource: { getLocale: () => 'jv' } });
	assert.equal(
		localizeNodeStatus({ nodeName: 'Webhook', status: 'success', itemCount: 3, durationMs: 12 }, jv).line,
		'[Webhook] Kasil dilakokake (3 item, 12 ms)',
	);
	const ar = createEnvelopeRuntime({ localeSource: { getLocale: () => 'ar' } });
	assert.equal(
		localizeNodeStatus({ nodeName: 'Code', status: 'error', itemCount: 1 }, ar).line,
		'[Code] فشل التنفيذ (1 عنصر)',
	);
});

test('E4 a run without counts renders a bare status line', () => {
	const rt = createEnvelopeRuntime({ localeSource: { getLocale: () => 'en' } });
	const line = localizeNodeStatus({ nodeName: 'Set', status: 'success' }, rt);
	assert.equal(line.line, '[Set] Execution succeeded');
	assert.equal(line.itemsText, undefined);
	assert.equal(line.durationText, undefined);
});

/* --- E5 API errors ---------------------------------------------------------------------- */

test('E5 every declared API error code has real text in every locale', () => {
	for (const code of API_ERROR_CODES) {
		for (const locale of SUPPORTED_LOCALE_CODES) {
			const rt = createEnvelopeRuntime();
			const localized = localizeApiError(code, rt, undefined, locale);
			assert.equal(localized.fallbackUsed, false, `${code}/${locale} fell back`);
			assert.notEqual(localized.message, code, `${code}/${locale} returned the raw code`);
			assert.equal(localized.messageKey, `api.error.${code}`);
			assert.notEqual(localized.message.trim(), '');
			assert.deepEqual([...rt.getMissingKeys()], []);
		}
	}
});

test('E5 an unknown API error code is echoed and diagnosed, never invented', () => {
	const rt = createEnvelopeRuntime({ localeSource: { getLocale: () => 'ru' } });
	const localized = localizeApiError('teapot', rt);
	assert.equal(localized.fallbackUsed, true);
	assert.equal(localized.message, 'teapot');
	assert.equal(localized.messageKey, 'api.error.teapot');
	assert.deepEqual([...rt.getMissingKeys()], ['api.error.teapot']);
});

test('E5 the health label is localized as well', () => {
	const rt = createEnvelopeRuntime();
	assert.deepEqual(
		SUPPORTED_LOCALE_CODES.map((locale) => rt.t('api.health.ok', undefined, locale)),
		['Sehat', 'Healthy', 'Sehat', 'سليم', '运行正常', 'Работает'],
	);
});

/* --- E6 isolation ----------------------------------------------------------------------- */

test('E6 the Phase 4B dictionaries are never mutated by the envelope layer', () => {
	const before = JSON.stringify(NATIVE_DICTIONARIES);
	const rt = createEnvelopeRuntime({ overlay: { en: { 'run.items': '{count} thing(s)' } } });
	assert.equal(rt.t('run.items', { count: 2 }, 'en'), '2 thing(s)');
	assert.equal(JSON.stringify(NATIVE_DICTIONARIES), before, 'dictionary object was mutated');
	assert.equal(NativeLocalizationService.translate('run.items', 'en'), 'run.items');
	assert.equal(
		createEnvelopeRuntime().t('run.items', { count: 2 }, 'en'),
		'2 item(s)',
		'the default vocabulary must stay intact',
	);
});

test('E6 envelope runtimes do not share locale state', () => {
	const id = createEnvelopeRuntime({ localeSource: { getLocale: () => 'id' } });
	const ru = createEnvelopeRuntime({ localeSource: { getLocale: () => 'ru' } });
	const first = buildRunEnvelope({ executionId: 'A', workflowName: 'wf', status: 'success' }, id);
	const second = buildRunEnvelope({ executionId: 'B', workflowName: 'wf', status: 'success' }, ru);
	assert.equal(first.locale, 'id');
	assert.equal(second.locale, 'ru');
	assert.equal(first.message, 'Eksekusi selesai');
	assert.equal(second.message, 'Выполнение завершено');
	assert.equal(NativeLocalizationService.getLocale(), 'id', 'the static 4B locale is untouched');
});

/* --- E7 module boundary ----------------------------------------------------------------- */

test('E7 the envelope module imports only the two in-package collaborators', () => {
	const source = readFileSync(join(PKG, 'src', 'localization-envelope.ts'), 'utf8');
	const specifiers = [
		...source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g),
	].map((m) => m[1]);
	assert.deepEqual([...specifiers].sort(), ['./backend-localization-service.ts', './localization-runtime.ts']);
	assert.doesNotMatch(source, /process\.env/, 'environment access must be injected, not read here');
	assert.doesNotMatch(source, /from 'node:|from '(fs|path|http|https)'/, 'no core-module coupling');
});

/* --- E8 determinism --------------------------------------------------------------------- */

test('E8 identical input produces a byte-identical envelope', () => {
	const rt = createEnvelopeRuntime({ localeSource: { getLocale: () => 'zh' } });
	const input = {
		executionId: 'EX-9',
		workflowName: 'wf',
		status: 'error' as const,
		nodes: sampleNodes,
		itemCount: 2,
		durationMs: 7,
	};
	const a = buildRunEnvelope(input, rt);
	const b = buildRunEnvelope(input, rt);
	assert.equal(JSON.stringify(a), JSON.stringify(b));
	const roundTripped = JSON.parse(JSON.stringify(a));
	assert.deepEqual(roundTripped, JSON.parse(JSON.stringify(b)), 'the envelope survives a JSON round-trip');
	assert.equal(typeof roundTripped.executionId, 'string');
	// only genuinely-absent optional labels disappear from the wire form (JSON has no `undefined`)
	assert.deepEqual(Object.keys(roundTripped.labels), ['items', 'nodes', 'duration']);
	assert.equal(a.labels.items, '2 个项目');
	assert.equal(a.nodeLines[1], '[Code] 执行失败');
});

/* --- E9 coverage vs the Phase 4B catalog ------------------------------------------------- */

test('E9 the vocabulary covers exactly the catalog locales — no more, no less', () => {
	assert.deepEqual([...envelopeLocales()], [...SUPPORTED_LOCALE_CODES]);
	for (const locale of Object.keys(ENVELOPE_DICTIONARY_EXTENSION)) {
		assert.notEqual(normalizeLocale(locale), null, `extension locale "${locale}" is not in the catalog`);
	}
});

test('E9 the lifecycle covers every status the runtime can emit', () => {
	assert.deepEqual([...EXECUTION_LIFECYCLE].sort(), ['cancelled', 'error', 'running', 'success', 'waiting']);
	for (const status of EXECUTION_LIFECYCLE) {
		assert.equal(typeof EXECUTION_MESSAGE_KEYS[status], 'string', `no message key for ${status}`);
	}
});

/* --- E10 RTL + explicit override -------------------------------------------------------- */

test('E10 RTL survives the envelope and an explicit locale overrides the runtime', () => {
	const rt = createEnvelopeRuntime({ localeSource: { getLocale: () => 'en' } });
	const arabic = buildRunEnvelope(
		{ executionId: 'EX-10', workflowName: 'wf', status: 'failed' === 'failed' ? 'error' : 'error', nodes: sampleNodes, locale: 'ar-ID' },
		rt,
	);
	assert.equal(arabic.locale, 'ar');
	assert.equal(arabic.direction, 'rtl');
	assert.equal(arabic.message, 'فشل التنفيذ');
	assert.equal(arabic.nodeLines[0], '[Webhook] تم التنفيذ بنجاح (3 عنصر, 12 م.ث)');

	const chinese = buildRunEnvelope({ executionId: 'EX-11', workflowName: 'wf', status: 'success', locale: 'zh-TW' }, rt);
	assert.equal(chinese.locale, 'zh');
	assert.equal(chinese.direction, 'ltr');
});
