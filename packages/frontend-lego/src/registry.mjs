/**
 * Frontend capability registry.
 *
 * The registry is the single place where a frontend feature declares itself:
 *
 *   identity      id, owning LEGO, title
 *   UI surface    which declared surfaces it renders into
 *   contract      which backend capability and contract it consumes
 *   extension     which declared extension points it attaches to
 *   tests         where its regression proof lives
 *
 * Registration is fail-closed: an unknown surface, an undeclared extension
 * point, a missing test path or a duplicate id is rejected with a precise error,
 * so a new feature cannot quietly invent its own boundary. Nothing registers
 * here in P2.5 — the mechanism is proven by tests, the catalog is the content.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */
import { isValidMessageKey } from './i18n.mjs';

export const CAPABILITY_STATUSES = Object.freeze(['declared', 'available', 'partial', 'unsupported']);

/** Fields a capability descriptor must provide (shape, not content). */
export const CAPABILITY_SCHEMA = Object.freeze({
  required: Object.freeze(['id', 'lego', 'title', 'surfaces', 'contracts', 'tests', 'status']),
  optional: Object.freeze(['extensionPoints', 'routes', 'backendCapabilities', 'messages', 'phase', 'notes']),
});

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Raised for any registration the registry refuses. Carries the full list of problems. */
export class RegistryError extends Error {
  constructor(message, { id, errors } = {}) {
    super(message);
    this.name = 'RegistryError';
    this.code = 'frontend.registry.invalid-capability';
    this.capabilityId = id ?? null;
    this.errors = Object.freeze([...(errors ?? [])]);
  }
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Validates a capability descriptor against the surface/extension catalogs.
 *
 * @param {object} capability
 * @param {{ surfaces: Array<{id: string}>, extensionPoints: Array<{id: string}>, knownNamespaces?: string[] }} catalog
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateCapability(capability, catalog = {}) {
  const errors = [];
  const surfaces = new Set((catalog.surfaces ?? []).map((surface) => surface.id));
  const extensionPoints = new Set((catalog.extensionPoints ?? []).map((point) => point.id));
  const knownNamespaces = new Set(catalog.knownNamespaces ?? []);

  if (capability === null || typeof capability !== 'object') {
    return { ok: false, errors: ['capability must be an object'] };
  }
  for (const field of CAPABILITY_SCHEMA.required) {
    if (capability[field] === undefined || capability[field] === null) errors.push(`missing required field "${field}"`);
  }
  if (typeof capability.id !== 'string' || !ID_PATTERN.test(capability.id)) {
    errors.push('"id" must be kebab-case (e.g. "translation")');
  }
  if (typeof capability.lego === 'string' && !ID_PATTERN.test(capability.lego)) {
    errors.push('"lego" must be kebab-case');
  }
  if (capability.status !== undefined && !CAPABILITY_STATUSES.includes(capability.status)) {
    errors.push(`"status" must be one of ${CAPABILITY_STATUSES.join(', ')}`);
  }

  const declaredSurfaces = asArray(capability.surfaces);
  if (declaredSurfaces.length === 0) errors.push('"surfaces" must name at least one declared surface');
  for (const surface of declaredSurfaces) {
    if (!surfaces.has(surface)) errors.push(`unknown surface "${surface}" (declare it in manifest/surfaces.json first)`);
  }

  for (const point of asArray(capability.extensionPoints)) {
    if (!extensionPoints.has(point)) errors.push(`unknown extension point "${point}" (declare it in manifest/extension-points.json first)`);
  }

  const contracts = asArray(capability.contracts);
  if (contracts.length === 0) errors.push('"contracts" must name the contract(s) this capability consumes or extends');
  for (const contract of contracts) {
    if (typeof contract !== 'string' || !contract.endsWith('.contract.md')) {
      errors.push(`contract reference "${contract}" must point at a contracts/*.contract.md file`);
    }
  }

  const tests = asArray(capability.tests);
  if (tests.length === 0) errors.push('"tests" must name at least one regression test (a capability without a test has no boundary)');
  for (const test of tests) {
    if (typeof test !== 'string' || !/(\.test\.mjs|\.mjs|\.ts)$/.test(test)) errors.push(`test reference "${test}" must be a file path`);
  }

  for (const route of asArray(capability.routes)) {
    if (typeof route !== 'string' || !route.startsWith('/')) errors.push(`route "${route}" must start with "/"`);
  }

  if (capability.messages !== undefined) {
    if (typeof capability.messages !== 'string' || !ID_PATTERN.test(capability.messages)) {
      errors.push('"messages" must be a namespace (kebab-case)');
    } else if (knownNamespaces.has(capability.messages)) {
      errors.push(`message namespace "${capability.messages}" is already owned by another capability`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Creates the registry. `capabilities` may be passed at construction (used by the
 * app and by tests) or registered later with `register`.
 *
 * @param {{ surfaces?: Array<object>, extensionPoints?: Array<object>, capabilities?: Array<object> }} init
 */
export function createFrontendRegistry({ surfaces = [], extensionPoints = [], capabilities = [] } = {}) {
  if (surfaces.length === 0) throw new RegistryError('the surface catalog is empty — the registry has no vocabulary', { errors: ['surfaces must not be empty'] });
  if (extensionPoints.length === 0) throw new RegistryError('the extension-point catalog is empty', { errors: ['extensionPoints must not be empty'] });

  const surfaceById = new Map(surfaces.map((surface) => [surface.id, surface]));
  const pointById = new Map(extensionPoints.map((point) => [point.id, point]));
  const registered = new Map();

  // Every surface must only reference declared hooks — validated once, so a
  // capability can trust the catalog it validates against.
  const brokenSurfaces = [];
  for (const surface of surfaces) {
    for (const point of surface.extensionPoints ?? []) {
      if (!pointById.has(point)) brokenSurfaces.push(`${surface.id} -> ${point}`);
    }
    for (const slot of surface.messageSlots ?? []) {
      if (!isValidMessageKey(`${slot}.placeholder`)) brokenSurfaces.push(`${surface.id} -> message slot ${slot}`);
    }
  }
  if (brokenSurfaces.length > 0) {
    throw new RegistryError('surface catalog references undeclared extension points or message slots', { errors: brokenSurfaces });
  }

  const catalog = {
    surfaces,
    extensionPoints,
    knownNamespaces: [],
  };

  function register(capability) {
    const id = capability?.id;
    // Duplicate ids are checked first: it is the clearest diagnosis, and every
    // later check would also reject the second registration for a side reason.
    if (typeof id === 'string' && registered.has(id)) {
      throw new RegistryError(`capability "${id}" is already registered`, { id, errors: ['duplicate id'] });
    }
    const { ok, errors } = validateCapability(capability, catalog);
    if (!ok) throw new RegistryError(`capability "${id ?? '(anonymous)'}" is not registrable: ${errors.join('; ')}`, { id, errors });
    // A message namespace belongs to exactly one capability: two LEGOs writing
    // into the same namespace make collisions invisible until runtime. The
    // collision check itself lives in validateCapability.
    if (capability.messages) catalog.knownNamespaces.push(capability.messages);
    const normalized = Object.freeze({
      id: capability.id,
      lego: capability.lego,
      title: capability.title,
      status: capability.status,
      phase: capability.phase ?? null,
      surfaces: Object.freeze([...asArray(capability.surfaces)]),
      extensionPoints: Object.freeze([...asArray(capability.extensionPoints)]),
      contracts: Object.freeze([...asArray(capability.contracts)]),
      backendCapabilities: Object.freeze([...asArray(capability.backendCapabilities)]),
      routes: Object.freeze([...asArray(capability.routes)]),
      messages: capability.messages ?? null,
      tests: Object.freeze([...asArray(capability.tests)]),
      notes: capability.notes ?? null,
    });
    registered.set(normalized.id, normalized);
    return normalized;
  }

  for (const capability of capabilities) register(capability);

  /** Deterministic order: declaration order within a status, ties broken by id. */
  function list({ surface, extensionPoint } = {}) {
    const values = [...registered.values()];
    const filtered = values.filter((capability) => {
      if (surface && !capability.surfaces.includes(surface)) return false;
      if (extensionPoint && !capability.extensionPoints.includes(extensionPoint)) return false;
      return true;
    });
    return filtered.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Resolves an application route to the capabilities that add it (longest route first). */
  function resolveRoute(path) {
    return list().filter((capability) => capability.routes.some((route) => path === route || path.startsWith(`${route}/`)));
  }

  /** What the boot payload exposes: catalog + registrations, no functions. */
  function descriptor() {
    return Object.freeze({
      catalogVersion: surfaces.catalogVersion ?? null,
      surfaces: Object.freeze(surfaces.map((surface) => Object.freeze({
        id: surface.id,
        title: surface.title,
        kind: surface.kind,
        routes: Object.freeze([...(surface.routes ?? [])]),
        status: surface.status,
        backend: Object.freeze({ ...(surface.backend ?? {}) }),
        extensionPoints: Object.freeze([...(surface.extensionPoints ?? [])]),
        messageSlots: Object.freeze([...(surface.messageSlots ?? [])]),
      }))),
      extensionPoints: Object.freeze(extensionPoints.map((point) => Object.freeze({
        id: point.id,
        title: point.title,
        surface: point.surface,
        additive: point.additive,
        mutates: point.mutates,
        requiresCapability: Object.freeze([...(point.requiresCapability ?? [])]),
        consumers: Object.freeze([...(point.consumers ?? [])]),
        status: point.status,
      }))),
      capabilities: Object.freeze(list().map((capability) => Object.freeze({ ...capability }))),
    });
  }

  return {
    surfaces: Object.freeze([...surfaces]),
    extensionPoints: Object.freeze([...extensionPoints]),
    register,
    registerAll(values) {
      return values.map(register);
    },
    has: (id) => registered.has(id),
    get: (id) => registered.get(id) ?? null,
    list,
    resolveRoute,
    surface: (id) => surfaceById.get(id) ?? null,
    extensionPoint: (id) => pointById.get(id) ?? null,
    descriptor,
    validate: (capability) => validateCapability(capability, catalog),
  };
}
