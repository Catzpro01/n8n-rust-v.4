// Phase 4B lanjutan — Locale Resolution & Native Message Runtime.
// Modul diuji lewat hasil kompilasi isolated-unit (.extract/dist/lego/*.js)
// agar sumber TypeScript tetap bergaya impor tanpa ekstensi (kompatibel dengan
// tsconfig CommonJS paket ini dan pipeline ekstraksi gate 02). Bila artefak
// belum ada/kedaluwarsa, build dipicu otomatis (extractor + tsc lokal).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_LEGO = join(PKG_DIR, '.extract/dist/lego');
const DIST_PROBE = join(DIST_LEGO, 'locale-resolution-service.js');

function newestMtime(dir) {
	let newest = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
		else newest = Math.max(newest, statSync(full).mtimeMs);
	}
	return newest;
}

function ensureIsolatedUnitBuild() {
	const srcNewest = newestMtime(join(PKG_DIR, 'src'));
	if (existsSync(DIST_PROBE) && statSync(DIST_PROBE).mtimeMs >= srcNewest) return;
	execFileSync(process.execPath, [join(PKG_DIR, '../../tools/workflow-isolation-extract.mjs')], {
		cwd: PKG_DIR,
		stdio: 'pipe',
	});
	execFileSync(join(PKG_DIR, 'node_modules/.bin/tsc'), ['-p', '.extract/tsconfig.json'], {
		cwd: PKG_DIR,
		stdio: 'pipe',
	});
}

ensureIsolatedUnitBuild();
const require = createRequire(import.meta.url);
const {
	NATIVE_DICTIONARIES,
	NativeLocalizationService,
	SUPPORTED_LOCALES,
} = require(join(DIST_LEGO, 'backend-localization-service.js'));
const {
	LocalizedBackendMessages,
	interpolate,
	parseAcceptLanguage,
	resolveFromAcceptLanguage,
	resolveLocale,
	selectPluralCategory,
	normalizeLocaleTag,
} = require(join(DIST_LEGO, 'locale-resolution-service.js'));
const { SettingsLocalizationAdapter } = require(join(DIST_LEGO, 'settings-localization-adapter.js'));

const LOCALES = Object.keys(SUPPORTED_LOCALES);

test('Phase 4B: exactly six locales, only Arabic is RTL', () => {
	assert.deepEqual([...LOCALES].sort(), ['ar', 'en', 'id', 'jv', 'ru', 'zh']);
	for (const code of LOCALES) {
		const meta = SUPPORTED_LOCALES[code];
		assert.equal(meta.code, code);
		assert.ok(meta.nativeName.length > 0, `${code} harus punya nativeName`);
		assert.equal(meta.direction, code === 'ar' ? 'rtl' : 'ltr', `${code} direction`);
	}
});

test('Phase 4B: dictionary key parity across all six locales', () => {
	const enKeys = Object.keys(NATIVE_DICTIONARIES.en).sort();
	assert.ok(enKeys.length >= 9, 'kamus en minimal memuat 9 kunci inti');
	for (const code of LOCALES) {
		assert.deepEqual(
			Object.keys(NATIVE_DICTIONARIES[code]).sort(),
			enKeys,
			`paritas kunci kamus ${code} vs en`,
		);
		for (const key of enKeys) {
			assert.ok(
				NATIVE_DICTIONARIES[code][key].trim().length > 0,
				`${code}:${key} tidak boleh kosong`,
			);
		}
	}
});

test('parseAcceptLanguage: q-value ordering, wildcard junk dropped, case normalized', () => {
	const parsed = parseAcceptLanguage('ru-RU,ru;q=0.9,en-GB;q=0.5, *;q=0.1 ,fr;q=0.8');
	assert.deepEqual(
		parsed.map((e) => `${e.locale}:${e.quality}`),
		['ru-RU:1', 'ru:0.9', 'fr:0.8', 'en-GB:0.5'],
	);
	assert.deepEqual(parseAcceptLanguage(''), []);
	assert.deepEqual(parseAcceptLanguage(';;;'), []);
});

