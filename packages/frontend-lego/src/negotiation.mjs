/**
 * Capability negotiation: discovery, access, availability and degradation.
 *
 * The rule this module exists to enforce: **placement grants nothing**. A unit
 * nested under a capable parent reaches only what its own surface binds, or what a
 * capability explicitly declares for that surface. Everything else is refused by
 * name — and a refused consumer is not even told whether the capability would have
 * worked.
 *
 * Three origins are kept apart on purpose, because they are different facts:
 *
 *   `frontend-registered`  a capability this frontend has registered at runtime;
 *   `frontend-declared`    a capability this frontend declares but has not installed;
 *   `backend-advertised`   a capability the backend (or the compatibility layer)
 *                          advertises — the frontend never probes for it.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */
import { backendCapabilitiesOf, capabilityOf, surfacesOfCapability } from './surface-capability.mjs';
import { compatibilityOf, satisfiesRange } from './versions.mjs';
import { directionOf as defaultDirectionOf } from './i18n.mjs';
import { vocabularyOf } from './vocabulary.mjs';

/**
 * The canonical degradation vocabulary — quoted from the backend foundation
 * (`lego.interaction` v1.0.0, owner agent-2) rather than re-invented here. The
 * frontend reports the *same* words the backend uses, because a UI that says
 * "disabled" while the backend says "dependency-disabled" has two answers to one
 * question. `vocabulary.mjs` holds the lock; this is the runtime use of it.
 */
const DEGRADATION = vocabularyOf('degradation');
const LIFECYCLE_VOCABULARY = vocabularyOf('lifecycle');

/** What each canonical degradation value instructs the surface to do — quoted, not softened. */
export function degradationOf(state) {
  if (!DEGRADATION.values.includes(state)) {
    throw new NegotiationError(`"${state}" is not a canonical degradation state (one of ${DEGRADATION.values.join(', ')})`, { code: 'frontend.vocabulary.unknown-term' });
  }
  return Object.freeze({
    state,
    usable: DEGRADATION.usable[state] === true,
    action: DEGRADATION.actions[state],
    /** The frontend rendering instruction, derived from the canonical instruction. */
    behavior: DEGRADATION.usable[state] === true ? 'proceed' : 'fallback',
  });
}

/** The states a negotiation verdict may report — the canonical degradation states. */
export const AVAILABILITY_STATES = DEGRADATION.values;

/**
 * The situations the frontend must survive, and the verdict each one produces. Data,
 * not prose — `test/23` walks this table and asserts every row. The `state` column is
 * a canonical degradation value, so the frontend never answers with a word the
 * backend foundation does not use.
 */
export const DEGRADATION_SITUATIONS = Object.freeze([
  Object.freeze({ situation: 'available', state: 'available', trigger: 'the capability is declared or advertised and nothing blocks it' }),
  Object.freeze({ situation: 'unavailable', state: 'capability-unavailable', trigger: 'the capability is not declared or advertised at all' }),
  Object.freeze({ situation: 'disabled', state: 'dependency-disabled', trigger: 'a declared lifecycle state of "disabled"' }),
  Object.freeze({ situation: 'unsupported', state: 'feature-unsupported', trigger: 'the instance does not implement the capability (the compatibility layer answers 501)' }),
  Object.freeze({ situation: 'incompatible', state: 'version-incompatible', trigger: 'a required version cannot be satisfied by what is offered' }),
  Object.freeze({ situation: 'degraded', state: 'degraded', trigger: 'the instance implements the capability partially, or an operation is missing' }),
  Object.freeze({ situation: 'not-installed', state: 'optional-absent', trigger: 'the frontend declares the capability but has not installed it' }),
  Object.freeze({ situation: 'migration-required', state: 'migration-required', trigger: 'a declared migration gate has not run' }),
]);

/**
 * Why an operation cannot be executed — the distinct outcomes the UI needs, never
 * collapsed into "unavailable". The precedence order is declared and tested: the
 * first matching row wins, so a verdict is deterministic.
 */
export const OPERATION_STATES = vocabularyOf('operationOutcome').values;

