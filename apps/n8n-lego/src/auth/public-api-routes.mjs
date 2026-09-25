/**
 * P5-M03 — the public REST API (`/api/v1`), first surface: the boundary plus
 * the workflows resource.
 *
 * Mirrors pinned n8n 2.9.4 `packages/cli/src/public-api` (express +
 * express-openapi-validator). The request pipeline runs in upstream order:
 *
 *   1. route match     unknown path -> 404 `not found`; known path, wrong
 *                      method -> 405 `<METHOD> method not allowed`
 *   2. security        X-N8N-API-KEY via authenticateMachineCredential();
 *                      missing -> 401 `'X-N8N-API-KEY' header required`,
 *                      anything else invalid -> 401 `unauthorized` (both are
 *                      recorded upstream goldens: publicApiNoKey/publicApiBadKey)
 *   3. body parse      invalid JSON -> 400 `Invalid JSON in request body`
 *   4. validation      query/path/body against the pinned OpenAPI schemas ->
 *                      400 with ajv-style `request/...` messages
 *   5. key scope       the principal's effective scopes (key ∩ owner's CURRENT
 *                      grant) through the P5.3 `authorize()` kernel -> 403
 *                      `Forbidden`
 *   6. handler         `{ message }` error bodies, never the `/rest` envelope
 *
 * Every error body is `{ message }`, exactly like upstream's error handler.
 * `/rest/*` keeps accepting session cookies only; `/api/v1/*` accepts API keys
 * only (no cookie, so no ambient authority and no CSRF surface).
 *
 * Deliberate differences from pinned n8n, all fail-closed:
 *   - key scopes are ALWAYS enforced. Upstream skips `apiKeyHasScope` unless
 *     the enterprise `apiKeyScopes` licence is on; here a key only ever acts
 *     within the scopes it was issued with (deny-by-default invariant).
 *   - this product has a single workspace and no project/sharing model yet, so
 *     `projectId` filtering and `shared`/`activeVersion` relations are not
 *     served, and `/workflows/{id}/transfer` is not mounted (404).
 *   - activation mirrors `/rest/workflows/:id/activate`: it publishes the
 *     current version (`activeVersionId = versionId`); there is no trigger
 *     registration service to consult, so no trigger-node check is claimed.
 *
 * Not mounted yet (later slices): executions, credentials, tags, users,
 * variables, projects, audit, source-control, data-tables, openapi.yml/docs.
 */
import { randomUUID } from 'node:crypto';

import { HttpError } from '../compat/error.mjs';
import { sendJson } from '../compat/response.mjs';
import { apiKeyPermissionRegistry, authenticateMachineCredential } from './api-key-routes.mjs';
import { authorize } from './security/authorization.mjs';

export const PUBLIC_API_PREFIX = '/api/v1';
export const PUBLIC_API_KEY_HEADER = 'x-n8n-api-key';

/** Upstream messages, verbatim. */
export const PUBLIC_API_MESSAGES = Object.freeze({
  KEY_REQUIRED: "'X-N8N-API-KEY' header required",
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND_ROUTE: 'not found',
  NOT_FOUND: 'Not Found',
  INVALID_JSON: 'Invalid JSON in request body',
  INVALID_CURSOR: 'An invalid cursor was provided',
  TAGS_NOT_FOUND: 'Some tags not found',
});

export const PUBLIC_API_LIMITS = Object.freeze({ DEFAULT_LIMIT: 100, MAX_LIMIT: 250 });

/* ------------------------------------------------------------ schemas */

const WORKFLOW_SETTINGS_KEYS = Object.freeze([
  'saveExecutionProgress',
  'saveManualExecutions',
  'saveDataErrorExecution',
  'saveDataSuccessExecution',
  'executionTimeout',
  'errorWorkflow',
  'timezone',
  'executionOrder',
  'callerPolicy',
  'callerIds',
  'timeSavedPerExecution',
  'availableInMCP',
]);

/** node.yml: property -> expected JSON type (readOnly props are marked). */
const NODE_PROPERTIES = Object.freeze({
  id: 'string',
  name: 'string',
  webhookId: 'string',
  disabled: 'boolean',
  notesInFlow: 'boolean',
  notes: 'string',
  type: 'string',
  typeVersion: 'number',
  executeOnce: 'boolean',
  alwaysOutputData: 'boolean',
  retryOnFail: 'boolean',
  maxTries: 'number',
  waitBetweenTries: 'number',
  continueOnFail: 'boolean',
  onError: 'string',
  position: 'array',
  parameters: 'object',
  credentials: 'object',
  createdAt: 'readOnly',
  updatedAt: 'readOnly',
});

