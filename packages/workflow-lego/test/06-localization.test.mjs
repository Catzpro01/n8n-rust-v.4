/**
 * Phase 4B — Backend Native Localization Hub (6 locales: id · en · jv · ar · zh · ru).
 *
 * The reference oracle for the *mechanism* is `reference/n8n/packages/frontend/@n8n/i18n`
 * (n8n 2.9.4): English base text as fallback locale, `{name}` interpolation, `one | many`
 * plural choices, `numberFormats` per locale, `_`-prefixed plumbing keys excluded from the
 * translatable key set, no HTML escaping (`warnHtmlMessage: false`). n8n ships English
 * only, so the six translations are product-supplied and the assertions below pin the
 * mechanism plus key parity — never a hand-written expectation of a translation.
 *
 * The suite is offline by design: the hub imports nothing, so it is compiled on the fly
 * (`tools/localization-module-loader.mjs`) and needs no reference runtime.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadLocalizationHub } from '../../../tools/localization-module-loader.mjs';

const hub = await loadLocalizationHub({ fresh: true });
const { service, adapter } = hub;
const {
	NativeLocalizationService,
	SUPPORTED_LOCALES,
	FALLBACK_LOCALE,
	NATIVE_NUMBER_FORMATS,
	normalizeLocale,
	matchLocale,
	resolveAcceptLanguage,
	isRtl,
	isTranslatableKey,
} = service;
const { SettingsLocalizationAdapter } = adapter;

const LOCALE_ORDER = ['id', 'en', 'jv', 'ar', 'zh', 'ru'];

before(() => {
	assert.equal(typeof NativeLocalizationService.translate, 'function', 'the hub did not load');
});

beforeEach(() => {
	NativeLocalizationService.resetRegistry();
	NativeLocalizationService.attachPersistence(null);
	NativeLocalizationService.setLocale('id');
});

/* ------------------------------------------------------------------ */
/* registry + parity                                                   */
/* ------------------------------------------------------------------ */

test('the registry exposes exactly the six requested locales with metadata', () => {
	assert.deepEqual(Object.keys(SUPPORTED_LOCALES), LOCALE_ORDER);
	for (const [code, meta] of Object.entries(SUPPORTED_LOCALES)) {
		assert.equal(meta.code, code);
		assert.ok(meta.nativeName.length > 0, `${code} has no native name`);
		assert.ok(['ltr', 'rtl'].includes(meta.direction), `${code} has an invalid direction`);
	}
	assert.equal(SUPPORTED_LOCALES.ar.direction, 'rtl');
	assert.equal(SUPPORTED_LOCALES.en.nativeName, 'English (US)');
	assert.equal(FALLBACK_LOCALE, 'en');
});

test('every locale is key-identical to the English base text (parity report)', () => {
	const report = NativeLocalizationService.parityReport();
	assert.equal(report.base, 'en');
	assert.equal(report.baseKeyCount, 23, 'the six locale dictionaries merged from the Phase 4B seed');
	assert.equal(report.ok, true, JSON.stringify(report.locales));
	for (const entry of report.locales) {
		assert.equal(entry.keyCount, report.baseKeyCount, `${entry.locale} key count`);
		assert.deepEqual(entry.missing, [], `${entry.locale} missing keys`);
		assert.deepEqual(entry.extra, [], `${entry.locale} extra keys`);
	}
});

test('parity is sensitive: a key present in one locale only fails the report', () => {
	NativeLocalizationService.registerMessages('ru', { 'test.extra.only.ru': 'только русский' });
	const report = NativeLocalizationService.parityReport();
	assert.equal(report.ok, false);
	const ru = report.locales.find((entry) => entry.locale === 'ru');
	assert.deepEqual(ru.extra, ['test.extra.only.ru']);
	assert.deepEqual(ru.missing, []);
});

test('the shipped dictionaries never carry an empty translation', () => {
	for (const [locale, messages] of Object.entries(service.NATIVE_DICTIONARIES)) {
		for (const [key, value] of Object.entries(messages)) {
			assert.equal(typeof value, 'string', `${locale}/${key} must be a string`);
			assert.ok(value.trim().length > 0, `${locale}/${key} is empty`);
		}
	}
});

/* ------------------------------------------------------------------ */
/* locale normalisation + negotiation                                  */
/* ------------------------------------------------------------------ */

