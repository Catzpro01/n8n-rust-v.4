import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIVE_DICTIONARIES,
  PROTECTED_MACHINE_KEYS,
  SUPPORTED_LOCALE_CODES,
  UniversalLocaleEnforcer,
  interceptLocalizedResponse,
} from './localization.mjs';
import { WorkflowExecutionEngine } from './runner.mjs';

test('all six native locales expose a complete backend catalog', () => {
  assert.deepEqual(SUPPORTED_LOCALE_CODES, ['id', 'jv', 'ar', 'zh', 'ru', 'en']);
  const keys = Object.keys(NATIVE_DICTIONARIES.en).sort();
  for (const locale of SUPPORTED_LOCALE_CODES) {
    assert.deepEqual(Object.keys(NATIVE_DICTIONARIES[locale]).sort(), keys, `${locale} catalog drift`);
    for (const key of keys) {
      assert.equal(typeof NATIVE_DICTIONARIES[locale][key], 'string');
      assert.notEqual(NATIVE_DICTIONARIES[locale][key].length, 0, `${locale}.${key} is empty`);
    }
  }
});

test('response localization is pure and protects machine fields', () => {
  const original = {
    name: 'Manual Trigger',
    type: 'n8n-nodes-base.manualTrigger',
    value: 'n8n-nodes-base.manualTrigger',
    inputs: [{ type: 'main', value: 'input-0' }],
    outputs: [{ type: 'main', value: 'output-0' }],
    routing: { requestRules: [{ value: 'GET' }] },
    label: 'Execute workflow',
    description: 'Execution succeeded',
    placeholder: 'Enter a value',
    data: { label: 'Execute workflow', message: 'Send' },
  };
  const snapshot = structuredClone(original);
  const localized = new UniversalLocaleEnforcer({ locale: 'zh-CN' }).enforce(original);

  assert.deepEqual(original, snapshot, 'input payload was mutated');
  for (const key of PROTECTED_MACHINE_KEYS) assert.deepEqual(localized[key], original[key], `${key} changed`);
  assert.equal(localized.label, '执行工作流');
  assert.equal(localized.description, '执行成功');
  assert.equal(localized.placeholder, '输入值');
  assert.deepEqual(localized.data, original.data, 'workflow data was localized');
});

test('execution, chat and API response surfaces are localized while statuses stay machine-safe', () => {
  const response = {
    status: 'COMPLETED',
    executionLog: [{ node: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', status: 'success', message: 'Execution succeeded' }],
    chat: { title: 'Chat session', send: 'Send', inputLabel: 'Write a message...' },
  };
  const localized = interceptLocalizedResponse(response, 'ru-RU');

  assert.equal(localized.status, 'COMPLETED');
  assert.equal(localized.statusText, 'Завершено');
  assert.equal(localized.executionLog[0].node, 'Manual Trigger');
  assert.equal(localized.executionLog[0].type, 'n8n-nodes-base.manualTrigger');
  assert.equal(localized.executionLog[0].status, 'success');
  assert.equal(localized.executionLog[0].statusText, 'Успешно');
  assert.equal(localized.executionLog[0].message, 'Выполнено успешно');
  assert.equal(localized.chat.title, 'Сеанс чата');
  assert.equal(localized.chat.send, 'Отправить');
  assert.equal(localized.chat.inputLabel, 'Введите сообщение...');
  assert.equal(response.chat.title, 'Chat session');
});

test('community-node translations can be registered without touching technical values', () => {
  const enforcer = new UniversalLocaleEnforcer({ locale: 'id' });
  enforcer.registerTranslations('id', {
    'community.example.description': 'Deskripsi komunitas',
    'Community example': 'Contoh komunitas',
  });
  const localized = enforcer.enforce({
    name: 'Community Node',
    type: 'community.example',
    description: 'Community example',
    translationKey: 'community.example.description',
  });
  assert.equal(localized.name, 'Community Node');
  assert.equal(localized.type, 'community.example');
  assert.equal(localized.description, 'Contoh komunitas');
  assert.equal(localized.translationKey, 'Deskripsi komunitas');
});

test('engine applies the selected locale at the backend response boundary', async () => {
  const engine = new WorkflowExecutionEngine({
    nodes: [{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger' }],
    connections: {},
  }, { locale: 'ar' });
  const result = await engine.runWorkflow();

  assert.equal(engine.getLocale(), 'ar');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.statusText, 'اكتمل');
  assert.equal(result.executionLog[0].status, 'success');
  assert.equal(result.executionLog[0].statusText, 'نجح');
  assert.deepEqual(result.data['Manual Trigger'][0].json, {});
});
