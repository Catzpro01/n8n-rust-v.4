/**
 * I4 — every backend error shape maps to exactly one machine-readable model.
 *
 * The chain under test: backend error → `FrontendError` (kind + code +
 * messageKey) → display model (messageKey + fallback text + actions). No test
 * here parses a sentence: if a surface had to, the boundary would be broken.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ERROR_CODES,
  ERROR_KINDS,
  FrontendError,
  normalizeError,
  toDisplayModel,
} from '../src/errors.mjs';
import { parseMessageKey } from '../src/i18n.mjs';
import { createRestClient, createStateStore } from '../src/client.mjs';

/** The compatibility layer's error shape (apps/n8n-lego/src/compat/error.mjs). */
const httpError = (status, message, extra = {}) => ({ status, message, ...extra });

test('each status maps to one kind, one code and one message key', () => {
  const cases = [
    [httpError(400, 'Bad request'), 'validation', ERROR_CODES.VALIDATION_FAILED],
    [httpError(401, 'Unauthorized'), 'auth', ERROR_CODES.SESSION_EXPIRED],
    [httpError(403, 'Forbidden'), 'forbidden', ERROR_CODES.PERMISSION_DENIED],
    [httpError(404, 'Not found'), 'not-found', ERROR_CODES.RESOURCE_MISSING],
    [httpError(409, 'Conflict'), 'conflict', ERROR_CODES.RESOURCE_CONFLICT],
    [httpError(422, 'Nope'), 'validation', ERROR_CODES.VALIDATION_FAILED],
    [httpError(500, 'Internal server error'), 'server', ERROR_CODES.SERVER_ERROR],
    [httpError(503, 'Starting'), 'server', ERROR_CODES.SERVER_ERROR],
  ];
  for (const [input, kind, code] of cases) {
    const error = normalizeError(input);
    assert.equal(error.kind, kind, `${input.status} should be ${kind}`);
    assert.equal(error.code, code);
    assert.equal(error.status, input.status);
    assert.ok(error.messageKey.startsWith('backend-errors.'), `${error.messageKey} must live in the backend-errors slot`);
    assert.ok(error.fallbackText.length > 0, 'a fallback text must exist even without a dictionary');
  }
});

test('the 501 capability contract survives normalization with its metadata', () => {
  const error = normalizeError({
    status: 501,
    body: { message: 'workflow-history is not implemented on this n8n-lego instance', code: 'unsupported', meta: { feature: 'workflow-history', owner: 'workflow', phase: 'P3' } },
  });
  assert.equal(error.kind, 'unsupported');
  assert.equal(error.code, 'unsupported');
  assert.equal(error.status, 501);
  assert.deepEqual(error.meta, { feature: 'workflow-history', owner: 'workflow', phase: 'P3' });
  assert.equal(error.params.feature, 'workflow-history');
  assert.equal(error.retryable, false);

  const display = toDisplayModel(error);
  assert.equal(display.severity, 'warning', 'an unimplemented capability is a warning, not a crash');
  assert.deepEqual(display.actions, ['dismiss']);
  assert.ok(display.fallbackText.includes('workflow-history'), 'the fallback names the capability');
});

test('a zod-style validation body keeps the path and the issue code', () => {
  const error = normalizeError({ status: 400, body: { code: 'too_small', message: 'Workflow name is required', path: ['name'] } });
  assert.equal(error.kind, 'validation');
  assert.equal(error.code, 'too_small', 'the backend code is preserved, never replaced by a generic one');
  assert.equal(error.params.field, 'name');
  assert.equal(error.meta.path[0], 'name');
});