/** workflow.yml top level. */
const WORKFLOW_REQUIRED = Object.freeze(['name', 'nodes', 'connections', 'settings']);
const WORKFLOW_READ_ONLY = Object.freeze(['id', 'active', 'createdAt', 'updatedAt', 'tags']);
const WORKFLOW_WRITABLE = Object.freeze(['name', 'nodes', 'connections', 'settings', 'staticData', 'shared', 'activeVersion']);

function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function invalid(message) {
  return new HttpError(400, message);
}

/**
 * Validates a workflow body the way the pinned OpenAPI schema does
 * (`additionalProperties: false`, required, readOnly, types). Returns the
 * body; throws 400 with an ajv-style message on the first violation.
 */
export function validateWorkflowBody(body) {
  if (jsonType(body) !== 'object') throw invalid('request/body must be object');
  for (const key of Object.keys(body)) {
    if (WORKFLOW_READ_ONLY.includes(key)) throw invalid(`request/body/${key} is read-only`);
    if (!WORKFLOW_WRITABLE.includes(key)) throw invalid('request/body must NOT have additional properties');
  }
  for (const key of WORKFLOW_REQUIRED) {
    if (!(key in body)) throw invalid(`request/body must have required property '${key}'`);
  }
  if (typeof body.name !== 'string') throw invalid('request/body/name must be string');
  if (!Array.isArray(body.nodes)) throw invalid('request/body/nodes must be array');
  body.nodes.forEach((node, index) => validateNode(node, index));
  if (jsonType(body.connections) !== 'object') throw invalid('request/body/connections must be object');
  if (jsonType(body.settings) !== 'object') throw invalid('request/body/settings must be object');
  for (const key of Object.keys(body.settings)) {
    if (!WORKFLOW_SETTINGS_KEYS.includes(key)) throw invalid('request/body/settings must NOT have additional properties');
  }
  if ('staticData' in body && body.staticData !== null) {
    const kind = jsonType(body.staticData);
    if (kind === 'string') {
      try {
        JSON.parse(body.staticData);
      } catch {
        throw invalid('request/body/staticData must match format "jsonString"');
      }
    } else if (kind !== 'object') {
      throw invalid('request/body/staticData must match a schema in anyOf');
    }
  }
  return body;
}

function validateNode(node, index) {
  const at = `request/body/nodes/${index}`;
  if (jsonType(node) !== 'object') throw invalid(`${at} must be object`);
  for (const [key, value] of Object.entries(node)) {
    const expected = NODE_PROPERTIES[key];
    if (expected === undefined) throw invalid(`${at} must NOT have additional properties`);
    if (expected === 'readOnly') throw invalid(`${at}/${key} is read-only`);
    if (jsonType(value) !== expected) throw invalid(`${at}/${key} must be ${expected}`);
    if (key === 'position' && !value.every((item) => typeof item === 'number')) {
      throw invalid(`${at}/position must be array of numbers`);
    }
  }
}

/** OpenAPI boolean query coercion (express-openapi-validator coerceTypes). */
function queryBoolean(query, name) {
  const raw = query[name];
  if (raw === undefined) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw invalid(`request/query/${name} must be boolean`);
}

function queryLimit(query) {
  const raw = query.limit;
  if (raw === undefined) return PUBLIC_API_LIMITS.DEFAULT_LIMIT;
  const value = Number(raw);
  if (raw === '' || !Number.isFinite(value)) throw invalid('request/query/limit must be number');
  if (value > PUBLIC_API_LIMITS.MAX_LIMIT) throw invalid(`request/query/limit must be <= ${PUBLIC_API_LIMITS.MAX_LIMIT}`);
  // Upstream passes the number to `take`; a non-positive or fractional page is
  // not a meaningful request, so it is floored to a sane page size.
  return Math.max(1, Math.floor(value));
}

/* ---------------------------------------------------------- pagination */

