/**
 * W4 unit gate — built-in node registry (determinism, opt-in code eval).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodeRegistry, listNodeTypes, NODE_REGISTRY_VERSION } from '../index.mjs';

const call = (registry, type, node, items) => registry.get(type)(node, items, registry.context);

test('built-in registry exposes the baseline node types', () => {
  const registry = createNodeRegistry();
  const types = registry.list().map((entry) => entry.type);
  for (const type of [
    'n8n-nodes-base.manualTrigger',
    'n8n-nodes-base.start',
    'n8n-nodes-base.noOp',
    'n8n-nodes-base.set',
    'n8n-nodes-base.code',
    'n8n-nodes-base.function',
    'n8n-nodes-base.functionItem',
  ]) {
    assert.ok(types.includes(type), `${type} must be registered`);
  }
  assert.equal(registry.version, NODE_REGISTRY_VERSION);
  assert.ok(registry.list().every((entry) => entry.implemented === true && typeof entry.label === 'string'));
});

test('listNodeTypes is sorted and stable across calls', () => {
  const first = listNodeTypes().map((entry) => entry.type);
  const second = listNodeTypes().map((entry) => entry.type);
  assert.deepEqual(first, second);
  assert.deepEqual(first, [...first].sort((a, b) => a.localeCompare(b)));
});

test('manual trigger seeds the run with input items (deterministic)', () => {
  const registry = createNodeRegistry();
  const withInput = call(registry, 'n8n-nodes-base.manualTrigger', { name: 'T' }, [{ json: { seed: 1 } }]);
  assert.deepEqual(withInput, [{ json: { seed: 1 } }]);
  const withoutInput = call(registry, 'n8n-nodes-base.manualTrigger', { name: 'T' }, []);
  assert.deepEqual(withoutInput, [{ json: {} }]);
});

test('noOp passes items through unchanged (same reference)', () => {
  const registry = createNodeRegistry();
  const items = [{ json: { a: 1 } }];
  assert.equal(call(registry, 'n8n-nodes-base.noOp', { name: 'N' }, items), items);
});

test('set node supports the 1.x values shape, keepOnlySet and type coercion', () => {
  const registry = createNodeRegistry();
  const node = {
    name: 'Edit',
    type: 'n8n-nodes-base.set',
    parameters: {
      keepOnlySet: true,
      values: {
        string: [{ name: 'status', value: 'ok' }],
        number: [{ name: 'count', value: '42' }],
        boolean: [{ name: 'flag', value: 'true' }],
      },
    },
  };
  const [item] = call(registry, 'n8n-nodes-base.set', node, [{ json: { original: 'dropped' } }]);
  assert.deepEqual(item, { json: { status: 'ok', count: 42, flag: true } });
});

test('set node supports the 2.x assignments shape and keeps other fields by default', () => {
  const registry = createNodeRegistry();
  const node = {
    name: 'Edit',
    type: 'n8n-nodes-base.set',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ name: 'total', value: 3, type: 'number' }] },
    },
  };
  const [item] = call(registry, 'n8n-nodes-base.set', node, [{ json: { kept: 'yes' } }]);
  assert.deepEqual(item, { json: { kept: 'yes', total: 3 } });
});

test('set node strips the expression prefix and emits EXPRESSION_NOT_EVALUATED', () => {
  const registry = createNodeRegistry();
  const node = {
    name: 'Edit',
    type: 'n8n-nodes-base.set',
    parameters: { values: { string: [{ name: 'greeting', value: '={{ $json.name }}' }] } },
  };
  const [item] = call(registry, 'n8n-nodes-base.set', node, [{ json: { name: 'ada' } }]);
  assert.equal(item.json.greeting, '{{ $json.name }}');
  const warnings = registry.takeWarnings();
  assert.equal(warnings[0].code, 'EXPRESSION_NOT_EVALUATED');
  assert.equal(warnings[0].node, 'Edit');
});

test('code node is a deterministic passthrough when eval is disabled', () => {
  const registry = createNodeRegistry();
  const items = [{ json: { n: 1 } }];
  const node = { name: 'Code', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return [{ json: { n: 2 } }];' } };
  assert.deepEqual(call(registry, 'n8n-nodes-base.code', node, items), items);
  const warnings = registry.takeWarnings();
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'CODE_EVAL_DISABLED');
  assert.equal(warnings[0].node, 'Code');
});

test('code node runs jsCode only when allowCodeEval is on', async () => {
  const registry = createNodeRegistry({ allowCodeEval: true });
  const node = {
    name: 'Code',
    type: 'n8n-nodes-base.code',
    parameters: { mode: 'runOnceForAllItems', jsCode: 'return $input.all().map((i) => ({ json: { doubled: i.json.n * 2 } }));' },
  };
  const out = await call(registry, 'n8n-nodes-base.code', node, [{ json: { n: 21 } }]);
  assert.deepEqual(out, [{ json: { doubled: 42 } }]);
  assert.deepEqual(registry.takeWarnings(), []);
});

test('code node supports runOnceForEachItem and does not expose require/process', async () => {
  const registry = createNodeRegistry({ allowCodeEval: true });
  const node = {
    name: 'Code',
    type: 'n8n-nodes-base.code',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: 'return { json: { seen: typeof require, proc: typeof process, v: $json.n + 1 } };',
    },
  };
  const out = await call(registry, 'n8n-nodes-base.code', node, [{ json: { n: 1 } }]);
  assert.deepEqual(out, [{ json: { seen: 'undefined', proc: 'undefined', v: 2 } }]);
});

test('custom handlers can be registered and appear in the list', () => {
  const registry = createNodeRegistry();
  registry.register('n8n-nodes-base.custom', (node, items) => items, { group: 'custom', label: 'Custom' });
  assert.equal(registry.has('n8n-nodes-base.custom'), true);
  assert.equal(registry.info('n8n-nodes-base.custom').label, 'Custom');
  assert.throws(() => registry.register('', () => {}), TypeError);
});