/**
 * Precedence: the first matching row wins, so the same question always gets the same
 * answer. Access first (a caller that was never granted the capability is not told
 * anything else), then the capability's own blockers, then what the caller must hold,
 * then whether the operation is published at all — and only then the ordinary
 * degraded/available answers.
 */
export const OPERATION_PRECEDENCE = Object.freeze([
  'operation-denied',
  'capability-unavailable',
  'optional-absent',
  'dependency-disabled',
  'migration-required',
  'version-incompatible',
  'feature-unsupported',
  'permission-unknown',
  'permission-missing',
  'operation-unpublished',
  'degraded',
  'available',
]);

/** Which canonical degradation state an operation outcome reports alongside the specific reason. */
const OPERATION_DEGRADATION = vocabularyOf('operationOutcome').mirror;

/** Origins of a capability answer. A backend name collision is not a synonym. */
export const CAPABILITY_ORIGINS = Object.freeze(['frontend-registered', 'frontend-declared', 'backend-advertised']);

/** Operation names are `\u003cdomain\u003e.\u003cname\u003e` — the grammar the registry and the envelope share. */
const OPERATION_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export class NegotiationError extends Error {
  constructor(message, { code = 'frontend.capability.unknown', capabilityId = null, unitId = null } = {}) {
    super(message);
    this.name = 'NegotiationError';
    this.code = code;
    this.capabilityId = capabilityId;
    this.unitId = unitId;
  }
}

/** Raised by `requireUse` when a unit has not been granted a capability. */
export class CapabilityNotGrantedError extends NegotiationError {
  constructor(message, { code = 'frontend.capability.not-granted', capabilityId = null, unitId = null } = {}) {
    super(message, { code, capabilityId, unitId });
    this.name = 'CapabilityNotGrantedError';
  }
}

const asArray = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

/**
 * @param {object} init
 * @param {object} init.registry     the capability registry (registered capabilities)
 * @param {object} init.subLegos     the nested sub-LEGO registry (units and surfaces)
 * @param {Array<object>} init.surfaces   the declared surface catalog
 * @param {Array<object>} [init.declared] capabilities this frontend declares but does not install
 * @param {object} [init.backend]    the derived backend view ({ capabilities })
 * @param {string} [init.contractVersion] the frontend contract version
 * @param {string[]} [init.locales]  locale codes this frontend serves
 */