test('transport failures and cancellations are distinguishable and retryable', () => {
  const network = normalizeError(new TypeError('fetch failed'));
  assert.equal(network.kind, 'network');
  assert.equal(network.code, ERROR_CODES.NETWORK_UNREACHABLE);
  assert.equal(network.retryable, true);

  const aborted = normalizeError(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  assert.equal(aborted.kind, 'aborted');
  assert.equal(aborted.retryable, true);
});

test('normalization is idempotent and surfaces are attributed', () => {
  const once = normalizeError(httpError(404, 'Not found'), { surface: 'executions' });
  const twice = normalizeError(once, { surface: 'settings' });
  assert.equal(twice, once, 'a FrontendError is returned as-is');
  assert.equal(twice.surface, 'executions', 'the first attribution wins');
  assert.equal(normalizeError('boom').kind, 'unknown');
  assert.equal(normalizeError(undefined).kind, 'unknown');
});

test('the display model is complete without any localization', () => {
  for (const kind of ERROR_KINDS) {
    const display = toDisplayModel(new FrontendError({ kind }));
    assert.ok(parseMessageKey(display.messageKey), `${kind} must carry a valid message key`);
    assert.ok(['error', 'warning', 'info'].includes(display.severity));
    assert.ok(Array.isArray(display.actions) && display.actions.length > 0, `${kind} must suggest an action`);
    assert.equal(typeof display.fallbackText, 'string');
  }
});

test('the client turns HTTP failures into values, never into thrown exceptions', async () => {
  const responses = [
    { status: 200, body: { data: { id: 1 } } },
    { status: 501, body: { message: 'not implemented', code: 'unsupported', meta: { feature: 'api-keys' } } },
    { status: 401, body: { message: 'Unauthorized' } },
    { status: 500, body: { message: 'Internal server error' } },
  ];
  let index = 0;
  const client = createRestClient({
    restEndpoint: 'rest',
    fetchImpl: async () => {
      const next = responses[index++];
      return {
        ok: next.status < 400,
        status: next.status,
        headers: {},
        text: async () => JSON.stringify(next.body),
      };
    },
  });

  const ok = await client.get('/settings');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data, { id: 1 });
  assert.equal(ok.error, null);

  const unsupported = await client.get('/api-keys');
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.kind, 'unsupported');
  assert.equal(unsupported.error.meta.feature, 'api-keys');

  const unauthorized = await client.get('/workflows');
  assert.equal(unauthorized.error.kind, 'auth');

  const server = await client.get('/workflows');
  assert.equal(server.error.kind, 'server');
  assert.equal(server.error.retryable, true);
});

test('the client reports the session expiry once, through the hook', async () => {
  const seen = [];
  const client = createRestClient({
    fetchImpl: async () => ({ ok: false, status: 401, headers: {}, text: async () => JSON.stringify({ message: 'Unauthorized' }) }),
    onAuthRequired: (error) => seen.push(error.kind),
  });
  await client.get('/workflows');
  await client.get('/executions');
  assert.deepEqual(seen, ['auth'], 'a session expiry is announced once, not on every request');
  client.resetAuthState();
  await client.get('/workflows');
  assert.deepEqual(seen, ['auth', 'auth']);
});

test('envelopes are unwrapped by contract, not by guessing', async () => {
  const payloads = {
    '/rest/workflows': { count: 2, data: [{ id: 'a' }, { id: 'b' }] },
    '/rest/executions': { count: 3, results: [{ id: 1 }], estimated: false },
    '/rest/variables': { data: [] },
    '/rest/settings': { data: { versionCli: '2.9.4' } },
    '/rest/executions/999': {},
  };
  const client = createRestClient({
    fetchImpl: async (url) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '');
      const body = payloads[path] ?? { data: null };
      return { ok: true, status: 200, headers: {}, text: async () => JSON.stringify(body) };
    },
  });

  const workflows = await client.get('/workflows');
  assert.equal(workflows.shape, 'bare');
  assert.equal(workflows.count, 2);
  assert.deepEqual(workflows.items.map((item) => item.id), ['a', 'b']);

  const executions = await client.get('/executions');
  assert.equal(executions.shape, 'bare');
  assert.deepEqual(executions.items, [{ id: 1 }]);
  assert.equal(executions.estimated, false);

  const variables = await client.get('/variables');
  assert.equal(variables.shape, 'data');
  assert.deepEqual(variables.data, []);

  const settings = await client.get('/settings');
  assert.deepEqual(settings.data, { versionCli: '2.9.4' });

  const missing = await client.get('/executions/999');
  assert.equal(missing.ok, false, 'the 200 {} quirk must not look like success');
  assert.equal(missing.error.kind, 'not-found');
});

test('state model: empty is empty, error is error, and neither is a thrown exception', () => {
  const store = createStateStore();
  assert.equal(store.status, 'idle');

  store.start();
  assert.equal(store.status, 'loading');

  store.apply({ ok: true, items: [], count: 0 });
  assert.equal(store.status, 'empty', 'an empty collection is not an error');

  store.apply({ ok: true, items: [{ id: 1 }] });
  assert.equal(store.status, 'ready');

  store.apply({ ok: false, error: normalizeError({ status: 503, message: 'starting' }) });
  assert.equal(store.status, 'error');
  assert.equal(store.error.kind, 'server');
  assert.equal(store.snapshot().isEmpty, false);
});

test('errors serialise without leaking the transport object', () => {
  const error = normalizeError(httpError(409, 'Conflict', { meta: { expectedChecksum: 'abc' } }));
  const json = error.toJSON();
  assert.deepEqual(Object.keys(json).sort(), ['code', 'kind', 'messageKey', 'meta', 'params', 'retryable', 'status', 'surface']);
  assert.equal(json.meta.expectedChecksum, 'abc');
  assert.equal(JSON.parse(JSON.stringify(json)).kind, 'conflict');
});
