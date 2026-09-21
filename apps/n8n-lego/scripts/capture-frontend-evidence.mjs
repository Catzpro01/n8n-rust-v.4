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
 *   - a real 501 capability answer becomes a machine-readable client error;
 *   - the P2.8-F maturity layer is present in the *running app* while the payload
 *     stays byte-identical (declared capabilities, impact graph, plan, profiles, pack).
 *
 * The browser-side view of the same boundary is captured in CI by
 * `tests/e2e/frontend-boundary.mjs`. This script is the local, dependency-free
 * counterpart committed so the evidence can be regenerated, not just trusted.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { startServer } from '../src/server.mjs';
import { createUi } from '../src/ui.mjs';
import {
  FRONTEND_BOOT_META_NAME,
  contextFor,
  createRestClient,
  extractBootPayload,
  packFiles,
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

/* ------------------------------------------- P2.8-F maturity, from the live app */

const frontend = started.frontend;
const availability = frontend.availability();

check('declared capability catalog is validated but not registered', availability.length === 1 && frontend.registry.list().length === 0, `${availability.length} declared, ${frontend.registry.list().length} registered`);
check('the declared capability is available, not installed', availability[0].lifecycle === 'available' && availability[0].installed === false && availability[0].activation === 'lazy', `${availability[0].id}: ${availability[0].lifecycle}/installed=${availability[0].installed}`);
check('its absence has a declared, non-fatal fallback', availability[0].degradation.behavior === 'fallback' && availability[0].degradation.fallback === 'fallback-locale', availability[0].degradation.detail);
check('device support is decided per profile, with a reason', availability[0].support.length === 6 && availability[0].support.every((entry) => ['supported', 'degraded', 'remote', 'unsupported'].includes(entry.state)), availability[0].support.map((entry) => `${entry.profile}:${entry.state}`).join(' '));

const dependent = frontend.impactOf('workflow-editor.canvas');
const privateChange = frontend.impactOf('node-picker');
check('impact: a dependent escalates the test tier', dependent.risk === 'high' && dependent.dependents.includes('workflow-editor.execution-panel') && dependent.recommendedTests.full.length > 0, `risk=${dependent.risk} dependents=${dependent.dependents.join(',')}`);
check('impact: a private root change stays low risk', privateChange.risk === 'low' && privateChange.recommendedTests.integration.length === 0, `risk=${privateChange.risk} tiers=${Object.keys(privateChange.recommendedTests).filter((tier) => privateChange.recommendedTests[tier].length > 0).join(',')}`);

const plan = frontend.planChange({ target: 'settings', kind: 'surface' });
check('dry-run plan names the foreign contract and its owner', plan.foreignContracts.length > 0 && plan.foreignContracts.every((entry) => typeof entry.owner === 'string' && entry.owner.length > 0), plan.foreignContracts.map((entry) => `${entry.contract}->${entry.owner}`).join(' '));

const retrieval = contextFor({ kind: 'upgrade-unit' });
check('.ai pack answers a task shape with the smallest file set', retrieval.level === 'L3' && retrieval.files.length === 3 && retrieval.files.every((file) => file.length > 0) && packFiles().length > retrieval.files.length, `${retrieval.files.length} of ${packFiles().length} files`);

/**
 * The P2.5 payload size, pinned. The maturity layer (P2.8-F) is deliberately
 * invisible to the browser: if this number moves, somebody either added something
 * to what every page load carries — which then needs its own justification — or
 * removed something a consumer relies on.
 */
const P25_PAYLOAD_BYTES = 18126;
check('boot payload is byte-identical to the P2.5 baseline', payloadBytes === P25_PAYLOAD_BYTES, `${payloadBytes} bytes vs pinned P2.5 baseline ${P25_PAYLOAD_BYTES}`);

/* ------------------------------------ performance: what this costs to boot (P2.8-F) */

const probe = `
const t0 = process.hrtime.bigint();
const before = process.memoryUsage().heapUsed;
const mod = await import(${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'packages', 'frontend-lego', 'index.mjs')).href)});
const lego = mod.createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
const kb = (process.memoryUsage().heapUsed - before) / 1024;
console.log(JSON.stringify({
  ms: Math.round(ms * 10) / 10,
  kb: Math.round(kb),
  units: lego.bootPayload.subLegos.length,
  surfaces: lego.bootPayload.surfaces.length,
  hooks: lego.bootPayload.extensionPoints.length,
}));
`;
const cost = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' }));
check('the LEGO cold-imports and assembles within a small budget', cost.ms < 250, `${cost.ms} ms for import + ${cost.surfaces} surfaces + ${cost.hooks} hooks + ${cost.units} units`);
check('assembling the descriptor stays inside a small memory budget', cost.kb < 4096, `${cost.kb} KB of heap for catalogs + both registries`);

const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'packages', 'frontend-lego', 'package.json'), 'utf8'));
check('the package still has no runtime dependency', Object.keys(packageJson.dependencies ?? {}).length === 0, `dependencies=${JSON.stringify(packageJson.dependencies ?? {})}`);

