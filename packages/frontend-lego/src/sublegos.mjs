/**
 * Sub-LEGO registry — the hierarchy below the frontend LEGO.
 *
 * One entry per independently meaningful UI area. "Independently meaningful"
 * means the unit has at least a public port, an owner, a version, a private area
 * and a test boundary. A component, button, icon or helper is *not* a sub-LEGO
 * — it is internal implementation detail of whichever unit owns it.
 *
 * The registry exists to make four things enforceable rather than aspirational:
 *
 *   1. hierarchy    — `settings.localization.rtl` must sit under an existing
 *                     `settings.localization`, whose parent must exist too;
 *   2. visibility   — a dependency may only point at a port the target
 *                     publishes; anything else is a private-internals import and
 *                     is refused by name;
 *   3. ownership    — every unit names an owner from the declared owner table;
 *   4. upgradability— an upgrade is validated against every dependent's declared
 *                     version range, and a breaking change must be acknowledged
 *                     by the units it breaks instead of silently breaking them.
 *
 * Validation runs in two phases: structure first (id/parent/owner/ports/tests/…),
 * then dependency resolution against the fully declared catalog. A unit may
 * therefore be declared before the unit it depends on, while the *set* is still
 * guaranteed to be consistent — a new registration that would leave a dangling or
 * private dependency is rolled back and refused.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */

import { CAPABILITY_STATES, CRITICALITY, TRUST_LEVELS, degradationFor, trustInherited, trustRank } from './lifecycle.mjs';
import { REQUIREMENT_FIELDS } from './profiles.mjs';

export const SUB_LEGO_STATUSES = Object.freeze(['declared', 'available', 'partial', 'unsupported']);

/**
 * Three levels: domain → feature → meaningful sub-feature. Deeper nesting stops
 * being a boundary and starts being a folder tree, so it is refused by name
 * rather than discouraged in a document.
 */
export const MAX_DEPTH = 2;
export const UPGRADE_POLICIES = Object.freeze(['independent', 'acknowledged', 'coupled']);

/** Fields a sub-LEGO descriptor must provide (shape, not content). */
export const SUB_LEGO_SCHEMA = Object.freeze({
  required: Object.freeze(['id', 'title', 'owner', 'version', 'contract', 'public', 'internals', 'tests', 'status', 'upgrade']),
  optional: Object.freeze([
    'parentId', 'surface', 'dependsOn', 'notes',
    // maturity fields (P2.8-F)
    'trust', 'criticality', 'lifecycle', 'requirements', 'degradation',
  ]),
});

/** Version ranges a sub-LEGO may declare. Deliberately small and unambiguous. */
export const RANGE_EXAMPLES = Object.freeze(['1.x', '^1.0.0', '~1.2.0', '>=1.2.0 <2.0.0', '*']);

