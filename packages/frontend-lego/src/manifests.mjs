/**
 * Manifest loading — the only Node-only module of the package.
 *
 * Every other module is browser-safe (no `node:*` import), so the contract can be
 * consumed by a future frontend implementation or by an extension script. Reading
 * the catalogs from disk is a build/boot concern, so it lives alone here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_DIR = join(PACKAGE_ROOT, 'manifest');

export const MANIFEST_FILES = Object.freeze({
  ownership: 'ownership.json',
  surfaces: 'surfaces.json',
  extensionPoints: 'extension-points.json',
  subLegos: 'sub-legos.json',
});

function readManifest(fileName) {
  const path = join(MANIFEST_DIR, fileName);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`frontend LEGO manifest ${fileName} is unreadable: ${error.message}`);
  }
}

/**
 * Loads and freezes the catalogs (ownership, surfaces, hooks, sub-LEGOs).
 *
 * @returns {{ ownership: object, surfaces: object[], surfaceCatalog: object, extensionPoints: object[],
 *             extensionCatalog: object, subLegos: object[], subLegoCatalog: object, owners: object }}
 */
export function loadManifests() {
  const ownership = readManifest(MANIFEST_FILES.ownership);
  const surfaceCatalog = readManifest(MANIFEST_FILES.surfaces);
  const extensionCatalog = readManifest(MANIFEST_FILES.extensionPoints);
  const subLegoCatalog = readManifest(MANIFEST_FILES.subLegos);

  if (!Array.isArray(surfaceCatalog.surfaces) || surfaceCatalog.surfaces.length === 0) {
    throw new Error('manifest/surfaces.json declares no surfaces');
  }
  if (!Array.isArray(extensionCatalog.extensionPoints) || extensionCatalog.extensionPoints.length === 0) {
    throw new Error('manifest/extension-points.json declares no extension points');
  }
  if (!Array.isArray(subLegoCatalog.subLegos) || subLegoCatalog.subLegos.length === 0) {
    throw new Error('manifest/sub-legos.json declares no sub-LEGOs');
  }

  return Object.freeze({
    ownership: Object.freeze(ownership),
    surfaceCatalog: Object.freeze(surfaceCatalog),
    extensionCatalog: Object.freeze(extensionCatalog),
    subLegoCatalog: Object.freeze(subLegoCatalog),
    surfaces: Object.freeze(surfaceCatalog.surfaces.map((surface) => Object.freeze({ ...surface }))),
    extensionPoints: Object.freeze(extensionCatalog.extensionPoints.map((point) => Object.freeze({ ...point }))),
    subLegos: Object.freeze(subLegoCatalog.subLegos.map((entry) => Object.freeze({ ...entry }))),
    owners: Object.freeze({ ...(subLegoCatalog.owners ?? {}) }),
    futureConsumers: Object.freeze(extensionCatalog.futureConsumers ?? []),
  });
}

/** Surface ids, in catalog order. */
export function surfaceIds(manifests = loadManifests()) {
  return manifests.surfaces.map((surface) => surface.id);
}

/** Sub-LEGO ids, in catalog order (parents before children). */
export function subLegoIds(manifests = loadManifests()) {
  return manifests.subLegos.map((entry) => entry.id);
}

/** Extension-point ids, in catalog order. */
export function extensionPointIds(manifests = loadManifests()) {
  return manifests.extensionPoints.map((point) => point.id);
}