test('normalizeLocale maps BCP-47 tags, legacy codes and unsupported input', () => {
	const expectations = [
		['id', 'id'],
		['id-ID', 'id'],
		['in', 'id'],
		['ID_id', 'id'],
		['en-US', 'en'],
		['en_GB', 'en'],
		['jw', 'jv'],
		['jv-ID', 'jv'],
		['AR-sa', 'ar'],
		['arb', 'ar'],
		['zh-Hans-CN', 'zh'],
		['zh_TW', 'zh'],
		['ru-RU', 'ru'],
		['de-DE', 'en'],
		['klingon', 'en'],
		['', 'en'],
		['   ', 'en'],
		[null, 'en'],
		[undefined, 'en'],
		[42, 'en'],
		[{}, 'en'],
	];
	for (const [input, expected] of expectations) {
		assert.equal(normalizeLocale(input), expected, `normalizeLocale(${JSON.stringify(input)})`);
	}
	assert.equal(matchLocale('de-DE'), null, 'matchLocale must not silently fall back');
	assert.equal(matchLocale('jw'), 'jv');
});

test('resolveAcceptLanguage honours q-weights, wildcards and unsupported-only headers', () => {
	assert.equal(resolveAcceptLanguage('de-DE;q=1, ar-SA;q=0.8, en;q=0.5'), 'ar');
	assert.equal(resolveAcceptLanguage('fr, zh-CN;q=0.9'), 'zh');
	assert.equal(resolveAcceptLanguage('fr;q=0.9, en;q=0.9'), 'en', 'equal q keeps header order');
	assert.equal(resolveAcceptLanguage('*'), 'en');
	assert.equal(resolveAcceptLanguage('de,fr'), 'en');
	assert.equal(resolveAcceptLanguage(''), 'en');
	assert.equal(resolveAcceptLanguage(null), 'en');
	assert.equal(resolveAcceptLanguage('jw'), 'jv', 'legacy code negotiates');
});

/* ------------------------------------------------------------------ */
/* resolution: locale, fallback chain, interpolation, plural           */
/* ------------------------------------------------------------------ */

test('translate resolves the active locale and keeps the original (key, locale) call shape', () => {
	NativeLocalizationService.setLocale('id');
	assert.equal(NativeLocalizationService.translate('execute.workflow'), 'Jalankan alur kerja');
	assert.equal(NativeLocalizationService.translate('execute.workflow', 'ar'), 'تشغيل سير العمل');
	NativeLocalizationService.setLocale('ru');
	assert.equal(NativeLocalizationService.t('settings.title'), 'Настройки');
	assert.equal(NativeLocalizationService.t('save.workflow', { locale: 'zh' }), '保存工作流');
});

test('the declared fallback chain jv → id → en is walked in order and can be disabled', () => {
	NativeLocalizationService.registerMessages('id', { 'test.chain.id': 'dari bahasa indonesia' });
	NativeLocalizationService.registerMessages('en', { 'test.chain.en': 'from english base' });

	assert.equal(NativeLocalizationService.translate('test.chain.id', { locale: 'jv' }), 'dari bahasa indonesia');
	assert.equal(NativeLocalizationService.translate('test.chain.en', { locale: 'jv' }), 'from english base');
	assert.equal(NativeLocalizationService.translate('test.chain.en', { locale: 'ar' }), 'from english base');

	assert.equal(NativeLocalizationService.translate('test.chain.en', { locale: 'jv', fallback: false }), 'test.chain.en');
	assert.equal(
		NativeLocalizationService.translate('test.chain.none', { locale: 'jv', defaultValue: 'fallback text' }),
		'fallback text',
	);
	assert.equal(NativeLocalizationService.translate('test.chain.none', { locale: 'jv' }), 'test.chain.none');
});

test('an English-only key is served to every locale (base text is the published locale)', () => {
	NativeLocalizationService.registerMessages('en', { 'test.base.only': 'English base text' });
	for (const locale of LOCALE_ORDER) {
		assert.equal(
			NativeLocalizationService.translate('test.base.only', { locale }),
			'English base text',
			`${locale} must fall back to the English base text`,
		);
	}
});

