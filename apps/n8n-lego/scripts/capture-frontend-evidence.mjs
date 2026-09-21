/**
 * Captures the frontend boundary evidence from a live instance.
 *
 *   node apps/n8n-lego/scripts/capture-frontend-evidence.mjs [--out <path>]
 *
 * Starts the app in-process (memory storage, temporary user folder), signs the
 * owner in, and records what the boundary actually does at HTTP level:
 *
 *   - the descriptor is auth-guarded and served in the standard envelope;
 *   - the payload validates against the contract and carries the catalogs;
 *   - the boot `<meta>` tag on index.html is byte-equal to the endpoint payload;
 *   - the served UI is byte-identical apart from that one additive tag;
 *   - the sub-LEGO hierarchy is published without its private areas;
 *   - a real 501 capability answer becomes a machine-readable client error.
 *
 * The browser-side view of the same boundary is captured in CI by
 * `tests/e2e/frontend-boundary.mjs`. This script is the local, dependency-free
 * counterpart committed so the evidence can be regenerated, not just trusted.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from '../src/server.mjs';
import { createUi } from '../src/ui.mjs';
import {
  FRONTEND_BOOT_META_NAME,
  createRestClient,
  extractBootPayload,
  validateBootPayload,
} from '../../../packages/frontend-lego/index.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(APP_DIR, '..', '..');
const outIndex = process.argv.indexOf('--out');
const OUT = outIndex === -1
  ? join(REPO_ROOT, 'docs', 'n8n-lego', 'evidence', 'frontend-boundary-p25.json')
  : resolve(process.argv[outIndex + 1]);

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const checks = [];
const check = (name, ok, detail) => checks.push({ name, verdict: ok ? 'PASS' : 'FAIL', detail });

const userFolder = mkdtempSync(join(tmpdir(), 'n8n-lego-p25-evidence-'));
const started = await startServer({
  env: {
    ...process.env,
    N8N_LEGO_PORT: '0',
    N8N_LEGO_HOST: '127.0.0.1',
    N8N_LEGO_STORAGE: 'memory',
    N8N_LEGO_LOG_LEVEL: 'error',
    N8N_LEGO_PROTOCOL: 'http',
    N8N_LEGO_USER_FOLDER: userFolder,
  },
  logger: silent,
});
const base = `http://127.0.0.1:${started.server.address().port}`;
let cookie = '';

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  });
  const text = await response.text();
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0 && !cookie) cookie = setCookie.map((value) => value.split(';')[0]).join('; ');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, text };
}

/* ---------------------------------------------------------------- the checks */
const anonymous = await call('/rest/frontend/bootstrap');
check('GET /rest/frontend/bootstrap is auth-guarded', anonymous.status === 401, `status=${anonymous.status}`);

await call('/rest/owner/setup', {
  method: 'POST',
  body: JSON.stringify({ email: 'p25@n8nlego.local', firstName: 'P2.5', lastName: 'Boundary', password: 'Surabaya2026!' }),
});
const endpoint = await call('/rest/frontend/bootstrap');
const payload = endpoint.body.data;
check('descriptor served in the {data} envelope', endpoint.status === 200 && Boolean(payload), `status=${endpoint.status}`);
check('payload validates against the contract', validateBootPayload(payload).ok, `contractVersion=${payload.contractVersion}`);
check('12 UI surfaces declared', payload.surfaces.length === 12, payload.surfaces.map((surface) => surface.id).join(','));
check('15 extension points declared', payload.extensionPoints.length === 15, payload.extensionPoints.map((point) => point.id).join(','));
check('19 nested units declared, 3 levels deep', payload.subLegos.length === 19 && payload.subLegos.some((unit) => unit.id === 'settings.localization.rtl'), `${payload.subLegos.length} units`);
check('hierarchy is walkable in declaration order', payload.subLegos.every((unit, index, all) => unit.parentId === null || all.slice(0, index).some((previous) => previous.id === unit.parentId)), 'every parent published before its children');
check('private areas never reach the payload', !JSON.stringify(payload.subLegos).includes('src/sub-legos') && !JSON.stringify(payload.subLegos).includes('internals'), 'identity/version/ports only');
check('no capability claims to be shipped', payload.capabilities.length === 0, 'capabilities=[]');
check('six locales with Arabic RTL', payload.locales.supported.length === 6 && payload.locales.rtl.join() === 'ar', payload.locales.supported.map((locale) => locale.code).join(','));
check('13 message slots declared', payload.messageSlots.length === 13, `${payload.messageSlots.length} slots`);

