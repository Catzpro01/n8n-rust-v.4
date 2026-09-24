/**
 * Framework-neutral **surface migration contract** (Issue #241 §Scope B).
 *
 * Describes what a single UI region promises when it moves from the reference
 * n8n implementation toward a Frontend LEGO implementation. It deliberately
 * *consumes* existing vocabulary instead of inventing a parallel architecture:
 *
 *   lifecycle     → lifecycle.mjs CAPABILITY_STATES / degradationFor
 *   capabilities  → declared capability ids (registry catalog), not a second list
 *   interaction   → interactions.mjs INTERACTION_CLASSES
 *   transport     → transport.mjs TRANSPORT_KINDS
 *   localization  → i18n.mjs MESSAGE_SLOTS + locale model
 *   errors        → errors.mjs ERROR_KINDS + toDisplayModel shape
 *   accessibility → declared a11y observation fields (attribute-level only)
 *
 * The contract is data: validate + describe. It never mounts, fetches, or
 * authorizes. Framework-neutral and browser-safe.
 */
import { CAPABILITY_STATES, CRITICALITY, degradationFor } from './lifecycle.mjs';
import { INTERACTION_CLASSES } from './interactions.mjs';
import { TRANSPORT_KINDS } from './transport.mjs';
import { ERROR_KINDS } from './errors.mjs';

/** Identity + version rules for a migration contract row. */
export const SURFACE_CONTRACT_ID_PATTERN = /^ui\.[a-z0-9]+(?:[.-][a-z0-9]+)+$/;

/** Modes a migrated surface may operate in (strangler, never big-bang). */
export const SURFACE_MODES = Object.freeze(['reference', 'pilot', 'dual', 'lego-primary']);

/** Observable region states the parity harness compares (not pixel states). */
export const REGION_STATES = Object.freeze(['loading', 'empty', 'error', 'ready']);

/** Required top-level fields of a surface migration contract. */
export const SURFACE_CONTRACT_FIELDS = Object.freeze([
  'id',
  'version',
  'title',
  'mode',
  'lifecycleState',
  'capabilityRequirements',
  'inputBoundary',
  'outputBoundary',
  'interaction',
  'transport',
  'localization',
  'accessibility',
  'states',
  'observability',
  'rollback',
]);

export class SurfaceContractError extends Error {
  constructor(message, { contractId = null, errors = [] } = {}) {
    super(message);
    this.name = 'SurfaceContractError';
    this.code = 'frontend.surface-contract.invalid';
    this.contractId = contractId;
    this.errors = Object.freeze([...errors]);
  }
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Validate a surface migration contract declaration.
 *
 * @param {object} contract
 * @param {{ knownSurfaceIds?: Set<string>, knownCapabilities?: Set<string>,
 *           knownMessageSlots?: Set<string> }} [catalog]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateSurfaceContract(contract, catalog = {}) {
  const errors = [];
  if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) {
    return { ok: false, errors: ['contract must be an object'] };
  }
  for (const field of SURFACE_CONTRACT_FIELDS) {
    if (contract[field] === undefined || contract[field] === null) {
      errors.push(`missing required field "${field}"`);
    }
  }
  const known = new Set(SURFACE_CONTRACT_FIELDS);
  for (const key of Object.keys(contract)) {
    if (!known.has(key)) errors.push(`unknown field "${key}" (surface contract is a closed shape)`);
  }

  if (typeof contract.id !== 'string' || !SURFACE_CONTRACT_ID_PATTERN.test(contract.id)) {
    errors.push('"id" must match the inventory id grammar (ui.area.name)');
  }
  if (typeof contract.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(contract.version ?? '')) {
    errors.push('"version" must be semver MAJOR.MINOR.PATCH');
  }
  if (typeof contract.title !== 'string' || contract.title.length === 0) {
    errors.push('"title" must be a non-empty string');
  }
  if (!SURFACE_MODES.includes(contract.mode)) {
    errors.push(`"mode" must be one of ${SURFACE_MODES.join(', ')}`);
  }
  if (!CAPABILITY_STATES.includes(contract.lifecycleState)) {
    errors.push(`"lifecycleState" must reuse lifecycle.mjs CAPABILITY_STATES (${CAPABILITY_STATES.join(', ')})`);
  }

