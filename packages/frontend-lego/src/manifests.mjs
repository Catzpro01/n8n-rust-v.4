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
  capabilities: 'capabilities.json',
  skills: 'skills.json',
  contextSession: 'context-session.json',
  memory: 'memory.json',
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
 *             extensionCatalog: object, subLegos: object[], subLegoCatalog: object, owners: object,
 *             capabilities: object[], capabilityCatalog: object }}
 */
export function loadManifests() {
  const ownership = readManifest(MANIFEST_FILES.ownership);
  const surfaceCatalog = readManifest(MANIFEST_FILES.surfaces);
  const extensionCatalog = readManifest(MANIFEST_FILES.extensionPoints);
  const subLegoCatalog = readManifest(MANIFEST_FILES.subLegos);
  const capabilityCatalog = readManifest(MANIFEST_FILES.capabilities);
  const skillCatalog = readManifest(MANIFEST_FILES.skills);
  const contextSessionCatalog = readManifest(MANIFEST_FILES.contextSession);
  const memoryCatalog = readManifest(MANIFEST_FILES.memory);

  if (!Array.isArray(surfaceCatalog.surfaces) || surfaceCatalog.surfaces.length === 0) {
    throw new Error('manifest/surfaces.json declares no surfaces');
  }
  if (!Array.isArray(extensionCatalog.extensionPoints) || extensionCatalog.extensionPoints.length === 0) {
    throw new Error('manifest/extension-points.json declares no extension points');
  }
  if (!Array.isArray(subLegoCatalog.subLegos) || subLegoCatalog.subLegos.length === 0) {
    throw new Error('manifest/sub-legos.json declares no sub-LEGOs');
  }
  // An empty capability catalog is a valid, honest state: it means this frontend
  // offers nothing beyond the stock UI. A missing catalog is not (see below).
  if (!Array.isArray(capabilityCatalog.capabilities)) {
    throw new Error('manifest/capabilities.json must declare a capabilities array (it may be empty)');
  }
  // The Skill catalog ships empty (a discovery surface lists what it is handed), so
  // emptiness is the expected state here — a *missing* array is still refused, because
  // "nothing declared" and "the declaration is broken" must not render the same way.
  if (!Array.isArray(skillCatalog.skills)) {
    throw new Error('manifest/skills.json must declare a skills array (it may be empty)');
  }
  if (typeof skillCatalog.contract !== 'string' || skillCatalog.contract.length === 0) {
    throw new Error('manifest/skills.json must name the contract it consumes (ai.skill)');
  }
  // The Context & Session surface consumes TWO contracts and stays one LEGO: a catalog that
  // cannot name both is broken, and a catalog that names a third has forked the domain.
  if (!Array.isArray(contextSessionCatalog.contracts) || contextSessionCatalog.contracts.length === 0) {
    throw new Error('manifest/context-session.json must declare the contracts it consumes (ai.context, ai.agent-session)');
  }
  if (!contextSessionCatalog.contracts.includes('ai.context') || !contextSessionCatalog.contracts.includes('ai.agent-session')) {
    throw new Error('manifest/context-session.json must consume exactly ai.context and ai.agent-session — Context & Session is one LEGO, not two');
  }
  if (!Array.isArray(contextSessionCatalog.contexts) || !Array.isArray(contextSessionCatalog.sessions)) {
    throw new Error('manifest/context-session.json must declare contexts and sessions arrays (both may be empty)');
  }
  // Memory consumes ONE contract and is its own LEGO: a catalog that cannot name it, or that
  // names a second contract, has either lost the boundary or absorbed a neighbour.
  if (!Array.isArray(memoryCatalog.contracts) || !memoryCatalog.contracts.includes('ai.memory') || memoryCatalog.contracts.length !== 1) {
    throw new Error('manifest/memory.json must consume exactly ai.memory — Memory is one LEGO with one contract, and it does not absorb Context & Session');
  }
  if (!Array.isArray(memoryCatalog.records)) {
    throw new Error('manifest/memory.json must declare a records array (it may be empty)');
  }

  return Object.freeze({
    ownership: Object.freeze(ownership),
    surfaceCatalog: Object.freeze(surfaceCatalog),
    extensionCatalog: Object.freeze(extensionCatalog),
    subLegoCatalog: Object.freeze(subLegoCatalog),
    capabilityCatalog: Object.freeze(capabilityCatalog),
    skillCatalog: Object.freeze(skillCatalog),
    contextSessionCatalog: Object.freeze(contextSessionCatalog),
    memoryCatalog: Object.freeze(memoryCatalog),
    surfaces: Object.freeze(surfaceCatalog.surfaces.map((surface) => Object.freeze({ ...surface }))),
    extensionPoints: Object.freeze(extensionCatalog.extensionPoints.map((point) => Object.freeze({ ...point }))),
    subLegos: Object.freeze(subLegoCatalog.subLegos.map((entry) => Object.freeze({ ...entry }))),
    capabilities: Object.freeze(capabilityCatalog.capabilities.map((entry) => Object.freeze({ ...entry }))),
    skills: Object.freeze(skillCatalog.skills.map((entry) => Object.freeze({ ...entry }))),
    contexts: Object.freeze(contextSessionCatalog.contexts.map((entry) => Object.freeze({ ...entry }))),
    sessions: Object.freeze(contextSessionCatalog.sessions.map((entry) => Object.freeze({ ...entry }))),
    records: Object.freeze(memoryCatalog.records.map((entry) => Object.freeze({ ...entry }))),
    owners: Object.freeze({ ...(subLegoCatalog.owners ?? {}) }),
    futureConsumers: Object.freeze(extensionCatalog.futureConsumers ?? []),
  });
}

/**
 * The Skill surface declaration — what this frontend consumes, and how the UI behaves
 * while the contract is unpublished. Validated by the Skill module, not by the registry:
 * a skill is not a capability and must not be registerable as one.
 */
export function skillSurface(manifests = loadManifests()) {
  return manifests.skillCatalog;
}

/**
 * The Context & Session surface declaration — the two contracts it consumes, the publication state
 * it was verified against, and the rules the UI is held to. Validated by the Context & Session
 * module: a context is not a capability and a session is not a transcript.
 */
export function contextSessionSurface(manifests = loadManifests()) {
  return manifests.contextSessionCatalog;
}

/**
 * The Memory surface declaration — the one contract it consumes, the publication state it was
 * verified against, and the rules the UI is held to. Validated by the Memory module: a memory
 * record is not a context, not a session and not a capability.
 */
export function memorySurface(manifests = loadManifests()) {
  return manifests.memoryCatalog;
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

/** Declared capability ids, in catalog order (declared — not installed, not loaded). */
export function declaredCapabilityIds(manifests = loadManifests()) {
  return manifests.capabilities.map((entry) => entry.id);
}
