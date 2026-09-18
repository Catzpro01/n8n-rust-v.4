/**
 * AGENT-5 · LEGO PERSISTENCE — localization store, enforcer and settings adapter.
 *
 * Run: node --test tests/agent-5/
 *
 * These are behavioural tests over the reconstructed sources; they import the
 * TypeScript modules directly through Node's native type stripping, so no build
 * step and no npm dependency is required.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
	PERSISTENCE_DICTIONARIES,
	PERSISTENCE_TEXT_KEYS,
	PERSISTENCE_LOCALE_CODES,
	PERSISTENCE_LOCALES,
	EXECUTION_STATUSES,
	MemoryStorage,
	PersistenceLocaleStore,
} from '../../packages/reconstructed-engine/src/persistence-locale-store.ts';
import { UniversalLocaleEnforcer } from '../../packages/reconstructed-engine/src/universal-locale-enforcer.ts';
import {
	SUPPORTED_LANGUAGES,
	SettingsLocalizationAdapter,
} from '../../packages/workflow-lego/src/settings-localization-adapter.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* -------------------------------------------------------------------------- */
/* dictionary                                                                 */
/* -------------------------------------------------------------------------- */

test('every locale covers exactly the canonical key set', () => {
	for (const locale of PERSISTENCE_LOCALE_CODES) {
		const keys = Object.keys(PERSISTENCE_DICTIONARIES[locale]).sort();
		assert.deepEqual(keys, [...PERSISTENCE_TEXT_KEYS].sort(), `key drift in ${locale}`);
	}
});

test('no locale ships an empty translation', () => {
	for (const locale of PERSISTENCE_LOCALE_CODES) {
		for (const key of PERSISTENCE_TEXT_KEYS) {
			assert.notEqual(
				String(PERSISTENCE_DICTIONARIES[locale][key]).trim(),
				'',
				`empty ${locale}:${key}`,
			);
		}
	}
});

test('all eight n8n execution statuses have a label in every locale', () => {
	const store = new PersistenceLocaleStore(new MemoryStorage(), 'id');
	assert.deepEqual([...EXECUTION_STATUSES].sort(), [
		'canceled',
		'crashed',
		'error',
		'new',
		'running',
		'success',
		'unknown',
		'waiting',
	]);
	for (const locale of PERSISTENCE_LOCALE_CODES) {
		store.setLocale(locale);
		for (const status of EXECUTION_STATUSES) {
			const label = store.status(status);
			assert.ok(label.length > 0, `${locale}/${status}`);
			assert.notEqual(label, status, `${locale}/${status} is untranslated`);
		}
	}
	assert.equal(store.leaks().length, 0, 'rendering every status recorded a miss');
});

test('{count} is interpolated, not leaked, in every locale', () => {
	const store = new PersistenceLocaleStore(new MemoryStorage(), 'id');
	for (const locale of PERSISTENCE_LOCALE_CODES) {
		const value = store.text('executionsList.confirmMessage.message', { count: 7 }, locale);
		assert.ok(value.includes('7'), `${locale}: ${value}`);
		assert.ok(!value.includes('{'), `${locale} leaked a placeholder: ${value}`);
	}
});

test('arabic is rendered right-to-left', () => {
	assert.equal(PERSISTENCE_LOCALES.ar.direction, 'rtl');
	assert.equal(PERSISTENCE_LOCALES.id.direction, 'ltr');
});

/* -------------------------------------------------------------------------- */
/* store / persistence                                                        */
/* -------------------------------------------------------------------------- */

test('the preference survives a fresh store over the same storage', () => {
	const storage = new MemoryStorage();
	const first = new PersistenceLocaleStore(storage, 'id');
	assert.equal(first.getLocale(), 'id');
	first.setLocale('zh');
	const second = new PersistenceLocaleStore(storage);
	assert.equal(second.getLocale(), 'zh');
	assert.equal(second.status('success'), '成功');
});

test('a corrupt stored preference falls back to id, never to English', () => {
	const storage = new MemoryStorage();
	storage.setItem('n8n.persistence.locale', 'de-AT');
	const store = new PersistenceLocaleStore(storage);
	assert.equal(store.getLocale(), 'id');
	assert.deepEqual(store.unsupportedLocales(), ['de-AT']);
	assert.equal(store.status('running'), 'Berjalan');
});

test('an unknown locale is repaired in place and recorded', () => {
	const storage = new MemoryStorage();
	const store = new PersistenceLocaleStore(storage, 'id');
	assert.equal(store.setLocale('klingon'), 'id');
	assert.deepEqual(store.unsupportedLocales(), ['klingon']);
	assert.equal(storage.getItem('n8n.persistence.locale'), 'id');
});

