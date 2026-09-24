/**
 * Differential / parity harness (Issue #241 §Scope C).
 *
 * Compares two **observations** of the same UI surface:
 *
 *   reference  — the pinned n8n implementation (or a fixture that stands in for it)
 *   candidate  — a Frontend LEGO surface (pilot or future migration)
 *
 * Comparison is on **observable behavior**, never pixels:
 *   visible · loading · empty · error · interaction results · emitted events
 *   · accessibility observables · localization keys · contract/boundary notes
 *
 * Every comparison yields one of four closed statuses:
 *
 *   equivalent         — every compared field matches exactly
 *   compatible         — differences that the contract allows (e.g. extra non-blocking event)
 *   migration-required — a material observable differs; migration is not done
 *   breaking           — safety/boundary violation or invalid observation shape
 *
 * Framework-neutral and browser-safe: pure functions, no I/O.
 */
import { REGION_STATES } from './surface-contract.mjs';

/** Closed comparison statuses. */
export const PARITY_STATUSES = Object.freeze(['equivalent', 'compatible', 'migration-required', 'breaking']);

/** Observation fields the harness knows how to compare. */
export const PARITY_FIELDS = Object.freeze([
  'visible',
  'regionState',
  'loading',
  'empty',
  'error',
  'interactions',
  'events',
  'accessibility',
  'localization',
  'contract',
]);

/**
 * Differences that are allowed without leaving `equivalent` when both sides agree
 * on semantics but list extras in a controlled way.
 */
const EVENT_COMPAT_RULES = Object.freeze({
  // candidate may omit optional analytics-like events the reference emits
  optionalCandidateMissing: Object.freeze(['parity-probe']),
});

export class ParityError extends Error {
  constructor(message, { errors = [] } = {}) {
    super(message);
    this.name = 'ParityError';
    this.code = 'frontend.parity.invalid-observation';
    this.errors = Object.freeze([...errors]);
  }
}

/**
 * Validate an observation shape. Fail-closed: an observation the harness cannot
 * compare must not produce a soft PASS.
 *
 * @param {object} observation
 * @returns {string[]} errors
 */
export function validateObservation(observation) {
  const errors = [];
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    return ['observation must be an object'];
  }
  if (typeof observation.surfaceId !== 'string' || observation.surfaceId.length === 0) {
    errors.push('surfaceId must be a non-empty string');
  }
  if (typeof observation.side !== 'string' || !['reference', 'candidate'].includes(observation.side)) {
    errors.push('side must be "reference" or "candidate"');
  }
  if (typeof observation.visible !== 'boolean') errors.push('visible must be a boolean');
  if (!REGION_STATES.includes(observation.regionState)) {
    errors.push(`regionState must be one of ${REGION_STATES.join(', ')}`);
  }
  if (typeof observation.loading !== 'boolean') errors.push('loading must be a boolean');
  if (typeof observation.empty !== 'boolean') errors.push('empty must be a boolean');
  const error = observation.error;
  if (error !== null && error !== undefined) {
    if (typeof error !== 'object') errors.push('error must be null or an object { kind?, code?, messageKey? }');
    else if (error.kind !== undefined && error.kind !== null && typeof error.kind !== 'string') {
      errors.push('error.kind must be a string when present');
    }
  }
  if (observation.interactions !== undefined) {
    if (typeof observation.interactions !== 'object' || Array.isArray(observation.interactions)) {
      errors.push('interactions must be an object map of name -> result');
    }
  }
  if (observation.events !== undefined && !Array.isArray(observation.events)) {
    errors.push('events must be an array of event names');
  }
  if (observation.accessibility !== undefined) {
    if (typeof observation.accessibility !== 'object' || observation.accessibility === null) {
      errors.push('accessibility must be an object of observables');
    }
  }
  if (observation.localization !== undefined) {
    const loc = observation.localization;
    if (typeof loc !== 'object' || loc === null) errors.push('localization must be an object');
    else {
      if (loc.slot !== undefined && typeof loc.slot !== 'string') errors.push('localization.slot must be a string');
      if (loc.messageKeys !== undefined && !Array.isArray(loc.messageKeys)) errors.push('localization.messageKeys must be an array');
    }
  }
  if (observation.contract !== undefined && observation.contract !== null) {
    if (typeof observation.contract !== 'object') errors.push('contract must be an object when present');
  }
  return errors;
}

function stableSorted(values) {
  return [...values].sort((a, b) => String(a).localeCompare(String(b)));
}

