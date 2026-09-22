/**
 * The localization boundary (Task G/H).
 *
 * The frontend owns locale **identity**, **direction**, **message keys**, the
 * **fallback chain** and the plural *contract*. It owns no dictionaries, no
 * grammar tables and no translation runtime — those belong to the future
 * Translation LEGO, which receives catalogs through `ui:message:catalog`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FALLBACK_LOCALE,
  MESSAGE_KEY_GRAMMAR,
  MESSAGE_SLOTS,
  PLURAL_CATEGORIES,
  SUPPORTED_LOCALES,
  createPluralSelector,
  createTranslator,
  describeLocalizationContract,
  describeLocales,
  directionOf,
  isSupportedLocale,
  localeMetadata,
  pluralKey,
  unmappedMessageSlots,
} from '../src/i18n.mjs';
import { PACKAGE_ROOT, loadManifests } from '../src/manifests.mjs';
import { createFrontendLego } from '../src/lego.mjs';

const manifests = loadManifests();
const LOCALE_SET = ['id', 'en', 'ar', 'zh', 'ru', 'jv'];

test('the declared locale set is exactly the six contract locales, with a fallback', () => {
  assert.deepEqual(SUPPORTED_LOCALES.map((locale) => locale.code), LOCALE_SET);
  assert.equal(FALLBACK_LOCALE, 'en');
  for (const locale of SUPPORTED_LOCALES) {
    assert.equal(typeof locale.englishName, 'string');
    assert.equal(typeof locale.nativeName, 'string', 'a native name is what a language picker shows');
    assert.ok(['ltr', 'rtl'].includes(locale.direction));
    assert.equal(locale.status, 'declared', 'declared is the honest state before Translation exists');
  }
  assert.equal(isSupportedLocale('jv'), true);
  assert.equal(isSupportedLocale('eo'), false);
  const described = describeLocales();
  assert.deepEqual(described.supported.map((locale) => locale.code), LOCALE_SET);
  assert.deepEqual(described.rtl, ['ar']);
  assert.match(described.dictionaries, /none/);
  // Everything the browser does not need lives in the contract description, not the
  // boot payload: locale identity travels, documentation does not.
  assert.deepEqual(Object.keys(described).sort(), ['dictionaries', 'fallback', 'rtl', 'supported']);
  const contract = describeLocalizationContract();
  assert.deepEqual(contract.locales.map((locale) => locale.code), LOCALE_SET);
  assert.equal(contract.fallback, 'en');
  assert.deepEqual(contract.pluralCategories, PLURAL_CATEGORIES);
  assert.match(contract.pluralRules, /Translation LEGO/);
  assert.ok(contract.ownedByFrontend.includes('direction metadata'));
  assert.ok(contract.notOwnedByFrontend.includes('dictionaries'));
});

test('direction is contract metadata, not a component decision', () => {
  // The six required answers, spelled out.
  assert.deepEqual(
    Object.fromEntries(LOCALE_SET.map((locale) => [locale, directionOf(locale)])),
    { id: 'ltr', en: 'ltr', ar: 'rtl', zh: 'ltr', ru: 'ltr', jv: 'ltr' },
  );
  assert.equal(directionOf('AR'), 'rtl', 'locale identity is case-insensitive');
  assert.equal(directionOf('ar-SA'), 'rtl', 'a region subtag is a locale, not a new direction');
  assert.equal(directionOf('eo'), 'ltr', 'an unknown locale degrades to ltr instead of throwing');
  assert.equal(localeMetadata('ru').code, 'ru');
  assert.equal(localeMetadata('nope').code, FALLBACK_LOCALE, 'an unknown locale resolves to the fallback identity');
});

test('the assembly publishes the direction of every served locale', () => {
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  const readiness = frontend.localeReadiness({ supported: LOCALE_SET, fallback: 'en' });
  assert.deepEqual(readiness.supported, LOCALE_SET);
  assert.equal(readiness.complete, true);
  assert.deepEqual(readiness.missing, []);
  assert.equal(readiness.fallback, 'en');
  assert.deepEqual(readiness.rtl, ['ar']);
  assert.deepEqual(readiness.directions, { id: 'ltr', en: 'ltr', ar: 'rtl', zh: 'ltr', ru: 'ltr', jv: 'ltr' });
  assert.equal(readiness.capability, 'declared-not-installed', 'the translator is a capability, and it is not installed');
  // A locale nobody serves is reported missing, not silently dropped.
  const partial = frontend.localeReadiness({ supported: [...LOCALE_SET, 'eo'], fallback: 'en' });
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missing, ['eo']);
});

test('the fallback chain is locale → en → the raw key, and it never throws', () => {
  const translator = createTranslator({
    locale: 'ar',
    catalogs: [
      { locale: 'ar', entries: { 'settings.title': 'الإعدادات', 'node-picker.nodes-selected.one': 'عقدة واحدة' } },
      { locale: 'en', entries: { 'settings.title': 'Settings', 'settings.save': 'Save' } },
    ],
  });
  assert.equal(translator.locale, 'ar');
  assert.equal(translator.direction, 'rtl');
  assert.equal(translator.t('settings.title'), 'الإعدادات', 'the active locale wins');
  assert.equal(translator.t('settings.save'), 'Save', 'a missing key falls back to en');
  assert.equal(translator.t('settings.not-there'), 'settings.not-there', 'and then to the key itself');
  assert.equal(translator.has('settings.save'), true);
  assert.equal(translator.has('settings.not-there'), false);
  assert.equal(translator.t('settings.title', {}), 'الإعدادات');
  // Unknown placeholders are left intact: never "undefined" in a UI.
  const withParams = createTranslator({ locale: 'en', catalogs: [{ locale: 'en', entries: { 'node-picker.title': 'Nodes: {count}' } }] });
  assert.equal(withParams.t('node-picker.title', { count: 3 }), 'Nodes: 3');
  assert.equal(withParams.t('node-picker.title'), 'Nodes: {count}');
});

test('adding a catalog is additive and immutable — the old translator keeps working', () => {
  const base = createTranslator({ locale: 'id' });
  const extended = base.withCatalog({ locale: 'id', entries: { 'dashboard.title': 'Dasbor' } });
  assert.equal(base.t('dashboard.title'), 'dashboard.title', 'the original is unchanged');
  assert.equal(extended.t('dashboard.title'), 'Dasbor');
  assert.deepEqual(extended.keys(), ['dashboard.title']);
});

test('pluralization is a contract here and data elsewhere', () => {
  assert.deepEqual(PLURAL_CATEGORIES, ['zero', 'one', 'two', 'few', 'many', 'other']);
  assert.equal(pluralKey('node-picker.nodes-selected', 'one'), 'node-picker.nodes-selected.one');
  assert.throws(() => pluralKey('node-picker.nodes-selected', 'some'), /unknown plural category/);
  // Without rules the selector is English-like and claims nothing about Arabic.
  const plain = createPluralSelector();
  assert.equal(plain(1, 'ar'), 'one');
  assert.equal(plain(3, 'ar'), 'other');
  // With rules the language decides; the contract only asks the question.
  const arabic = createPluralSelector({ rules: { ar: (count) => (count === 0 ? 'zero' : count === 1 ? 'one' : count === 2 ? 'two' : count <= 10 ? 'few' : 'other') } });
  assert.equal(arabic(0, 'ar'), 'zero');
  assert.equal(arabic(2, 'ar'), 'two');
  assert.equal(arabic(5, 'ar'), 'few');

  const translator = createTranslator({
    locale: 'en',
    catalogs: [{ locale: 'en', entries: { 'node-picker.nodes-selected.one': '1 node selected', 'node-picker.nodes-selected.other': '{count} nodes selected' } }],
  });
  assert.equal(translator.tn('node-picker.nodes-selected', 1), '1 node selected');
  assert.equal(translator.tn('node-picker.nodes-selected', 4), '4 nodes selected');
  assert.equal(translator.tn('node-picker.nodes-missing', 4), 'node-picker.nodes-missing', 'a missing plural key still degrades to the key');
  assert.equal(translator.pluralCategory(1), 'one');
});

test('message keys belong to the frontend, dictionaries do not', () => {
  assert.equal(MESSAGE_KEY_GRAMMAR.test('settings.title'), true);
  assert.equal(MESSAGE_KEY_GRAMMAR.test('node-picker.nodes-selected.one'), true, 'plural categories fit the grammar');
  assert.equal(MESSAGE_KEY_GRAMMAR.test('Settings.Title'), false);
  assert.ok(MESSAGE_SLOTS.length >= 10);
  // Every slot is reachable from a declared surface: a slot nobody owns is a string
  // that gets hard-coded somewhere instead.
  assert.deepEqual(unmappedMessageSlots(manifests.surfaces), []);
  for (const slot of MESSAGE_SLOTS) {
    assert.ok(manifests.surfaces.some((surface) => (surface.messageSlots ?? []).includes(slot.id)), `${slot.id} is owned by a surface`);
  }
  // The package ships no dictionaries and loads nothing.
  const source = readFileSync(join(PACKAGE_ROOT, 'src', 'i18n.mjs'), 'utf8');
  assert.equal(/fetch\(|import\(/.test(source), false, 'no dictionary loading in the frontend');
  assert.equal(/from 'node:/.test(source), false, 'and it stays browser-safe (no node:* import)');
});

test('error codes map to message keys in a declared slot, so translation stays possible', async () => {
  const { ERROR_CODES, normalizeError, toDisplayModel } = await import('../src/errors.mjs');
  const { assertErrorKeysUseDeclaredSlots } = await import('../src/errors.mjs');
  assert.ok(Object.keys(ERROR_CODES).length > 0);
  assert.equal(assertErrorKeysUseDeclaredSlots(), true, 'every error key sits in a declared slot');

  const keys = await (await import('../src/errors.mjs')).errorMessageKeys();
  assert.ok(keys.length > 0);
  for (const key of keys) {
    assert.equal(MESSAGE_KEY_GRAMMAR.test(key), true, `${key} is a translatable key`);
    assert.equal(key.split('.')[0], 'backend-errors', 'error text lives in the errors slot');
  }
  // A failure from the backend becomes a display model with a key, not a sentence.
  const model = toDisplayModel(normalizeError({ status: 401, message: 'unauthorized' }));
  assert.equal(MESSAGE_KEY_GRAMMAR.test(model.messageKey), true);
  assert.ok(keys.includes(model.messageKey), 'and the key is one the contract declares');
  assert.ok(model.fallbackText.length > 0, 'a fallback exists for the moment before translation');
});

test('no unrelated LEGO carries translation content', () => {
  // The only non-ASCII literals in the package are the locale native names.
  const i18n = readFileSync(join(PACKAGE_ROOT, 'src', 'i18n.mjs'), 'utf8');
  for (const name of ['Bahasa Indonesia', 'English', 'العربية', '中文', 'Русский', 'Basa Jawa']) {
    assert.ok(i18n.includes(name), `${name} is declared as a native name`);
  }
  for (const file of ['contract.mjs', 'registry.mjs', 'sublegos.mjs', 'lifecycle.mjs', 'profiles.mjs', 'impact.mjs', 'knowledge.mjs', 'boot.mjs', 'client.mjs']) {
    const source = readFileSync(join(PACKAGE_ROOT, 'src', file), 'utf8');
    assert.equal(/[\u0600-\u06ff\u4e00-\u9fff]/.test(source), false, `${file} carries no translation content`);
  }
});
