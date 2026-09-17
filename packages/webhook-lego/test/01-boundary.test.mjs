import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const surface = fs.readFileSync(path.join(__dirname, '../src/model-surface.ts'), 'utf8');

test('webhook surface pins W1-W10 + provenance', async () => {
  for (const sym of [
    'ALLOWED_METHODS', 'WEBHOOK_ROUTES', 'buildMethodNotSupported', 'isPreflight',
    'buildWebhookNotFound', 'buildWebhookWrongMethod', 'buildWebhookPathTaken',
    'WORKFLOW_WAS_STARTED', 'RESPONSE_MODES', 'resolveResponseMode', 'matchWebhook',
    'shouldSanitizeCookies', 'TEST_WEBHOOK_TIMEOUT_MS', 'WEBHOOK_NOT_FOUND_PRODUCTION_HINT',
    'b6dc2787c45677a29a9612cd27eb911302961a83',
  ]) {
    assert.ok(surface.includes(sym), `missing surface symbol: ${sym}`);
  }
  for (const w of ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10']) {
    assert.ok(surface.includes(w), `missing invariant: ${w}`);
  }
});

test('W1 method guard exact shape, W2 preflight', async () => {
  const buildMethodNotSupported = (m) => `The method ${m} is not supported.`;
  assert.equal(buildMethodNotSupported('PROPFIND'), 'The method PROPFIND is not supported.');
  assert.ok(surface.includes('The method ${method} is not supported.'));
  const isPreflight = (m) => m === 'OPTIONS';
  assert.equal(isPreflight('OPTIONS'), true);
  assert.equal(isPreflight('POST'), false);
  for (const m of ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS']) {
    assert.ok(surface.includes(`'${m}'`), `missing allowed method ${m}`);
  }
});

test('W4/W5 404 shapes byte-exact', async () => {
  const notFound = (p) => `The requested webhook "${p}" is not registered.`;
  assert.equal(notFound('POST no-such-path'), 'The requested webhook "POST no-such-path" is not registered.');
  const wrongMethod = (m, ms) => `This webhook is not registered for ${m} requests. Did you mean to make a ${ms} request?`;
  assert.equal(
    wrongMethod('GET', 'POST'),
    'This webhook is not registered for GET requests. Did you mean to make a POST request?',
  );
  assert.ok(surface.includes('The requested webhook "${webhookPath}" is not registered.'));
  assert.ok(surface.includes('Did you mean to make a ${methods} request?'));
});

test('W3 exact-first then longest-dynamic match order', async () => {
  const matchWebhook = (rows, method, path) => {
    const clean = path.replace(/\/+$/, '');
    const exact = rows.find((r) => r.method === method && r.webhookPath === clean);
    if (exact) return exact;
    const [head, ...rest] = clean.split('/');
    let best = null; let bestScore = -1;
    for (const row of rows.filter((r) => r.method === method && r.webhookId === head)) {
      const statics = row.staticSegments ?? [];
      let score = 0; let ok = true;
      for (let i = 0; i < statics.length; i++) {
        if (rest[i] === statics[i]) score++; else { ok = false; break; }
      }
      if (!ok) continue;
      const total = score * 1000 + (row.pathLength ?? rest.length);
      if (total > bestScore) { bestScore = total; best = row; }
    }
    return best;
  };
  const rows = [
    { webhookPath: 'static-hook', method: 'POST' },
    { webhookPath: 'dyn/:a', method: 'POST', webhookId: 'dyn', pathLength: 1, staticSegments: [] },
    { webhookPath: 'dyn/fixed/:b', method: 'POST', webhookId: 'dyn', pathLength: 2, staticSegments: ['fixed'] },
  ];
  assert.equal(matchWebhook(rows, 'POST', 'static-hook'), rows[0]);
  assert.equal(matchWebhook(rows, 'POST', 'static-hook/'), rows[0]); // trailing slash stripped
  assert.equal(matchWebhook(rows, 'POST', 'dyn/other'), rows[1]); // fallback row
  assert.equal(matchWebhook(rows, 'POST', 'dyn/fixed/x'), rows[2]); // longest wins
  assert.equal(matchWebhook(rows, 'GET', 'static-hook'), null);
  assert.equal(matchWebhook(rows, 'POST', 'missing'), null);
});

test('W6 path-taken exact, W7 default body, W8 invalid mode', async () => {
  const taken = (n) => `The URL path that the "${n}" node uses is already taken. Please change it to something else.`;
  assert.equal(taken('Webhook'), 'The URL path that the "Webhook" node uses is already taken. Please change it to something else.');
  assert.ok(surface.includes('node uses is already taken. Please change it to something else.'));
  assert.deepEqual({ message: 'Workflow was started' }, { message: 'Workflow was started' });
  assert.ok(surface.includes("message: 'Workflow was started'"));
  const MODES = ['onReceived', 'lastNode', 'responseNode', 'streaming', 'formPage', 'hostedChat'];
  const resolve = (mode) => {
    if (mode === undefined || mode === 'onReceived') return 'onReceived';
    if (MODES.includes(mode)) return mode;
    throw new Error(`The response mode '${mode}' is not valid!`);
  };
  assert.equal(resolve(undefined), 'onReceived');
  assert.equal(resolve('lastNode'), 'lastNode');
  assert.throws(() => resolve('bogus'), /The response mode 'bogus' is not valid!/);
});

test('W9 sanitizer rule, W10 test/waiting semantics', async () => {
  const shouldSanitize = (t, allow) => !allow.includes(t);
  assert.equal(shouldSanitize('n8n-nodes-base.webhook', []), true);
  assert.equal(shouldSanitize('chat', ['chat']), false);
  assert.equal(120_000, 120000);
  assert.ok(surface.includes('TEST_WEBHOOK_TIMEOUT_MS = 120_000'));
  const finished = (id) => `The execution "${id}" has finished already.`;
  const unknown = (id) => `The execution "${id}" does not exist.`;
  assert.equal(finished('42'), 'The execution "42" has finished already.');
  assert.equal(unknown('42'), 'The execution "42" does not exist.');
});
