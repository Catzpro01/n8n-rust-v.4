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
import { CONTRACT_VERSION } from './contract.mjs';
import { unmappedMessageSlots } from './i18n.mjs';
import { loadManifests } from './manifests.mjs';
import { createFrontendRegistry } from './registry.mjs';
import { createSubLegoRegistry } from './sublegos.mjs';

/**
 * @param {object} init
 * @param {{ name: string, version: string, referenceVersion?: string }} init.app
 * @param {{ basePath?: string, restEndpoint?: string }} [init.ui]
 * @param {string} [init.adapterId] adapter to use (defaults to the current implementation)
 * @param {Array<object>} [init.capabilities] capabilities to register at boot
 * @param {{ warn?: Function, info?: Function }} [init.logger]
 */
export function createFrontendLego({ app, ui = {}, adapterId = CURRENT_ADAPTER_ID, capabilities = [], logger = {} } = {}) {
  if (!app?.name || !app?.version) throw new Error('createFrontendLego needs { app: { name, version } }');

  const manifests = loadManifests();
  const registry = createFrontendRegistry({
    surfaces: manifests.surfaces,
    extensionPoints: manifests.extensionPoints,
    capabilities,
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
      adapter: adapter.id,
      framework: adapter.framework,
      bundle: adapter.bundle,
      bootMetaName: adapter.bootMetaName,
      backendUntouched: true,
    });
  }

  return Object.freeze({
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
    describe,
  });
}
