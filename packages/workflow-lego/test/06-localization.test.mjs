/**
 * Gate 6 — Phase 4 native localization stack (4A + 4B + 4C).
 *
 * Like gates 3 and 4, this tests the ISOLATED UNIT (.extract/dist), not the TS
 * sources directly: the modules are copied into the isolated unit under
 * dist/lego/ and compiled by the same build as everything else the LEGO ships.
 *
 * Covers:
 *   - the 6-language NativeLocalizationService hub (metadata, fallback,
 *     interpolation, locale switching)
 *   - the SettingsLocalizationAdapter harmonized in 4C (derived language list,
 *     hub synchronization, RTL direction, invalid-language rejection)
 *   - the NodeParameterValidator rendering messages through the hub in the
 *     active locale, with the Indonesian default byte-identical to Phase 3C
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(fileURLToPath(import.meta.url), '..', '..');
const DIST = join(PKG, '.extract', 'dist', 'lego');

/** @type {any} */
let hub;
/** @type {any} */
let adapter;
/** @type {any} */
let validator;

const LOCALES = ['id', 'en', 'jv', 'ar', 'zh', 'ru'];

before(async () => {
	for (const f of ['backend-localization-service.js', 'settings-localization-adapter.js', 'parameter-issues.js']) {
		assert.ok(
			existsSync(join(DIST, f)),
			`isolated unit not built (${f} missing) — run \`npm run build\` in packages/workflow-lego`
		);
	}
	hub = await import(join(DIST, 'backend-localization-service.js'));
	adapter = await import(join(DIST, 'settings-localization-adapter.js'));
	validator = await import(join(DIST, 'parameter-issues.js'));
	// reset the shared hub locale between test files / runs
	hub.NativeLocalizationService.setLocale('id');
});

test('exactly six locales are supported, each with complete metadata', () => {
	assert.deepEqual(
		Object.keys(hub.SUPPORTED_LOCALES).sort(),
		[...LOCALES].sort(),
		'supported locale set changed'
	);
	for (const code of LOCALES) {
		const meta = hub.SUPPORTED_LOCALES[code];
		assert.equal(meta.code, code);
		assert.ok(meta.name.length > 0, `${code}: name missing`);
		assert.ok(meta.nativeName.length > 0, `${code}: nativeName missing`);
		assert.ok(meta.direction === 'ltr' || meta.direction === 'rtl', `${code}: bad direction`);
	}
	assert.equal(hub.SUPPORTED_LOCALES['ar'].direction, 'rtl', 'Arabic must be RTL');
	for (const code of LOCALES.filter((l) => l !== 'ar')) {
		assert.equal(hub.SUPPORTED_LOCALES[code].direction, 'ltr', `${code} must be LTR`);
	}
});

test('every dictionary holds the same key set (no partially translated locale)', () => {
	const referenceKeys = Object.keys(hub.NATIVE_DICTIONARIES['id']).sort();
	for (const code of LOCALES) {
		assert.deepEqual(
			Object.keys(hub.NATIVE_DICTIONARIES[code]).sort(),
			referenceKeys,
			`${code}: dictionary keys diverge from id`
		);
	}
});

test('translate follows the active locale and falls back to en, then the key', () => {
	hub.NativeLocalizationService.setLocale('ru');
	assert.equal(hub.NativeLocalizationService.translate('settings.title'), 'Настройки');

	// explicit locale wins over the active one
	assert.equal(hub.NativeLocalizationService.translate('settings.title', 'zh'), '设置');

	// unknown key -> en fallback cannot help -> the key itself
	assert.equal(hub.NativeLocalizationService.translate('no.such.key'), 'no.such.key');
});

test('translate interpolates {placeholders} and leaves unknown placeholders intact', () => {
	hub.NativeLocalizationService.setLocale('id');
	assert.equal(
		hub.NativeLocalizationService.translate('param.required', undefined, { name: 'url' }),
		'Parameter "url" wajib diisi.'
	);
	assert.equal(
		hub.NativeLocalizationService.translate('param.below_min', 'en', { value: 3, min: 5 }),
		'Value 3 is below the minimum limit of 5.'
	);
	// an unknown placeholder survives untouched
	assert.equal(
		hub.NativeLocalizationService.translate('param.above_max', undefined, { value: 9 }),
		'Nilai 9 lebih besar dari batas maksimum {max}.'
	);
});