/** Upstream `encodeNextCursor` (offset flavour). */
export function encodeNextCursor({ offset, limit, numberOfTotalRecords }) {
  if (numberOfTotalRecords > offset + limit) {
    return Buffer.from(JSON.stringify({ limit, offset: offset + limit })).toString('base64');
  }
  return null;
}

/** Upstream `validCursor`: a cursor overrides limit/offset; garbage is a 400. */
export function decodeOffsetCursor(cursor) {
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(String(cursor), 'base64').toString());
  } catch {
    throw invalid(PUBLIC_API_MESSAGES.INVALID_CURSOR);
  }
  const offset = Number(decoded?.offset);
  const limit = Number(decoded?.limit);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > PUBLIC_API_LIMITS.MAX_LIMIT) {
    throw invalid(PUBLIC_API_MESSAGES.INVALID_CURSOR);
  }
  return { offset, limit };
}

/* ---------------------------------------------------------- DTOs */

function tagDto(tag) {
  return { id: tag.id, name: tag.name, createdAt: tag.createdAt ?? null, updatedAt: tag.updatedAt ?? null };
}

/** The upstream WorkflowEntity projection this product can honestly serve. */
export function publicWorkflowDto(workflow, { excludePinnedData = false } = {}) {
  const dto = {
    id: workflow.id,
    name: workflow.name,
    active: Boolean(workflow.active),
    isArchived: Boolean(workflow.isArchived),
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    nodes: workflow.nodes ?? [],
    connections: workflow.connections ?? {},
    settings: workflow.settings ?? {},
    staticData: workflow.staticData ?? null,
    meta: workflow.meta ?? null,
    pinData: workflow.pinData ?? {},
    versionId: workflow.versionId ?? null,
    activeVersionId: workflow.active ? (workflow.activeVersionId ?? workflow.versionId ?? null) : null,
    triggerCount: workflow.triggerCount ?? 0,
    tags: (workflow.tags ?? []).map(tagDto),
  };
  if (excludePinnedData) delete dto.pinData;
  return dto;
}

/* ---------------------------------------------------------- handlers */

function loadWorkflow(ctx) {
  const workflow = ctx.store.workflows.get(ctx.params.id);
  if (!workflow) throw new HttpError(404, PUBLIC_API_MESSAGES.NOT_FOUND);
  return workflow;
}

function normaliseStaticData(value) {
  if (typeof value === 'string') return JSON.parse(value);
  return value ?? null;
}

function listWorkflows(ctx) {
  let offset = 0;
  let limit = queryLimit(ctx.query);
  if (ctx.query.cursor) ({ offset, limit } = decodeOffsetCursor(ctx.query.cursor));
  const active = queryBoolean(ctx.query, 'active');
  const excludePinnedData = queryBoolean(ctx.query, 'excludePinnedData') ?? false;
  const name = typeof ctx.query.name === 'string' ? ctx.query.name.trim().toLowerCase() : undefined;

  let candidates = ctx.store.workflows.all();
  if (typeof ctx.query.tags === 'string') {
    // Upstream getWorkflowIdsViaTags: the INTERSECTION of the workflows of
    // every tag that exists; unknown names are ignored, none found -> empty.
    const names = ctx.query.tags.split(',').map((tag) => tag.trim());
    const tagIds = ctx.store.tags.all().filter((tag) => names.includes(tag.name)).map((tag) => tag.id);
    candidates = tagIds.length === 0
      ? []
      : candidates.filter((workflow) => tagIds.every((id) => (workflow.tags ?? []).some((tag) => tag.id === id)));
  }
  const matching = candidates
    .filter((workflow) => (name !== undefined ? String(workflow.name).toLowerCase().includes(name) : true))
    .filter((workflow) => (active !== undefined ? Boolean(workflow.active) === active : true))
    // Stable order so cursors are deterministic across pages.
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));

  sendJson(ctx.res, 200, {
    data: matching.slice(offset, offset + limit).map((workflow) => publicWorkflowDto(workflow, { excludePinnedData })),
    nextCursor: encodeNextCursor({ offset, limit, numberOfTotalRecords: matching.length }),
  });
}

