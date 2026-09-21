/**
 * Frontend contract — the machine-readable half of `contracts/frontend.contract.md`.
 *
 * This module is framework-neutral and browser-safe: no framework import, no
 * `node:*` import. It answers, as data, the questions a frontend implementation
 * must not answer ad-hoc:
 *
 *   - what envelopes may a `/rest/*` response use, and how is each unwrapped?
 *   - what does each status code mean, and what must the UI do with it?
 *   - what is the session / capability-discovery / route contract?
 *   - which push events exist and what is their payload key?
 *   - how are the contract and its keys versioned?
 *
 * The document is the normative text; this module is the normative data. A test
 * (`test/01-contract.test.mjs`) fails when the two drift apart, so the boundary
 * cannot silently become documentation-only.
 */

/** Contract identity. `MAJOR.MINOR`, see §13 of the contract for the rules. */
export const CONTRACT_VERSION = '1.0.0';
export const CONTRACT_ID = 'frontend';

/**
 * Response envelopes. The editor reads almost everything through
 * `makeRestApiRequest` (`return response.data`) and a handful of endpoints
 * through `getFullApiResponse` — both are part of the contract (api.contract §3).
 */
export const ENVELOPES = Object.freeze({
  data: Object.freeze({
    id: 'data',
    shape: '{ data: <payload> }',
    unwrap: 'data',
    description: 'Standard success envelope; every value the UI reads lives under `data`.',
  }),
  bare: Object.freeze({
    id: 'bare',
    shape: '{ count, data } | { count, results, estimated }',
    unwrap: 'bare',
    description: 'List endpoints read with getFullApiResponse — not wrapped again.',
  }),
  error: Object.freeze({
    id: 'error',
    shape: '{ message, code?, meta? }',
    unwrap: 'error',
    description: 'Non-2xx answer; `code` is the machine-readable handle, `message` the fallback text.',
  }),
  empty: Object.freeze({
    id: 'empty',
    shape: '{}',
    unwrap: 'empty',
    description: 'n8n quirk: endpoints answer 200 {} for a missing entity (e.g. GET /rest/executions/:id).',
  }),
});

/** Keys a consumer is allowed to see at the top level of a successful payload. */
export const ENVELOPE_KEYS = Object.freeze(['data', 'count', 'results', 'estimated']);

/**
 * List shapes per endpoint prefix, longest prefix wins (`resolveListShape`).
 * Endpoints not listed default to the standard `{ data: [...] }` envelope.
 */
export const LIST_SHAPES = Object.freeze({
  'count-data': Object.freeze({
    id: 'count-data',
    items: 'data',
    count: 'count',
    description: '{ count, data: [...] }',
  }),
  'count-results': Object.freeze({
    id: 'count-results',
    items: 'results',
    count: 'count',
    description: '{ count, results: [...], estimated }',
  }),
  data: Object.freeze({
    id: 'data',
    items: 'data',
    count: null,
    description: '{ data: [...] }',
  }),
});

export const LIST_ENDPOINTS = Object.freeze({
  '/rest/workflows': 'count-data',
  '/rest/executions': 'count-results',
  '/rest/projects': 'count-data',
  '/rest/variables': 'data',
  '/rest/credentials': 'data',
  '/rest/tags': 'data',
  '/rest/active-workflows': 'data',
  '/rest/users': 'count-data',
});

/** Endpoints that answer `200 {}` instead of 404 when the entity is missing. */
export const EMPTY_BODY_ENDPOINTS = Object.freeze(['/rest/executions/']);

/**
 * Status semantics the frontend must implement. Mirrors the compatibility layer
 * (`apps/n8n-lego/src/compat/error.mjs`) so both sides of the boundary agree.
 */
export const STATUS_SEMANTICS = Object.freeze({
  200: Object.freeze({ id: 200, meaning: 'answered (an empty collection is an honest empty, not a stub)', retryable: false }),
  400: Object.freeze({ id: 400, meaning: 'the request itself is wrong', retryable: false }),
  401: Object.freeze({ id: 401, meaning: 'no session — the UI must offer sign-in and must not retry blindly', retryable: false }),
  403: Object.freeze({ id: 403, meaning: 'authenticated but not allowed', retryable: false }),
  404: Object.freeze({ id: 404, meaning: 'the addressed entity does not exist', retryable: false }),
  409: Object.freeze({ id: 409, meaning: 'conflict (e.g. workflow checksum mismatch) — refetch, then retry', retryable: true }),
  422: Object.freeze({ id: 422, meaning: 'understood but not processable', retryable: false }),
  501: Object.freeze({ id: 501, meaning: "capability known but not implemented here ({ code: 'unsupported', meta: { feature, owner, phase } })", retryable: false }),
  500: Object.freeze({ id: 500, meaning: 'unexpected server failure', retryable: true }),
  503: Object.freeze({ id: 503, meaning: 'service unavailable (still starting)', retryable: true }),
});

/** Session context rules (api.contract §3/§11). */
export const SESSION = Object.freeze({
  cookie: 'n8n-auth',
  login: '/rest/login',
  logout: '/rest/logout',
  ownerSetup: '/rest/owner/setup',
  unauthenticatedShape: "{ status: 'error', message: 'Unauthorized' }",
  expiredSignal: 'any 401 answer — the UI clears its session view and offers sign-in; it never retries automatically',
  scopeField: 'globalScopes on the login/me payload drives every scope-gated surface (P2 R1 fix)',
});