test('parseAcceptLanguage: RFC 7231 — q-values outside 0..1 or malformed are rejected', () => {
	// q=1.5 tidak boleh mengungguli preferensi valid
	assert.deepEqual(
		parseAcceptLanguage('en;q=1.5,fr;q=0.9').map((e) => `${e.locale}:${e.quality}`),
		['fr:0.9'],
	);
	// q=2 dan q negatif juga ditolak
	assert.deepEqual(parseAcceptLanguage('en;q=2'), []);
	assert.deepEqual(
		parseAcceptLanguage('id;q=-0.5,en;q=0.4').map((e) => `${e.locale}:${e.quality}`),
		['en:0.4'],
	);
	// sintaks q tak dikenal → entri ditolak (bukan dianggap q=1)
	assert.deepEqual(parseAcceptLanguage('en;q=abc'), []);
	// q=1.000 tetap sah (= 1)
	assert.deepEqual(
		parseAcceptLanguage('en;q=1.000').map((e) => `${e.locale}:${e.quality}`),
		['en:1'],
	);
	// q=0 = "not acceptable" (RFC 7231) → dibuang, tidak boleh ikut negosiasi
	assert.deepEqual(parseAcceptLanguage('ru;q=0'), []);
	assert.deepEqual(
		parseAcceptLanguage('ru;q=0,en;q=0.5').map((e) => `${e.locale}:${e.quality}`),
		['en:0.5'],
	);
	assert.equal(resolveFromAcceptLanguage('ru;q=0', 'id'), 'id');
});

test('normalizeLocaleTag: language lowercase, region uppercase, script title-case', () => {
	assert.equal(normalizeLocaleTag('ID-id'), 'id-ID');
	assert.equal(normalizeLocaleTag('ZH-hans-cn'), 'zh-Hans-CN');
	assert.equal(normalizeLocaleTag('EN'), 'en');
	// subtag variant numerik & singleton tidak diutak-atik
	assert.equal(normalizeLocaleTag('de-DE-1901'), 'de-DE-1901');
	assert.equal(normalizeLocaleTag('en-x-custom'), 'en-x-custom');
});

test('resolveLocale: exact, region→language fallback, case-insensitive, default fallback', () => {
	assert.equal(resolveLocale(['id-ID']), 'id');
	assert.equal(resolveLocale(['fr-FR', 'en-GB']), 'en');
	assert.equal(resolveLocale(['RU']), 'ru');
	assert.equal(resolveLocale(['jv', 'id']), 'jv');
	assert.equal(resolveLocale([], 'zh'), 'zh');
	assert.equal(resolveLocale(['fr', 'de'], 'ar'), 'ar');
});

test('resolveFromAcceptLanguage: end-to-end header negotiation', () => {
	assert.equal(resolveFromAcceptLanguage('ru-RU,ru;q=0.9,en;q=0.5', 'en'), 'ru');
	assert.equal(resolveFromAcceptLanguage('fr-FR,fr;q=0.9', 'id'), 'id');
	assert.equal(resolveFromAcceptLanguage('', 'jv'), 'jv');
});

