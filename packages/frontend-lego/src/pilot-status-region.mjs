/**
 * Pilot surface: **status region** (Issue #241 §Scope D + E).
 *
 * Exactly one pilot for this slice — a small, low-risk, reversible shared primitive
 * covering loading / empty / error / ready presentation. It:
 *
 *   - does not touch workflow execution, auth, storage, or the canvas;
 *   - stays framework-neutral (a view-model + observation, never a framework component);
 *   - integrates through the existing capability registry + `ui:error:render` seam;
 *   - keeps the original n8n UI as the default/primary path (mode: pilot).
 *
 * The module only **declares / requests / renders** metadata. It never authorizes,
 * never calls the network, never reads secrets.
 */
import { defineSurfaceContract, validateSurfaceContract, describeSurfaceContract, REGION_STATES, SURFACE_MODES } from './surface-contract.mjs';
import { observation, validateObservation } from './parity.mjs';
import { FrontendError, toDisplayModel, normalizeError } from './errors.mjs';

/** Pilot identity (must stay in sync with manifest/surface-migrations.json + capabilities). */
export const PILOT_ID = 'ui.primitives.status-region';
export const PILOT_VERSION = '1.0.0';
export const PILOT_CAPABILITY_ID = 'status-region';

/** Message slot the pilot owns within the existing i18n grammar. */
export const PILOT_MESSAGE_SLOT = 'system-messages';

/**
 * The migration contract for the pilot. States reuse REGION_STATES; keys live in
 * the existing `system-messages` slot; rollback keeps the reference primary.
 */
export function pilotSurfaceContract() {
  return defineSurfaceContract({
    id: PILOT_ID,
    version: PILOT_VERSION,
    title: 'Status region (loading / empty / error / ready)',
    mode: 'pilot',
    // Metadata-only pilot: available in the catalog, loaded only when a consumer asks.
    lifecycleState: 'available',
    capabilityRequirements: [
      {
        id: 'reference-ui',
        criticality: 'optional',
        degradation: {
          fallback: 'native-behavior',
          detail: 'without the pilot the stock n8n status presentation remains the path',
        },
      },
      {
        id: 'status-region',
        criticality: 'optional',
        degradation: {
          fallback: 'native-behavior',
          detail: 'if the pilot capability is absent, surfaces keep the reference empty/error UI',
        },
      },
    ],
    inputBoundary: {
      fields: ['regionState', 'messageKey', 'params', 'retryEvent'],
      source: 'hand-over',
    },
    outputBoundary: {
      events: ['status-region:retry', 'status-region:dismiss'],
      authority: 'declare-request-render',
    },
    interaction: 'event',
    transport: 'local',
    localization: {
      slot: PILOT_MESSAGE_SLOT,
      fallbackLocale: 'en',
    },
    accessibility: {
      observables: ['role', 'aria-busy', 'aria-live', 'aria-label-key'],
    },
    states: {
      loading: {
        messageKey: `${PILOT_MESSAGE_SLOT}.status-loading`,
        a11y: { role: 'status', 'aria-busy': 'true' },
      },
      empty: {
        messageKey: `${PILOT_MESSAGE_SLOT}.status-empty`,
        a11y: { role: 'status', 'aria-busy': 'false' },
      },
      error: {
        messageKey: `${PILOT_MESSAGE_SLOT}.status-error`,
        errorKind: 'network',
        a11y: { role: 'alert', 'aria-live': 'assertive' },
      },
      ready: {
        messageKey: `${PILOT_MESSAGE_SLOT}.status-ready`,
        a11y: { role: 'status', 'aria-busy': 'false' },
      },
    },
    observability: {
      events: ['pilot.status-region.rendered', 'pilot.status-region.transition'],
    },
    rollback: {
      strategy: 'pilot-not-primary',
      reference: 'n8n-editor-ui@2.9.4',
    },
  });
}

/** Validate the pilot contract (always against closed vocabularies). */
export function validatePilotSurfaceContract(contract = pilotSurfaceContract(), catalog = {}) {
  return validateSurfaceContract(contract, catalog);
}

/**
 * Create a pilot status-region view model.
 *
 * @param {{ state?: string, messageKey?: string|null, params?: object,
 *           error?: object|null, locale?: string }} [init]
 */
