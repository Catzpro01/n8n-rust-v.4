/**
 * Phase 4C — Native Localization Runtime tests (Gate 6).
 *
 * Machine-verified properties asserted here:
 *   L1  BCP-47 normalization + legacy aliases (`in`, `jw`, `cmn`, `zh-Hans-CN`)
 *   L2  resolution chain: explicit -> settings/environment -> fallback, with fail-safe degradation
 *   L3  strictness: `setLocale()` raises `UnsupportedLocaleError`, a source value never throws
 *   L4  dictionary parity across all six Phase 4B locales (no key silently missing)
 *   L5  catalog <-> Phase 4B `SUPPORTED_LOCALES` parity (drift gate between contract and data)
 *   L6  real translations for all six languages (1:1 with the Phase 4B dictionaries)
 *   L7  interpolation (`{n}` and `{{ n }}`), unknown placeholders preserved
 *   L8  direction (Arabic = rtl), RTL survives locale switches
 *   L9  overlay keys are additive and never mutate the Phase 4B dictionary
 *   L10 missing-key diagnostics are de-duplicated, sorted and resettable
 *   L11 engine status mapping (success/error translated, unknown status diagnosed, not invented)
 *   L12 determinism: runtime is instance-scoped and does not read/write the Phase 4B static locale
 *
 * Run: node --test packages/workflow-lego/test/06-localization-runtime.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ENGINE_STATUS_OVERLAY,
	FALLBACK_LOCALE,
	LOCALE_CATALOG,
	LocalizationRuntime,
	STATUS_MESSAGE_KEYS,
	SUPPORTED_LOCALE_CODES,
	UnsupportedLocaleError,
	type ExecutionStatus,
	createLocalizationRuntime,
	dictionaryParity,
	directionOf,
	describeLocale,
	firstResolvingSource,
	fromConstant,
	fromEnvironment,
	fromSettingsState,
	hasUnfilledPlaceholder,
	interpolate,
	isSupportedLocale,
	normalizeLocale,
} from '../src/localization-runtime.ts';
import {
	NATIVE_DICTIONARIES,
	NativeLocalizationService,
	SUPPORTED_LOCALES,
} from '../src/backend-localization-service.ts';

/* --- shared collaborators ---------------------------------------------------------------- */

const service = NativeLocalizationService;

const runtime = (options: Parameters<typeof createLocalizationRuntime>[0] = {}) =>
	createLocalizationRuntime({ dictionaries: service, ...options });

const EXPECTED = {
	id: 'Pengaturan',
	en: 'Settings',
	jv: 'Setelan',
	ar: 'الإعدادات',
	zh: '设置',
	ru: 'Настройки',
} as const;

/* --- L1 normalization ------------------------------------------------------------------- */

test('L1 normalizeLocale folds case, separator and subtags', () => {
	assert.equal(normalizeLocale('id'), 'id');
	assert.equal(normalizeLocale('  ID_id  '), 'id');
	assert.equal(normalizeLocale('en-GB'), 'en');
	assert.equal(normalizeLocale('zh-Hans-CN'), 'zh');
	assert.equal(normalizeLocale('ar-SA'), 'ar');
	assert.equal(normalizeLocale('ru-RU'), 'ru');
	assert.equal(normalizeLocale('jv-ID'), 'jv');
});

test('L1 legacy/endonym aliases resolve to the canonical code', () => {
	assert.equal(normalizeLocale('in'), 'id', 'ISO-639 legacy code for Indonesian');
	assert.equal(normalizeLocale('bahasa'), 'id');
	assert.equal(normalizeLocale('jw'), 'jv', 'ISO-639 legacy code for Javanese');
	assert.equal(normalizeLocale('cmn'), 'zh');
	assert.equal(normalizeLocale('mandarin'), 'zh');
	assert.equal(normalizeLocale('ara'), 'ar');
});

test('L1 unknown or malformed input resolves to null, never a guess', () => {
	for (const bad of ['de', 'xx', 'klingon', '', '   ', '-', '--', null, undefined, 42 as unknown as string]) {
		assert.equal(normalizeLocale(bad), null, `expected null for ${String(bad)}`);
	}
	assert.equal(isSupportedLocale('id-ID'), true);
	assert.equal(isSupportedLocale('de-DE'), false);
});