  // Capability requirements: ids + criticality, degraded through lifecycle.mjs rules.
  const reqs = contract.capabilityRequirements;
  if (!Array.isArray(reqs) || reqs.length === 0) {
    errors.push('"capabilityRequirements" must be a non-empty array');
  } else {
    for (const req of reqs) {
      if (!req || typeof req !== 'object') {
        errors.push('each capabilityRequirement must be an object');
        continue;
      }
      if (typeof req.id !== 'string' || req.id.length === 0) {
        errors.push('capabilityRequirement.id must be a non-empty string');
      } else if (catalog.knownCapabilities && !catalog.knownCapabilities.has(req.id) && req.id !== 'reference-ui') {
        // `reference-ui` is the virtual requirement meaning "the stock bundle supplies this".
        errors.push(`unknown capability "${req.id}"`);
      }
      if (!CRITICALITY.includes(req.criticality)) {
        errors.push(`capability "${req.id ?? '?'}" criticality must be one of ${CRITICALITY.join(', ')}`);
      }
      if (req.degradation !== undefined && req.degradation !== null) {
        const degradation = degradationFor({ criticality: req.criticality, degradation: req.degradation });
        if (degradation.behavior === 'fail-loud' && req.criticality === 'core') {
          // core + explicit fallback would contradict fail-loud; allow detail-only
          if (req.degradation.fallback && req.degradation.fallback !== null) {
            errors.push(`core capability "${req.id}" must not declare a fallback (missing core is fail-loud)`);
          }
        }
      }
    }
  }

  // Input / output boundaries: declared data shapes only — no code, no URLs with secrets.
  const input = contract.inputBoundary;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push('"inputBoundary" must be an object');
  } else {
    if (!Array.isArray(input.fields)) errors.push('inputBoundary.fields must be an array');
    else {
      for (const field of input.fields) {
        if (typeof field !== 'string' || field.length === 0) errors.push('inputBoundary.fields entries must be non-empty strings');
      }
    }
    if (input.source !== undefined && input.source !== 'hand-over' && input.source !== 'reference-observe') {
      errors.push('inputBoundary.source must be "hand-over" or "reference-observe"');
    }
    for (const banned of ['password', 'secret', 'privateKey', 'apiKey']) {
      if (Array.isArray(input.fields) && input.fields.includes(banned)) {
        errors.push(`inputBoundary must not accept "${banned}"`);
      }
    }
  }

  const output = contract.outputBoundary;
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    errors.push('"outputBoundary" must be an object');
  } else {
    if (!Array.isArray(output.events)) errors.push('outputBoundary.events must be an array of event names');
    else {
      for (const ev of output.events) {
        if (typeof ev !== 'string' || !/^[a-z][a-z0-9-]+(?::[a-z][a-z0-9-]+)*$/.test(ev)) {
          errors.push(`output event "${ev}" must be kebab-case segments joined by ':'`);
        }
      }
    }
    if (output.authority !== undefined && output.authority !== 'declare-request-render') {
      errors.push('outputBoundary.authority must be "declare-request-render" (UI never authorizes or executes)');
    }
  }

  if (!INTERACTION_CLASSES.includes(contract.interaction)) {
    errors.push(`"interaction" must reuse INTERACTION_CLASSES (${INTERACTION_CLASSES.join(', ')})`);
  }
  if (!TRANSPORT_KINDS.includes(contract.transport)) {
    errors.push(`"transport" must reuse TRANSPORT_KINDS (${TRANSPORT_KINDS.join(', ')})`);
  }

  const loc = contract.localization;
  if (!loc || typeof loc !== 'object') {
    errors.push('"localization" must be an object');
  } else {
    if (typeof loc.slot !== 'string' || loc.slot.length === 0) {
      errors.push('localization.slot must be a message slot id');
    } else if (catalog.knownMessageSlots && !catalog.knownMessageSlots.has(loc.slot)) {
      errors.push(`unknown message slot "${loc.slot}"`);
    }
    if (loc.fallbackLocale !== undefined && typeof loc.fallbackLocale !== 'string') {
      errors.push('localization.fallbackLocale must be a string locale tag when present');
    }
  }

  const a11y = contract.accessibility;
  if (!a11y || typeof a11y !== 'object') {
    errors.push('"accessibility" must be an object');
  } else {
    if (!Array.isArray(a11y.observables)) {
      errors.push('accessibility.observables must be an array');
    } else {
      const allowed = new Set(['role', 'aria-busy', 'aria-live', 'aria-label-key', 'tabindex', 'hidden']);
      for (const obs of a11y.observables) {
        if (!allowed.has(obs)) errors.push(`accessibility observable "${obs}" must be one of ${[...allowed].join(', ')}`);
      }
    }
  }

  const states = contract.states;
  if (!states || typeof states !== 'object') {
    errors.push('"states" must be an object mapping each region state to a declaration');
  } else {
    for (const state of REGION_STATES) {
      if (states[state] === undefined) {
        errors.push(`states must declare "${state}"`);
        continue;
      }
      const decl = states[state];
      if (!decl || typeof decl !== 'object') {
        errors.push(`states.${state} must be an object`);
        continue;
      }
      if (typeof decl.messageKey !== 'string') errors.push(`states.${state}.messageKey must be a string`);
      else if (typeof loc?.slot === 'string' && decl.messageKey.length > 0 && !decl.messageKey.startsWith(`${loc.slot}.`)) {
        errors.push(`states.${state}.messageKey "${decl.messageKey}" must live in slot "${loc.slot}."`);
      }
    }
  }

  const obs = contract.observability;
  if (!obs || typeof obs !== 'object') {
    errors.push('"observability" must be an object');
  } else {
    if (!Array.isArray(obs.events)) errors.push('observability.events must be an array');
    else if (obs.events.length === 0) errors.push('observability.events must name at least one boundary event');
    else {
      for (const ev of obs.events) {
        if (typeof ev !== 'string' || ev.length === 0) errors.push('observability.events entries must be non-empty strings');
      }
    }
  }

  const rollback = contract.rollback;
  if (!rollback || typeof rollback !== 'object') {
    errors.push('"rollback" must be an object');
  } else {
    if (!['reference-remains-default', 'pilot-not-primary', 'lego-primary-with-reference'].includes(rollback.strategy)) {
      errors.push('rollback.strategy must be a known rollback strategy');
    }
    if (typeof rollback.reference !== 'string' || rollback.reference.length === 0) {
      errors.push('rollback.reference must name the pinned reference implementation');
    }
  }

  // Fail closed on error-kind mismatch if a state claims an error kind.
  for (const state of REGION_STATES) {
    const decl = contract.states?.[state];
    if (decl && typeof decl.errorKind === 'string' && !ERROR_KINDS.includes(decl.errorKind)) {
      errors.push(`states.${state}.errorKind "${decl.errorKind}" is not in ERROR_KINDS`);
    }
  }

  return { ok: errors.length === 0, errors: Object.freeze(errors) };
}