test('setLocale ignores unsupported codes; isSupported distinguishes them', () => {
	hub.NativeLocalizationService.setLocale('en');
	hub.NativeLocalizationService.setLocale('klingon');
	assert.equal(hub.NativeLocalizationService.getLocale(), 'en', 'unsupported locale must not stick');
	assert.equal(hub.NativeLocalizationService.isSupported('jv'), true);
	assert.equal(hub.NativeLocalizationService.isSupported('klingon'), false);
});

test('settings adapter derives all six hub languages (4C harmonization)', () => {
	const languages = adapter.SettingsLocalizationAdapter.getSupportedLanguages();
	assert.equal(languages.length, 6);
	assert.deepEqual(
		languages.map((l) => l.code).sort(),
		[...LOCALES].sort(),
		'adapter language list must equal the hub locale set'
	);
	const arabic = languages.find((l) => l.code === 'ar');
	assert.ok(arabic, 'Arabic missing from adapter list');
	assert.equal(arabic.direction, 'rtl');
	assert.equal(arabic.label, 'العربية');
});

test('settings adapter setLanguage syncs the hub locale and rejects unknown codes', () => {
	const state = adapter.SettingsLocalizationAdapter.getState();
	assert.equal(state.currentLanguage, 'id', 'default language must remain id');
	assert.equal(state.isUpdateNoticeSuppressed, true);

	assert.equal(adapter.SettingsLocalizationAdapter.setLanguage('ru'), true);
	assert.equal(adapter.SettingsLocalizationAdapter.getDirection(), 'ltr');
	assert.equal(hub.NativeLocalizationService.getLocale(), 'ru', 'hub locale must follow the adapter');
	assert.equal(adapter.SettingsLocalizationAdapter.getState().currentLanguage, 'ru');

	assert.equal(adapter.SettingsLocalizationAdapter.setLanguage('klingon'), false);
	assert.equal(adapter.SettingsLocalizationAdapter.getState().currentLanguage, 'ru', 'state unchanged on rejection');
	assert.equal(hub.NativeLocalizationService.getLocale(), 'ru');

	assert.equal(adapter.SettingsLocalizationAdapter.setLanguage('ar'), true);
	assert.equal(adapter.SettingsLocalizationAdapter.getDirection(), 'rtl');

	// the returned state is a copy — mutating it must not leak inside
	const snapshot = adapter.SettingsLocalizationAdapter.getState();
	snapshot.currentLanguage = 'zh';
	assert.equal(adapter.SettingsLocalizationAdapter.getState().currentLanguage, 'ar');
});

test('parameter validator default (id) output is byte-identical to Phase 3C', () => {
	hub.NativeLocalizationService.setLocale('id');
	const def = { name: 'amount', type: 'number', required: true, typeOptions: { minValue: 1, maxValue: 10 } };

	assert.deepEqual(validator.NodeParameterValidator.validateField(def, undefined), {
		parameter: 'amount',
		message: 'Parameter "amount" wajib diisi.',
		issueType: 'missing',
	});
	assert.deepEqual(validator.NodeParameterValidator.validateField(def, 'abc'), {
		parameter: 'amount',
		message: 'Nilai "abc" harus berupa angka yang valid.',
		issueType: 'invalid_type',
	});
	assert.deepEqual(validator.NodeParameterValidator.validateField(def, 0), {
		parameter: 'amount',
		message: 'Nilai 0 lebih kecil dari batas minimum 1.',
		issueType: 'out_of_bounds',
	});
	assert.deepEqual(validator.NodeParameterValidator.validateField(def, 99), {
		parameter: 'amount',
		message: 'Nilai 99 lebih besar dari batas maksimum 10.',
		issueType: 'out_of_bounds',
	});
	assert.equal(validator.NodeParameterValidator.validateField(def, 5), null);
});

test('parameter validator renders issues in the active locale (4C)', () => {
	const def = { name: 'amount', type: 'number', required: true };

	hub.NativeLocalizationService.setLocale('en');
	assert.equal(
		validator.NodeParameterValidator.validateField(def, null)?.message,
		'Parameter "amount" is required.'
	);

	adapter.SettingsLocalizationAdapter.setLanguage('zh');
	assert.equal(
		validator.NodeParameterValidator.validateField(def, null)?.message,
		'参数 "amount" 为必填项。'
	);

	const defs = [
		{ name: 'amount', type: 'number', required: true },
		{ name: 'url', type: 'string', required: true },
	];
	const issues = validator.NodeParameterValidator.getNodeParametersIssues(defs, { url: '' });
	assert.equal(issues.length, 2);
	assert.deepEqual(issues.map((i) => i.parameter), ['amount', 'url']);
});
