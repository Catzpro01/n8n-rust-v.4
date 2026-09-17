/**
 * Zero Cross-Language Leak Enforcer — tests.
 * Run: node --experimental-strip-types --test packages/reconstructed-engine/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	SUPPORTED_LOCALES,
	REFERENCE_LOCALE,
	UniversalLocaleEnforcer,
	isLocaleDictionary,
	auditDictionary,
	auditLocaleDictionaries,
	assertNoCrossLanguageLeak,
} from '../src/universal-locale-enforcer.ts';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- unit: resolution
test('enforceLocale: supported locales pass through, unknown falls back to reference', () => {
	for (const l of SUPPORTED_LOCALES) assert.equal(UniversalLocaleEnforcer.enforceLocale(l), l);
	assert.equal(UniversalLocaleEnforcer.enforceLocale('klingon'), REFERENCE_LOCALE);
	assert.equal(UniversalLocaleEnforcer.enforceLocale(''), REFERENCE_LOCALE);
});

test('translate: resolves locale, then reference, then the key itself', () => {
	const dict = { id: { hello: 'Halo' }, jv: { hello: 'Halo' } };
	assert.equal(UniversalLocaleEnforcer.translate(dict, 'hello', 'jv'), 'Halo');
	assert.equal(UniversalLocaleEnforcer.translate(dict, 'hello', 'de'), 'Halo', 'unknown locale -> reference');
	assert.equal(UniversalLocaleEnforcer.translate(dict, 'nope', 'jv'), 'nope', 'unknown key -> key itself');
});

// ---------------------------------------------------------------- unit: detection
test('isLocaleDictionary accepts only { locale: { key: string } } shapes', () => {
	assert.equal(isLocaleDictionary({ id: { a: 'x' } }), true);
	assert.equal(isLocaleDictionary({}), false);
	assert.equal(isLocaleDictionary({ id: {} }), false, 'empty locale block rejected');
	assert.equal(isLocaleDictionary({ id: { a: 1 } }), false, 'non-string value rejected');
	assert.equal(isLocaleDictionary(['id']), false);
	assert.equal(isLocaleDictionary(null), false);
});

test('a fully covered dictionary is clean', () => {
	const audit = auditDictionary('ok', {
		id: { greeting: 'Selamat pagi', brand: 'Telegram' },
		jv: { greeting: 'Sugeng enjing', brand: 'Telegram' },
	});
	assert.equal(audit.clean, true);
	assert.deepEqual(audit.missingKeys, []);
	assert.deepEqual(audit.untranslated, [], 'brand names are not flagged as leaks');
});

test('missing keys are reported per locale (runtime falls back to reference)', () => {
	const audit = auditDictionary('gaps', {
		id: { a: 'satu', b: 'dua' },
		jv: { a: 'setunggal' },
	});
	assert.equal(audit.clean, false);
	assert.deepEqual(audit.missingKeys, [{ locale: 'jv', key: 'b', value: '' }]);
});

test('byte-identical prose is flagged as untranslated; short proper nouns are not', () => {
	const audit = auditDictionary('prose', {
		id: { sentence: 'Runs the flow on receiving an HTTP request', brand: 'Telegram' },
		ru: { sentence: 'Runs the flow on receiving an HTTP request', brand: 'Telegram' },
	});
	assert.deepEqual(audit.untranslated, [{ locale: 'ru', key: 'sentence', value: 'Runs the flow on receiving an HTTP request' }]);
});

test('blank values are reported separately', () => {
	const audit = auditDictionary('blank', { id: { a: 'isi' }, ar: { a: '   ' } });
	assert.equal(audit.blankValues.length, 1);
	assert.equal(audit.blankValues[0].locale, 'ar');
});

test('assertNoCrossLanguageLeak throws only on a dirty report', () => {
	const clean = auditLocaleDictionaries({ m: { D: { id: { a: 'satu' }, jv: { a: 'setunggal' } } } });
	assert.doesNotThrow(() => assertNoCrossLanguageLeak(clean));
	// NB: an *empty* locale block is rejected by isLocaleDictionary (see test above), so a
	// coverage gap — not an empty block — is what makes a dictionary dirty.
	const dirty = auditLocaleDictionaries({ m: { D: { id: { a: 'satu', b: 'dua' }, jv: { a: 'setunggal' } } } });
	assert.throws(() => assertNoCrossLanguageLeak(dirty), /Cross-language leak detected/);
});

// ---------------------------------------------------------------- integration: real modules
const evidencePath = resolve(here, '../../../docs/isolation/evidence/locale-leak-audit.json');

test('live modules: audit still matches the frozen evidence (drift guard)', async () => {
	const src = resolve(here, '../src');
	const names = ['node-catalog-dictionary', 'node-parameter-label-sanitizer', 'canvas-node-locales'];
	const modules: Record<string, Record<string, unknown>> = {};
	for (const n of names) modules[n] = (await import(`../src/${n}.ts`)) as Record<string, unknown>;

	const report = auditLocaleDictionaries(modules);
	const frozen = JSON.parse(readFileSync(evidencePath, 'utf8'));

	assert.equal(report.totals.dictionaries, frozen.totals.dictionaries);
	assert.equal(report.totals.keys, frozen.totals.keys);
	assert.equal(report.totals.findings, frozen.totals.findings, 'a new or fixed leak must be re-frozen deliberately');
});

test('live modules: the known leak is recorded, bounded and attributable', async () => {
	const src = resolve(here, '../src');
	const mods: Record<string, Record<string, unknown>> = {
		node_catalog: (await import('../src/node-catalog-dictionary.ts')) as Record<string, unknown>,
		node_params: (await import('../src/node-parameter-label-sanitizer.ts')) as Record<string, unknown>,
		canvas: (await import('../src/canvas-node-locales.ts')) as Record<string, unknown>,
	};
	const report = auditLocaleDictionaries(mods);
	void src;

	// Canvas dictionary is fully translated; the two catalog dictionaries are not.
	const byName = new Map(report.dictionaries.map((d) => [d.name, d]));
	assert.equal(byName.get('canvas.CANVAS_NODE_LOCALES')?.clean, true);
	assert.equal(byName.get('node_catalog.TRIGGER_PANEL_LOCALES')?.clean, false);
	assert.equal(byName.get('node_params.NODE_ACTIONS_AND_PARAMS')?.clean, false);

	// Every finding is a coverage gap (missing key), not a blank or mistranslated value.
	for (const d of report.dictionaries) {
		assert.equal(d.blankValues.length, 0, `${d.name}: no blank translations allowed`);
		assert.equal(d.untranslated.length, 0, `${d.name}: no identical-prose translations allowed`);
	}
});