const page = await call('/');
const embedded = extractBootPayload(page.text);
check('boot meta tag present on index.html', embedded !== null, `<meta name="${FRONTEND_BOOT_META_NAME}">`);
check('meta tag and endpoint carry the same descriptor', JSON.stringify(embedded) === JSON.stringify(payload), 'byte-equal JSON');
check('stock UI still templated (title + config tag)', page.text.includes('Workflow Automation') && page.text.includes('n8n:config:rest-endpoint'), 'title/config tag intact');
check('no unrendered template leftovers', !page.text.includes('/{{BASE_PATH}}/'), 'BASE_PATH resolved');

const editorDist = join(APP_DIR, 'node_modules', 'n8n-editor-ui', 'dist');
const renderWith = (frontend) => {
  const ui = createUi({
    config: { editorDist, restEndpoint: 'rest', basePath: '/', appName: 'n8n lego', env: 'test', version: '0.1.0', dataDir: userFolder },
    logger: silent,
    frontend,
  });
  let body = '';
  ui.serve({}, { writeHead() {}, end(chunk) { body += typeof chunk === 'string' ? chunk : String(chunk ?? ''); } }, '/');
  return body;
};
const withTag = renderWith(started.frontend);
const withoutTag = renderWith();
check(
  'UI byte-identical apart from the additive tag',
  withTag.replace(new RegExp(`<meta[^>]*name="${FRONTEND_BOOT_META_NAME}"[^>]*>`), '') === withoutTag,
  `delta=${withTag.length - withoutTag.length} bytes (the tag only)`,
);

const client = createRestClient({
  baseUrl: base,
  restEndpoint: 'rest',
  fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...(options?.headers ?? {}), cookie } }),
});
const unsupported = await client.get('/api-keys');
check('501 capability becomes a machine-readable error', unsupported.error?.kind === 'unsupported' && unsupported.error.meta.feature === 'api-keys', `kind=${unsupported.error?.kind} feature=${unsupported.error?.meta?.feature} key=${unsupported.error?.messageKey}`);

const payloadBytes = JSON.stringify(payload).length;
check('boot descriptor stays inside its budget', Math.ceil((payloadBytes * 4) / 3) < 32 * 1024, `${payloadBytes} bytes JSON → ${Math.ceil((payloadBytes * 4) / 3)} bytes base64`);

/* ---------------------------------------------------------------- the record */
const evidence = {
  kind: 'p25-frontend-boundary',
  generatedAt: new Date().toISOString(),
  phase: 'P2.5',
  method: 'node apps/n8n-lego/scripts/capture-frontend-evidence.mjs (live in-process instance, HTTP level); the browser gate tests/e2e/frontend-boundary.mjs captures the same boundary from inside a real page in CI (docs/n8n-lego/FRONTEND_LEGO.md §6)',
  baseline: 'cb71dbb2',
  editorUi: payload.ui,
  checks,
  summary: {
    checks: checks.length,
    passed: checks.filter((entry) => entry.verdict === 'PASS').length,
    failed: checks.filter((entry) => entry.verdict === 'FAIL').length,
  },
  bootDescriptor: {
    contractVersion: payload.contractVersion,
    surfaces: payload.surfaces.map((surface) => ({ id: surface.id, status: surface.status, backend: surface.backend?.capability })),
    subLegos: payload.subLegos.map((unit) => ({ id: unit.id, parentId: unit.parentId, version: unit.version, owner: unit.owner, status: unit.status })),
    subLegoDepth: Math.max(...payload.subLegos.map((unit) => unit.id.split('.').length - 1)),
    extensionPoints: payload.extensionPoints.map((point) => point.id),
    messageSlots: payload.messageSlots.map((slot) => slot.id),
    locales: payload.locales.supported.map((locale) => locale.code),
    rtl: payload.locales.rtl,
    errorCodes: payload.errorCodes,
    errorKinds: payload.errorKinds,
    capabilities: payload.capabilities,
    bytes: payloadBytes,
  },
};
writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

for (const entry of checks) console.log(`${entry.verdict}  ${entry.name} — ${entry.detail}`);
console.log(`\n${evidence.summary.passed}/${evidence.summary.checks} PASS → ${OUT}`);

await new Promise((done) => started.server.close(done));
process.exit(evidence.summary.failed === 0 ? 0 : 1);