/* --------------------------- architecture rules, checked against the live LEGO */
// The rules are data (`src/conformance.mjs`); this records the same answer at the
// application boundary, so a CI reader sees it without running the package suite.
const LEGO_ROOT = join(REPO_ROOT, 'packages', 'frontend-lego');
const LEGO_SRC = pathToFileURL(join(LEGO_ROOT, 'src')).href;
const { createFrontendLego } = await import(pathToFileURL(join(LEGO_ROOT, 'index.mjs')).href);
const { checkConformance, ARCHITECTURE_RULES } = await import(`${LEGO_SRC}/conformance.mjs`);
const { createOperationGateway, defineLocalTransport, defineTransport } = await import(`${LEGO_SRC}/transport.mjs`);
const { INTERACTION_CLASSES } = await import(`${LEGO_SRC}/interactions.mjs`);
const { SUPPORTED_LOCALES } = await import(`${LEGO_SRC}/i18n.mjs`);

const liveFrontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
const conformance = checkConformance(liveFrontend);
check(`${ARCHITECTURE_RULES.length} architecture rules pass on a live assembly`, conformance.ok, conformance.checks.filter((entry) => entry.state !== 'pass').map((entry) => entry.ruleId).join(',') || 'all pass');

const directions = Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale.code, locale.direction]));
check('direction is locale metadata: ar RTL, the rest LTR', directions.ar === 'rtl' && Object.entries(directions).filter(([, direction]) => direction === 'rtl').length === 1, JSON.stringify(directions));

check('four interaction classes are declared', INTERACTION_CLASSES.join(',') === 'call,event,stream,batch', INTERACTION_CLASSES.join(','));

// Delivery: a same-process operation is a direct call with no serialization, and a
// call is never carried by a fire-and-forget transport.
const delivered = [];
const gateway = createOperationGateway({
  transports: [
    defineTransport({ id: 'event:bus', kind: 'event', cost: 0, invoke: async () => { delivered.push('event'); return null; } }),
    defineLocalTransport({ handlers: { 'workflow.list': async () => { delivered.push('local'); return []; } } }),
  ],
});
const delivery = await gateway.invoke({ capability: 'workflow', operation: 'workflow.list', interaction: 'call' });
check('a same-process call is direct, unserialized and never routed through an event bus', delivery.transport === 'local:direct' && delivery.serialization === 'none' && !delivered.includes('event'), `transport=${delivery.transport} serialization=${delivery.serialization}`);

let refused = null;
try {
  await gateway.invoke({ capability: 'execution', operation: 'execution.watch', interaction: 'stream' });
} catch (error) {
  refused = error;
}
check('an interaction no transport can carry is refused by name', refused?.code === 'frontend.transport.unsupported', refused ? `${refused.code}: ${refused.message.slice(0, 60)}…` : 'accepted (would be a silent fallback)');

const verdict = liveFrontend.negotiate({ capabilityId: 'translation', unitId: 'settings.localization.rtl' });
check('a declared-but-not-installed capability degrades instead of pretending', verdict.state === 'degraded' && verdict.degradation.behavior === 'degrade', `state=${verdict.state} fallback=${verdict.degradation.fallback}`);
const ungranted = liveFrontend.negotiate({ capabilityId: 'workflow', unitId: 'settings.localization.rtl' });
check('placement grants nothing: the refusal leaks no capability metadata', ungranted.state === 'unavailable' && ungranted.identity === null && /placement never grants/.test(ungranted.reasons[0]), `state=${ungranted.state} identity=${ungranted.identity}`);

// The two situations that must never read as "available": a migration gate, and a
// consumer that has to be allowed to do something before it may ask.
const gated = createFrontendLego({
  app: { name: 'n8n-lego', version: '0.1.0' },
  backend: { capabilities: { workflow: { status: 'available', owner: 'workflow', migration: { required: true, from: 'v1', to: 'v2' } } } },
});
const gatedVerdict = gated.negotiate({ capabilityId: 'workflow', unitId: 'workflow-editor.canvas' });
check('a migration gate is its own state, never availability', gatedVerdict.state === 'migration-required' && gatedVerdict.migrationRequired === true && gatedVerdict.degradation.behavior === 'fallback', `state=${gatedVerdict.state} fallback=${gatedVerdict.degradation.fallback}`);

const permitted = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
permitted.register({
  id: 'audit-log', lego: 'settings', title: 'Audit log', status: 'available', surfaces: ['settings'],
  contracts: ['contracts/frontend.contract.md'], tests: ['packages/frontend-lego/test/23-degradation.test.mjs'],
  operations: ['audit.list'], permissions: ['audit:read'], activation: 'lazy', entry: './features/audit/index.mjs',
});
const permissionVerdict = permitted.negotiate({ capabilityId: 'audit-log' });
check('required permissions are declared and reported, never inferred', JSON.stringify(permissionVerdict.requiredPermissions) === '["audit:read"]', `requiredPermissions=${JSON.stringify(permissionVerdict.requiredPermissions)}`);

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
    importMs: cost.ms,
    heapKb: cost.kb,
  },
};
writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

for (const entry of checks) console.log(`${entry.verdict}  ${entry.name} — ${entry.detail}`);
console.log(`\n${evidence.summary.passed}/${evidence.summary.checks} PASS → ${OUT}`);

await new Promise((done) => started.server.close(done));
process.exit(evidence.summary.failed === 0 ? 0 : 1);