function createWorkflow(ctx) {
  const body = validateWorkflowBody(ctx.body);
  const now = new Date().toISOString();
  const workflow = ctx.store.workflows.insert({
    name: body.name,
    description: null,
    active: false,
    nodes: body.nodes.map((node) => ({ ...node, id: typeof node.id === 'string' && node.id !== '' ? node.id : randomUUID() })),
    connections: body.connections,
    settings: body.settings,
    pinData: {},
    staticData: normaliseStaticData(body.staticData),
    meta: null,
    tags: [],
    versionId: randomUUID(),
    createdAt: now,
    updatedAt: now,
  });
  ctx.logger?.info?.('workflow created', { workflowId: workflow.id, via: 'public-api' });
  sendJson(ctx.res, 200, publicWorkflowDto(workflow));
}

function getWorkflow(ctx) {
  const excludePinnedData = queryBoolean(ctx.query, 'excludePinnedData') ?? false;
  sendJson(ctx.res, 200, publicWorkflowDto(loadWorkflow(ctx), { excludePinnedData }));
}

function updateWorkflow(ctx) {
  const existing = loadWorkflow(ctx);
  const body = validateWorkflowBody(ctx.body);
  const versionId = randomUUID();
  const patch = {
    name: body.name,
    nodes: body.nodes.map((node) => ({ ...node, id: typeof node.id === 'string' && node.id !== '' ? node.id : randomUUID() })),
    connections: body.connections,
    settings: body.settings,
    updatedAt: new Date().toISOString(),
    versionId,
  };
  if ('staticData' in body) patch.staticData = normaliseStaticData(body.staticData);
  // Upstream `publishIfActive: true` — an active workflow publishes the update.
  if (existing.active) patch.activeVersionId = versionId;
  const updated = ctx.store.workflows.update(existing.id, patch);
  sendJson(ctx.res, 200, publicWorkflowDto(updated));
}

function deleteWorkflow(ctx) {
  const existing = loadWorkflow(ctx);
  ctx.store.workflows.remove(existing.id);
  sendJson(ctx.res, 200, publicWorkflowDto(existing));
}

function activateWorkflow(ctx) {
  const existing = loadWorkflow(ctx);
  const updated = ctx.store.workflows.update(existing.id, {
    active: true,
    activeVersionId: existing.versionId ?? null,
    updatedAt: new Date().toISOString(),
  });
  sendJson(ctx.res, 200, publicWorkflowDto(updated));
}

function deactivateWorkflow(ctx) {
  const existing = loadWorkflow(ctx);
  const updated = ctx.store.workflows.update(existing.id, {
    active: false,
    activeVersionId: null,
    updatedAt: new Date().toISOString(),
  });
  sendJson(ctx.res, 200, publicWorkflowDto(updated));
}

function getWorkflowTags(ctx) {
  const existing = loadWorkflow(ctx);
  sendJson(ctx.res, 200, (existing.tags ?? []).map(tagDto));
}

function updateWorkflowTags(ctx) {
  const body = ctx.body;
  if (!Array.isArray(body)) throw invalid('request/body must be array');
  body.forEach((item, index) => {
    if (jsonType(item) !== 'object') throw invalid(`request/body/${index} must be object`);
    if (!('id' in item)) throw invalid(`request/body/${index} must have required property 'id'`);
    if (typeof item.id !== 'string') throw invalid(`request/body/${index}/id must be string`);
    for (const key of Object.keys(item)) {
      if (key !== 'id') throw invalid(`request/body/${index} must NOT have additional properties`);
    }
  });
  const existing = loadWorkflow(ctx);
  const wanted = [...new Set(body.map((item) => item.id))];
  const tags = wanted.map((id) => ctx.store.tags.get(id));
  if (tags.some((tag) => !tag)) throw new HttpError(404, PUBLIC_API_MESSAGES.TAGS_NOT_FOUND);
  ctx.store.workflows.update(existing.id, { tags, updatedAt: new Date().toISOString() });
  sendJson(ctx.res, 200, tags.map(tagDto));
}

/* ---------------------------------------------------------- routes */

/**
 * The mounted operations: method, path template, the API-key scope upstream
 * guards it with (`apiKeyHasScope`), and the handler.
 */