function setEquals(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

function compareError(ref, cand) {
  const r = ref ?? null;
  const c = cand ?? null;
  if (r === null && c === null) return { level: 'equal', detail: null };
  if (r === null || c === null) return { level: 'diff', detail: 'error presence differs' };
  const notes = [];
  if (r.kind !== undefined && c.kind !== undefined && r.kind !== c.kind) notes.push(`kind ${r.kind} vs ${c.kind}`);
  if (r.code !== undefined && c.code !== undefined && r.code !== c.code) notes.push(`code ${r.code} vs ${c.code}`);
  if (r.messageKey !== undefined && c.messageKey !== undefined && r.messageKey !== c.messageKey) {
    notes.push(`messageKey ${r.messageKey} vs ${c.messageKey}`);
  }
  if (notes.length === 0) return { level: 'equal', detail: null };
  return { level: 'diff', detail: notes.join('; ') };
}

/**
 * Compare two observations of the same surface.
 *
 * @param {object} referenceObservation side === 'reference'
 * @param {object} candidateObservation side === 'candidate'
 * @param {{ strictEvents?: boolean }} [options]
 * @returns {{ status: string, surfaceId: string, diffs: Array<object>, fieldStatus: object }}
 */
export function compareObservations(referenceObservation, candidateObservation, options = {}) {
  const strictEvents = options.strictEvents === true;
  const refErrors = validateObservation(referenceObservation);
  const candErrors = validateObservation(candidateObservation);
  if (refErrors.length > 0 || candErrors.length > 0) {
    throw new ParityError('observations are not comparable', {
      errors: [
        ...refErrors.map((e) => `reference: ${e}`),
        ...candErrors.map((e) => `candidate: ${e}`),
      ],
    });
  }
  if (referenceObservation.side !== 'reference') {
    throw new ParityError('first observation must be side="reference"', { errors: ['side'] });
  }
  if (candidateObservation.side !== 'candidate') {
    throw new ParityError('second observation must be side="candidate"', { errors: ['side'] });
  }
  if (referenceObservation.surfaceId !== candidateObservation.surfaceId) {
    throw new ParityError('observations describe different surfaces', {
      errors: [`${referenceObservation.surfaceId} vs ${candidateObservation.surfaceId}`],
    });
  }

  const diffs = [];
  const fieldStatus = Object.create(null);

  function note(field, level, detail) {
    fieldStatus[field] = level;
    if (level !== 'equal') diffs.push({ field, level, detail });
  }

  // visible / region / loading / empty — exact boolean equality
  for (const field of ['visible', 'regionState', 'loading', 'empty']) {
    if (referenceObservation[field] === candidateObservation[field]) note(field, 'equal', null);
    else note(field, 'diff', `${String(referenceObservation[field])} vs ${String(candidateObservation[field])}`);
  }

  const errCmp = compareError(referenceObservation.error, candidateObservation.error);
  note('error', errCmp.level, errCmp.detail);

  // interactions: every reference interaction must match; extra candidate keys are noted
  const refIx = referenceObservation.interactions ?? {};
  const candIx = candidateObservation.interactions ?? {};
  const ixNotes = [];
  for (const [name, result] of Object.entries(refIx)) {
    if (!(name in candIx)) ixNotes.push(`missing interaction "${name}"`);
    else if (JSON.stringify(candIx[name]) !== JSON.stringify(result)) {
      ixNotes.push(`interaction "${name}" ${JSON.stringify(result)} vs ${JSON.stringify(candIx[name])}`);
    }
  }
  for (const name of Object.keys(candIx)) {
    if (!(name in refIx)) ixNotes.push(`extra interaction "${name}"`);
  }
  note('interactions', ixNotes.length === 0 ? 'equal' : 'diff', ixNotes.join('; ') || null);

  // events: ordered set compare with optional-event allowance
  const refEvents = stableSorted(referenceObservation.events ?? []);
  const candEvents = stableSorted(candidateObservation.events ?? []);
  if (setEquals(refEvents, candEvents)) {
    note('events', 'equal', null);
  } else {
    const refSet = new Set(refEvents);
    const candSet = new Set(candEvents);
    const missingInCand = refEvents.filter((e) => !candSet.has(e));
    const extraInCand = candEvents.filter((e) => !refSet.has(e));
    const optionalMissing = missingInCand.filter((e) => EVENT_COMPAT_RULES.optionalCandidateMissing.includes(e));
    const materialMissing = missingInCand.filter((e) => !EVENT_COMPAT_RULES.optionalCandidateMissing.includes(e));
    if (materialMissing.length === 0 && extraInCand.length === 0) {
      note('events', 'equal', null);
    } else if (materialMissing.length === 0 && !strictEvents) {
      // extra candidate events that are not on the reference need a compatible tag
      note('events', 'diff', `extra candidate events: ${extraInCand.join(', ')}`);
    } else {
      note('events', 'diff', [
        materialMissing.length ? `missing: ${materialMissing.join(', ')}` : null,
        extraInCand.length ? `extra: ${extraInCand.join(', ')}` : null,
      ].filter(Boolean).join('; '));
    }
    void optionalMissing;
  }

  // accessibility: every reference observable must match on the candidate
  const refA = referenceObservation.accessibility ?? {};
  const candA = candidateObservation.accessibility ?? {};
  const aNotes = [];
  for (const [key, value] of Object.entries(refA)) {
    if (!(key in candA)) aNotes.push(`missing ${key}`);
    else if (candA[key] !== value) aNotes.push(`${key}: ${String(value)} vs ${String(candA[key])}`);
  }
  note('accessibility', aNotes.length === 0 ? 'equal' : 'diff', aNotes.join('; ') || null);

  // localization: slot must match; messageKeys — reference keys must exist on candidate
  const refL = referenceObservation.localization ?? {};
  const candL = candidateObservation.localization ?? {};
  const lNotes = [];
  if (refL.slot !== undefined && candL.slot !== undefined && refL.slot !== candL.slot) {
    lNotes.push(`slot ${refL.slot} vs ${candL.slot}`);
  }
  const refKeys = refL.messageKeys ?? [];
  const candKeys = new Set(candL.messageKeys ?? []);
  for (const key of refKeys) {
    if (!candKeys.has(key)) lNotes.push(`missing messageKey ${key}`);
  }
  note('localization', lNotes.length === 0 ? 'equal' : 'diff', lNotes.join('; ') || null);

  // contract notes: boundary authority must agree when both declare it
  const refC = referenceObservation.contract ?? null;
  const candC = candidateObservation.contract ?? null;
  if (refC && candC) {
    const cNotes = [];
    if (refC.authority !== undefined && candC.authority !== undefined && refC.authority !== candC.authority) {
      cNotes.push(`authority ${refC.authority} vs ${candC.authority}`);
    }
    if (refC.mode !== undefined && candC.mode !== undefined && refC.mode !== candC.mode) {
      // mode difference is expected during pilot (reference vs pilot) — compatible, not equal
      note('contract', 'diff', `mode ${refC.mode} vs ${candC.mode} (expected while piloting)`);
    } else {
      note('contract', cNotes.length === 0 ? 'equal' : 'diff', cNotes.join('; ') || null);
    }
    if (cNotes.length > 0 && fieldStatus.contract === 'diff' && diffs.filter((d) => d.field === 'contract').length) {
      // append authority notes to existing contract diff
      const existing = diffs.find((d) => d.field === 'contract');
      if (existing && cNotes.length) existing.detail = existing.detail ? `${existing.detail}; ${cNotes.join('; ')}` : cNotes.join('; ');
    }
  } else {
    note('contract', 'equal', null);
  }

  // Safety: UI must never claim authorize/execute authority
  if (candC && candC.authority && candC.authority !== 'declare-request-render') {
    diffs.push({ field: 'contract', level: 'breaking', detail: `candidate authority "${candC.authority}" violates isolation` });
    fieldStatus.contract = 'breaking';
  }

  // Roll up status
  let status = 'equivalent';
  const levels = Object.values(fieldStatus);
  const hasBreaking = diffs.some((d) => d.level === 'breaking')
    || fieldStatus.contract === 'breaking';
  const materialDiffs = diffs.filter((d) => d.level === 'diff' && d.field !== 'contract');
  // mode-only contract diff is compatible during pilot
  const contractOnlyModeDiff = diffs.length > 0 && diffs.every((d) => d.field === 'contract' && /mode /.test(d.detail ?? ''));

  if (hasBreaking) status = 'breaking';
  else if (materialDiffs.length > 0) status = 'migration-required';
  else if (diffs.length > 0) status = contractOnlyModeDiff ? 'compatible' : 'compatible';

  // regionState/loading/empty/visible diffs are material
  for (const field of ['visible', 'regionState', 'loading', 'empty', 'error', 'interactions', 'events', 'accessibility', 'localization']) {
    if (fieldStatus[field] === 'diff') {
      if (status === 'equivalent') status = 'migration-required';
    }
  }
  if (diffs.some((d) => d.level === 'breaking')) status = 'breaking';

  void levels;
  return Object.freeze({
    status,
    surfaceId: referenceObservation.surfaceId,
    diffs: Object.freeze(diffs.map((d) => Object.freeze({ ...d }))),
    fieldStatus: Object.freeze({ ...fieldStatus }),
  });
}

/**
 * Convenience: build a minimal observation (tests and fixtures).
 *
 * @param {object} init
 */
export function observation(init) {
  return Object.freeze({
    surfaceId: init.surfaceId,
    side: init.side,
    visible: init.visible === true,
    regionState: init.regionState,
    loading: init.loading === true,
    empty: init.empty === true,
    error: init.error ?? null,
    interactions: Object.freeze({ ...(init.interactions ?? {}) }),
    events: Object.freeze([...(init.events ?? [])]),
    accessibility: Object.freeze({ ...(init.accessibility ?? {}) }),
    localization: init.localization ? Object.freeze({ ...init.localization }) : undefined,
    contract: init.contract ? Object.freeze({ ...init.contract }) : undefined,
  });
}

/** Describe harness capabilities for evidence. */
export function describeParityHarness() {
  return Object.freeze({
    statuses: PARITY_STATUSES,
    fields: PARITY_FIELDS,
    compares: 'observable behavior (not pixels)',
    regionStates: REGION_STATES,
  });
}
