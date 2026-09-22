/**
 * Adapter selection — the swap point for the frontend implementation.
 *
 * `src/lego.mjs` imports *this* module, never a framework file, so the framework
 * name appears in exactly one directory (`src/adapters/**`). Replacing Vue with
 * another implementation means adding an adapter here and changing one line —
 * nothing else in the package, the app or the backend contracts moves.
 */
import { createVueAdapter } from './vue.mjs';

/** Adapter factory for the reference implementation (pinned n8n editor bundle). */
export const CURRENT_ADAPTER = createVueAdapter;
export const CURRENT_ADAPTER_ID = 'vue';

export { createVueAdapter };
export const ADAPTERS = Object.freeze({ vue: createVueAdapter });

/** Resolves an adapter factory by id, defaulting to the current implementation. */
export function createAdapter(id = CURRENT_ADAPTER_ID) {
  const factory = ADAPTERS[id];
  if (!factory) throw new Error(`unknown frontend adapter "${id}" (available: ${Object.keys(ADAPTERS).join(', ')})`);
  return factory;
}