export const PUBLIC_API_OPERATIONS = Object.freeze([
  { method: 'GET', path: '/workflows', scope: 'workflow:list', handler: listWorkflows },
  { method: 'POST', path: '/workflows', scope: 'workflow:create', handler: createWorkflow, body: true },
  { method: 'GET', path: '/workflows/:id', scope: 'workflow:read', handler: getWorkflow },
  { method: 'PUT', path: '/workflows/:id', scope: 'workflow:update', handler: updateWorkflow, body: true },
  { method: 'DELETE', path: '/workflows/:id', scope: 'workflow:delete', handler: deleteWorkflow },
  { method: 'POST', path: '/workflows/:id/activate', scope: 'workflow:activate', handler: activateWorkflow },
  { method: 'POST', path: '/workflows/:id/deactivate', scope: 'workflow:deactivate', handler: deactivateWorkflow },
  { method: 'GET', path: '/workflows/:id/tags', scope: 'workflowTags:list', handler: getWorkflowTags },
  { method: 'PUT', path: '/workflows/:id/tags', scope: 'workflowTags:update', handler: updateWorkflowTags, body: true },
].map((operation) => Object.freeze(operation)));

function compile(template) {
  const names = [];
  const pattern = template.replace(/:([A-Za-z]+)/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  });
  return { regex: new RegExp(`^${pattern}/?$`), names };
}

const COMPILED = PUBLIC_API_OPERATIONS.map((operation) => ({ operation, ...compile(operation.path) }));

/**
 * Route match in express-openapi-validator order. `path` is relative to
 * `/api/v1`. Returns `{ operation, params }`, or throws 404/405.
 */
export function matchPublicApiRoute(method, path) {
  let pathKnown = false;
  for (const { operation, regex, names } of COMPILED) {
    const found = regex.exec(path);
    if (!found) continue;
    pathKnown = true;
    if (operation.method !== method) continue;
    const params = {};
    names.forEach((name, index) => {
      params[name] = decodeURIComponent(found[index + 1]);
    });
    return { operation, params };
  }
  if (pathKnown) throw new HttpError(405, `${method} method not allowed`);
  throw new HttpError(404, PUBLIC_API_MESSAGES.NOT_FOUND_ROUTE);
}

export function isPublicApiPath(pathname) {
  return pathname === PUBLIC_API_PREFIX || pathname.startsWith(`${PUBLIC_API_PREFIX}/`);
}

async function readJsonBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'request entity too large');
    chunks.push(chunk);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, PUBLIC_API_MESSAGES.INVALID_JSON);
  }
}

/**
 * Serves one `/api/v1/*` request end to end. Never throws: every failure
 * becomes an upstream-shaped `{ message }` body. Returns the authenticated
 * owner's email (for the access log) or null.
 */
export async function handlePublicApiRequest(ctx) {
  const { req, res, store, config, logger } = ctx;
  let ownerEmail = null;
  try {
    const relative = ctx.path.slice(PUBLIC_API_PREFIX.length) || '/';
    const { operation, params } = matchPublicApiRoute(ctx.method, relative);

    const presented = req.headers[PUBLIC_API_KEY_HEADER];
    if (presented === undefined || presented === '') throw new HttpError(401, PUBLIC_API_MESSAGES.KEY_REQUIRED);
    const verified = authenticateMachineCredential({ store, config, presented: Array.isArray(presented) ? presented[0] : presented, logger });
    if (!verified.ok) throw new HttpError(401, PUBLIC_API_MESSAGES.UNAUTHORIZED);
    ownerEmail = verified.owner.email ?? null;

    ctx.params = params;
    ctx.principal = verified.principal;
    ctx.user = verified.owner;
    if (operation.body) {
      ctx.body = await readJsonBody(req, config.maxBodyBytes);
      if (ctx.body === undefined) throw invalid('request/body must be object');
    }

    // Key scope through the P5.3 kernel: unknown permission fails closed,
    // expiry and permission are re-checked here, not trusted from issuance.
    const decision = authorize(
      { principal: verified.principal, action: operation.scope, resourceType: 'workflow', resourceId: params.id },
      { registry: apiKeyPermissionRegistry(config) },
    );
    if (!decision.allowed) throw new HttpError(403, PUBLIC_API_MESSAGES.FORBIDDEN);

    await operation.handler(ctx);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : 'Internal Server Error';
    if (status >= 500) logger?.error?.('public api request failed', { cause: error instanceof Error ? error.message : String(error) });
    if (!res.headersSent) sendJson(res, status, { message });
  }
  return ownerEmail;
}
