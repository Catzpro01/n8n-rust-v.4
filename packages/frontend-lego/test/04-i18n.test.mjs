/**
 * I5 — translation readiness without a translation system.
 *
 * P2.5 ships no dictionary: it ships the structure a future Translation LEGO
 * fills. These tests prove the structure is usable (keys are validated, the
 * fallback chain is deterministic, Arabic is RTL, placeholders survive) and that
 * nothing pretends to be translated.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FALLBACK_LOCALE,
  MESSAGE_SLOTS,
  SUPPORTED_LOCALES,
  buildMessageKey,
  createMessageCatalog,
  createTranslator,
  describeLocales,
  directionOf,
  parseMessageKey,
  resolveLocale,
  substitute,
} from '../src/i18n.mjs';

const catalogFor = (locale, entries, namespace = 'test') => createMessageCatalog({ locale, namespace, entries });

test('the six required locales are declared with direction metadata', () => {
  const codes = SUPPORTED_LOCALES.map((locale) => locale.code);
  assert.deepEqual(codes, ['id', 'en', 'ar', 'zh', 'ru', 'jv'], 'P2.5 locale order is part of the contract');
  assert.equal(directionOf('ar'), 'rtl');
  for (const code of ['id', 'en', 'zh', 'ru', 'jv']) assert.equal(directionOf(code), 'ltr');
  assert.equal(describeLocales().rtl.length, 1);
});

test('locale tags are normalized like the backend does', () => {
  assert.equal(resolveLocale('id-ID'), 'id');
  assert.equal(resolveLocale('ar_SA'), 'ar');
  assert.equal(resolveLocale('zh-CN'), 'zh');
  assert.equal(resolveLocale('en-GB'), 'en');
  assert.equal(resolveLocale('de'), FALLBACK_LOCALE, 'an unimplemented locale degrades, it does not throw');
  assert.equal(resolveLocale(null), FALLBACK_LOCALE);
  assert.equal(resolveLocale('ar', { defaultLocale: 'id' }), 'ar');
  assert.equal(resolveLocale('nope', { defaultLocale: 'id' }), 'id', 'an explicit default is honoured');
});

test('message keys follow the <slot>.<name> grammar and reject everything else', () => {
  assert.equal(buildMessageKey('navigation', 'settings_item'), 'navigation.settings-item');
  assert.equal(buildMessageKey('empty-states', 'workflow.list'), 'empty-states.workflow.list');
  assert.throws(() => buildMessageKey('not-a-slot', 'x'), /unknown message slot/);
  assert.throws(() => buildMessageKey('navigation', 'Bad Name!'), /invalid message name/);

  assert.deepEqual(parseMessageKey('backend-errors.session-expired'), { slot: 'backend-errors', name: 'session-expired' });
  assert.equal(parseMessageKey('unknown-slot.thing'), null);
  assert.equal(parseMessageKey('navigation'), null);
  assert.equal(parseMessageKey(42), null);
  assert.equal(parseMessageKey('navigation.Thing'), null, 'keys are lowercase by contract');
});

test('the thirteen message slots exist and cover the surfaces P2.5 names', () => {
  const expected = [
    'navigation',
    'settings',
    'dashboard',
    'node-menu',
    'node-descriptions',
    'forms',
    'dialogs',
    'notifications',
    'validation-errors',
    'backend-errors',
    'execution-errors',
    'empty-states',
    'system-messages',
  ];
  assert.deepEqual(MESSAGE_SLOTS.map((slot) => slot.id), expected);
  for (const slot of MESSAGE_SLOTS) {
    assert.ok(slot.title && slot.description, `${slot.id} needs documentation`);
    assert.ok(Array.isArray(slot.surfaces) && slot.surfaces.length > 0, `${slot.id} must name the surfaces it covers`);
  }
});

test('a catalog is validated on construction', () => {
  const catalog = catalogFor('id', { 'navigation.settings': 'Pengaturan' });
  assert.equal(catalog.locale, 'id');
  assert.deepEqual(catalog.slots, ['navigation']);
  assert.equal(catalog.meta.direction, 'ltr');

  assert.throws(() => catalogFor('de', { 'navigation.settings': 'x' }), /unknown locale "de"/);
  assert.throws(() => catalogFor('id', { 'settings-ish.thing': 'x' }), /outside the "<slot>.<name>" grammar/);
  assert.throws(() => catalogFor('id', { 'navigation.settings': '   ' }), /empty translations/);
  assert.throws(() => catalogFor('id', ['navigation.settings']), /entries must be an object/);
  assert.throws(() => createMessageCatalog({ locale: 'id', namespace: 'Bad Namespace', entries: {} }), /invalid catalog namespace/);
});

test('the fallback chain is locale → en → raw key and never throws', () => {
  const translator = createTranslator({
    locale: 'jv',
    catalogs: [
      catalogFor('en', { 'navigation.settings': 'Settings' }),
      catalogFor('jv', { 'navigation.settings': 'Setelan', 'navigation.javanese-only': 'Mung Jawa' }),
    ],
  });
  assert.equal(translator.locale, 'jv');
  assert.equal(translator.t('navigation.settings'), 'Setelan');
  assert.equal(translator.t('navigation.javanese-only'), 'Mung Jawa');
  assert.equal(translator.t('empty-states.workflows'), 'empty-states.workflows', 'a missing key returns itself, it never throws');
  assert.equal(translator.has('navigation.settings'), true);
  assert.equal(translator.has('empty-states.workflows'), false);
  assert.deepEqual(translator.keys(), ['navigation.javanese-only', 'navigation.settings']);
});

test('an Arabic catalog carries rtl direction and substitutes placeholders', () => {
  const translator = createTranslator({
    locale: 'ar',
    catalogs: [catalogFor('ar', { 'backend-errors.capability-unsupported': 'هذا المثيل لا يدعم «{feature}» بعد.' })],
  });
  assert.equal(translator.direction, 'rtl');
  assert.equal(translator.t('backend-errors.capability-unsupported', { feature: 'workflow-history' }), 'هذا المثيل لا يدعم «workflow-history» بعد.');
});

test('placeholders without a value stay intact — never "undefined"', () => {
  assert.equal(substitute('Node "{node}" failed: {error}', { node: 'HTTP Request' }), 'Node "HTTP Request" failed: {error}');
  assert.equal(substitute('{a} {b}', {}), '{a} {b}');
  assert.equal(substitute('{a}', { a: 0 }), '0', 'a falsy value is still a value');
});

test('catalogs are additive: a later LEGO cannot rewrite an earlier one', () => {
  const base = createTranslator({ locale: 'id', catalogs: [catalogFor('id', { 'navigation.settings': 'Setelan' }, 'asas')] });
  const extended = base.withCatalog(catalogFor('id', { 'empty-states.workflows': 'Belum ada alur kerja' }, 'tambahan'));
  assert.equal(base.t('empty-states.workflows'), 'empty-states.workflows', 'the original translator is unchanged');
  assert.equal(extended.t('empty-states.workflows'), 'Belum ada alur kerja');
  assert.equal(extended.t('navigation.settings'), 'Setelan', 'earlier catalogs survive');
});

test('nothing ships translated: no dictionaries, no locale switch in P2.5', () => {
  const empty = createTranslator({ locale: 'id' });
  assert.deepEqual(empty.keys(), []);
  assert.equal(empty.t('navigation.settings'), 'navigation.settings');
  assert.match(describeLocales().dictionaries, /^none/);
  for (const locale of describeLocales().supported) {
    assert.equal(locale.status, 'declared', `${locale.code} must not claim to be available`);
    assert.equal(locale.dictionary, undefined, 'no catalog may be attached to the locale model yet');
  }
});