test('selectPluralCategory: CLDR cardinal rules (en, ru, ar, id/jv/zh)', () => {
	// English: one / other
	assert.equal(selectPluralCategory(1, 'en'), 'one');
	assert.equal(selectPluralCategory(2, 'en'), 'other');
	assert.equal(selectPluralCategory(0, 'en'), 'other');
	// Russian: one / few / many
	assert.equal(selectPluralCategory(1, 'ru'), 'one');
	assert.equal(selectPluralCategory(21, 'ru'), 'one');
	assert.equal(selectPluralCategory(101, 'ru'), 'one');
	assert.equal(selectPluralCategory(2, 'ru'), 'few');
	assert.equal(selectPluralCategory(22, 'ru'), 'few');
	assert.equal(selectPluralCategory(104, 'ru'), 'few');
	assert.equal(selectPluralCategory(5, 'ru'), 'many');
	assert.equal(selectPluralCategory(11, 'ru'), 'many');
	assert.equal(selectPluralCategory(14, 'ru'), 'many');
	assert.equal(selectPluralCategory(111, 'ru'), 'many');
	assert.equal(selectPluralCategory(0, 'ru'), 'many');
	// Arabic: zero / one / two / few / many / other
	assert.equal(selectPluralCategory(0, 'ar'), 'zero');
	assert.equal(selectPluralCategory(1, 'ar'), 'one');
	assert.equal(selectPluralCategory(2, 'ar'), 'two');
	assert.equal(selectPluralCategory(3, 'ar'), 'few');
	assert.equal(selectPluralCategory(10, 'ar'), 'few');
	assert.equal(selectPluralCategory(11, 'ar'), 'many');
	assert.equal(selectPluralCategory(99, 'ar'), 'many');
	assert.equal(selectPluralCategory(100, 'ar'), 'other');
	// id / jv / zh: selalu other
	for (const code of ['id', 'jv', 'zh']) {
		for (const n of [0, 1, 2, 5, 100]) {
			assert.equal(selectPluralCategory(n, code), 'other', `${code}(${n})`);
		}
	}
});

test('selectPluralCategory: CLDR fraction handling (v > 0 → never one/few/many)', () => {
	// English: 1.5 punya visible fraction → other, bukan one
	assert.equal(selectPluralCategory(1.5, 'en'), 'other');
	assert.equal(selectPluralCategory(0.5, 'en'), 'other');
	// 1.0 sebagai number JS tampil tanpa pecahan (v=0) → tetap one
	assert.equal(selectPluralCategory(1.0, 'en'), 'one');
	// Russian: semua aturan butuh v = 0
	assert.equal(selectPluralCategory(1.5, 'ru'), 'other');
	assert.equal(selectPluralCategory(2.5, 'ru'), 'other');
	assert.equal(selectPluralCategory(21.0, 'ru'), 'one');
	// Arabic: exact-match & range hanya untuk nilai integer
	assert.equal(selectPluralCategory(1.5, 'ar'), 'other');
	assert.equal(selectPluralCategory(3.5, 'ar'), 'other');
	assert.equal(selectPluralCategory(11.5, 'ar'), 'other');
	assert.equal(selectPluralCategory(103, 'ar'), 'few');
	assert.equal(selectPluralCategory(11.0, 'ar'), 'many');
	// input non-finite tidak pernah melempar
	assert.equal(selectPluralCategory(Number.NaN, 'ru'), 'other');
	assert.equal(selectPluralCategory(Number.POSITIVE_INFINITY, 'en'), 'other');
});

test('selectPluralCategory: notasi eksponensial tetap menghitung digit pecahan', () => {
	// 1e-7 punya 7 digit pecahan → other (bukan many lewat jalan pintas floor lama)
	assert.equal(selectPluralCategory(1e-7, 'ru'), 'other');
	assert.equal(selectPluralCategory(2.5e-3, 'en'), 'other');
	assert.equal(selectPluralCategory(1.5e-3, 'ar'), 'other');
	// eksponen positif yang bernilai integer tetap mengikuti aturan integer
	assert.equal(selectPluralCategory(1.5e2, 'ru'), 'many'); // 150 → mod10=0
	assert.equal(selectPluralCategory(2.1e1, 'en'), 'other'); // 21 ≠ 1
	assert.equal(selectPluralCategory(1e0, 'en'), 'one'); // 1
});

test('interpolate: substitutes known params, keeps unknown placeholders', () => {
	assert.equal(interpolate('Hello {{name}}!', { name: 'n8n' }), 'Hello n8n!');
	assert.equal(interpolate('{{ count }} item(s)', { count: 3 }), '3 item(s)');
	assert.equal(interpolate('Hi {{missing}}', {}), 'Hi {{missing}}');
	assert.equal(interpolate('no placeholders'), 'no placeholders');
});

