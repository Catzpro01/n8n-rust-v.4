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
import { INTERACTION_CLASSES, isInteractionClass, normaliseInteraction } from './interactions.mjs';
import { CAPABILITY_STATES, CRITICALITY, TRUST_LEVELS, degradationFor } from './lifecycle.mjs';
import { REQUIREMENT_FIELDS } from './profiles.mjs';

/** How a capability reaches the runtime. `eager` is the exception, not the rule. */
export const ACTIVATION_MODES = Object.freeze(['eager', 'lazy', 'manual']);

export const CAPABILITY_STATUSES = Object.freeze(['declared', 'available', 'partial', 'unsupported']);

/** Fields a capability descriptor must provide (shape, not content). */
export const CAPABILITY_SCHEMA = Object.freeze({
  required: Object.freeze(['id', 'lego', 'title', 'surfaces', 'contracts', 'tests', 'status']),
  optional: Object.freeze([
    'extensionPoints', 'routes', 'backendCapabilities', 'messages', 'phase', 'notes',
    // maturity fields (P2.8-F)
    'activation', 'entry', 'criticality', 'trust', 'requirements', 'lifecycle', 'degradation',
    // what a consumer may ask for by name (empty = no operation contract published yet)
    'operations',
    // ...and, per operation, what kind of interaction it is (call/event/stream/batch)
    'interactions',
    // who owns the capability (validated against the owners declared in the manifests)
    'owner',
  ]),
});

/** Operations are named `<domain>.<name>` — the same grammar the envelope enforces. */
const OPERATION_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

/**
 * The operation names a capability publishes. An operation may be a plain string
 * (a call) or `{ name, interaction }`; the declaration shape is normalised here so
 * the rest of the system sees one form.
 */
export function operationsOf(capability) {
  return [...new Set((capability.operations ?? []).map((entry) => normaliseInteraction(entry).operation))];
}

/**
 * The declared interaction class per operation. Inline declarations are folded in
 * so both spellings agree; `interactions` may not restate a different class for an
 * operation it has already declared inline.
 */
export function interactionsOf(capability) {
  const declared = {};
  for (const entry of capability.operations ?? []) {
    const normalised = normaliseInteraction(entry);
    if (typeof entry === 'object' && entry !== null && entry.interaction !== undefined) {
      declared[normalised.operation] = normalised.interaction;
    }
  }
  for (const [operation, interaction] of Object.entries(capability.interactions ?? {})) {
    // Fail closed on disagreement rather than letting the last write win.
    if (declared[operation] !== undefined && declared[operation] !== interaction) {
      throw new RegistryError(
        `"${capability.id ?? '(anonymous)'}" declares operation "${operation}" as "${declared[operation]}" and also as "${interaction}"`,
        { id: capability.id, errors: ['contradictory interaction declaration'] },
      );
    }
    declared[operation] = interaction;
  }
  return declared;
}