test('interpolation inserts values verbatim — placeholders and HTML are never escaped', () => {
	NativeLocalizationService.registerMessages('id', {
		'test.greeting': 'Halo {name}, {missing} tersisa',
		'test.html': '<strong>{name}</strong>',
	});
	assert.equal(
		NativeLocalizationService.translate('test.greeting', { interpolate: { name: 'Fern' } }),
		'Halo Fern, {missing} tersisa',
		'unknown placeholders stay visible',
	);
	assert.equal(
		NativeLocalizationService.translate('test.html', { interpolate: { name: '<em>ok</em>' } }),
		'<strong><em>ok</em></strong>',
		'mirrors warnHtmlMessage: false',
	);
});

test('the `one | many` plural choice follows the count, with `{count}` interpolated', () => {
	NativeLocalizationService.registerMessages('en', { 'test.items': '1 item | {count} items' });
	const at = (count) => NativeLocalizationService.translate('test.items', { locale: 'en', count });
	assert.equal(at(1), '1 item');
	assert.equal(at(2), '2 items');
	assert.equal(at(7), '7 items');
	assert.equal(at(0), '1 item', 'count < 1 clamps to the first declared form (vue-i18n rule)');
	assert.equal(
		NativeLocalizationService.translate('execute.workflow', { locale: 'en', count: 3 }),
		'Execute workflow',
		'a message without a choice ignores the count',
	);
});

/* ------------------------------------------------------------------ */
/* key surface + direction + change notification                       */
/* ------------------------------------------------------------------ */

test('`_`-prefixed plumbing keys stay out of the translatable key set', () => {
	NativeLocalizationService.registerMessages('en', { '_internal.debug': 'do not translate' });
	assert.equal(isTranslatableKey('_internal.debug'), false);
	assert.equal(isTranslatableKey('execute.workflow'), true);
	assert.deepEqual(
		NativeLocalizationService.listKeys('en').filter((key) => key.startsWith('_')),
		[],
	);
	assert.equal(NativeLocalizationService.parityReport().ok, true, 'plumbing keys never break parity');
	assert.equal(NativeLocalizationService.exists('_internal.debug', 'en'), true, 'explicit lookup still resolves');
});

test('listKeys / exists / missingKeys report the resolution surface deterministically', () => {
	const keys = NativeLocalizationService.listKeys('en');
	assert.deepEqual(keys, [...keys].sort(), 'keys are sorted');
	assert.equal(new Set(keys).size, keys.length, 'keys are unique');
	assert.equal(NativeLocalizationService.exists('execute.workflow', 'ru'), true);
	assert.equal(NativeLocalizationService.exists('execute.workflow'), true, 'defaults to the active locale');
	assert.equal(NativeLocalizationService.exists('does.not.exist'), false);
	assert.deepEqual(NativeLocalizationService.missingKeys('en'), []);
	NativeLocalizationService.registerMessages('zh', { 'test.zh.only': '仅中文' });
	assert.deepEqual(NativeLocalizationService.missingKeys('zh'), []);
	assert.deepEqual(
		NativeLocalizationService.listKeys('zh').filter((key) => key === 'test.zh.only'),
		['test.zh.only'],
	);
});

test('RTL is metadata: only Arabic is right-to-left, and input is normalised first', () => {
	assert.equal(isRtl('ar'), true);
	assert.equal(isRtl('ar-SA'), true);
	assert.equal(isRtl('AR'), true);
	assert.equal(isRtl('en'), false);
	assert.equal(isRtl('jv'), false);
	assert.equal(isRtl(undefined), false, 'the free function falls back to the English base');
	assert.equal(NativeLocalizationService.isRtl(), false, 'the class method reads the active locale');
	NativeLocalizationService.setLocale('ar');
	assert.equal(NativeLocalizationService.isRtl(), true);
	assert.equal(NativeLocalizationService.getDirection('ar'), 'rtl');
	assert.equal(NativeLocalizationService.getDirection('zh'), 'ltr');
	assert.equal(NativeLocalizationService.getLocaleMetadata('ar-TN').nativeName, 'العربية');
});