test('LocalizedBackendMessages.t: native output + fallback chain locale → en → key', () => {
	assert.equal(LocalizedBackendMessages.t('save.workflow', {}, 'id'), 'Simpan alur kerja');
	assert.equal(LocalizedBackendMessages.t('save.workflow', {}, 'ru'), 'Сохранить процесс');
	assert.equal(
		LocalizedBackendMessages.t('node.success', {}, 'ar'),
		'تم التنفيذ بنجاح',
	);
	// kunci tak dikenal → dikembalikan apa adanya
	assert.equal(LocalizedBackendMessages.t('no.such.key', {}, 'id'), 'no.such.key');
	// parameter diinterpolasi
	assert.equal(
		LocalizedBackendMessages.t('settings.language', { unused: 1 }, 'zh'),
		'显示语言',
	);
});

test('LocalizedBackendMessages.tp: plural variant lookup with graceful fallback', () => {
	// tanpa varian plural di kamus → jatuh ke kunci polos
	assert.equal(LocalizedBackendMessages.tp('save.workflow', 5, {}, 'en'), 'Save workflow');
	// suntik varian plural sementara untuk membuktikan pemilihan kategori
	const en = NATIVE_DICTIONARIES.en;
	const id = NATIVE_DICTIONARIES.id;
	en['items#one'] = '{{count}} item';
	en['items#other'] = '{{count}} items';
	id['items#other'] = '{{count}} butir';
	try {
		assert.equal(LocalizedBackendMessages.tp('items', 1, {}, 'en'), '1 item');
		assert.equal(LocalizedBackendMessages.tp('items', 4, {}, 'en'), '4 items');
		assert.equal(LocalizedBackendMessages.tp('items', 4, {}, 'id'), '4 butir');
		// ru mengikuti kategori few/many: varian tidak ada di ru → fallback en
		assert.equal(LocalizedBackendMessages.tp('items', 3, {}, 'ru'), '3 items');
		assert.equal(LocalizedBackendMessages.tp('items', 11, {}, 'ru'), '11 items');
	} finally {
		delete en['items#one'];
		delete en['items#other'];
		delete id['items#other'];
	}
});

test('SettingsLocalizationAdapter: Phase 4A API now covers all six locales', () => {
	const state = SettingsLocalizationAdapter.getState();
	assert.deepEqual(
		state.supportedLanguages.map((l) => l.code).sort(),
		['ar', 'en', 'id', 'jv', 'ru', 'zh'],
	);
	assert.ok(state.supportedLanguages.find((l) => l.code === 'id')?.label === 'Bahasa Indonesia');
	assert.ok(state.supportedLanguages.find((l) => l.code === 'ar')?.label === 'العربية');
	assert.equal(typeof state.isUpdateNoticeSuppressed, 'boolean');
});

test('SettingsLocalizationAdapter.setLanguage: syncs NativeLocalizationService, rejects unknown codes', () => {
	NativeLocalizationService.setLocale('id');
	SettingsLocalizationAdapter.setLanguage('jv');
	assert.equal(NativeLocalizationService.getLocale(), 'jv');
	assert.equal(SettingsLocalizationAdapter.getState().currentLanguage, 'jv');
	assert.equal(LocalizedBackendMessages.t('execute.workflow'), 'Lakokake alur kerja');

	SettingsLocalizationAdapter.setLanguage('ru');
	assert.equal(NativeLocalizationService.getLocale(), 'ru');
	assert.equal(LocalizedBackendMessages.t('execute.workflow'), 'Запустить процесс');

	// kode tak dikenal ditolak — state tidak berubah
	SettingsLocalizationAdapter.setLanguage('xx');
	assert.equal(NativeLocalizationService.getLocale(), 'ru');
	assert.equal(SettingsLocalizationAdapter.getState().currentLanguage, 'ru');

	assert.equal(SettingsLocalizationAdapter.suppressAggressiveUpdateNotice(), true);

	// mundur ke id untuk determinisme suite lain
	SettingsLocalizationAdapter.setLanguage('id');
	assert.equal(NativeLocalizationService.getLocale(), 'id');
});
