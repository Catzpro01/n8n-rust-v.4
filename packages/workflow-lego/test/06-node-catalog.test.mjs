/**
 * Gate 6 — built-in node catalog (Native Multi-Locale wave, Agent 2).
 *
 * Verifies:
 *   1. the TypeScript boundary catalog is byte-identical in keys and values to
 *      the reconstructed-engine ESM runtime catalog (drift guard);
 *   2. the typed registration seam works on the BackendLocalizationService;
 *   3. localizeNodeMetadata is pure and protects machine fields.
 *
 * The TS sources use extensionless imports per the package tsconfig
 * (module: commonjs), so they are compiled to a temp dir and loaded as CJS.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(PKG, '..', '..');

let TS;
let BackendLocalizationService;
let NativeLocalizationService;

before(async () => {
	const out = mkdtempSync(join(tmpdir(), 'lego-node-catalog-'));
	const result = spawnSync(
		process.execPath,
		[
			join(PKG, 'node_modules', 'typescript', 'bin', 'tsc'),
			'--module', 'commonjs',
			'--target', 'ES2022',
			'--strict',
			'--skipLibCheck',
			'--outDir', out,
			'--rootDir', join(PKG, 'src'),
			join(PKG, 'src', 'node-catalog-localization.ts'),
			join(PKG, 'src', 'backend-localization-service.ts'),
		],
		{ encoding: 'utf8' },
	);
	assert.equal(result.status, 0, `tsc emit failed:\n${result.stdout}\n${result.stderr}`);
	TS = require(join(out, 'node-catalog-localization.js'));
	BackendLocalizationService = require(join(out, 'backend-localization-service.js')).BackendLocalizationService;
	NativeLocalizationService = require(join(out, 'backend-localization-service.js')).NativeLocalizationService;
});

const {
	BUILTIN_NODE_CATALOG: MJS_CATALOG,
	BUILTIN_NODE_ALIASES: MJS_ALIASES,
	BUILTIN_NODE_CATALOG_KEYS: MJS_KEYS,
} = await import(join(REPO, 'packages', 'reconstructed-engine', 'node-catalog.mjs'));

test('TS catalog and ESM runtime catalog are identical (no drift)', () => {
	assert.deepEqual([...TS.BUILTIN_NODE_ALIASES], [...MJS_ALIASES]);
	assert.deepEqual([...TS.BUILTIN_NODE_CATALOG_KEYS], [...MJS_KEYS]);
	for (const locale of ['id', 'jv', 'ar', 'zh', 'ru', 'en']) {
		const tsKeys = Object.keys(TS.BUILTIN_NODE_CATALOG[locale]).sort();
		const mjsKeys = Object.keys(MJS_CATALOG[locale]).sort();
		assert.deepEqual(tsKeys, mjsKeys, `${locale}: key set drift`);
		for (const key of tsKeys) {
			assert.equal(TS.BUILTIN_NODE_CATALOG[locale][key], MJS_CATALOG[locale][key], `${locale}.${key}: value drift`);
		}
	}
});

test('catalog completeness: 15 core nodes, canonical keys non-empty in all six locales', () => {
	assert.equal(TS.BUILTIN_NODE_ALIASES.length, 15);
	for (const locale of ['id', 'jv', 'ar', 'zh', 'ru', 'en']) {
		for (const key of TS.BUILTIN_NODE_CATALOG_KEYS) {
			const value = TS.BUILTIN_NODE_CATALOG[locale][key];
			assert.equal(typeof value, 'string', `${locale}.${key} type`);
			assert.ok(value.length > 0, `${locale}.${key} empty`);
		}
	}
});

test('registration seam on BackendLocalizationService translates node keys per locale', () => {
	const service = new BackendLocalizationService('en');
	TS.registerBuiltInNodeCatalog(service);
	assert.equal(service.translate('node.code.label'), 'Code');
	service.setLocale('zh');
	assert.equal(service.translate('node.code.label'), '代码');
	assert.equal(service.translate('node.webhook.parameters.path'), '路径');
	service.setLocale('ar');
	assert.equal(service.translate('node.scheduleTrigger.label'), 'مُحفِّز الجدولة');
});

test('localizeNodeMetadata is pure and protects machine fields', () => {
	const original = {
		name: 'My Code',
		type: 'n8n-nodes-base.code',
		value: 'n8n-nodes-base.code',
		inputs: ['main'],
		outputs: ['main'],
		parameters: { mode: 'runOnceForEachItem', jsCode: 'return items; $json.secret' },
		id: 'xyz-9',
	};
	const snapshot = structuredClone(original);
	const localized = TS.localizeNodeMetadata(original, 'ru');

	assert.deepEqual(original, snapshot, 'input node was mutated');
	assert.equal(localized.label, 'Код');
	assert.equal(localized.description, 'Выполняет собственный JavaScript или Python код');
	assert.equal(localized.name, 'My Code');
	assert.equal(localized.type, 'n8n-nodes-base.code');
	assert.equal(localized.value, 'n8n-nodes-base.code');
	assert.deepEqual(localized.parameters, original.parameters, 'parameters subtree must stay intact');
	assert.equal(localized.id, 'xyz-9');
});

test('unknown node types are never guessed at', () => {
	const unknown = { name: 'X', type: 'n8n-nodes-base.definitelyNotReal', label: 'Keep' };
	const localized = TS.localizeNodeMetadata(unknown, 'id');
	assert.equal(localized.label, 'Keep');
	assert.equal(localized.description, undefined);
	assert.equal(TS.getNodeCatalogEntry('definitelyNotReal'), null);
	assert.equal(TS.nodeAliasOf('n8n-nodes-base.code'), 'code');
	assert.equal(NativeLocalizationService.normalizeLocale('zh-CN'), 'zh');
});

test('community catalogs are namespaced and reject empty package names', () => {
	const catalog = TS.createCommunityNodeCatalog('id', 'n8n-nodes-community.demo', {
		hello: { label: 'Salam Demo', description: 'Komunitas demo', parameters: { greeting: 'Salam' } },
	});
	assert.equal(catalog['community.n8n-nodes-community.demo.hello.label'], 'Salam Demo');
	assert.equal(catalog['community.n8n-nodes-community.demo.hello.parameters.greeting'], 'Salam');
	assert.throws(() => TS.createCommunityNodeCatalog('id', '  ', {}), TypeError);
});