test('locale change listeners fire once per real change, carry the previous locale, and unsubscribe', () => {
	const seen = [];
	const off = NativeLocalizationService.onLocaleChange((locale, previous) => seen.push([locale, previous]));

	assert.equal(NativeLocalizationService.setLocale('zh'), 'zh');
	assert.equal(NativeLocalizationService.setLocale('ZH-hans'), 'zh', 'no-op change is not a change');
	assert.equal(NativeLocalizationService.setLocale('ar-SA'), 'ar');
	assert.deepEqual(seen, [
		['zh', 'id'],
		['ar', 'zh'],
	]);

	off();
	NativeLocalizationService.setLocale('ru');
	assert.equal(seen.length, 2, 'unsubscribed listener must not fire');
	assert.equal(NativeLocalizationService.getLocale(), 'ru');
});

/* ------------------------------------------------------------------ */
/* persistence port + number formats                                   */
/* ------------------------------------------------------------------ */

test('the persistence port stores the preference and hydrate() restores only supported values', () => {
	const storage = { value: null };
	NativeLocalizationService.attachPersistence({
		load: () => storage.value,
		save: (locale) => {
			storage.value = locale;
		},
	});

	NativeLocalizationService.setLocale('ar');
	assert.equal(storage.value, 'ar', 'setLocale persists');
	assert.equal(NativeLocalizationService.setLocale('ar-SA'), 'ar', 'normalised no-op does not rewrite storage');
	assert.equal(storage.value, 'ar');

	NativeLocalizationService.setLocale('en');
	storage.value = 'jw';
	assert.equal(NativeLocalizationService.hydrate(), 'jv', 'legacy stored tag is normalised on hydration');

	storage.value = 'klingon';
	NativeLocalizationService.setLocale('id');
	assert.equal(NativeLocalizationService.hydrate(), 'id', 'unsupported stored value keeps the current locale');
	NativeLocalizationService.attachPersistence(null);
});

test('formatNumber goes through the locale numberFormats and accepts explicit options', () => {
	assert.deepEqual(NATIVE_NUMBER_FORMATS.id.default, { maximumFractionDigits: 2 });
	const oracle = (locale, options, value) => new Intl.NumberFormat(locale, options).format(value);
	const value = 12345.678;
	for (const locale of LOCALE_ORDER) {
		assert.equal(
			NativeLocalizationService.formatNumber(value, 'default', locale),
			oracle(locale, { maximumFractionDigits: 2 }, value),
			`${locale} number format`,
		);
	}
	const explicit = { minimumFractionDigits: 3, maximumFractionDigits: 3 };
	assert.equal(
		NativeLocalizationService.formatNumber(1234.5, explicit, 'ru'),
		oracle('ru', explicit, 1234.5),
	);
});

/* ------------------------------------------------------------------ */
/* boundary + settings adapter projection                              */
/* ------------------------------------------------------------------ */

