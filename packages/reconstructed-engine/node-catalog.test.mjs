import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_NODE_ALIASES,
  BUILTIN_NODE_CATALOG,
  BUILTIN_NODE_CATALOG_KEYS,
  createCommunityNodeCatalog,
  getNodeCatalogEntry,
  localizeNodeMetadata,
  nodeAliasOf,
  registerBuiltInNodeCatalog,
  registerCommunityNodeCatalog,
} from './node-catalog.mjs';
import { PROTECTED_MACHINE_KEYS, UniversalLocaleEnforcer } from './localization.mjs';
import { WorkflowExecutionEngine } from './runner.mjs';

test('built-in catalog covers all 15 core node aliases in all six locales without drift', () => {
  assert.equal(BUILTIN_NODE_ALIASES.length, 15);
  const enKeys = Object.keys(BUILTIN_NODE_CATALOG.en).filter((k) => k.startsWith('node.')).sort();
  assert.deepEqual(enKeys, [...BUILTIN_NODE_CATALOG_KEYS].sort());
  assert.ok(enKeys.length >= 60, 'expected at least 60 canonical keys');

  for (const locale of ['id', 'jv', 'ar', 'zh', 'ru', 'en']) {
    const table = BUILTIN_NODE_CATALOG[locale];
    const canonicalKeys = Object.keys(table).filter((k) => k.startsWith('node.')).sort();
    assert.deepEqual(canonicalKeys, enKeys, `${locale} canonical key set drifted`);
    for (const key of enKeys) {
      assert.equal(typeof table[key], 'string', `${locale}.${key} must be a string`);
      assert.ok(table[key].length > 0, `${locale}.${key} is empty`);
    }
  }
});

test('non-English catalogs register English source text as value aliases without collisions', () => {
  const canonicalKeys = new Set(BUILTIN_NODE_CATALOG_KEYS);
  for (const locale of ['id', 'jv', 'ar', 'zh', 'ru']) {
    const table = BUILTIN_NODE_CATALOG[locale];
    for (const [key, nativeText] of Object.entries(BUILTIN_NODE_CATALOG.en)) {
      if (nativeText === table[key]) continue; // identical text needs no alias
      assert.equal(table[nativeText], table[key], `${locale}: alias for EN text "${nativeText}"`);
    }
    // shared English source text must map to one and only one native text
    const byEnText = new Map();
    for (const [key, nativeText] of Object.entries(BUILTIN_NODE_CATALOG.en)) {
      if (!canonicalKeys.has(key)) continue;
      const seen = byEnText.get(nativeText);
      if (seen === undefined) byEnText.set(nativeText, table[key]);
      else assert.equal(table[key], seen, `${locale}: EN text "${nativeText}" has inconsistent translations`);
    }
  }
});

test('nodeAliasOf strips the built-in prefix and rejects garbage', () => {
  assert.equal(nodeAliasOf('n8n-nodes-base.code'), 'code');
  assert.equal(nodeAliasOf('n8n-nodes-base.manualTrigger'), 'manualTrigger');
  assert.equal(nodeAliasOf('community.acme.thing'), 'community.acme.thing');
  assert.equal(nodeAliasOf(null), null);
  assert.equal(nodeAliasOf(42), null);
  assert.equal(nodeAliasOf('  '), null);
});

test('catalog registration seam works on the enforcer and keeps the en dictionary intact', () => {
  const enforcer = new UniversalLocaleEnforcer({ locale: 'id' });
  registerBuiltInNodeCatalog(enforcer);

  assert.equal(enforcer.translate('node.code.label', 'id'), 'Kode');
  assert.equal(enforcer.translate('node.code.label', 'ar'), 'كود');
  assert.equal(enforcer.translate('node.webhook.parameters.path', 'zh'), '路径');
  assert.equal(enforcer.translate('node.wait.label', 'ru'), 'Ожидание');
  assert.equal(enforcer.translate('node.manualTrigger.description', 'jv'), 'Nglakokake alur nalika tombol ing kanvas dituthuk');
  // English locale still serves the n8n 2.9.4 source text
  assert.equal(enforcer.translate('node.splitInBatches.label', 'en'), 'Loop Over Items (Split in Batches)');
});

test('enforceNodeDescription localizes label/description and protects the seven machine tokens', () => {
  const enforcer = new UniversalLocaleEnforcer({ locale: 'ar' });
  registerBuiltInNodeCatalog(enforcer);
  const original = {
    name: 'My Request',
    type: 'n8n-nodes-base.httpRequest',
    value: 'n8n-nodes-base.httpRequest',
    inputs: [{ type: 'main', value: 'input-0' }],
    outputs: [{ type: 'main', value: 'output-0' }],
    routing: { requestRules: [{ value: 'GET' }] },
    label: 'HTTP Request',
    description: 'Makes an HTTP request and returns the response data',
    parameters: { method: 'GET', url: 'https://example.com/{id}' },
    id: 'abc-123',
  };
  const snapshot = structuredClone(original);
  const localized = enforcer.enforceNodeDescription(original);

  assert.deepEqual(original, snapshot, 'input node was mutated');
  for (const key of PROTECTED_MACHINE_KEYS) assert.deepEqual(localized[key], original[key], `${key} changed`);
  assert.deepEqual(localized.parameters, original.parameters, 'parameters subtree was localized');
  assert.equal(localized.id, 'abc-123');
  assert.equal(localized.label, 'طلب HTTP');
  assert.equal(localized.description, 'إرسال طلب HTTP وإرجاع بيانات الاستجابة');
});