/**
 * Build a contract object (does not validate). Use for pilots and tests so field
 * order stays deterministic.
 *
 * @param {object} init
 */
export function defineSurfaceContract(init) {
  const contract = {
    id: init.id,
    version: init.version ?? '1.0.0',
    title: init.title,
    mode: init.mode ?? 'reference',
    lifecycleState: init.lifecycleState ?? 'available',
    capabilityRequirements: init.capabilityRequirements ?? [],
    inputBoundary: { source: 'hand-over', fields: [], ...(init.inputBoundary ?? {}) },
    outputBoundary: {
      events: [],
      authority: 'declare-request-render',
      ...(init.outputBoundary ?? {}),
    },
    interaction: init.interaction ?? 'call',
    transport: init.transport ?? 'local',
    localization: init.localization,
    accessibility: init.accessibility,
    states: init.states,
    observability: init.observability,
    rollback: init.rollback,
  };
  return contract;
}

/** Stable description for evidence and docs. */
export function describeSurfaceContract(contract) {
  return Object.freeze({
    id: contract?.id ?? null,
    version: contract?.version ?? null,
    mode: contract?.mode ?? null,
    lifecycleState: contract?.lifecycleState ?? null,
    regionStates: Object.freeze([...REGION_STATES]),
    interaction: contract?.interaction ?? null,
    transport: contract?.transport ?? null,
    capabilities: Object.freeze(asArray(contract?.capabilityRequirements).map((r) => r?.id)),
    rollbackStrategy: contract?.rollback?.strategy ?? null,
    authority: contract?.outputBoundary?.authority ?? null,
  });
}

/** Whether the surface may render in its current lifecycle state (reuses lifecycle.mjs). */
export function surfaceRunnable(contract) {
  return CAPABILITY_STATES.includes(contract?.lifecycleState)
    && ['loaded', 'active', 'idle'].includes(contract.lifecycleState);
}
