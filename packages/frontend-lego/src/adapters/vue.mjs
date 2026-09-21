/**
 * Vue adapter — **the only module in this package allowed to know that Vue
 * exists** (enforced by `test/05-boundary.test.mjs`).
 *
 * The pinned `n8n-editor-ui@2.9.4` bundle is the reference implementation and is
 * served verbatim, so the adapter's job is not to rewrite it. Its job is to make
 * the seam explicit:
 *
 *   - name the framework and the bundle version in the boot descriptor, so a
 *     consumer knows which implementation is live without guessing;
 *   - describe how the *current* implementation consumes the contract (meta tag →
 *     read the payload; future extension scripts mount through the documented
 *     hooks);
 *   - record the conventions a future implementation must honour, and the ones
 *     that are Vue-specific and may be dropped when the implementation changes.
 *
 * Nothing here patches the bundle, injects a script into it, or assumes a Vue
 * internal. Every rule is data, so it can be asserted by tests and read by a
 * future implementer instead of living in someone's head.
 */
import { FRONTEND_BOOT_GLOBAL, FRONTEND_BOOT_META_NAME, bootMetaTag, browserBootstrapSnippet, buildBootPayload } from '../boot.mjs';

/** Identity of the current implementation. */
export const ADAPTER = Object.freeze({
  id: 'vue',
  framework: 'Vue 3',
  bundle: 'n8n-editor-ui',
  bundleVersion: '2.9.4',
  servedBy: 'apps/n8n-lego/src/ui.mjs',
  patched: false,
  isolated: true,
  boot: Object.freeze({
    metaName: FRONTEND_BOOT_META_NAME,
    globalKey: FRONTEND_BOOT_GLOBAL,
    /** The stock bundle never reads the payload today; extension scripts do. */
    consumedByStockBundle: false,
  }),
});

/**
 * How the current implementation consumes the frontend contract. Declarative on
 * purpose: it is the migration map for a future implementation, and a checklist
 * for the extension mechanism when it is implemented.
 */
export const CONVENTIONS = Object.freeze([
  Object.freeze({
    id: 'boot-payload',
    title: 'Boot descriptor delivery',
    rule: `read <meta name="${FRONTEND_BOOT_META_NAME}"> (base64 JSON) or GET /rest/frontend/bootstrap; never parse rendered HTML for contract data`,
  }),
  Object.freeze({
    id: 'single-bridge',
    title: 'One bridge global',
    rule: `the payload is published at window.${FRONTEND_BOOT_GLOBAL}; extensions read it from there instead of importing backend modules`,
  }),
  Object.freeze({
    id: 'no-bundle-patch',
    title: 'No bundle patching',
    rule: 'the served bundle is never modified: extension points apply at runtime, on top of the stock UI',
  }),
  Object.freeze({
    id: 'contract-first',
    title: 'Contract before component',
    rule: 'a component asks the client/error/i18n modules for meaning (envelope, error kind, message key) and only then renders',
  }),
  Object.freeze({
    id: 'implementation-scoped',
    title: 'Vue-specific knowledge stays here',
    rule: 'component names, stores, provide/inject keys and router internals may only appear in this adapter directory',
  }),
  Object.freeze({
    id: 'replaceable',
    title: 'Replacement is an adapter task',
    rule: 'a different implementation (another framework, Web Components per contracts/micro-frontend.contract.md) replaces this adapter and reuses every other module unchanged',
  }),
]);

/**
 * Creates the adapter for the current implementation.
 *
 * @param {{ registry: object, app: { name: string, version: string, referenceVersion?: string }, ui?: { basePath: string, restEndpoint: string } }} init
 */
export function createVueAdapter({ registry, app, ui = { basePath: '/', restEndpoint: 'rest' } }) {
  const bootPayload = buildBootPayload({
    registry,
    app,
    ui: {
      editorPackage: ADAPTER.bundle,
      editorVersion: ADAPTER.bundleVersion,
      framework: ADAPTER.framework,
      frameworkIsolated: true,
      basePath: ui.basePath,
      restEndpoint: ui.restEndpoint,
    },
  });

  return Object.freeze({
    id: ADAPTER.id,
    framework: ADAPTER.framework,
    bundle: `${ADAPTER.bundle}@${ADAPTER.bundleVersion}`,
    isolated: true,
    bootPayload,
    metaTag: bootMetaTag(bootPayload),
    bootMetaName: FRONTEND_BOOT_META_NAME,
    globalKey: FRONTEND_BOOT_GLOBAL,
    conventions: CONVENTIONS,
    browserSnippet: browserBootstrapSnippet,
    /** Data-only summary; safe to log (no payload, no secrets). */
    describe() {
      return {
        adapter: ADAPTER.id,
        framework: ADAPTER.framework,
        bundle: `${ADAPTER.bundle}@${ADAPTER.bundleVersion}`,
        bootMetaName: FRONTEND_BOOT_META_NAME,
        globalKey: FRONTEND_BOOT_GLOBAL,
        conventions: CONVENTIONS.length,
      };
    },
  });
}