/* --- L2 resolution chain ---------------------------------------------------------------- */

test('L2 explicit locale wins over the source; source wins over the fallback', () => {
	const rt = runtime({ localeSource: fromConstant('jv'), fallbackLocale: 'id' });
	assert.equal(rt.getLocale(), 'jv');
	assert.equal(rt.resolveLocale('ar'), 'ar');
	assert.equal(rt.describe('ru').code, 'ru');
});

test('L2 a broken or unknown source degrades to the fallback instead of failing the run', () => {
	assert.equal(runtime({ localeSource: fromConstant('de'), fallbackLocale: 'id' }).getLocale(), 'id');
	assert.equal(runtime({ localeSource: fromConstant(''), fallbackLocale: 'id' }).getLocale(), 'id');
	assert.equal(
		runtime({
			localeSource: {
				getLocale: () => {
					throw new Error('settings store offline');
				},
			},
			fallbackLocale: 'jv',
		}).getLocale(),
		'jv',
	);
});

test('L2 fromSettingsState adapts the Phase 4A settings object without coupling to it', () => {
	const adapter = { getState: () => ({ currentLanguage: 'en' }) };
	const rt = runtime({ localeSource: fromSettingsState(adapter), fallbackLocale: 'id' });
	assert.equal(rt.getLocale(), 'en');
	assert.equal(runtime({ localeSource: fromSettingsState(adapter) }).t('settings.title'), 'Settings');
	assert.equal(
		runtime({
			localeSource: fromSettingsState({
				getState: () => {
					throw new Error('corrupt settings');
				},
			}),
			fallbackLocale: 'id',
		}).getLocale(),
		'id',
	);
});

test('L2 fromEnvironment reads N8N_DEFAULT_LOCALE, then LANG', () => {
	assert.equal(runtime({ localeSource: fromEnvironment({ N8N_DEFAULT_LOCALE: 'jv', LANG: 'ru_RU' }) }).getLocale(), 'jv');
	assert.equal(runtime({ localeSource: fromEnvironment({ LANG: 'ru_RU' }) }).getLocale(), 'ru');
	assert.equal(runtime({ localeSource: fromEnvironment({}), fallbackLocale: 'id' }).getLocale(), 'id');
});

test('L2 firstResolvingSource skips broken and unknown sources', () => {
	const chain = firstResolvingSource(
		{
			getLocale: () => {
				throw new Error('down');
			},
		},
		fromConstant('xx-YY'),
		fromConstant('ar-EG'),
	);
	assert.equal(runtime({ localeSource: chain }).getLocale(), 'ar');
	assert.equal(firstResolvingSource(fromConstant('xx')).getLocale(), null);
});

/* --- L3 strictness ---------------------------------------------------------------------- */

test('L3 setLocale is strict: an unknown tag raises UnsupportedLocaleError with the input', () => {
	const rt = runtime();
	assert.equal(rt.setLocale('JV_id'), 'jv');
	const error = (() => {
		try {
			rt.setLocale('de-DE');
			return null;
		} catch (caught) {
			return caught as UnsupportedLocaleError;
		}
	})();
	assert.ok(error instanceof UnsupportedLocaleError, 'expected UnsupportedLocaleError');
	assert.equal(error.input, 'de-DE');
	assert.deepEqual([...error.supported], [...SUPPORTED_LOCALE_CODES]);
	assert.match(error.message, /Unsupported locale "de-DE"/);
	assert.equal(rt.getLocale(), 'jv', 'a rejected setLocale leaves the locale untouched');
});

/* --- L4/L5 parity ----------------------------------------------------------------------- */

test('L4 every Phase 4B dictionary has exactly the same key set as English', () => {
	const parity = dictionaryParity(NATIVE_DICTIONARIES, 'en');
	assert.equal(parity.consistent, true, JSON.stringify(parity));
	assert.deepEqual(parity.missingByLocale, Object.fromEntries(parity.locales.map((l) => [l, []])));
	assert.deepEqual(parity.extraByLocale, Object.fromEntries(parity.locales.map((l) => [l, []])));
	assert.deepEqual(parity.emptyValues, []);
});