export function createCapabilityNegotiator({
  registry,
  subLegos,
  surfaces = [],
  declared = [],
  backend = { capabilities: {} },
  contractVersion = '0.0.0',
  locales = [],
} = {}) {
  const declaredById = new Map(declared.map((capability) => [capability.id, capability]));
  const backendCapabilities = backend.capabilities ?? {};
  const surfaceById = new Map(surfaces.map((surface) => [surface.id, surface]));
  // A capability that declares a surface: capabilityId → [surfaceId].
  const declaredSurfaces = new Map();

  function capabilityEntry(capabilityId) {
    const registered = registry.get(capabilityId);
    if (registered) return { origin: 'frontend-registered', entry: registered, installed: true };
    const declaration = declaredById.get(capabilityId) ?? null;
    if (declaration) return { origin: 'frontend-declared', entry: declaration, installed: false };
    const advertised = backendCapabilities[capabilityId] ?? null;
    if (advertised) return { origin: 'backend-advertised', entry: advertised, installed: true };
    return null;
  }

  function surfacesFor(capabilityId, entry) {
    const explicit = asArray(entry.surfaces);
    if (explicit.length > 0) return explicit;
    const registered = declaredSurfaces.get(capabilityId);
    if (registered && registered.length > 0) return registered;
    return surfacesOfCapability(surfaces, capabilityId);
  }

  /** The capability a unit's own surface binds, or null when the surface is UI-only. */
  function ownCapabilityOf(unit) {
    const surface = surfaceById.get(unit.surface) ?? null;
    return capabilityOf(surface ?? {}) ?? capabilityOf(unit) ?? null;
  }

  /**
   * What a unit is granted by placement alone. `capability` is the unit's own
   * surface binding; `declaredSurfaces` are the capabilities that named this unit's
   * surface on their own terms.
   */
  function grantOf(unitId) {
    const unit = subLegos.get(unitId);
    if (!unit) {
      throw new NegotiationError(`"${unitId}" is not a declared unit`, { code: 'frontend.capability.unknown-unit', unitId });
    }
    const declaredForSurface = [];
    for (const [capabilityId, entry] of [
      ...declaredById.entries(),
      ...[...registry.list()].map((capability) => [capability.id, capability]),
    ]) {
      if (asArray(entry.surfaces).includes(unit.surface)) declaredForSurface.push(capabilityId);
    }
    return Object.freeze({
      unitId,
      surface: unit.surface,
      capability: ownCapabilityOf(unit),
      placement: unit.parentId,
      declaredSurfaces: Object.freeze([...new Set(declaredForSurface)].sort()),
    });
  }

  /**
   * May this unit use this capability?
   *
   * Yes when the unit's own surface binds it, or when the capability declares that
   * surface. No in every other case — including when a parent could.
   */
  function mayUse(unitId, capabilityId) {
    const unit = subLegos.get(unitId);
    if (!unit) {
      return Object.freeze({ allowed: false, unitId, capabilityId, basis: null, reason: `"${unitId}" is not a declared unit` });
    }
    const own = ownCapabilityOf(unit);
    if (own !== null && own === capabilityId) {
      return Object.freeze({ allowed: true, unitId, capabilityId, basis: 'surface-binding', reason: null });
    }
    const found = capabilityEntry(capabilityId);
    if (!found) {
      return Object.freeze({
        allowed: false,
        unitId,
        capabilityId,
        basis: null,
        reason: `"${capabilityId}" is not declared by this frontend`,
      });
    }
    const surfaces_ = surfacesFor(capabilityId, found.entry);
    if (surfaces_.includes(unit.surface)) {
      return Object.freeze({ allowed: true, unitId, capabilityId, basis: 'declared-surface', reason: null });
    }
    const reason = own === null
      ? `"${unitId}" sits on surface "${unit.surface}", which carries no backend capability, and "${capabilityId}" does not declare it — placement never grants a capability`
      : `"${unitId}" is granted "${own}" by its surface, and "${capabilityId}" does not declare surface "${unit.surface}" — placement never grants a capability`;
    return Object.freeze({ allowed: false, unitId, capabilityId, basis: null, reason });
  }

  /** `mayUse`, but a refusal is an error instead of a decision object. */
  function requireUse(unitId, capabilityId) {
    const decision = mayUse(unitId, capabilityId);
    if (!decision.allowed) {
      throw new CapabilityNotGrantedError(decision.reason, { capabilityId, unitId });
    }
    return decision;
  }

  /**
   * Discovers a capability: identity, version, operations, owner and origin.
   *
   * @throws {NegotiationError} code `frontend.capability.unknown` when nothing
   *   declares or advertises the id. Discovery is deliberately loud; a *verdict*
   *   is `negotiate()`, which never throws.
   */
  function describe(capabilityId) {
    const found = capabilityEntry(capabilityId);
    if (!found) {
      throw new NegotiationError(`"${capabilityId}" is neither declared by this frontend nor advertised by the backend`, { capabilityId });
    }
    const { origin, entry, installed } = found;
    const version = entry.contractVersion ?? contractVersion;
    return Object.freeze({
      id: capabilityId,
      lego: entry.lego ?? null,
      title: entry.title ?? capabilityId,
      origin,
      status: entry.status ?? 'declared',
      lifecycle: entry.lifecycle ?? 'available',
      criticality: entry.criticality ?? 'optional',
      trust: entry.trust ?? 'feature',
      activation: entry.activation ?? 'eager',
      owner: entry.owner ?? null,
      installed,
      contractVersion: version,
      contracts: Object.freeze([...asArray(entry.contracts)]),
      surfaces: Object.freeze([...surfacesFor(capabilityId, entry)]),
      operations: Object.freeze([...asArray(entry.operations)]),
      /** What a consumer must be allowed to do — declared, never inferred from a route. */
      permissions: Object.freeze([...asArray(entry.permissions)]),
      migration: entry.migration ? Object.freeze({ required: entry.migration.required === true, ...entry.migration }) : null,
      requirements: Object.freeze({ ...(entry.requirements ?? {}) }),
      degradation: entry.degradation ? Object.freeze({ ...entry.degradation }) : null,
    });
  }

  /**
   * The negotiation verdict for a capability, optionally from a unit's point of
   * view and optionally requiring operations or a version.
   *
   * Never throws: an unknown capability, an ungranted consumer and an incompatible
   * version are all states with reasons, so a surface can render them.
   */
  function negotiate({ capabilityId, unitId = null, requireOperations = [], requireVersion = null } = {}) {
    const requestedOperations = asArray(requireOperations);

    // A unit that may not use the capability learns nothing about it.
    if (unitId !== null) {
      const decision = mayUse(unitId, capabilityId);
      if (!decision.allowed) return verdict({ state: 'capability-unavailable', capabilityId, unitId, description: null, reasons: [decision.reason], requestedOperations });
    }

    const found = capabilityEntry(capabilityId);
    if (!found) {
      return verdict({
        state: 'capability-unavailable',
        capabilityId,
        unitId,
        description: null,
        reasons: [`"${capabilityId}" is not declared by this frontend`],
        requestedOperations,
      });
    }

    const description = describe(capabilityId);
    const reasons = [];
    let state = 'available';

    // A declared migration gate outranks availability: the capability is present but
    // may not serve, and pretending otherwise is exactly the silent fallback we refuse.
    if (description.migration?.required === true) {
      state = 'migration-required';
      reasons.push(`"${capabilityId}" is declared but requires a migration before it can serve${description.migration.detail ? `: ${description.migration.detail}` : ''}`);
    } else if (description.origin === 'backend-advertised') {
      if (description.status === 'unsupported') {
        state = 'feature-unsupported';
        reasons.push(`the instance does not implement "${capabilityId}"`);
      } else if (description.status === 'partial') {
        state = 'degraded';
        reasons.push(`the instance implements "${capabilityId}" partially`);
      } else if (description.status === 'unknown') {
        state = 'capability-unavailable';
        reasons.push(`"${capabilityId}" is advertised without a usable status`);
      }
    } else if (!description.installed) {
      // Declared, not installed: the optional path is skipped, which is a normal state
      // and not an error — the canonical vocabulary has a word for exactly this.
      state = 'optional-absent';
      reasons.push(`"${capabilityId}" is declared but not installed`);
    }

    if (description.lifecycle === 'disabled') {
      state = 'dependency-disabled';
      reasons.push(`"${capabilityId}" is administratively disabled`);
    } else if (description.lifecycle === 'installed' || description.lifecycle === 'declared') {
      state = state === 'available' ? 'optional-absent' : state;
      reasons.push(`"${capabilityId}" is ${description.lifecycle}, so it publishes no implementation yet`);
    }

    let compatibility = null;
    if (requireVersion !== null) {
      compatibility = compatibilityOf(requireVersion, description.contractVersion);
      if (compatibility.kind === 'breaking' || compatibility.kind === 'downgrade') {
        // A version mismatch is a fact even when migration is also pending; report the
        // more specific blocker, and say so.
        if (state !== 'migration-required') state = 'version-incompatible';
        reasons.push(compatibility.detail);
      } else if (compatibility.kind === 'invalid') {
        if (state !== 'migration-required') state = 'version-incompatible';
        reasons.push(`"${capabilityId}" does not declare a usable version (${compatibility.detail})`);
      }
    }

    const grantedOperations = requestedOperations.filter((operation) => description.operations.includes(operation));
    const missingOperations = requestedOperations.filter((operation) => !description.operations.includes(operation));
    if (missingOperations.length > 0 && state === 'available') {
      state = 'degraded';
    }
    if (missingOperations.length > 0) {
      reasons.push(`operations not offered: ${missingOperations.join(', ')}`);
    }

    return verdict({ state, capabilityId, unitId, description, reasons, compatibility, requestedOperations, grantedOperations, missingOperations });
  }

  /**
   * Can this operation run, and if not, exactly why not?
   *
   * The user interface needs the reason, not a single "unavailable": a missing
   * permission is something the user can fix, an incompatible version is something
   * the operator can fix, an unpublished operation is something nobody can fix yet,
   * and a capability the caller was never granted is not its business at all. The
   * precedence is declared (`OPERATION_PRECEDENCE`) so the answer is deterministic.
   *
   * Never throws for a refusal — only for a malformed operation name.
   */
  function negotiateOperation({
    capabilityId,
    operation,
    unitId = null,
    held = [],
    requirePermissions = [],
    requireVersion = null,
  } = {}) {
    if (typeof operation !== 'string' || !OPERATION_PATTERN.test(operation)) {
      throw new NegotiationError(`"${operation}" is not an operation name (expected <domain>.<name>)`, { code: 'frontend.operation.invalid-name', capabilityId });
    }
    const heldPermissions = Object.freeze([...asArray(held)]);
    const demanded = Object.freeze([...asArray(requirePermissions)]);

    // A caller that was not granted the capability is refused at the operation level,
    // and learns nothing about the capability — not even whether it exists.
    if (unitId !== null) {
      const decision = mayUse(unitId, capabilityId);
      if (!decision.allowed) {
        return operationVerdict({
          state: 'operation-denied',
          capabilityId,
          unitId,
          operation,
          description: null,
          reasons: [decision.reason],
        });
      }
    }

    const found = capabilityEntry(capabilityId);
    if (!found) {
      return operationVerdict({
        state: 'capability-unavailable',
        capabilityId,
        unitId,
        operation,
        description: null,
        reasons: [`"${capabilityId}" is not declared by this frontend`],
      });
    }

    const description = describe(capabilityId);
    const reasons = [];

    // Capability-level blockers first — the same precedence `negotiate()` reports.
    const capabilityVerdict = negotiate({ capabilityId, unitId, requireVersion });
    const blocked = {
      'capability-unavailable': 'capability-unavailable',
      'feature-unsupported': 'feature-unsupported',
      'version-incompatible': 'version-incompatible',
      'dependency-disabled': 'dependency-disabled',
      'migration-required': 'migration-required',
      'optional-absent': 'optional-absent',
    }[capabilityVerdict.state];
    if (blocked) {
      return operationVerdict({
        state: blocked,
        capabilityId,
        unitId,
        operation,
        description,
        reasons: [...capabilityVerdict.reasons],
        exists: description.operations.length === 0 ? null : description.operations.includes(operation),
      });
    }

    // What the caller requires must be something the capability declares at all.
    const unknownPermissions = demanded.filter((permission) => !description.permissions.includes(permission));
    if (unknownPermissions.length > 0) {
      return operationVerdict({
        state: 'permission-unknown',
        capabilityId,
        unitId,
        operation,
        description,
        reasons: [`"${capabilityId}" never declares ${unknownPermissions.join(', ')}`],
        exists: description.operations.includes(operation),
      });
    }

    // What a consumer must be allowed to do is declared; what it holds is the caller's fact.
    const missingPermissions = description.permissions.filter((permission) => !heldPermissions.includes(permission));
    if (missingPermissions.length > 0) {
      return operationVerdict({
        state: 'permission-missing',
        capabilityId,
        unitId,
        operation,
        description,
        reasons: [`the caller does not hold ${missingPermissions.join(', ')}`],
        exists: description.operations.includes(operation),
      });
    }

    // An unpublished operation list is not permission to call anything: fail closed.
    if (description.operations.length === 0) {
      return operationVerdict({
        state: 'operation-unpublished',
        capabilityId,
        unitId,
        operation,
        description,
        reasons: [`"${capabilityId}" publishes no operation list, so "${operation}" cannot be verified`],
        exists: null,
      });
    }

    if (!description.operations.includes(operation)) {
      return operationVerdict({
        state: 'feature-unsupported',
        capabilityId,
        unitId,
        operation,
        description,
        reasons: [`"${capabilityId}" does not offer "${operation}"`],
        exists: false,
      });
    }

    const degraded = capabilityVerdict.state === 'degraded';
    if (degraded) reasons.push(...capabilityVerdict.reasons);
    return operationVerdict({
      state: degraded ? 'degraded' : 'available',
      capabilityId,
      unitId,
      operation,
      description,
      reasons,
      exists: true,
      capabilityVerdict,
    });
  }

  /** The operation answer: identity, reason, what it takes, and what to do about it. */
  function operationVerdict({
    state,
    capabilityId,
    unitId,
    operation,
    description,
    reasons,
    exists = null,
    capabilityVerdict = null,
  }) {
    const known = Boolean(description);
    const usable = state === 'available' || state === 'degraded';
    return Object.freeze({
      capabilityId,
      unitId,
      operation,
      state,
      usable,
      ok: usable,
      /** Does the provider publish this operation? `null` = it publishes no list, so nobody can say. */
      exists,
      capability: known ? description : null,
      identity: known ? `${capabilityId}@${description.contractVersion}#${operation}` : null,
      origin: known ? description.origin : null,
      requiredPermissions: Object.freeze([...(description?.permissions ?? [])]),
      requiredVersion: requireVersionFrom(capabilityVerdict),
      reasons: Object.freeze([...reasons]),
      /** The canonical degradation answer, when the operation vocabulary maps onto it. */
      degradation: OPERATION_DEGRADATION[state] === null
        ? null
        : Object.freeze(degradationOf(OPERATION_DEGRADATION[state])),
      /** What the UI does with this answer — declared per outcome, never improvised. */
      behavior: usable ? 'proceed' : 'fallback',
      fallback: usable ? null : 'native-behavior',
    });
  }

  function requireVersionFrom(capabilityVerdict) {
    return capabilityVerdict?.compatibility ?? null;
  }

  function verdict({
    state,
    capabilityId,
    unitId,
    description,
    reasons,
    compatibility = null,
    requestedOperations = [],
    grantedOperations = [],
    missingOperations = [],
  }) {
    // A refused or unknown capability is reported without metadata: `known` is false
    // both when the capability does not exist and when the caller was not granted it.
    const known = Boolean(description);
    return Object.freeze({
      capabilityId,
      unitId,
      state,
      ok: state === 'available' || state === 'degraded',
      degraded: state === 'degraded',
      capability: known ? description : null,
      identity: known ? `${capabilityId}@${description.contractVersion}` : null,
      origin: known ? description.origin : null,
      contractVersion: known ? description.contractVersion : null,
      compatibility,
      /** What the consumer has to be allowed to do; empty when nothing is required. */
      requiredPermissions: Object.freeze([...(description?.permissions ?? [])]),
      migrationRequired: description?.migration?.required === true,
      grantedOperations: Object.freeze([...grantedOperations]),
      missingOperations: Object.freeze([...missingOperations]),
      reasons: Object.freeze([...reasons]),
      /**
       * What the UI is expected to do — the canonical instruction and the rendering
       * behaviour derived from it. Declared, never improvised per surface.
       */
      degradation: Object.freeze({
        state,
        usable: DEGRADATION.usable[state] === true,
        action: DEGRADATION.actions[state],
        behavior: DEGRADATION.usable[state] === true ? 'proceed' : 'fallback',
        fallback: DEGRADATION.usable[state] === true ? null : 'native-behavior',
      }),
    });
  }

  /**
   * Every surface, with what the frontend declares beside what the backend
   * advertises. The frontend never probes: a fact that was not handed over is
   * reported as such.
   */
  function featureAvailability() {
    return Object.freeze(surfaces.map((surface) => {
      const capability = capabilityOf(surface);
      const backendEntry = capability ? backendCapabilities[capability] ?? null : null;
      const declaredEntry = capability ? declaredById.get(capability) ?? null : null;
      const registered = capability ? registry.get(capability) ?? null : null;
      let state = 'available';
      const reasons = [];
      if (!capability) {
        state = 'available'; // frontend-only surface: nothing to negotiate
      } else if (!backendEntry) {
        state = 'available';
      } else if (backendEntry.status === 'unsupported') {
        state = 'feature-unsupported';
        reasons.push(`the instance does not implement "${capability}"`);
      } else if (backendEntry.status === 'partial') {
        state = 'degraded';
        reasons.push(`the instance implements "${capability}" partially`);
      }
      if (backendEntry?.migration?.required === true && state !== 'feature-unsupported') {
        state = 'migration-required';
        reasons.push(`"${capability}" requires a migration before it can serve`);
      }
      if (declaredEntry && (declaredEntry.lifecycle === 'disabled')) {
        state = 'dependency-disabled';
        reasons.push(`"${capability}" is administratively disabled`);
      }
      return Object.freeze({
        surface: surface.id,
        capability,
        owner: backendEntry?.owner ?? surface.backend?.owner ?? null,
        contract: surface.backend?.contract ?? null,
        backendContractVersion: backendEntry?.contractVersion ?? null,
        frontendDeclared: Boolean(declaredEntry),
        frontendRegistered: Boolean(registered),
        /** Where the backend fact came from — `override`, the 501 map or the catalog. */
        source: backendEntry?.source ?? 'surface-catalog',
        state,
        reasons: Object.freeze(reasons),
      });
    }));
  }

  /**
   * Locale readiness: which locales this frontend serves, their direction and what
   * is missing. It is a declaration — this module contains no dictionaries.
   */
  function localeReadiness({ supported = [], fallback = null, directionOf = null } = {}) {
    const served = Object.freeze([...locales]);
    const direction = typeof directionOf === 'function' ? directionOf : null;
    const directions = Object.freeze(Object.fromEntries(served.map((locale) => [locale, direction ? direction(locale) : null])));
    return Object.freeze({
      supported: served,
      fallback,
      /** Direction is metadata: the surface asks, it does not decide. */
      directions,
      rtl: Object.freeze(served.filter((locale) => directions[locale] === 'rtl')),
      complete: supported.length > 0 && supported.every((locale) => served.includes(locale)),
      missing: Object.freeze(supported.filter((locale) => !served.includes(locale))),
      /** Translation is a capability like any other: absent means fall back, not break. */
      capability: (() => {
        try {
          return declaredById.get('translation') ? 'declared-not-installed' : 'not-declared';
        } catch {
          return 'not-declared';
        }
      })(),
    });
  }

  return Object.freeze({
    describe,
    grantOf,
    mayUse,
    requireUse,
    negotiate,
    negotiateOperation,
    featureAvailability,
    localeReadiness,
    /** Data for docs, `.ai/` cards and the observability vocabulary. */
    describeModel: () => Object.freeze({
      states: AVAILABILITY_STATES,
      situations: DEGRADATION_SITUATIONS,
      operationStates: OPERATION_STATES,
      operationPrecedence: OPERATION_PRECEDENCE,
      origins: CAPABILITY_ORIGINS,
      rules: Object.freeze([
        'Placement grants nothing: a capability is usable only where its own surface binds it or the capability declares that surface.',
        'A consumer that was not granted a capability is not told whether it would have worked.',
        'Operation lists are declared; an empty list means the unit publishes no operation contract yet.',
        'Version alignment uses the one version vocabulary; a major difference is never compatible.',
        'Frontend readiness and backend availability are separate declarations and are shown side by side.',
        'A backend-advertised name that collides with a frontend one is reported by origin, never merged.',
        'The degradation vocabulary is quoted from the backend foundation, never re-invented: one word, one meaning, both sides.',
        'An operation is answered with the reason it cannot run — a missing permission, an incompatible version and an unpublished operation are different facts.',
        'An operation no provider publishes is refused (operation-unpublished), not assumed to exist.',
        'A caller that was never granted a capability is refused at the operation level and learns nothing about the capability.',
      ]),
    }),
  });
}

/** The negotiation model, for docs and tests, without construction. */
export function describeNegotiation() {
  return Object.freeze({
    states: AVAILABILITY_STATES,
    situations: DEGRADATION_SITUATIONS,
    operationStates: OPERATION_STATES,
    operationPrecedence: OPERATION_PRECEDENCE,
    origins: CAPABILITY_ORIGINS,
    lifecycle: LIFECYCLE_VOCABULARY.values,
    directionOf: typeof defaultDirectionOf,
  });
}

/** Re-exported so a caller can build a range check without a second vocabulary. */
export { satisfiesRange, surfacesOfCapability };
