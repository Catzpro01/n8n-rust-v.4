/**
 * Frontend LEGO assembly — the single entry the application uses.
 *
 * Boot order:
 *   1. load the catalogs (surfaces, extension points, ownership);
 *   2. build the registry (fail-closed validation of the catalogs themselves);
 *   3. hand the registry to the current adapter, which produces the boot payload.
 *
 * The assembly is **fail-soft by design**: if anything here throws, the caller
 * (the app) logs it and serves the stock editor without the descriptor. The UI
 * must never depend on this LEGO being loadable to render — that is the
 * difference between a boundary and a new coupling.
 */
import { createAdapter, CURRENT_ADAPTER_ID } from './adapters/index.mjs';
import { describeAgents } from './agents.mjs';
import { describeAgentEvents } from './agent-events.mjs';
import { backendAvailabilityFrom } from './backend-view.mjs';
import { checkConformance } from './conformance.mjs';
import { describeInteractions, resolveInteraction } from './interactions.mjs';
import { CONTRACT_VERSION } from './contract.mjs';
import { createImpactGraph } from './impact.mjs';
import { SUPPORTED_LOCALES, directionOf, unmappedMessageSlots } from './i18n.mjs';
import { loadManifests } from './manifests.mjs';
import { degradationFor } from './lifecycle.mjs';
import { createCapabilityNegotiator } from './negotiation.mjs';
import { createObservability } from './observability.mjs';
import { DEVICE_PROFILES, resolveSupport } from './profiles.mjs';
import { createFrontendRegistry, validateCapability } from './registry.mjs';
import { createSubLegoRegistry } from './sublegos.mjs';
import { createOperationGateway, defineLocalTransport } from './transport.mjs';
import { describeVocabulary, detectCollisions, vocabularyConflicts } from './vocabulary.mjs';
import { capabilityIdentity, consumeInput, describeSeam } from './seam.mjs';

/**
 * @param {object} init
 * @param {{ name: string, version: string, referenceVersion?: string }} init.app
 * @param {{ basePath?: string, restEndpoint?: string }} [init.ui]
 * @param {string} [init.adapterId] adapter to use (defaults to the current implementation)
 * @param {Array<object>} [init.capabilities] capabilities to register at boot
 * @param {object} [init.backend]           what the backend advertises, as data the app
 *        hands over: `{ capabilities: { id: { status, owner, contractVersion, operations } } }`
 *        (built by `backendAvailabilityFrom` from the surface catalog + compat layer)
 * @param {object} [init.observability]     an existing observability instance; one is
 *        created by default so boundary events are always inspectable
 * @param {{ warn?: Function, info?: Function }} [init.logger]
 */