test('the hub is import-free and the adapter only imports the hub (LEGO boundary)', () => {
	const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
	const serviceSource = stripComments(readFileSync(hub.sources.service.path, 'utf8'));
	assert.equal(/^\s*import\s/m.test(serviceSource), false, 'the hub must not import anything');
	const adapterSource = stripComments(readFileSync(hub.sources.adapter.path, 'utf8'));
	const adapterImports = [...adapterSource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
	assert.deepEqual(adapterImports, ['./backend-localization-service']);
	assert.equal(adapterImports.every((spec) => spec.startsWith('.')), true, 'no external package may leak into the adapter');
});

test('the settings adapter projects the hub: six languages, native names, direction, normalising setter', () => {
	const state = SettingsLocalizationAdapter.getState();
	assert.deepEqual(
		state.supportedLanguages.map((entry) => entry.code),
		LOCALE_ORDER,
	);
	assert.equal(state.supportedLanguages.length, 6, 'the Phase 4A two-language list is gone');
	assert.equal(state.supportedLanguages.find((entry) => entry.code === 'jv').label, 'Javanese');
	assert.equal(state.supportedLanguages.find((entry) => entry.code === 'jv').nativeLabel, 'Basa Jawa');
	assert.equal(state.supportedLanguages.find((entry) => entry.code === 'jv').nativeName, 'Basa Jawa');
	assert.equal(state.supportedLanguages.find((entry) => entry.code === 'ar').direction, 'rtl');
	assert.equal(state.currentLanguage, 'id');
	assert.equal(state.direction, 'ltr');

	assert.equal(SettingsLocalizationAdapter.setLanguage('ar-SA'), 'ar');
	const arabic = SettingsLocalizationAdapter.getState();
	assert.equal(arabic.currentLanguage, 'ar');
	assert.equal(arabic.direction, 'rtl');
	assert.equal(SettingsLocalizationAdapter.translate('execute.workflow'), 'تشغيل سير العمل');

	assert.equal(SettingsLocalizationAdapter.setLanguage('de-DE'), 'en', 'unknown → English base');
	assert.equal(SettingsLocalizationAdapter.getState().currentLanguage, 'en');

	const copy = SettingsLocalizationAdapter.getState();
	copy.supportedLanguages.pop();
	copy.currentLanguage = 'zh';
	assert.equal(SettingsLocalizationAdapter.getState().supportedLanguages.length, 6, 'state is a copy');
	assert.equal(SettingsLocalizationAdapter.getState().currentLanguage, 'en');
});

/* ------------------------------------------------------------------ */
/* Phase 4B seed surface (merged): 23 keys, aliases, browser storage    */
/* ------------------------------------------------------------------ */

test('the merged dictionary surface spans 23 keys and resolves in every locale', () => {
	const keys = NativeLocalizationService.listKeys('en');
	assert.equal(keys.length, 23);
	for (const key of ['workflow.active', 'execution.finished', 'validation.cycle', 'system.recovered']) {
		assert.ok(keys.includes(key), `missing merged key ${key}`);
	}
	for (const locale of LOCALE_ORDER) {
		for (const key of keys) {
			const value = NativeLocalizationService.translate(key, { locale });
			assert.ok(value.length > 0, `${locale}/${key} is empty`);
			assert.notEqual(value, key, `${locale}/${key} did not resolve`);
		}
	}
});

test('isRTL is the all-caps alias of isRtl', () => {
	assert.equal(NativeLocalizationService.isRTL('ar'), true);
	assert.equal(NativeLocalizationService.isRTL('ar-SA'), true);
	assert.equal(NativeLocalizationService.isRTL('en'), false);
	NativeLocalizationService.setLocale('ar');
	assert.equal(NativeLocalizationService.isRTL(), true, 'defaults to the active locale');
});

test('formatExecutionMessage replaces every occurrence of a parameter', () => {
	NativeLocalizationService.registerMessages('id', { 'test.repeat': '{name} dan {name} lagi' });
	assert.equal(
		NativeLocalizationService.formatExecutionMessage('test.repeat', { name: 'Fern' }),
		'Fern dan Fern lagi',
	);
	assert.equal(NativeLocalizationService.formatExecutionMessage('test.repeat'), '{name} dan {name} lagi');
});

test('attachBrowserStorage binds localStorage, hydrates it and persists later changes', () => {
	const store = new Map();
	globalThis.localStorage = {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => store.set(key, String(value)),
	};
	try {
		store.set('n8n_locale', 'jw');
		assert.equal(NativeLocalizationService.attachBrowserStorage(), 'jv', 'stored legacy tag hydrates');
		assert.equal(NativeLocalizationService.setLocale('ar'), 'ar');
		assert.equal(store.get('n8n_locale'), 'ar', 'setLocale writes through the browser port');
		assert.equal(NativeLocalizationService.suppressUpdateBanner(), true);
		assert.equal(store.get('n8n_update_notice_suppressed'), 'true');

		store.set('n8n_locale', 'klingon');
		NativeLocalizationService.setLocale('en');
		assert.equal(NativeLocalizationService.hydrate(), 'en', 'unsupported stored value keeps the current locale');
	} finally {
		NativeLocalizationService.attachPersistence(null);
		delete globalThis.localStorage;
	}
});

test('the adapter exposes the Phase 4B helper surface on top of the hub projection', () => {
	assert.equal(SettingsLocalizationAdapter.isRTL('ar'), true);
	assert.equal(SettingsLocalizationAdapter.isRTL('id'), false);
	assert.equal(SettingsLocalizationAdapter.getSupportedLanguages().length, 6);
	const state = SettingsLocalizationAdapter.getState();
	assert.equal(state.supportedLanguages.find((entry) => entry.code === 'zh').label, 'Chinese');
	assert.equal(state.supportedLanguages.find((entry) => entry.code === 'zh').nativeLabel, '中文 (简体)');
	assert.equal(SettingsLocalizationAdapter.suppressAggressiveUpdateNotice(), true);
	assert.equal(SettingsLocalizationAdapter.getState().isUpdateNoticeSuppressed, true);
});