/**
 * Capability discovery. Feature availability is decided by the contract, never
 * by hiding UI (`FRONTEND_COMPATIBILITY.md` §2).
 */
export const CAPABILITY_DISCOVERY = Object.freeze({
  sources: Object.freeze([
    Object.freeze({ id: 'settings-flags', endpoint: '/rest/settings', description: 'boot flags (hideUsagePage, communityNodesEnabled, …)' }),
    Object.freeze({ id: 'scopes', endpoint: '/rest/login', description: 'globalScopes from the session payload' }),
    Object.freeze({ id: 'unsupported-501', endpoint: '*', description: "501 { code: 'unsupported', meta: { feature, owner, phase } } for known-but-unimplemented capabilities" }),
    Object.freeze({ id: 'frontend-descriptor', endpoint: '/rest/frontend/bootstrap', description: 'frontend surfaces, extension points and registered frontend capabilities' }),
  ]),
  rule: 'A surface with an unimplemented backend renders and says so (501 metadata); it is never hidden and never faked.',
});

/** Route conventions of the served bundle (`apps/n8n-lego/src/ui.mjs`). */
export const ROUTE_CONVENTIONS = Object.freeze({
  spaFallback: 'any non-dotted path without a file renders the editor shell',
  basePathTemplate: '/{{BASE_PATH}}/',
  restEndpointMeta: 'n8n:config:rest-endpoint (base64 of the bare segment, e.g. "rest")',
  bootstrapMeta: 'n8n-lego:frontend-bootstrap (base64 of the boot payload, additive)',
  editorRoutes: Object.freeze(['/home', '/workflow/:id', '/settings', '/signin', '/setup']),
});

/** Push channel contract (api.contract §3). */
export const EVENTS = Object.freeze({
  channel: '/rest/push',
  transport: 'WebSocket (SSE compatible)',
  reconnect: 'the client reopens the channel on close and re-reads state; events are notifications, never the source of truth',
  names: Object.freeze([
    Object.freeze({ id: 'executionStarted', payloadKey: null, description: 'an execution started' }),
    Object.freeze({ id: 'executionFinished', payloadKey: 'data', description: 'execution finished (result data follows)' }),
    Object.freeze({ id: 'nodeExecuteAfter', payloadKey: 'data', description: 'per-node progress' }),
    Object.freeze({ id: 'workflowActivated', payloadKey: 'data', description: 'a trigger was activated' }),
    Object.freeze({ id: 'testWebhookReceived', payloadKey: 'data', description: 'a test webhook arrived' }),
  ]),
});

/** Versioning rules (contract §13). */
export const VERSIONING = Object.freeze({
  scheme: 'MAJOR.MINOR',
  additiveWithinMajor: true,
  neverRemoveOrRepurpose: Object.freeze(['field names', 'envelope shapes', 'status codes', 'message keys', 'error codes']),
  retirement: 'removal only on a major bump, after two minor versions marked deprecated: true',
  consumerRule: 'unknown fields are ignored; unknown enum values degrade to "unknown"',
  pinnedUi: 'n8n-editor-ui@2.9.4',
});

/** Fields every boot payload carries, in payload order. */
export const BOOT_PAYLOAD_KEYS = Object.freeze([
  'contractVersion',
  'app',
  'ui',
  'contract',
  'locales',
  'messageSlots',
  'errorKinds',
  'errorCodes',
  'surfaces',
  'subLegos',
  'extensionPoints',
  'capabilities',
]);

/**
 * Resolves the list shape for a request path (longest matching prefix wins).
 * @param {string} path request path without query string
 * @returns {{ id: string, items: string, count: string|null, description: string }}
 */
export function resolveListShape(path) {
  const matches = Object.keys(LIST_ENDPOINTS)
    .filter((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`))
    .sort((a, b) => b.length - a.length);
  const shapeId = matches.length > 0 ? LIST_ENDPOINTS[matches[0]] : 'data';
  return LIST_SHAPES[shapeId];
}

/** True when the endpoint is one of the `200 {}`-for-missing-entity endpoints. */
export function answersEmptyBody(path) {
  return EMPTY_BODY_ENDPOINTS.some((prefix) => path.startsWith(prefix));
}

/**
 * Contract self-description, as exposed to the boot payload and to tests. Keeps
 * the payload small: ids and the facts a consumer needs, not the prose.
 */
export function describeContract() {
  return Object.freeze({
    id: CONTRACT_ID,
    version: CONTRACT_VERSION,
    envelopes: Object.freeze(Object.keys(ENVELOPES)),
    statusSemantics: Object.freeze(
      Object.fromEntries(Object.entries(STATUS_SEMANTICS).map(([code, entry]) => [code, entry.meaning])),
    ),
    capabilityDiscovery: CAPABILITY_DISCOVERY,
    session: SESSION,
    routeConventions: ROUTE_CONVENTIONS,
    events: EVENTS,
    versioning: VERSIONING,
  });
}