test('reset clears the persisted preference', () => {
	const storage = new MemoryStorage();
	const store = new PersistenceLocaleStore(storage, 'id');
	store.setLocale('ru');
	store.reset();
	assert.equal(store.getLocale(), 'id');
	assert.equal(storage.getItem('n8n.persistence.locale'), null);
});

test('snapshot reports the live persistence state', () => {
	const storage = new MemoryStorage();
	const store = new PersistenceLocaleStore(storage, 'id');
	store.setLocale('ar');
	const snapshot = store.snapshot();
	assert.equal(snapshot.locale, 'ar');
	assert.equal(snapshot.persisted, 'ar');
	assert.equal(snapshot.direction, 'rtl');
	assert.equal(snapshot.storageBackend, 'memory');
	assert.deepEqual(snapshot.supportedLocales, ['id', 'en', 'jv', 'ar', 'zh', 'ru']);
});

test('a missing key is reported as a leak instead of silently falling back', () => {
	const store = new PersistenceLocaleStore(new MemoryStorage(), 'id');
	store.clearLeaks();
	const value = store.text('does.not.exist');
	assert.equal(value, 'does.not.exist');
	assert.deepEqual(store.leaks(), ['id:does.not.exist']);
	store.clearLeaks();
	assert.deepEqual(store.leaks(), []);
});

/* -------------------------------------------------------------------------- */
/* enforcer + settings adapter                                                */
/* -------------------------------------------------------------------------- */

test('the enforcer keeps the locale inside the supported set', () => {
	assert.equal(UniversalLocaleEnforcer.enforce('jv'), 'jv');
	assert.equal(UniversalLocaleEnforcer.enforce('pt-BR'), 'id');
	assert.equal(UniversalLocaleEnforcer.enforce(''), 'id');
	assert.equal(UniversalLocaleEnforcer.isSupported('zh'), true);
	assert.equal(UniversalLocaleEnforcer.isSupported('fr'), false);
});

test('the enforcer records untranslated English instead of hiding it', () => {
	UniversalLocaleEnforcer.clearLeaks();
	assert.equal(UniversalLocaleEnforcer.cleanText('Running', 'en', {}), 'Running');
	assert.equal(UniversalLocaleEnforcer.cleanText('Running', 'id', { Running: 'Berjalan' }), 'Berjalan');
	assert.equal(UniversalLocaleEnforcer.cleanText('Crashed', 'id', {}), 'Crashed');
	assert.deepEqual(UniversalLocaleEnforcer.leaks(), ['id:Crashed']);
	UniversalLocaleEnforcer.clearLeaks();
	assert.equal(UniversalLocaleEnforcer.hasLeaks(), false);
});

test('the settings adapter offers the same six languages as the runtime', () => {
	const codes = SUPPORTED_LANGUAGES.map((entry) => entry.code).sort();
	assert.deepEqual(codes, [...PERSISTENCE_LOCALE_CODES].sort());
	assert.equal(SettingsLocalizationAdapter.isSupported('jv'), true);
	assert.equal(SettingsLocalizationAdapter.setLanguage('klingon'), 'id');
});

test('settings and store agree through one shared storage backend', () => {
	const storage = new MemoryStorage();
	SettingsLocalizationAdapter.useStorage(storage);
	SettingsLocalizationAdapter.setLanguage('ar');
	const store = new PersistenceLocaleStore(storage);
	assert.equal(store.getLocale(), 'ar');
	assert.equal(SettingsLocalizationAdapter.getDirection(), 'rtl');
	store.setLocale('ru');
	SettingsLocalizationAdapter.hydrate();
	assert.equal(SettingsLocalizationAdapter.getState().currentLanguage, 'ru');
	SettingsLocalizationAdapter.useStorage(null);
});

/* -------------------------------------------------------------------------- */
/* gate                                                                       */
/* -------------------------------------------------------------------------- */

test('tools/localization-leak-gate.mjs is green on the committed tree', () => {
	const evidence = join(tmpdir(), 'localization-leak-gate.node-test.json');
	const res = spawnSync(
		process.execPath,
		[join(REPO, 'tools', 'localization-leak-gate.mjs'), '--json', evidence, '--quiet'],
		{ cwd: REPO, encoding: 'utf8' },
	);
	assert.equal(res.status, 0, `gate output: ${res.stdout}${res.stderr}`);
});