test('localizeNodeMetadata fills missing label/description and translates existing source text (pure)', () => {
  const bare = { name: 'Code Node', type: 'n8n-nodes-base.code', parameters: { mode: 'runOnceForEachItem' } };
  const snapshot = structuredClone(bare);

  const zh = localizeNodeMetadata(bare, 'zh');
  assert.deepEqual(bare, snapshot, 'input node was mutated');
  assert.equal(zh.label, '代码');
  assert.equal(zh.description, '运行自定义 JavaScript 或 Python 代码');
  assert.deepEqual(zh.parameters, bare.parameters);
  assert.equal(zh.name, 'Code Node');
  assert.equal(zh.type, 'n8n-nodes-base.code');

  // Existing English source label gets translated, not duplicated.
  const enLabeled = { ...bare, label: 'Code' };
  assert.equal(localizeNodeMetadata(enLabeled, 'ru').label, 'Код');

  // Unknown node types are returned untouched (no guessing).
  const unknown = { name: 'X', type: 'n8n-nodes-base.notARealNode', label: 'Keep Me' };
  const asIs = localizeNodeMetadata(unknown, 'id');
  assert.equal(asIs.label, 'Keep Me');
  assert.equal(asIs.description, undefined);
});

test('community node catalogs register through the same seam and stay namespaced', () => {
  const catalog = createCommunityNodeCatalog('id', 'n8n-nodes-community.example', {
    greeting: { label: 'Panggilan Salam', description: 'Mengirim salam dari komunitas', parameters: { name: 'Nama' } },
  });
  assert.equal(catalog['community.n8n-nodes-community.example.greeting.label'], 'Panggilan Salam');
  assert.equal(catalog['community.n8n-nodes-community.example.greeting.parameters.name'], 'Nama');

  const enforcer = new UniversalLocaleEnforcer({ locale: 'id' });
  registerCommunityNodeCatalog(enforcer, 'id', 'n8n-nodes-community.example', {
    greeting: { label: 'Panggilan Salam', description: 'Mengirim salam dari komunitas', parameters: { name: 'Nama' } },
  });
  const node = {
    name: 'Greeting',
    type: 'n8n-nodes-community.example.greeting',
    label: 'Panggilan Salam',
    translationKey: 'community.n8n-nodes-community.example.greeting.description',
  };
  const localized = enforcer.enforceNodeDescription(node);
  assert.equal(localized.name, 'Greeting');
  assert.equal(localized.type, 'n8n-nodes-community.example.greeting');
  assert.equal(localized.label, 'Panggilan Salam');
  assert.equal(localized.translationKey, 'Mengirim salam dari komunitas');

  assert.throws(() => createCommunityNodeCatalog('id', '', {}), TypeError);
});

test('engine auto-registers the built-in catalog and localizes execution log node labels', async () => {
  const definition = {
    nodes: [
      { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
      { name: 'Code Node', type: 'n8n-nodes-base.code', parameters: { mode: 'runOnceForEachItem' } },
    ],
    connections: {
      'Manual Trigger': { main: [[{ node: 'Code Node', type: 'main', index: 0 }]] },
    },
  };

  const engine = new WorkflowExecutionEngine(definition, { locale: 'zh' });
  const zhResult = await engine.runWorkflow();
  assert.equal(zhResult.status, 'COMPLETED');
  assert.equal(zhResult.executionLog[0].node, 'Manual Trigger', 'user node name must stay canonical');
  assert.equal(zhResult.executionLog[0].nodeLabel, '手动触发器');
  assert.equal(zhResult.executionLog[1].nodeLabel, '代码');
  assert.deepEqual(zhResult.data['Code Node'][0].json, {});

  // Locale switch at runtime re-localizes labels for known built-ins.
  engine.setLocale('ru');
  const ruResult = await engine.runWorkflow();
  assert.equal(ruResult.executionLog[1].nodeLabel, 'Код');

  // engine.localizeNodeMetadata uses the registered catalog.
  const meta = engine.localizeNodeMetadata({ name: 'C', type: 'n8n-nodes-base.code' });
  assert.equal(meta.label, 'Код');
});

test('user-supplied translations override the built-in catalog', async () => {
  const engine = new WorkflowExecutionEngine(
    { nodes: [{ name: 'Code Node', type: 'n8n-nodes-base.code', parameters: {} }], connections: {} },
    {
      locale: 'id',
      translations: { id: { 'node.code.label': 'Kode Kustom' } },
    },
  );
  const result = await engine.runWorkflow();
  assert.equal(result.executionLog[0].nodeLabel, 'Kode Kustom');
});

test('registerBuiltInNodeCatalog rejects services without the seam', () => {
  assert.throws(() => registerBuiltInNodeCatalog(null), TypeError);
  assert.throws(() => registerBuiltInNodeCatalog({}), TypeError);
});