test('L4 dictionaryParity reports a missing key instead of hiding it', () => {
	const report = dictionaryParity(
		{ en: { a: 'A', b: 'B' }, jv: { a: 'A', b: '' } },
		'en',
	);
	assert.equal(report.consistent, false);
	assert.deepEqual(report.missingByLocale['jv'], []);
	assert.deepEqual(report.emptyValues, ['jv:b']);
	const missing = dictionaryParity({ en: { a: 'A', b: 'B' }, jv: { a: 'A' } }, 'en');
	assert.deepEqual(missing.missingByLocale['jv'], ['b']);
	assert.throws(() => dictionaryParity({ jv: {} }, 'en'), /reference locale "en" is absent/);
});

test('L5 the runtime catalog equals the Phase 4B SUPPORTED_LOCALES table', () => {
	const fromService = Object.values(SUPPORTED_LOCALES)
		.map((l) => `${l.code}|${l.name}|${l.nativeName}|${l.direction}`)
		.sort();
	const fromCatalog = LOCALE_CATALOG.map((l) => `${l.code}|${l.name}|${l.nativeName}|${l.direction}`).sort();
	assert.deepEqual(fromCatalog, fromService);
	assert.deepEqual([...SUPPORTED_LOCALE_CODES], Object.keys(NATIVE_DICTIONARIES));
	assert.deepEqual([...SUPPORTED_LOCALE_CODES], Object.keys(SUPPORTED_LOCALES));
});

/* --- L6 real translations --------------------------------------------------------------- */

test('L6 the six native languages translate the same key with their own string', () => {
	const rt = runtime();
	for (const [locale, expected] of Object.entries(EXPECTED)) {
		assert.equal(rt.t('settings.title', undefined, locale), expected, `locale ${locale}`);
	}
});

test('L6 every catalog locale translates every key to a non-empty value', () => {
	const rt = runtime();
	for (const locale of SUPPORTED_LOCALE_CODES) {
		for (const key of Object.keys(NATIVE_DICTIONARIES['en'])) {
			const value = rt.t(key, undefined, locale);
			assert.equal(typeof value, 'string');
			assert.notEqual(value.trim(), '', `${locale}:${key} is empty`);
			assert.notEqual(value, key, `${locale}:${key} fell back to the raw key`);
			assert.equal(rt.has(key, locale), true, `${locale}:${key} reported as missing`);
		}
	}
});

/* --- L7 interpolation ------------------------------------------------------------------- */

test('L7 interpolation supports {x} and {{ x }} forms', () => {
	assert.equal(interpolate('node {name} took {ms}ms', { name: 'Set', ms: 12 }), 'node Set took 12ms');
	assert.equal(interpolate('node {{ name }} took {{ms}}ms', { name: 'Set', ms: 12 }), 'node Set took 12ms');
	assert.equal(interpolate('flag={on}', { on: false }), 'flag=false');
});

test('L7 unknown or null params keep the placeholder visible', () => {
	assert.equal(interpolate('node {name} took {ms}ms', { name: 'Set' }), 'node Set took {ms}ms');
	assert.equal(interpolate('a {x} b', { x: null }), 'a {x} b');
	assert.equal(interpolate('no params here'), 'no params here');
	assert.equal(hasUnfilledPlaceholder('node {name}'), true);
	assert.equal(hasUnfilledPlaceholder('node Set'), false);
});

test('L7 runtime translates then interpolates', () => {
	const rt = runtime({ overlay: { id: { 'run.summary': 'Node {name} selesai: {count} item' } } });
	assert.equal(
		rt.t('run.summary', { name: 'Webhook', count: 3 }, 'id'),
		'Node Webhook selesai: 3 item',
	);
});

/* --- L8 direction ----------------------------------------------------------------------- */