export function createFrontendLego({
  app,
  ui = {},
  adapterId = CURRENT_ADAPTER_ID,
  capabilities = [],
  backend = null,
  observability = null,
  logger = {},
} = {}) {
  if (!app?.name || !app?.version) throw new Error('createFrontendLego needs { app: { name, version } }');

  const manifests = loadManifests();
  // Boundary observability exists by default so lifecycle/upgrade/rejection events
  // are inspectable without wiring anything; it stays a bounded in-memory buffer.
  const events = observability ?? createObservability();
  const registry = createFrontendRegistry({
    surfaces: manifests.surfaces,
    extensionPoints: manifests.extensionPoints,
    owners: manifests.owners,
    capabilities,
    observability: events,
  });
  // The hierarchy below this LEGO. Fail-closed: a sub-LEGO that breaks the
  // hierarchy, publishes no boundary or depends on a private area stops the boot
  // (fail-soft at the app level, which then serves the stock editor).
  const subLegos = createSubLegoRegistry({
    subLegos: manifests.subLegos,
    owners: manifests.owners,
    surfaces: manifests.surfaces,
    extensionPoints: manifests.extensionPoints,
    catalogVersion: manifests.subLegoCatalog.catalogVersion ?? null,
    observability: events,
  });

  /**
   * The declared capability catalog is validated but NOT registered. Declaring a
   * capability is how its identity, criticality, trust level and fallback are
   * agreed; registering it would claim it is installed, and the boot payload
   * would carry metadata for something that does not exist. Availability is
   * reported through `availability()` instead — in-process, never on the wire.
   */
  const declaredErrors = [];
  const namespaceOwner = new Map();
  for (const declaration of manifests.capabilities) {
    const { ok, errors } = validateCapability(declaration, {
      surfaces: manifests.surfaces,
      extensionPoints: manifests.extensionPoints,
      // One capability, one message namespace — enforced across declarations too.
      knownNamespaces: [...namespaceOwner.keys()],
    });
    if (!ok) declaredErrors.push(...errors.map((error) => `declared capability "${declaration.id}": ${error}`));
    if (typeof declaration.messages === 'string') namespaceOwner.set(declaration.messages, declaration.id);
  }
  if (declaredErrors.length > 0) {
    throw new Error(`manifest/capabilities.json is invalid — ${declaredErrors.join('; ')}`);
  }

  /** The frontend capability declarations, with their degradation contract. */
  function availability() {
    return Object.freeze(manifests.capabilities.map((declaration) => Object.freeze({
      id: declaration.id,
      lego: declaration.lego,
      title: declaration.title,
      status: declaration.status ?? 'declared',
      activation: declaration.activation ?? 'eager',
      lifecycle: declaration.lifecycle ?? 'available',
      criticality: declaration.criticality ?? 'optional',
      trust: declaration.trust ?? 'feature',
      /** Who owns the capability: explicit, and validated against manifest/sub-legos.json. */
      owner: declaration.owner ?? null,
      surfaces: Object.freeze([...(declaration.surfaces ?? [])]),
      entry: declaration.entry ?? null,
      requirements: Object.freeze({ ...(declaration.requirements ?? {}) }),
      degradation: degradationFor(declaration),
      /** Where it will run: the declared budget decided per device profile. */
      support: Object.freeze(DEVICE_PROFILES.map((profile) => Object.freeze({
        profile: profile.id,
        state: resolveSupport(profile.id, declaration).state,
      }))),
      installed: false,
    })));
  }

  /**
   * The backend view: derived from declarations the app hands over, never probed.
   * When the app passes nothing, the surface catalog alone answers — which is the
   * honest default in a checkout with no compatibility layer running.
   */
  const backendView = backend?.capabilities
    ? backend
    : backendAvailabilityFrom({ surfaces: manifests.surfaces, unsupportedFeatures: backend?.unsupportedFeatures ?? [] });

  const negotiator = createCapabilityNegotiator({
    registry,
    subLegos,
    surfaces: manifests.surfaces,
    declared: manifests.capabilities,
    backend: backendView,
    contractVersion: CONTRACT_VERSION,
    // Locale identity belongs to the frontend contract: the declared locale set,
    // extended (never replaced) by anything the surface catalog adds.
    locales: [...new Set([
      ...SUPPORTED_LOCALES.map((locale) => locale.code),
      ...((manifests.surfaceCatalog.locales ?? []).map?.((locale) => locale.code ?? locale) ?? []),
    ])],
  });

  /**
   * Operation delivery with no transport assumption. The local transport is a
   * direct in-process call (no serialization); REST is the boundary that already
   * exists. Nothing else is wired, and nothing is routed implicitly.
   */
  const localHandlers = {};
  const localTransport = defineLocalTransport({ handlers: localHandlers });
  const extraTransports = [];
  const gateway = createOperationGateway({ transports: [localTransport], observability: events });

  const impact = createImpactGraph({
    subLegos,
    capabilities: registry,
    surfaces: manifests.surfaces,
    contractOwners: Object.freeze(Object.fromEntries(
      manifests.surfaces
        .filter((surface) => surface.backend?.contract && !['contracts/frontend.contract.md', 'contracts/frontend-sub-lego.contract.md'].includes(surface.backend.contract))
        .map((surface) => [surface.backend.contract, surface.backend.capability ?? 'another LEGO']),
    )),
  });

  const createAdapterFor = createAdapter(adapterId);
  const adapter = createAdapterFor({
    registry,
    subLegos,
    app,
    ui: { basePath: ui.basePath ?? '/', restEndpoint: ui.restEndpoint ?? 'rest' },
  });

  const warnings = [];
  const unmapped = unmappedMessageSlots(manifests.surfaces);
  if (unmapped.length > 0) {
    warnings.push(`message slots without a declared surface: ${unmapped.join(', ')}`);
    logger.warn?.('frontend LEGO: message slots without an owning surface', { slots: unmapped });
  }

  logger.info?.('frontend LEGO ready', describe());

  function describe() {
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      surfaces: manifests.surfaces.length,
      subLegos: subLegos.list().length,
      subLegoDepth: Math.max(0, ...subLegos.list().map((entry) => subLegos.depthOf(entry.id))),
      extensionPoints: manifests.extensionPoints.length,
      capabilities: registry.list().length,
      declaredCapabilities: manifests.capabilities.length,
      backendCapabilities: Object.keys(backendView.capabilities).length,
      transports: gateway.describe().implemented.length,
      aiCapabilities: describeAgents().capabilities.length,
      agentEventTypes: describeAgentEvents().eventTypes.length,
      events: events.stats().emitted,
      adapter: adapter.id,
      framework: adapter.framework,
      bundle: adapter.bundle,
      bootMetaName: adapter.bootMetaName,
      backendUntouched: true,
    });
  }

  const assembly = {
    contractVersion: CONTRACT_VERSION,
    manifests,
    registry,
    subLegos,
    adapter,
    warnings: Object.freeze(warnings),
    /** The descriptor the browser (and tooling) receives. */
    bootPayload: adapter.bootPayload,
    /** Additive `<meta>` tag for `index.html`; empty string when unavailable. */
    metaTag: adapter.metaTag,
    /** Registers a capability after boot (used by tests and by late LEGO wiring). */
    register: (capability) => registry.register(capability),
    /** Registers a sub-LEGO after boot (the unit is validated against the hierarchy). */
    registerSubLego: (entry) => subLegos.register(entry),
    /**
     * What this frontend can offer, what it may not be trusted to do, and what
     * happens when it is absent. Declared only — nothing here is installed.
     */
    availability,
    /** "If this unit changes, what must be tested?" — see src/impact.mjs. */
    impactOf: (target, options) => impact.impactOf(target, options),
    /** The dry-run plan for a change, before anything is touched. */
    planChange: (request) => impact.planChange(request),
    conformance: () => checkConformance(assembly),
    /** Boundary events: capability, unit, lifecycle, upgrade, operation. */
    observability: events,
    /** Capability discovery and access decisions (placement grants nothing). */
    negotiate: (request) => negotiator.negotiate(request),
    /**
     * Can this operation run, and if not, why not? `operation-unpublished` means the
     * provider declared no operation list — the frontend refuses rather than assumes.
     */
    negotiateOperation: (request) => negotiator.negotiateOperation(request),
    /**
     * Discovery: an unknown capability answers `null` instead of throwing; for a
     * verdict with reasons, `negotiate()` is the call (it never throws).
     */
    describeCapability: (id) => {
      try {
        return negotiator.describe(id);
      } catch (error) {
        if (error?.code === 'frontend.capability.unknown') return null;
        throw error;
      }
    },
    mayUse: (unitId, capabilityId) => negotiator.mayUse(unitId, capabilityId),
    requireUse: (unitId, capabilityId) => negotiator.requireUse(unitId, capabilityId),
    grantOf: (unitId) => negotiator.grantOf(unitId),
    /** What the frontend offers per surface, against what the backend advertises. */
    featureAvailability: () => negotiator.featureAvailability(),
    localeReadiness: (options = {}) => negotiator.localeReadiness({ directionOf, ...options }),
    /** The shared vocabulary this package quotes from the backend foundation, with provenance. */
    describeVocabulary,
    /** The lock's self-audit: a local word that competes with a shared one is a conflict. */
    vocabularyConflicts: () => vocabularyConflicts(),
    /** Capability ids that appear under more than one origin — reported, never merged. */
    capabilityCollisions: () => detectCollisions([
      ...[...registry.list()].map((capability) => ({ id: capability.id, origin: 'frontend-registered' })),
      ...manifests.capabilities.map((capability) => ({ id: capability.id, origin: 'frontend-declared' })),
      ...Object.keys(backendView.capabilities).map((id) => ({ id, origin: 'backend-advertised' })),
    ]),
    /**
     * The AI vocabulary: declared capabilities, provider/runtime/tool kinds, the MCP
     * boundary and the trace contract. Nothing here calls a model.
     */
    describeAgents,
    /** The universal agent event vocabulary and the bounded work-trace contract. */
    describeAgentEvents,
    /**
     * The seam: the closed list of inputs this LEGO may consume, the sources each may
     * come from, and the one identity shape a capability is projected into. `consumeInput`
     * is the fail-closed check; nothing here reads a backend file.
     */
    describeSeam,
    capabilityIdentity,
    consumeInput,
    /**
     * Transport-neutral delivery. `invoke` picks the cheapest capable transport
     * that can carry the operation's declared interaction class.
     */
    // `async` on purpose: a refused interaction must surface as a rejected call,
    // exactly like a refused transport, so every caller handles one shape.
    invoke: async (request = {}) => {
      const declared = registry.interactionOf(request.capability, request.operation);
      const interaction = resolveInteraction({
        declared: declared.interaction,
        requested: request.interaction ?? null,
        operation: request.operation,
      });
      return gateway.invoke({ ...request, interaction });
    },
    /** The declared interaction class of an operation (`declared: false` = default call). */
    interactionOf: (capability, operation) => registry.interactionOf(capability, operation),
    /** The interaction model as data. */
    describeInteractions,
    describeTransports: () => gateway.describe(),
    selectTransport: (request) => gateway.select(request),
    /**
     * Attaches an in-process operation handler. This is how a same-process LEGO
     * becomes reachable without inventing an HTTP hop.
     */
    registerOperation: (operation, handler) => {
      if (typeof operation !== 'string' || typeof handler !== 'function') {
        throw new Error('registerOperation(operation, handler) needs a name and a function');
      }
      localHandlers[operation] = handler;
      return true;
    },
    /** Registers another transport (already-implemented ones join selection by cost). */
    registerTransport: (transport) => {
      extraTransports.push(transport);
      return true;
    },
    describe,
  };
  // Frozen last: `conformance()` reads the assembly it belongs to.
  return Object.freeze(assembly);
}