export function createStatusRegion(init = {}) {
  const contract = pilotSurfaceContract();
  const state = init.state ?? 'ready';
  if (!REGION_STATES.includes(state)) {
    throw new Error(`status region state "${state}" must be one of ${REGION_STATES.join(', ')}`);
  }

  let current = state;
  let params = { ...(init.params ?? {}) };
  let errorInput = init.error ?? null;
  let messageKey = init.messageKey ?? contract.states[state].messageKey;
  const locale = init.locale ?? 'en';
  const history = [{ state: current, at: 0 }];

  function displayModel() {
    if (current === 'error' && errorInput) {
      // Prefer an explicit kind from the pilot input; fall back to the shared normalizer.
      const kind = typeof errorInput.kind === 'string' ? errorInput.kind : null;
      const frontendError = kind
        ? new FrontendError({
            kind,
            code: errorInput.code ?? null,
            messageKey: errorInput.messageKey ?? undefined,
            message: errorInput.message ?? undefined,
            status: typeof errorInput.status === 'number' ? errorInput.status : undefined,
          })
        : normalizeError(errorInput);
      return toDisplayModel(frontendError);
    }
    const decl = contract.states[current];
    return Object.freeze({
      messageKey: messageKey ?? decl.messageKey,
      params: Object.freeze({ ...params }),
      fallbackText: null,
      severity: current === 'error' ? 'error' : current === 'loading' ? 'info' : 'info',
      actions: current === 'error' ? Object.freeze(['retry', 'dismiss']) : Object.freeze([]),
    });
  }

  function a11y() {
    const decl = contract.states[current];
    return Object.freeze({
      role: decl.a11y?.role ?? 'status',
      'aria-busy': current === 'loading' ? 'true' : 'false',
      'aria-live': decl.a11y?.['aria-live'] ?? 'polite',
      'aria-label-key': messageKey ?? decl.messageKey,
    });
  }

  return Object.freeze({
    id: PILOT_ID,
    version: PILOT_VERSION,
    get state() {
      return current;
    },
    get mode() {
      return 'pilot';
    },
    contract: Object.freeze(contract),
    transition(next, { reason = null, params: nextParams = null, error = undefined, messageKey: nextKey = undefined } = {}) {
      if (!REGION_STATES.includes(next)) {
        throw new Error(`unknown status region state "${next}"`);
      }
      if (next !== current) {
        history.push({ state: next, at: history.length, reason });
        current = next;
        // Default the key to the state's declared key unless the caller passes one.
        messageKey = nextKey ?? contract.states[current].messageKey;
      } else if (nextKey !== undefined) {
        messageKey = nextKey;
      }
      if (nextParams) params = { ...nextParams };
      if (error !== undefined) errorInput = error;
      return current;
    },
    /** Observable snapshot for the parity harness (candidate side). */
    observe() {
      return observation({
        surfaceId: PILOT_ID,
        side: 'candidate',
        visible: true,
        regionState: current,
        loading: current === 'loading',
        empty: current === 'empty',
        error: current === 'error'
          ? {
              kind: errorInput?.kind ?? contract.states.error.errorKind,
              code: errorInput?.code ?? null,
              messageKey: displayModel().messageKey,
            }
          : null,
        interactions: {
          'shows-retry': current === 'error',
        },
        events: [],
        accessibility: a11y(),
        localization: {
          slot: PILOT_MESSAGE_SLOT,
          messageKeys: REGION_STATES.map((s) => contract.states[s].messageKey),
        },
        contract: {
          mode: 'pilot',
          authority: 'declare-request-render',
          id: PILOT_ID,
          version: PILOT_VERSION,
        },
      });
    },
    displayModel,
    a11y,
    get history() {
      return Object.freeze([...history]);
    },
    get locale() {
      return locale;
    },
    describe: () => Object.freeze({
      ...describeSurfaceContract(contract),
      pilot: true,
      primary: false,
      originalUiRemainsDefault: true,
    }),
  });
}

/**
 * Build a **reference-side** observation that stands in for the stock n8n status
 * presentation for the same logical states. Fixtures are deterministic; a future
 * harness run may replace this with a live probe without changing the contract.
 *
 * @param {{ state: string, surfaceId?: string, error?: object|null }} init
 */
export function referenceStatusObservation(init) {
  const state = init.state;
  if (!REGION_STATES.includes(state)) {
    throw new Error(`unknown reference state "${state}"`);
  }
  const contract = pilotSurfaceContract();
  const surfaceId = init.surfaceId ?? PILOT_ID;
  const a11yByState = {
    loading: { role: 'status', 'aria-busy': 'true', 'aria-live': 'polite' },
    empty: { role: 'status', 'aria-busy': 'false', 'aria-live': 'polite' },
    error: { role: 'alert', 'aria-busy': 'false', 'aria-live': 'assertive' },
    ready: { role: 'status', 'aria-busy': 'false', 'aria-live': 'polite' },
  };
  return observation({
    surfaceId,
    side: 'reference',
    visible: true,
    regionState: state,
    loading: state === 'loading',
    empty: state === 'empty',
    error: state === 'error'
      ? {
          kind: init.error?.kind ?? 'network',
          code: init.error?.code ?? null,
          messageKey: init.error?.messageKey ?? contract.states.error.messageKey,
        }
      : null,
    interactions: {
      'shows-retry': state === 'error',
    },
    events: [],
    accessibility: a11yByState[state],
    localization: {
      slot: PILOT_MESSAGE_SLOT,
      messageKeys: REGION_STATES.map((s) => contract.states[s].messageKey),
    },
    contract: {
      mode: 'reference',
      authority: 'declare-request-render',
      id: surfaceId,
    },
  });
}

/** Ensure an observation the pilot produces is valid (fail-closed helper). */
export function assertValidPilotObservation(obs) {
  const errors = validateObservation(obs);
  if (errors.length > 0) throw new Error(`invalid pilot observation: ${errors.join('; ')}`);
  if (obs.surfaceId !== PILOT_ID) throw new Error(`pilot observation surfaceId must be ${PILOT_ID}`);
  if (obs.side !== 'candidate') throw new Error('pilot observation side must be candidate');
  return obs;
}

/** Capability declaration fragment reused by manifest/capabilities.json (no second registry). */
export function pilotCapabilityDeclaration() {
  return {
    id: PILOT_CAPABILITY_ID,
    lego: 'ui-frontend',
    title: 'Status region pilot (loading / empty / error)',
    status: 'available',
    activation: 'eager',
    criticality: 'optional',
    trust: 'feature',
    lifecycle: 'available',
    surfaces: ['error-surfaces', 'dashboard'],
    contracts: ['contracts/frontend.contract.md'],
    extensionPoints: ['ui:error:render'],
    messages: 'status-region',
    degradation: {
      fallback: 'native-behavior',
      detail: 'without the pilot capability the reference n8n status/error presentation remains primary',
    },
    tests: ['packages/frontend-lego/test/39-pilot-status-region.test.mjs'],
    phase: 'issue-241',
    owner: 'agent-01',
    notes: 'Issue #241 pilot only: metadata + view-model behind the existing registry/extension seam; original UI stays default. Not installed at boot unless registered by a consumer.',
  };
}