test('L8 Arabic is rtl, the other five locales are ltr', () => {
	assert.equal(directionOf('ar'), 'rtl');
	assert.equal(directionOf('ar-SA'), 'rtl');
	for (const locale of ['id', 'en', 'jv', 'zh', 'ru']) {
		assert.equal(directionOf(locale), 'ltr', locale);
	}
	assert.equal(directionOf('de'), 'ltr', 'unknown locales never crash a renderer');
	const rt = runtime();
	assert.equal(rt.getDirection('ar'), 'rtl');
	assert.equal(rt.getDirection('zh'), 'ltr');
});

test('L8 direction follows the active locale and the snapshot reports it', () => {
	const rt = runtime({ overlay: { ar: { 'settings.title': 'الإعدادات' } } });
	rt.setLocale('ar');
	assert.equal(rt.snapshot().direction, 'rtl');
	assert.equal(rt.snapshot().locale, 'ar');
	rt.setLocale('ru');
	assert.equal(rt.snapshot().direction, 'ltr');
	assert.deepEqual([...rt.snapshot().supportedLocales], [...SUPPORTED_LOCALE_CODES]);
});

/* --- L9 overlay isolation --------------------------------------------------------------- */

test('L9 overlay keys are additive and never mutate the Phase 4B dictionary', () => {
	const before = JSON.stringify(NATIVE_DICTIONARIES);
	const rt = runtime({ overlay: { jv: { 'queue.idle': 'Antrean nganggur' } } });
	assert.equal(rt.t('queue.idle', undefined, 'jv'), 'Antrean nganggur');
	assert.equal(service.translate('queue.idle', 'jv'), 'queue.idle', 'service still returns the raw key');
	assert.equal(JSON.stringify(NATIVE_DICTIONARIES), before, 'dictionary object was mutated');
	assert.equal(rt.t('queue.idle', undefined, 'en'), 'queue.idle', 'overlay must not leak across locales');
});

test('L9 overlay wins over the dictionary owner for the same key', () => {
	const rt = runtime({ overlay: { en: { 'settings.title': 'Preferences' } } });
	assert.equal(rt.t('settings.title', undefined, 'en'), 'Preferences');
	assert.equal(rt.t('settings.title', undefined, 'id'), 'Pengaturan', 'other locales untouched');
});

/* --- L10 diagnostics -------------------------------------------------------------------- */

test('L10 unknown keys fall back to the key itself and are recorded once, sorted', () => {
	const rt = runtime();
	assert.equal(rt.t('does.not.exist'), 'does.not.exist');
	assert.equal(rt.t('does.not.exist'), 'does.not.exist');
	assert.equal(rt.t('another.missing'), 'another.missing');
	assert.deepEqual([...rt.getMissingKeys()], ['another.missing', 'does.not.exist']);
	const snapshot = rt.snapshot();
	assert.deepEqual([...snapshot.missingKeys], ['another.missing', 'does.not.exist']);
	rt.resetDiagnostics();
	assert.deepEqual([...rt.getMissingKeys()], []);
});

test('L10 a throwing dictionary is diagnosed, not propagated', () => {
	const rt = createLocalizationRuntime({
		dictionaries: {
			translate: () => {
				throw new Error('dictionary exploded');
			},
		},
		fallbackLocale: 'id',
	});
	assert.equal(rt.t('settings.title'), 'settings.title');
	assert.deepEqual([...rt.getMissingKeys()], ['settings.title']);
	assert.equal(rt.getLocale(), 'id');
});

/* --- L11 engine status mapping ---------------------------------------------------------- */

test('L11 success/error map to the translated Phase 4B messages', () => {
	const rt = runtime();
	assert.equal(rt.tStatus('success', undefined, 'en'), 'Execution succeeded');
	assert.equal(rt.tStatus('error', undefined, 'id'), 'Gagal dieksekusi');
	assert.equal(rt.tStatus('success', undefined, 'ar'), 'تم التنفيذ بنجاح');
});

