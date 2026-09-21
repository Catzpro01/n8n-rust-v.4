/**
 * The frontend's read-only view of what the backend advertises.
 *
 * This is **not** a second backend registry. The backend's capability registry
 * (the compatibility layer's unsupported/feature map, owned by the same agent as
 * this boundary but living in the application) stays the source of truth; this
 * module turns the data the app hands over into the shape the frontend's
 * negotiation speaks — feature availability and compatibility state, per surface.
 *
 * Nothing here calls anything, reads a module or assumes a transport: it is a pure
 * function of declarations, so it can run at boot, in a test or in a plan without
 * side effects.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */
import { NO_CAPABILITY, capabilityOf } from './surface-capability.mjs';
import { compatibilityOf } from './versions.mjs';

/** How the frontend sees a backend capability. */
export const BACKEND_STATES = Object.freeze(['available', 'partial', 'unsupported', 'unknown']);

/**
 * @param {object} init
 * @param {Array<object>} [init.surfaces]            the surface catalog
 * @param {Array<object>} [init.unsupportedFeatures] entries from the compat layer:
 *        `{ prefix, feature, label, owner, phase }` — each one is a real endpoint the
 *        instance answers 501 for
 * @param {Record<string, object>} [init.overrides]  explicit facts (`status`, `owner`,
 *        `contractVersion`, `operations`) for capabilities the declarations cannot tell
 * @param {string} [init.contractVersion]            the frontend's contract version
 */
export function backendAvailabilityFrom({
  surfaces = [],
  unsupportedFeatures = [],
  overrides = {},
  contractVersion = null,
} = {}) {
  const byOwner = new Map();
  for (const entry of unsupportedFeatures) {
    const owner = entry.owner ?? 'unknown';
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(entry);
  }

  const capabilities = {};
  const seen = new Set();
  for (const surface of surfaces) {
    const capability = capabilityOf(surface);
    if (!capability || seen.has(capability)) continue;
    seen.add(capability);

    const declared = surface.backend ?? {};
    const override = overrides[capability] ?? {};
    const gaps = byOwner.get(capability) ?? [];
    const declaredStatus = declared.status === 'unsupported' ? 'unsupported' : 'available';
    const status = override.status ?? (gaps.length > 0 ? 'partial' : declaredStatus);

    capabilities[capability] = Object.freeze({
      status: BACKEND_STATES.includes(status) ? status : 'unknown',
      owner: override.owner ?? gaps[0]?.owner ?? capability,
      contract: override.contract ?? declared.contract ?? null,
      contractVersion: override.contractVersion
        ?? (override.contract && contractVersion ? compatibilityOf(contractVersion, override.contractVersion ?? contractVersion).state === 'compatible' ? override.contractVersion : null : null),
      operations: Object.freeze([...(override.operations ?? [])]),
      /** Why the frontend believes this — declared facts only, no probing. */
      reasons: Object.freeze([
        override.status ? 'declared by an override' : null,
        gaps.length > 0 ? `${gaps.length} endpoint(s) answered 501 by the compatibility layer` : null,
        declared.status === 'unsupported' ? 'the surface catalog marks the backend unsupported' : null,
      ].filter(Boolean)),
      /** Where the fact came from, so a reader can audit the conclusion. */
      source: override.status ? 'override' : gaps.length > 0 ? 'compat-unsupported-map' : 'surface-catalog',
      endpoints: Object.freeze(gaps.map((entry) => entry.prefix)),
    });
  }

  for (const [capability, override] of Object.entries(overrides)) {
    if (capabilities[capability]) continue;
    capabilities[capability] = Object.freeze({
      status: BACKEND_STATES.includes(override.status) ? override.status : 'unknown',
      owner: override.owner ?? capability,
      contract: override.contract ?? null,
      contractVersion: override.contractVersion ?? null,
      operations: Object.freeze([...(override.operations ?? [])]),
      reasons: Object.freeze(['declared by an override for a capability no surface binds']),
      source: 'override',
      endpoints: Object.freeze([]),
    });
  }

  return Object.freeze({ capabilities: Object.freeze(capabilities) });
}

/** The view as data for docs and `.ai/` cards. */
export function describeBackendView() {
  return Object.freeze({
    states: BACKEND_STATES,
    rules: Object.freeze([
      'The backend registry stays the source of truth; this view is derived from declarations the app hands over.',
      'Nothing is probed: a fact is only here because a declaration said so, and `source` names which one.',
      'A capability answered 501 in part is `partial`, never `available`.',
      `A surface bound to no backend capability reports "${NO_CAPABILITY}" and is frontend-only.`,
    ]),
  });
}