const SEGMENT_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PORT_PATTERN = /^ui:[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const RANGE_PATTERN = /^(\*|x|\d+\.(x|\*|\d+)(\.(x|\*|\d+))?|[\^~]\d+\.\d+\.\d+|[<>]=?\d+\.\d+\.\d+)(\s+[<>]=?\d+\.\d+\.\d+)?$/;

/** Raised for any declaration the registry refuses. Carries every problem found. */
export class SubLegoError extends Error {
  constructor(message, { id, errors } = {}) {
    super(message);
    this.name = 'SubLegoError';
    this.code = 'frontend.registry.invalid-sub-lego';
    this.subLegoId = id ?? null;
    this.errors = Object.freeze([...(errors ?? [])]);
  }
}

/** Raised when an upgrade is refused (downgrade, coupled release, or unacknowledged dependents). */
export class SubLegoUpgradeError extends Error {
  constructor(message, { id, affected, errors } = {}) {
    super(message);
    this.name = 'SubLegoUpgradeError';
    this.code = 'frontend.registry.upgrade-blocked';
    this.subLegoId = id ?? null;
    /** Units that pin the previous major and must acknowledge before the upgrade. */
    this.affected = Object.freeze([...(affected ?? [])]);
    this.errors = Object.freeze([...(errors ?? [])]);
  }
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** `settings.localization.rtl` -> `settings.localization` (null for a root). */
export function parentIdOf(id) {
  const index = id.lastIndexOf('.');
  return index === -1 ? null : id.slice(0, index);
}

export function depthOf(id) {
  return id.split('.').length - 1;
}

function compare(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

/**
 * Evaluates a declared range against a concrete version.
 *
 * `^1.2.0` and `1.x` mean "same major"; `~1.2.0` and `1.2.x` mean "same minor";
 * `>=`/`<` compare directly. Anything else is not a range this vocabulary allows
 * and is rejected at registration time.
 */
export function satisfies(version, range) {
  if (!SEMVER_PATTERN.test(String(version ?? ''))) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  const spec = String(range ?? '').trim();
  if (spec === '' || spec === '*' || spec === 'x') return true;
  for (const clause of spec.split(/\s+/)) {
    let ok = false;
    if (clause.startsWith('^')) {
      ok = major === Number(clause.slice(1).split('.')[0]);
    } else if (clause.startsWith('~')) {
      const parts = clause.slice(1).split('.');
      ok = major === Number(parts[0]) && minor === Number(parts[1]);
    } else if (clause.startsWith('>=')) ok = compare(version, clause.slice(2)) >= 0;
    else if (clause.startsWith('<=')) ok = compare(version, clause.slice(2)) <= 0;
    else if (clause.startsWith('>')) ok = compare(version, clause.slice(1)) > 0;
    else if (clause.startsWith('<')) ok = compare(version, clause.slice(1)) < 0;
    else {
      const parts = clause.split('.');
      ok = Number(parts[0]) === major;
      if (ok && parts[1] !== undefined && !/^[x*]$/.test(parts[1])) ok = Number(parts[1]) === minor;
      if (ok && parts[2] !== undefined && !/^[x*]$/.test(parts[2])) ok = Number(parts[2]) === patch;
    }
    if (!ok) return false;
  }
  return true;
}

function normalise(entry) {
  return Object.freeze({
    id: entry.id,
    parentId: entry.parentId ?? parentIdOf(entry.id),
    title: entry.title,
    owner: entry.owner,
    version: entry.version,
    surface: entry.surface ?? null,
    capability: entry.capability ?? null,
    contract: entry.contract,
    public: Object.freeze({
      ports: Object.freeze([...(entry.public?.ports ?? [])]),
      contracts: Object.freeze([...(entry.public?.contracts ?? [])]),
    }),
    internals: Object.freeze([...asArray(entry.internals)]),
    dependsOn: Object.freeze((entry.dependsOn ?? []).map((dependency) => Object.freeze({
      subLego: dependency.subLego,
      port: dependency.port,
      versionRange: dependency.versionRange ?? '*',
    }))),
    status: entry.status,
    trust: entry.trust ?? 'feature',
    criticality: entry.criticality ?? 'optional',
    lifecycle: entry.lifecycle ?? 'available',
    requirements: Object.freeze({ ...(entry.requirements ?? {}) }),
    degradation: entry.degradation ? Object.freeze({ ...entry.degradation }) : null,
    tests: Object.freeze([...asArray(entry.tests)]),
    upgrade: Object.freeze({
      policy: entry.upgrade?.policy ?? 'independent',
      compatibleWith: entry.upgrade?.compatibleWith ?? `${String(entry.version).split('.')[0]}.x`,
      coupledWith: Object.freeze([...(entry.upgrade?.coupledWith ?? [])]),
    }),
    acknowledgedUpgrades: Object.freeze([...(entry.acknowledgedUpgrades ?? [])]),
    notes: entry.notes ?? null,
  });
}

/**
 * Validates one sub-LEGO descriptor. Never throws.
 *
 * @param {object} entry
 * @param {object} [catalog]  known ids, owner/surface/hook vocabularies, port table
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateSubLego(entry, catalog = {}) {
  const errors = [];
  const owners = catalog.owners ?? new Set();
  const surfaces = catalog.surfaces ?? new Set();
  const extensionPoints = catalog.extensionPoints ?? new Set();
  const portOwners = catalog.portOwners ?? new Map();
  const resolveDependencies = catalog.resolveDependencies !== false;
  const known = catalog.known ?? new Set();

  if (entry === null || typeof entry !== 'object') return { ok: false, errors: ['sub-LEGO must be an object'] };
  for (const field of SUB_LEGO_SCHEMA.required) {
    if (entry[field] === undefined || entry[field] === null) errors.push(`missing required field "${field}"`);
  }

  const id = entry.id;
  const idIsUsable = typeof id === 'string' && id.length > 0;
  const derivedParent = idIsUsable ? parentIdOf(id) : null;
  if (!idIsUsable) {
    errors.push('"id" must be a dotted identifier (e.g. "settings.localization")');
  } else {
    for (const segment of id.split('.')) {
      if (!SEGMENT_PATTERN.test(segment)) errors.push(`"id" segment "${segment}" must be lowercase kebab-case`);
    }
    // The parent is derived from the id; declaring a different one is a lie the
    // hierarchy would silently accept, so it is an error rather than a fixup.
    if (entry.parentId !== undefined && entry.parentId !== null && entry.parentId !== derivedParent) {
      errors.push(`"parentId" must be the id prefix ("${derivedParent}"), not "${entry.parentId}"`);
    }
    if (derivedParent !== null && (entry.parentId === undefined || entry.parentId === null)) {
      errors.push(`"parentId" must be the id prefix ("${derivedParent}") — a dotted id is not a root unit`);
    }
    if (derivedParent !== null && !known.has(derivedParent)) {
      errors.push(`parent "${derivedParent}" is not a declared sub-LEGO (declare the parent first)`);
    }
  }

  if (typeof entry.owner !== 'string' || entry.owner.length === 0) errors.push('"owner" must name the owning agent');
  else if (owners.size > 0 && !owners.has(entry.owner)) errors.push(`unknown owner "${entry.owner}" (add it to the owner table in manifest/sub-legos.json)`);

  if (typeof entry.version !== 'string' || !SEMVER_PATTERN.test(entry.version)) errors.push('"version" must be semver (e.g. "1.0.0")');

  if (typeof entry.contract !== 'string' || !entry.contract.endsWith('.contract.md')) {
    errors.push(`"contract" must point at a contracts/*.contract.md file (got ${JSON.stringify(entry.contract)})`);
  }

  if (entry.surface !== undefined && entry.surface !== null && surfaces.size > 0 && !surfaces.has(entry.surface)) {
    errors.push(`unknown surface "${entry.surface}" (declare it in manifest/surfaces.json first)`);
  }

  // The backend capability is read from the surface, never restated: a unit that
  // claims a different capability than its surface would be a second source of
  // truth, and the two would drift.
  if (entry.capability !== undefined && entry.capability !== null) {
    const declaredCapabilities = catalog.declaredCapabilities;
    if (declaredCapabilities?.size > 0 && !declaredCapabilities.has(entry.capability)) {
      errors.push(`unknown backend capability "${entry.capability}" (it must be one a declared surface consumes)`);
    }
    if (entry.surface && catalog.surfaceCapabilities?.has(entry.surface)) {
      const surfaceCapability = catalog.surfaceCapabilities.get(entry.surface);
      if (surfaceCapability !== entry.capability) {
        errors.push(`"capability" must match the one its surface declares ("${surfaceCapability ?? 'none'}", not "${entry.capability}")`);
      }
    }
  }

  const ports = asArray(entry.public?.ports);
  if (ports.length === 0) errors.push('"public.ports" must publish at least one port (a unit with no public boundary is private implementation detail)');
  for (const port of ports) {
    if (typeof port !== 'string' || !PORT_PATTERN.test(port)) {
      errors.push(`port "${port}" must look like "ui:<area>:<name>"`);
      continue;
    }
    if (extensionPoints.size > 0 && extensionPoints.has(port)) {
      errors.push(`port "${port}" is also a declared extension point — ports and hooks must not share an id`);
    }
    const owner = portOwners.get(port);
    if (owner && owner !== id) errors.push(`port "${port}" is already published by "${owner}"`);
  }

  const contracts = asArray(entry.public?.contracts);
  if (contracts.length === 0) errors.push('"public.contracts" must name the contract(s) that define this unit\'s boundary');
  for (const contract of contracts) {
    if (typeof contract !== 'string' || !contract.endsWith('.contract.md')) {
      errors.push(`public contract "${contract}" must point at a contracts/*.contract.md file`);
    }
  }

  const internals = asArray(entry.internals);
  if (internals.length === 0) errors.push('"internals" must name the private area of the unit');
  for (const area of internals) {
    if (typeof area !== 'string' || !area.startsWith('src/sub-legos/') || area.includes('..')) {
      errors.push(`internals area "${area}" must be a path under src/sub-legos/** (private code never lives outside the package)`);
    }
  }

  for (const dependency of entry.dependsOn ?? []) {
    if (typeof dependency?.subLego !== 'string' || typeof dependency?.port !== 'string') {
      errors.push('each dependency must name a "subLego" and the "port" it consumes');
      continue;
    }
    if (idIsUsable && dependency.subLego === id) {
      errors.push(`"${id}" cannot depend on itself`);
      continue;
    }
    const range = dependency.versionRange ?? '*';
    if (typeof range !== 'string' || !RANGE_PATTERN.test(range)) {
      errors.push(`dependency on "${dependency.subLego}" must declare a supported version range (one of ${RANGE_EXAMPLES.join(', ')})`);
    }
    if (!resolveDependencies) continue;
    // The only allowed coupling is a published port of the target.
    if (!known.has(dependency.subLego)) {
      errors.push(`dependency "${dependency.subLego}" is not a declared sub-LEGO`);
      continue;
    }
    const owner = portOwners.get(dependency.port);
    if (owner !== dependency.subLego) {
      errors.push(
        owner === undefined
          ? `"${id}" reaches into the private internals of "${dependency.subLego}": "${dependency.port}" is not a published port (only public.ports may be consumed)`
          : `"${id}" depends on "${dependency.subLego}" through "${dependency.port}", which is published by "${owner}"`,
      );
    }
  }

  const tests = asArray(entry.tests);
  if (tests.length === 0) errors.push('"tests" must name at least one regression test (a unit without a test boundary is not independently meaningful)');
  for (const test of tests) {
    if (typeof test !== 'string' || !/(\.test\.mjs|\.mjs|\.ts)$/.test(test)) errors.push(`test reference "${test}" must be a file path`);
  }

  if (!SUB_LEGO_STATUSES.includes(entry.status)) errors.push(`"status" must be one of ${SUB_LEGO_STATUSES.join(', ')}`);

  // Maturity: bounded depth, inherited trust, declared criticality and state.
  if (idIsUsable && depthOf(id) > MAX_DEPTH) {
    errors.push(`"${id}" is ${depthOf(id) + 1} levels deep — the hierarchy is bounded at ${MAX_DEPTH + 1} (domain -> feature -> sub-feature)`);
  }

  const trust = entry.trust ?? (derivedParent === null ? 'feature' : null);
  if (trust !== null && !TRUST_LEVELS.includes(trust)) errors.push(`"trust" must be one of ${TRUST_LEVELS.join(', ')}`);
  // A child may be less trusted than its parent, never more: a feature cannot
  // promote itself to core by nesting under one.
  const parentTrust = catalog.trustOf instanceof Map && derivedParent ? catalog.trustOf.get(derivedParent) ?? null : null;
  if (trust !== null && parentTrust && !trustInherited(parentTrust, trust)) {
    errors.push(`"trust": "${trust}" is more trusted than its parent "${derivedParent}" (${parentTrust}) — a child may not be promoted by nesting`);
  }

  const criticality = entry.criticality ?? 'optional';
  if (!CRITICALITY.includes(criticality)) errors.push(`"criticality" must be one of ${CRITICALITY.join(', ')}`);
  if (criticality === 'core' && entry.degradation?.fallback) {
    errors.push('a "core" unit may not declare a fallback — its absence must stay visible');
  }

  const lifecycleState = entry.lifecycle ?? 'available';
  if (!CAPABILITY_STATES.includes(lifecycleState)) errors.push(`"lifecycle" must be one of ${CAPABILITY_STATES.join(', ')}`);

  if (entry.requirements !== undefined) {
    if (entry.requirements === null || typeof entry.requirements !== 'object' || Array.isArray(entry.requirements)) {
      errors.push('"requirements" must be an object');
    } else {
      for (const key of Object.keys(entry.requirements)) {
        if (!REQUIREMENT_FIELDS.includes(key)) errors.push(`unknown requirement "${key}" (one of ${REQUIREMENT_FIELDS.join(', ')})`);
      }
    }
  }

  const policy = entry.upgrade?.policy;
  if (!UPGRADE_POLICIES.includes(policy)) errors.push(`"upgrade.policy" must be one of ${UPGRADE_POLICIES.join(', ')}`);
  const compatibleWith = entry.upgrade?.compatibleWith;
  if (compatibleWith !== undefined && (typeof compatibleWith !== 'string' || !RANGE_PATTERN.test(compatibleWith))) {
    errors.push(`"upgrade.compatibleWith" must be a supported version range (one of ${RANGE_EXAMPLES.join(', ')})`);
  }
  if (policy === 'coupled' && asArray(entry.upgrade?.coupledWith).length === 0) {
    errors.push('"upgrade.policy: coupled" must list the units it is coupled with in "upgrade.coupledWith"');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Creates the sub-LEGO registry.
 *
 * @param {object} init
 * @param {Array<object>} init.subLegos        entries from manifest/sub-legos.json
 * @param {Record<string, string>} [init.owners] owner table
 * @param {Array<object>} [init.surfaces]      declared UI surfaces
 * @param {Array<object>} [init.extensionPoints] declared hooks (ports and hooks must not collide)
 * @param {string} [init.catalogVersion]
 */
export function createSubLegoRegistry({ subLegos = [], owners = {}, surfaces = [], extensionPoints = [], catalogVersion = null } = {}) {
  if (subLegos.length === 0) throw new SubLegoError('the sub-LEGO catalog is empty — there is no hierarchy to enforce', { errors: ['subLegos must not be empty'] });

  const ownerIds = new Set(Object.keys(owners));
  const surfaceIds = new Set(surfaces.map((surface) => surface.id));
  // `none` is the surfaces catalog's sentinel for "this surface consumes no backend
  // capability"; a sub-LEGO expresses that as null instead of a capability named
  // "none", and the validator keeps the two spellings equivalent.
  const capabilityOf = (surface) => {
    const capability = surface.backend?.capability ?? null;
    return capability === 'none' ? null : capability;
  };
  const surfaceCapabilities = new Map(surfaces.map((surface) => [surface.id, capabilityOf(surface)]));
  const declaredCapabilities = new Set(surfaces.map(capabilityOf).filter(Boolean));
  const hookIds = new Set(extensionPoints.map((point) => point.id));
  const entries = new Map();
  const portOwners = new Map();

  function catalogFor() {
    return {
      owners: ownerIds,
      surfaces: surfaceIds,
      surfaceCapabilities,
      trustOf: new Map([...entries.values()].map((value) => [value.id, value.trust])),
      declaredCapabilities,
      extensionPoints: hookIds,
      known: new Set(entries.keys()),
      portOwners,
    };
  }

  function validate(entry) {
    return validateSubLego(entry, catalogFor());
  }

  /** Phase 1: everything a unit can be judged on alone (no target lookup yet). */
  function assertStructure(entry) {
    const { ok, errors } = validateSubLego(entry, { ...catalogFor(), resolveDependencies: false });
    if (!ok) throw new SubLegoError(`sub-LEGO "${entry?.id ?? '(anonymous)'}" is not registrable: ${errors.join('; ')}`, { id: entry?.id, errors });
  }

  /**
   * Phase 2: the whole set must be consistent — every dependency resolves to a
   * published port, and the dependency graph is acyclic. Runs after every
   * mutation, and rolls the mutation back when it is not.
   */
  function detectCycles(map = entries) {
    const problems = [];
    const state = new Map();
    const walk = (id, trail) => {
      const current = state.get(id);
      if (current === 'done') return;
      if (current === 'visiting') {
        problems.push(`sub-LEGO dependency cycle: ${[...trail, id].join(' -> ')}`);
        return;
      }
      state.set(id, 'visiting');
      for (const dependency of map.get(id).dependsOn) {
        if (map.has(dependency.subLego)) walk(dependency.subLego, [...trail, id]);
      }
      state.set(id, 'done');
    };
    for (const id of map.keys()) walk(id, []);
    return [...new Set(problems)];
  }

  function resolveAll(map = entries) {
    const errors = [];
    for (const entry of map.values()) {
      for (const dependency of entry.dependsOn) {
        const target = map.get(dependency.subLego);
        if (!target) {
          errors.push(`"${entry.id}" depends on "${dependency.subLego}", which is not a declared sub-LEGO`);
          continue;
        }
        if (!target.public.ports.includes(dependency.port)) {
          const owner = portOwners.get(dependency.port);
          errors.push(
            owner === undefined
              ? `"${entry.id}" reaches into the private internals of "${dependency.subLego}": "${dependency.port}" is not a published port (only public.ports may be consumed)`
              : `"${entry.id}" depends on "${dependency.subLego}" through "${dependency.port}", which is published by "${owner}"`,
          );
        }
      }
    }
    errors.push(...detectCycles(map));
    return [...new Set(errors)];
  }

  function add(entry, { resolve = true } = {}) {
    if (typeof entry?.id === 'string' && !entries.has(entry.id) && entry.trust === undefined) {
      // Trust is inherited rather than chosen: a unit nested under a `feature`
      // unit is a feature by default, and may only be lowered explicitly.
      const parent = entries.get(parentIdOf(entry.id));
      if (parent) entry = { ...entry, trust: parent.trust };
    }
    if (typeof entry?.id === 'string' && entries.has(entry.id)) {
      // Checked before anything else: it is the clearest diagnosis, and every
      // later check would also reject the second declaration for a side reason.
      throw new SubLegoError(`sub-LEGO "${entry.id}" is already registered`, { id: entry.id, errors: ['duplicate id'] });
    }
    assertStructure(entry);
    const normalised = normalise(entry);
    const claimed = normalised.public.ports;
    for (const port of claimed) portOwners.set(port, normalised.id);
    entries.set(normalised.id, normalised);
    if (!resolve) return normalised;
    const errors = resolveAll();
    if (errors.length > 0) {
      entries.delete(normalised.id);
      for (const port of claimed) {
        if (portOwners.get(port) === normalised.id) portOwners.delete(port);
      }
      throw new SubLegoError(`sub-LEGO "${normalised.id}" is not registrable: ${errors.join('; ')}`, { id: normalised.id, errors });
    }
    return normalised;
  }

  // The catalog is declared as a set: phase 1 registers every unit structurally
  // (parents must still be declared before their children — an orphan is a typo,
  // not a declaration-order question), phase 2 resolves every dependency against
  // the finished set, so a unit may reference a sibling declared later.
  for (const entry of subLegos) add(entry, { resolve: false });
  const unresolved = resolveAll();
  if (unresolved.length > 0) {
    throw new SubLegoError(`the sub-LEGO catalog is inconsistent: ${unresolved.join('; ')}`, { errors: unresolved });
  }

  const childrenOf = (id) => [...entries.values()].filter((entry) => entry.parentId === id).sort((a, b) => a.id.localeCompare(b.id));
  const roots = () => childrenOf(null);

  function descendantsOf(id) {
    const collected = [];
    const walk = (current) => {
      for (const child of childrenOf(current)) {
        collected.push(child);
        walk(child.id);
      }
    };
    walk(id);
    return collected;
  }

  function ancestorsOf(id) {
    const chain = [];
    let cursor = entries.get(id)?.parentId ?? null;
    while (cursor !== null) {
      const parent = entries.get(cursor);
      if (!parent) break;
      chain.push(parent);
      cursor = parent.parentId;
    }
    return chain;
  }

  /** Units that declare a dependency on `id` (direct dependents only). */
  function dependentsOf(id) {
    return [...entries.values()]
      .filter((entry) => entry.dependsOn.some((dependency) => dependency.subLego === id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function dependentsOn(id, port) {
    return dependentsOf(id).filter((entry) => entry.dependsOn.some((dependency) => dependency.subLego === id && dependency.port === port));
  }

  /** Resolves a public port of a unit — the only way another unit may couple to it. */
  function resolvePort(id, port) {
    const entry = entries.get(id);
    if (!entry || !entry.public.ports.includes(port)) {
      throw new SubLegoError(`"${id}" does not publish "${port}" — it is private to the unit`, { id, errors: ['unpublished port'] });
    }
    return Object.freeze({ subLego: id, port, version: entry.version, contract: entry.public.contracts[0] ?? entry.contract });
  }

  /**
   * Evaluates an upgrade before applying it.
   *
   * @returns {{ ok, kind, breaking, affected, affectedDetail, unchanged, errors }}
   */
  function validateUpgrade(id, nextVersion) {
    const entry = entries.get(id);
    if (!entry) return { ok: false, kind: 'same', breaking: false, affected: [], affectedDetail: [], unchanged: [], errors: [`"${id}" is not a registered sub-LEGO`] };
    if (!SEMVER_PATTERN.test(String(nextVersion ?? ''))) {
      return { ok: false, kind: 'same', breaking: false, affected: [], affectedDetail: [], unchanged: [], errors: [`"${nextVersion}" is not a semver version`] };
    }
    const [currentMajor, currentMinor] = entry.version.split('.').map(Number);
    const [nextMajor, nextMinor] = nextVersion.split('.').map(Number);
    const kind = nextMajor > currentMajor ? 'major'
      : nextMajor < currentMajor ? 'downgrade'
        : nextMinor > currentMinor ? 'minor'
          : nextMinor < currentMinor ? 'downgrade'
            : nextVersion === entry.version ? 'same' : 'patch';
    const breaking = kind === 'major' || kind === 'downgrade';

    const affectedDetail = [];
    for (const dependent of dependentsOf(id)) {
      for (const dependency of dependent.dependsOn.filter((value) => value.subLego === id)) {
        if (!satisfies(nextVersion, dependency.versionRange)) {
          affectedDetail.push(Object.freeze({ dependent: dependent.id, range: dependency.versionRange, port: dependency.port }));
        }
      }
    }

    const errors = [];
    if (kind === 'downgrade') errors.push(`"${nextVersion}" is a downgrade from "${entry.version}"`);
    if (entry.upgrade.policy === 'coupled') {
      errors.push(`"${id}" is declared coupled: upgrading requires a coordinated release with ${entry.upgrade.coupledWith.join(', ') || '(unlisted units)'}`);
    }

    const affected = affectedDetail.map((value) => value.dependent);
    return {
      ok: errors.length === 0,
      kind,
      breaking,
      affected,
      affectedDetail,
      unchanged: [...entries.keys()].filter((other) => other !== id && !affected.includes(other)).sort(),
      errors,
    };
  }

  /**
   * Applies a manifest patch as a new version of one unit.
   *
   * The real mechanism, not a test double: a sub-LEGO upgrades by shipping a new
   * manifest entry. Siblings stay untouched unless a breaking change forces a
   * dependent to acknowledge — and that acknowledgment, recorded on the
   * dependent itself, is the only thing allowed to change another unit.
   *
   * @returns {{ changed: string[], unchanged: string[], acknowledged: string[], kind: string }}
   */
  function upgrade(id, patch = {}, { acknowledge = [] } = {}) {
    const entry = entries.get(id);
    if (!entry) throw new SubLegoError(`"${id}" is not a registered sub-LEGO`, { id, errors: ['unknown unit'] });

    const next = { ...entry, ...patch, id, parentId: entry.parentId };
    if (patch.public) next.public = { ...entry.public, ...patch.public };
    if (patch.upgrade) next.upgrade = { ...entry.upgrade, ...patch.upgrade };

    const evaluation = validateUpgrade(id, next.version);
    if (evaluation.errors.length > 0) {
      throw new SubLegoUpgradeError(`sub-LEGO "${id}" upgrade is blocked: ${evaluation.errors.join('; ')}`, { id, affected: evaluation.affected, errors: evaluation.errors });
    }
    const unacknowledged = evaluation.affected.filter((dependent) => !acknowledge.includes(dependent));
    if (unacknowledged.length > 0) {
      const detail = evaluation.affectedDetail
        .filter((value) => unacknowledged.includes(value.dependent))
        .map((value) => `${value.dependent} pins ${value.port} at "${value.range}"`)
        .join('; ');
      throw new SubLegoUpgradeError(
        `sub-LEGO "${id}" cannot move to ${next.version} while dependents pin the previous major — acknowledge them or ship a compatible version (${detail})`,
        { id, affected: unacknowledged, errors: [detail] },
      );
    }

    // An upgrade is atomic: every change is built and validated off to the side,
    // then committed in one step. There is no moment where the hierarchy is half
    // upgraded, and a refused upgrade leaves the catalog exactly as it was.
    const candidate = new Map(entries);
    const candidatePorts = new Map(portOwners);
    const changed = [id];

    const normalised = normalise(next);
    candidate.set(id, normalised);
    for (const port of entry.public.ports) {
      if (candidatePorts.get(port) === id) candidatePorts.delete(port);
    }
    for (const port of normalised.public.ports) candidatePorts.set(port, id);

    for (const dependentId of acknowledge) {
      if (!evaluation.affected.includes(dependentId)) continue;
      const dependent = candidate.get(dependentId);
      const adopted = dependent.dependsOn.map((dependency) => (
        dependency.subLego === id && !satisfies(normalised.version, dependency.versionRange)
          ? { ...dependency, versionRange: `^${normalised.version}` }
          : dependency
      ));
      candidate.set(dependentId, Object.freeze({
        ...dependent,
        dependsOn: Object.freeze(adopted.map((dependency) => Object.freeze({ ...dependency }))),
        // The acknowledgment is recorded on the unit that carries the risk.
        acknowledgedUpgrades: Object.freeze([
          ...dependent.acknowledgedUpgrades,
          Object.freeze({ subLego: id, to: normalised.version }),
        ]),
      }));
      changed.push(dependentId);
    }

    const problems = [];
    for (const changedId of changed) {
      const { ok, errors } = validateSubLego(candidate.get(changedId), {
        owners: ownerIds,
        surfaces: surfaceIds,
        surfaceCapabilities,
        declaredCapabilities,
        extensionPoints: hookIds,
        known: new Set(candidate.keys()),
        portOwners: candidatePorts,
        trustOf: new Map([...candidate.values()].map((value) => [value.id, value.trust])),
        resolveDependencies: false,
      });
      if (!ok) problems.push(...errors.map((error) => `${changedId}: ${error}`));
    }
    for (const [candidateId, value] of candidate) {
      for (const dependency of value.dependsOn) {
        const target = candidate.get(dependency.subLego);
        if (!target) {
          problems.push(`${candidateId}: depends on undeclared "${dependency.subLego}"`);
          continue;
        }
        if (candidatePorts.get(dependency.port) !== dependency.subLego) {
          problems.push(`${candidateId}: "${dependency.port}" is not published by "${dependency.subLego}" in the upgraded catalog`);
        }
      }
    }
    problems.push(...detectCycles(candidate));
    if (problems.length > 0) {
      throw new SubLegoError(
        `sub-LEGO "${id}" upgrade would leave the catalog inconsistent — nothing was applied (${[...new Set(problems)].join('; ')})`,
        { id, errors: [...new Set(problems)] },
      );
    }

    // Commit: swap the validated state in, in one step.
    entries.clear();
    for (const [key, value] of candidate) entries.set(key, value);
    portOwners.clear();
    for (const [key, value] of candidatePorts) portOwners.set(key, value);

    const unchanged = [...entries.keys()].filter((other) => !changed.includes(other)).sort();
    return Object.freeze({
      kind: evaluation.kind,
      changed: Object.freeze(changed),
      unchanged: Object.freeze(unchanged),
      acknowledged: Object.freeze([...acknowledge].filter((value) => evaluation.affected.includes(value))),
    });
  }

  /** Full descriptor (tooling, tests, documentation generators). */
  function descriptor() {
    return Object.freeze({
      catalogVersion,
      subLegos: Object.freeze([...entries.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((entry) => Object.freeze({
          ...entry,
          // Derived, never declared twice: the backend capability behind the unit's
          // surface. `null` means the surface is frontend-only (e.g. dialogs).
          capability: entry.surface ? surfaceCapabilities.get(entry.surface) ?? null : null,
        }))),
      owners: Object.freeze({ ...owners }),
      ports: Object.freeze([...portOwners.entries()].map(([port, owner]) => Object.freeze({ port, owner }))),
    });
  }

  /**
   * The projection published in the boot descriptor: identity, hierarchy, version
   * and the published port names. Private areas never leave the process.
   */
  function toBootView() {
    return Object.freeze([...entries.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      // Lean on purpose: identity, hierarchy and published ports. Trust, criticality
      // and lifecycle are policy the runtime enforces, and the backend capability is
      // a join from `surface` — none of them belong in what the browser receives.
      .map((entry) => Object.freeze({
        id: entry.id,
        parentId: entry.parentId,
        version: entry.version,
        status: entry.status,
        owner: entry.owner,
        surface: entry.surface,
        ports: entry.public.ports,
      })));
  }

  return {
    catalogVersion,
    owners: Object.freeze({ ...owners }),
    register: add,
    registerAll(values) {
      return values.map(add);
    },
    has: (id) => entries.has(id),
    get: (id) => entries.get(id) ?? null,
    list: ({ depth, owner, status } = {}) => [...entries.values()]
      .filter((entry) => (depth === undefined || depthOf(entry.id) === depth))
      .filter((entry) => (owner === undefined || entry.owner === owner))
      .filter((entry) => (status === undefined || entry.status === status))
      .sort((a, b) => a.id.localeCompare(b.id)),
    roots,
    childrenOf,
    descendantsOf,
    ancestorsOf,
    depthOf,
    dependentsOf,
    dependentsOn,
    resolvePort,
    availability: () => Object.freeze([...entries.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((entry) => Object.freeze({
        id: entry.id,
        status: entry.status,
        lifecycle: entry.lifecycle,
        trust: entry.trust,
        criticality: entry.criticality,
        degradation: degradationFor(entry),
      }))),
    trustOf: (id) => entries.get(id)?.trust ?? null,
    criticalityOf: (id) => entries.get(id)?.criticality ?? null,
    degradationOf: (id) => {
      const entry = entries.get(id);
      return entry ? degradationFor(entry) : null;
    },
    publicPortsOf: (id) => {
      const entry = entries.get(id);
      if (!entry) throw new SubLegoError(`"${id}" is not a registered sub-LEGO`, { id, errors: ['unknown unit'] });
      return entry.public.ports;
    },
    validate,
    validateUpgrade,
    upgrade,
    descriptor,
    toBootView,
  };
}