/** Keys that would smuggle implementation code into a registry of metadata. */
const CODE_LIKE_KEYS = Object.freeze(['load', 'render', 'mount', 'install', 'activate', 'handler', 'component']);

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
  const knownOwners = new Set(Object.keys(catalog.owners ?? {}));

  if (capability === null || typeof capability !== 'object') {
    return { ok: false, errors: ['capability must be an object'] };
  }
  for (const field of CAPABILITY_SCHEMA.required) {
    if (capability[field] === undefined || capability[field] === null) errors.push(`missing required field "${field}"`);
  }
  // Fail closed on unknown fields: a key nobody defined is either a typo or a second
  // source of truth (an owner restated, a capability renamed), and both are worse
  // than a refusal. The schema above is the whole vocabulary.
  const knownFields = new Set([...CAPABILITY_SCHEMA.required, ...CAPABILITY_SCHEMA.optional]);
  for (const key of Object.keys(capability)) {
    if (!knownFields.has(key)) errors.push(`unknown field "${key}" (known: ${[...knownFields].join(', ')})`);
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

  // Hooks are owned by a surface. A capability may extend the hooks of the surfaces
  // it occupies — and only those: reaching a hook on somebody else's surface is the
  // decoration-free version of patching an implementation you do not own.
  const pointOwner = new Map((catalog.extensionPoints ?? []).map((point) => [point.id, point.surface ?? null]));
  for (const point of asArray(capability.extensionPoints)) {
    if (!extensionPoints.has(point)) {
      errors.push(`unknown extension point "${point}" (declare it in manifest/extension-points.json first)`);
      continue;
    }
    const owner = pointOwner.get(point) ?? null;
    if (owner !== null && declaredSurfaces.length > 0 && !declaredSurfaces.includes(owner)) {
      errors.push(`extension point "${point}" belongs to surface "${owner}", which this capability does not occupy (it declares: ${declaredSurfaces.join(', ')}) — an extension may only add to its own surface's hooks`);
    }
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

  // A registry of metadata: implementation is referenced by path, never carried
  // inline. This is what keeps "installed" from meaning "loaded".
  for (const key of CODE_LIKE_KEYS) {
    if (capability[key] !== undefined) {
      errors.push(`"${key}" carries implementation into the registry — reference it through "entry" (metadata must not require loading code)`);
    }
  }

  // Ownership is explicit and checked: a capability nobody owns has no escalation
  // path when something breaks, and a free-text owner is a claim, not an owner.
  if (capability.owner !== undefined && capability.owner !== null) {
    if (typeof capability.owner !== 'string' || !/^(agent-\d{2}|manager)$/.test(capability.owner)) {
      errors.push(`"owner" must be an agent id (e.g. "agent-01") or "manager"`);
    } else if (knownOwners.size > 0 && !knownOwners.has(capability.owner)) {
      errors.push(`unknown owner "${capability.owner}" (declared owners: ${[...knownOwners].join(', ')})`);
    }
  }

  const activation = capability.activation ?? 'eager';
  if (!ACTIVATION_MODES.includes(activation)) errors.push(`"activation" must be one of ${ACTIVATION_MODES.join(', ')}`);
  // A declared capability has no code to lazy-load yet, so it owes no entry. The
  // moment it is installable, a non-eager activation must say where its code is.
  const installable = (capability.status ?? 'declared') !== 'declared';
  if (activation !== 'eager' && installable && (typeof capability.entry !== 'string' || !/\.(mjs|js|cjs|ts)$/.test(capability.entry))) {
    errors.push(`activation "${activation}" needs an "entry" module path (e.g. "./features/x/index.mjs")`);
  }
  if (capability.entry !== undefined && capability.entry !== null && (typeof capability.entry !== 'string' || !/\.(mjs|js|cjs|ts)$/.test(capability.entry))) {
    errors.push('"entry" must be a module path (e.g. "./features/x/index.mjs")');
  }

  if (capability.operations !== undefined) {
    if (!Array.isArray(capability.operations)) {
      errors.push('"operations" must be an array of semantic operation names');
    } else {
      for (const entry of capability.operations) {
        let operation = entry;
        // An operation may declare its interaction class inline. Anything else
        // (a route, a handler, a function) is implementation, not a declaration.
        if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
          const normalised = normaliseInteraction(entry);
          operation = normalised.operation;
          if (entry.interaction !== undefined && !isInteractionClass(entry.interaction)) {
            errors.push(`operation "${entry.name}" declares interaction "${entry.interaction}" (one of ${INTERACTION_CLASSES.join(', ')})`);
          }
          for (const key of Object.keys(entry)) {
            if (!['name', 'interaction'].includes(key)) errors.push(`operation "${entry.name}" may declare only "name" and "interaction" (got "${key}")`);
          }
        }
        if (typeof operation !== 'string' || !OPERATION_PATTERN.test(operation)) {
          errors.push(`operation "${operation}" must look like "<domain>.<name>" (kebab-case, at least one dot)`);
        }
      }
      const names = capability.operations.map((entry) => normaliseInteraction(entry).operation);
      if (new Set(names).size !== names.length) errors.push('"operations" must not repeat an operation');
    }
  }

  if (capability.interactions !== undefined) {
    if (capability.interactions === null || typeof capability.interactions !== 'object' || Array.isArray(capability.interactions)) {
      errors.push('"interactions" must be an object mapping operation → interaction class');
    } else {
      const inline = {};
      for (const entry of capability.operations ?? []) {
        if (entry !== null && typeof entry === 'object' && !Array.isArray(entry) && entry.interaction !== undefined) {
          inline[entry.name] = entry.interaction;
        }
      }
      for (const [operation, interaction] of Object.entries(capability.interactions)) {
        if (!isInteractionClass(interaction)) {
          errors.push(`"${operation}" declares interaction "${interaction}" (one of ${INTERACTION_CLASSES.join(', ')})`);
        }
        if (inline[operation] !== undefined && inline[operation] !== interaction) {
          errors.push(`operation "${operation}" is declared as "${inline[operation]}" inline and as "${interaction}" in "interactions" — one class per operation`);
        }
      }
    }
  }

  const criticality = capability.criticality ?? 'optional';
  if (!CRITICALITY.includes(criticality)) errors.push(`"criticality" must be one of ${CRITICALITY.join(', ')}`);
  if (criticality === 'core' && capability.degradation?.fallback) {
    // A core capability with a fallback is a capability whose absence has been
    // hidden — that is how a broken instance starts looking healthy.
    errors.push('a "core" capability may not declare a fallback — its absence must stay visible');
  }

  const trust = capability.trust ?? 'feature';
  if (!TRUST_LEVELS.includes(trust)) errors.push(`"trust" must be one of ${TRUST_LEVELS.join(', ')}`);

  const lifecycle = capability.lifecycle ?? 'available';
  if (!CAPABILITY_STATES.includes(lifecycle)) errors.push(`"lifecycle" must be a capability state (one of ${CAPABILITY_STATES.join(', ')})`);

  if (capability.requirements !== undefined) {
    if (capability.requirements === null || typeof capability.requirements !== 'object' || Array.isArray(capability.requirements)) {
      errors.push('"requirements" must be an object');
    } else {
      for (const key of Object.keys(capability.requirements)) {
        if (!REQUIREMENT_FIELDS.includes(key)) errors.push(`unknown requirement "${key}" (one of ${REQUIREMENT_FIELDS.join(', ')})`);
      }
      for (const key of ['memoryMb', 'storageMb']) {
        const value = capability.requirements[key];
        if (value !== undefined && (!Number.isFinite(value) || value <= 0)) errors.push(`requirement "${key}" must be a positive number`);
      }
    }
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
export function createFrontendRegistry({ surfaces = [], extensionPoints = [], owners = {}, capabilities = [], observability = null } = {}) {
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
    // The owner vocabulary comes from the manifests; an empty map means "not handed
    // over", in which case only the owner-id shape is checked.
    owners,
    knownNamespaces: [],
  };

  function register(capability) {
    const id = capability?.id;
    // Duplicate ids are checked first: it is the clearest diagnosis, and every
    // later check would also reject the second registration for a side reason.
    if (typeof id === 'string' && registered.has(id)) {
      observability?.tryEmit('frontend.capability.rejected', { capability: id, code: 'frontend.registry.invalid-capability', reason: 'duplicate id' });
      throw new RegistryError(`capability "${id}" is already registered`, { id, errors: ['duplicate id'] });
    }
    const { ok, errors } = validateCapability(capability, catalog);
    if (!ok) {
      observability?.tryEmit('frontend.capability.rejected', {
        capability: typeof id === 'string' ? id : null,
        code: 'frontend.registry.invalid-capability',
        reason: errors.join('; '),
      });
      throw new RegistryError(`capability "${id ?? '(anonymous)'}" is not registrable: ${errors.join('; ')}`, { id, errors });
    }
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
      // maturity (P2.8-F): how it activates, how much it matters, who wrote it
      activation: capability.activation ?? 'eager',
      entry: capability.entry ?? null,
      criticality: capability.criticality ?? 'optional',
      trust: capability.trust ?? 'feature',
      lifecycle: capability.lifecycle ?? 'available',
      requirements: Object.freeze({ ...(capability.requirements ?? {}) }),
      owner: capability.owner ?? null,
      operations: Object.freeze(operationsOf(capability)),
      interactions: Object.freeze(interactionsOf(capability)),
      degradation: capability.degradation ? Object.freeze({ ...capability.degradation }) : null,
    });
    registered.set(normalized.id, normalized);
    observability?.tryEmit('frontend.capability.registered', {
      capability: normalized.id,
      lego: normalized.lego,
      activation: normalized.activation,
      criticality: normalized.criticality,
      trust: normalized.trust,
      operations: normalized.operations.length,
      interactions: Object.keys(normalized.interactions).length,
    });
    if (normalized.criticality !== 'core' && normalized.degradation) {
      observability?.tryEmit('frontend.capability.degraded', {
        capability: normalized.id,
        behavior: normalized.degradation.behavior ?? null,
      });
    }
    return normalized;
  }

  for (const capability of capabilities) register(capability);

  /**
   * The interaction class of an operation, or the default when nothing is declared.
   * Returned with `declared` so a caller can tell a decision from a fallback.
   */
  function interactionOf(capabilityId, operation) {
    const capability = registered.get(capabilityId);
    if (!capability) return Object.freeze({ capability: capabilityId, operation, interaction: null, declared: false, known: false });
    const declared = capability.interactions[operation] ?? null;
    return Object.freeze({
      capability: capabilityId,
      operation,
      interaction: declared ?? 'call',
      declared: declared !== null,
      known: capability.operations.includes(operation),
    });
  }

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

  /**
   * Availability (declared + resolvable) is not activation (loaded + running).
   * This projection answers the first without touching the second.
   */
  function availability() {
    return Object.freeze(list().map((capability) => Object.freeze({
      id: capability.id,
      status: capability.status,
      activation: capability.activation,
      entry: capability.entry,
      lifecycle: capability.lifecycle,
      criticality: capability.criticality,
      trust: capability.trust,
      surfaces: capability.surfaces,
      owner: capability.owner,
      operations: capability.operations,
      interactions: capability.interactions,
      degradation: degradationFor(capability),
    })));
  }


  return {
    surfaces: Object.freeze([...surfaces]),
    extensionPoints: Object.freeze([...extensionPoints]),
    register,
    availability,
    degradationOf: (id) => {
      const capability = registered.get(id);
      return capability ? degradationFor(capability) : null;
    },
    registerAll(values) {
      return values.map(register);
    },
    has: (id) => registered.has(id),
    get: (id) => registered.get(id) ?? null,
    list,
    resolveRoute,
    /** The interaction class of an operation, with `declared` telling a decision from a default. */
    interactionOf,
    surface: (id) => surfaceById.get(id) ?? null,
    extensionPoint: (id) => pointById.get(id) ?? null,
    descriptor,
    validate: (capability) => validateCapability(capability, catalog),
  };
}
