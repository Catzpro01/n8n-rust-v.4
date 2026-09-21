/**
 * The surface → backend-capability join, in one place.
 *
 * Three modules need this answer (the sub-LEGO registry, the capability negotiator
 * and anything reading a surface's backend binding). It lives here so they cannot
 * disagree about the `none` sentinel — the surfaces catalog spells "no backend
 * capability" as `none`, while units and grants express the same thing as `null`.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */

/** The surfaces catalog's sentinel for "this surface consumes no backend capability". */
export const NO_CAPABILITY = 'none';

/**
 * The backend capability a surface is bound to, or `null`.
 *
 * @param {{ backend?: { capability?: string|null } }} surface
 * @returns {string|null}
 */
export function capabilityOf(surface) {
  const capability = surface?.backend?.capability ?? null;
  if (capability === null || capability === undefined) return null;
  return capability === NO_CAPABILITY ? null : capability;
}

/** Every distinct backend capability the surface catalog binds, sorted. */
export function backendCapabilitiesOf(surfaces = []) {
  return Object.freeze([...new Set(surfaces.map(capabilityOf).filter(Boolean))].sort());
}

/** The surfaces bound to a backend capability, in catalog order. */
export function surfacesOfCapability(surfaces = [], capabilityId = null) {
  return Object.freeze(surfaces.filter((surface) => capabilityOf(surface) === capabilityId).map((surface) => surface.id));
}