test('L11 every status key the runtime can emit resolves in all six locales', () => {
	const rt = runtime();
	for (const [status, key] of Object.entries(STATUS_MESSAGE_KEYS)) {
		const shipped = typeof NATIVE_DICTIONARIES['en'][key] === 'string';
		const overlaid = typeof ENGINE_STATUS_OVERLAY['en'][key] === 'string';
		assert.ok(
			shipped || overlaid,
			`status "${status}" points at "${key}" which neither Phase 4B nor the engine overlay ships`,
		);
		for (const locale of SUPPORTED_LOCALE_CODES) {
			const value = rt.tStatus(status as ExecutionStatus, undefined, locale);
			assert.notEqual(value, key, `${locale}:${key} was not translated`);
			assert.equal(rt.has(key, locale), true, `${locale}:${key} reported as missing`);
		}
	}
	assert.equal(rt.tStatus('running', undefined, 'jv'), 'Lagi dilakokake');
	assert.equal(rt.tStatus('waiting', undefined, 'ar'), 'في الانتظار');
	assert.equal(rt.tStatus('cancelled', undefined, 'ru'), 'Отменено');
});

test('L11 the engine overlay covers every locale with the same key set', () => {
	const keySets = Object.entries(ENGINE_STATUS_OVERLAY).map(([locale, keys]) => [
		locale,
		Object.keys(keys).sort(),
	]);
	const [, reference] = keySets[0];
	for (const [locale, keys] of keySets) {
		assert.deepEqual(keys, reference, `engine overlay drift in ${locale}`);
	}
	assert.deepEqual([...keySets.map(([l]) => l)].sort(), [...SUPPORTED_LOCALE_CODES].sort());
});

test('L11 a caller overlay can override an engine status string without mutating the default', () => {
	const before = JSON.stringify(ENGINE_STATUS_OVERLAY);
	const rt = runtime({ overlay: { en: { 'node.running': 'In progress' } } });
	assert.equal(rt.tStatus('running', undefined, 'en'), 'In progress');
	assert.equal(rt.tStatus('running', undefined, 'id'), 'Sedang dieksekusi');
	assert.equal(runtime().tStatus('running', undefined, 'en'), 'Running');
	assert.equal(JSON.stringify(ENGINE_STATUS_OVERLAY), before, 'ENGINE_STATUS_OVERLAY was mutated');
});

test('L11 an unmapped status is diagnosed instead of inventing text', () => {
	const rt = runtime();
	const value = rt.tStatus('skipped' as never, undefined, 'en');
	assert.equal(value, 'skipped', 'an unknown status is echoed, never invented');
	assert.deepEqual([...rt.getMissingKeys()], ['status.skipped']);
});

/* --- L12 determinism -------------------------------------------------------------------- */

test('L12 runtimes are instance-scoped: no cross-talk, no static locale leak', () => {
	const staticBefore = service.getLocale();
	const indonesian = runtime({ fallbackLocale: 'id' });
	const javanese = runtime({ localeSource: fromConstant('jv') });
	assert.equal(indonesian.t('settings.title'), 'Pengaturan');
	assert.equal(javanese.t('settings.title'), 'Setelan');
	assert.equal(indonesian.getLocale(), 'id', 'second runtime must not leak its locale');
	assert.equal(service.getLocale(), staticBefore, 'the Phase 4B static locale must stay untouched');

	indonesian.setLocale('ar');
	assert.equal(indonesian.getLocale(), 'ar');
	assert.equal(javanese.getLocale(), 'jv');
	assert.equal(service.getLocale(), staticBefore);
});

test('L12 describe() always returns catalog metadata, even for an unknown locale', () => {
	const rt = runtime({ fallbackLocale: 'zh' });
	assert.equal(describeLocale('ru-RU')?.nativeName, 'Русский');
	assert.equal(describeLocale('de'), null);
	assert.equal(rt.describe('de').code, 'zh', 'unknown locale falls back to the configured default');
	assert.equal(rt.describe().direction, 'ltr');
	assert.equal(runtime().describe().code, FALLBACK_LOCALE);
});

test('L12 the resolved locale is stable across repeated reads', () => {
	const rt = runtime({ localeSource: firstResolvingSource(fromConstant('jv'), fromConstant('id')) });
	assert.deepEqual([rt.getLocale(), rt.getLocale(), rt.getLocale()], ['jv', 'jv', 'jv']);
});
