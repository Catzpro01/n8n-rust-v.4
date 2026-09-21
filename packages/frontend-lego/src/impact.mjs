/**
 * Impact graph, selective test map and the dry-run plan model.
 *
 * Two questions this module answers, both from declaration data only:
 *
 *   "If this unit changes, what must be tested?"
 *   "What would this change touch, before anything is touched?"
 *
 * The answers come from the registries (hierarchy + dependencies + tests +
 * contracts) and never from reading source files, so they stay correct when the
 * implementation moves and they cost microseconds. A small change gets a small
 * test set; escalation happens when the graph says so (dependents, shared
 * contracts, core trust), not because it was easier to run everything.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */

/**
 * Test tiers, cheapest first. A change runs the lowest tier that can catch it and
 * escalates along `recommendedTests` when the impact graph requires more.
 */
export const TEST_TIERS = Object.freeze(['fast-contract', 'boundary', 'browser', 'integration', 'full']);

/** The suites each tier runs, by path (kept in one place so it cannot drift). */
export const TIER_SUITES = Object.freeze({
  'fast-contract': Object.freeze(['packages/frontend-lego/test/01-contract.test.mjs']),
  boundary: Object.freeze([
    'packages/frontend-lego/test/05-boundary.test.mjs',
    'packages/frontend-lego/test/06-sublegos.test.mjs',
    'apps/n8n-lego/test/frontend.boundary.test.mjs',
  ]),
  browser: Object.freeze(['tests/e2e/frontend-boundary.mjs', 'tests/e2e/settings-compat.mjs']),
  integration: Object.freeze(['apps/n8n-lego/test/*.test.mjs', 'tests/e2e/lego-smoke.mjs']),
  full: Object.freeze(['npm run frontend-lego:test', 'npm run verify:fast', 'python3 tools/sublego-audit/audit.py', 'bash scripts/release.sh --no-docker']),
});

/**
 * Contracts the frontend LEGO owns. Changing one of these is the LEGO's own
 * business; changing anything else in the graph means somebody outside the
 * frontend LEGO has to agree first.
 */
export const OWN_CONTRACTS = Object.freeze([
  'contracts/frontend.contract.md',
  'contracts/frontend-sub-lego.contract.md',
]);

export class ImpactError extends Error {
  constructor(message, { target } = {}) {
    super(message);
    this.name = 'ImpactError';
    this.code = 'frontend.impact.unknown-target';
    this.target = target ?? null;
  }
}

function closureOf(start, next) {
  const seen = new Set();
  const queue = [...start];
  while (queue.length > 0) {
    const id = queue.shift();
    for (const entry of next(id)) {
      if (seen.has(entry.id) || entry.id === id) continue;
      seen.add(entry.id);
      queue.push(entry.id);
    }
  }
  return [...seen].sort();
}

/**
 * Builds the graph over the sub-LEGO hierarchy, the capability registry and the
 * surface catalog. All three are optional so the graph can answer partial
 * questions early in a project's life.
 *
 * @param {object} init
 * @param {object} [init.subLegos]         sub-LEGO registry (hierarchy + dependencies)
 * @param {object} [init.capabilities]     capability registry
 * @param {Array<object>} [init.surfaces]  surface catalog
 * @param {string[]} [init.ownContracts]   contracts owned by this LEGO (default: OWN_CONTRACTS)
 * @param {string[]} [init.foreignContracts] contracts owned by another LEGO, added to the
 *        ones derived from the surfaces' backend contracts (so the graph stays honest
 *        without anybody maintaining a second list)
 * @param {Record<string, string>} [init.contractOwners] names for contracts whose owner
 *        is not a backend capability (e.g. a LEGO that does not exist yet)
 */
export function createImpactGraph({
  subLegos = null,
  capabilities = null,
  surfaces = [],
  ownContracts = OWN_CONTRACTS,
  foreignContracts = [],
  contractOwners = {},
} = {}) {
  const ownerName = (contract) => contractOwners[contract] ?? backendContractOwner.get(contract) ?? 'another LEGO';
  const surfaceById = new Map(surfaces.map((surface) => [surface.id, surface]));
  const owns = new Set(ownContracts);
  const backendContractOwner = new Map();
  for (const surface of surfaces) {
    const contract = surface.backend?.contract;
    if (contract && !backendContractOwner.has(contract)) {
      backendContractOwner.set(contract, surface.backend?.capability ?? null);
    }
  }
  // Every surface backend contract is foreign to the frontend LEGO; callers can
  // add contracts whose owner has not landed yet. Own contracts can never be
  // foreign, however they reached the list.
  const foreign = new Set([
    ...[...backendContractOwner.keys()].filter((contract) => !owns.has(contract)),
    ...foreignContracts,
  ]);
  for (const contract of ownContracts) foreign.delete(contract);

  function unit(id) {
    const found = subLegos?.get(id) ?? null;
    if (!found) throw new ImpactError(`unknown sub-LEGO "${id}"`, { target: id });
    return found;
  }

  /** Direct + transitive dependents (units that would notice a breaking change here). */
  function dependentsClosure(id) {
    if (!subLegos) return [];
    return closureOf([id], (current) => subLegos.dependentsOf(current));
  }

  function unitsOnSurface(surfaceId) {
    if (!subLegos) return [];
    return subLegos.list().filter((entry) => entry.surface === surfaceId).map((entry) => entry.id);
  }

  /** Units a capability renders into (by surface) plus the units that host them. */
  function unitsForCapability(capabilityId) {
    const found = capabilities?.get(capabilityId) ?? null;
    if (!found) throw new ImpactError(`unknown capability "${capabilityId}"`, { target: capabilityId });
    const ids = new Set(found.surfaces.flatMap((surface) => unitsOnSurface(surface)));
    return [...ids].sort();
  }

  /** Resolves any kind of target to the units, surfaces and contracts it touches. */
  function resolve(target, { kind = 'unit' } = {}) {
    if (kind === 'unit') {
      const entry = unit(target);
      const ancestors = subLegos.ancestorsOf(target).map((value) => value.id);
      const descendants = subLegos.descendantsOf(target).map((value) => value.id);
      const dependents = dependentsClosure(target);
      const siblings = subLegos.childrenOf(entry.parentId).filter((value) => value.id !== target).map((value) => value.id);
      const surfaceIds = [...new Set([entry.surface, ...descendants.map((id) => subLegos.get(id).surface)].filter(Boolean))];
      const contracts = [...new Set([entry.contract, ...entry.public.contracts, ...descendants.flatMap((id) => subLegos.get(id).public.contracts)])];
      const tests = [...new Set([...entry.tests, ...descendants.flatMap((id) => subLegos.get(id).tests)])];
      return { kind, target, entry, ancestors, descendants, dependents, siblings, surfaceIds, contracts, tests, foreign: foreignContractsOf({ contracts }) };
    }
    if (kind === 'capability') {
      const found = capabilities?.get(target) ?? null;
      if (!found) throw new ImpactError(`unknown capability "${target}"`, { target });
      const units = unitsForCapability(target);
      const contracts = [...new Set([...found.contracts, ...units.flatMap((id) => subLegos?.get(id)?.public.contracts ?? [])])];
      return {
        kind, target, entry: found, ancestors: [], descendants: [], dependents: [], siblings: [],
        surfaceIds: [...found.surfaces], contracts, tests: [...found.tests], foreign: foreignContractsOf({ contracts }),
      };
    }
    if (kind === 'surface') {
      const surface = surfaceById.get(target);
      if (!surface) throw new ImpactError(`unknown surface "${target}"`, { target });
      const units = unitsOnSurface(target);
      const contracts = [surface.backend?.contract].filter(Boolean);
      return {
        kind, target, entry: surface, ancestors: [], descendants: [], dependents: [],
        siblings: [], surfaceIds: [target], contracts,
        tests: [...new Set(units.flatMap((id) => subLegos?.get(id)?.tests ?? []))],
        foreign: foreignContractsOf({ contracts }),
      };
    }
    throw new ImpactError(`unknown target kind "${kind}" (unit | capability | surface)`, { target });
  }

  /** Which contracts in a resolved target belong to somebody else. */
  function foreignContractsOf(resolved) {
    return resolved.contracts
      .filter((contract) => foreign.has(contract))
      .map((contract) => Object.freeze({ contract, owner: ownerName(contract) }));
  }

  /** Risk is about blast radius, not about how many lines changed. */
  function riskOf(resolved) {
    const trust = resolved.entry?.trust ?? null;
    if (
      resolved.dependents.length > 0
      || resolved.foreign.length > 0
      || trust === 'extension'
      || trust === 'untrusted'
    ) return 'high';
    if (resolved.kind === 'unit' && (resolved.ancestors.length > 0 || resolved.descendants.length > 0)) return 'medium';
    if (resolved.kind === 'capability') return 'medium';
    return 'low';
  }

  /** The smallest valid test set, plus the tiers that must escalate. */
  function recommendedTests(resolved, { risk }) {
    const recommended = {
      'fast-contract': [...TIER_SUITES['fast-contract'], ...resolved.tests],
      boundary: [...TIER_SUITES.boundary],
      browser: resolved.surfaceIds.length > 0 ? [...TIER_SUITES.browser] : [],
      integration: [],
      full: [],
    };
    // The gradient: a private edit runs its own contract tests, a nested one adds
    // the boundary tier, anything with a dependent or a foreign contract adds the
    // integration and full gates.
    if (risk === 'high') recommended.integration = [...TIER_SUITES.integration];
    if (risk === 'high') recommended.full = [...TIER_SUITES.full];
    recommended['fast-contract'] = [...new Set(recommended['fast-contract'])].sort();
    return Object.freeze(recommended);
  }

  /** "If this changes, what must be tested?" */
  function impactOf(target, { kind = 'unit' } = {}) {
    const resolved = resolve(target, { kind });
    const risk = riskOf(resolved);
    return Object.freeze({
      kind: resolved.kind,
      target: resolved.target,
      identity: resolved.entry ? { id: resolved.entry.id ?? resolved.target, version: resolved.entry.version ?? null, owner: resolved.entry.owner ?? null } : null,
      ancestors: Object.freeze(resolved.ancestors),
      descendants: Object.freeze(resolved.descendants),
      dependents: Object.freeze(resolved.dependents),
      siblings: Object.freeze(resolved.siblings),
      surfaces: Object.freeze(resolved.surfaceIds),
      contracts: Object.freeze(resolved.contracts),
      foreignContracts: Object.freeze(resolved.foreign),
      tests: Object.freeze([...new Set(resolved.tests)]),
      risk,
      escalateToFull: risk === 'high',
      recommendedTests: recommendedTests(resolved, { risk }),
    });
  }

  /**
   * The dry-run plan: what a change would touch, before anything is touched.
   * This is data for a human — or for an assistant that must show its plan first.
   */
  function planChange({ target, kind = 'unit', description = null, addUnit = false } = {}) {
    const impact = impactOf(target, { kind });
    const resolved = resolve(target, { kind });
    const owner = resolved.entry?.owner ?? null;
    const files = [];
    if (resolved.kind === 'unit') {
      files.push(...(resolved.entry.internals ?? []));
      files.push(...resolved.tests);
      files.push('packages/frontend-lego/manifest/sub-legos.json');
    } else if (resolved.kind === 'capability') {
      files.push(...resolved.tests);
    } else {
      files.push('packages/frontend-lego/manifest/surfaces.json');
    }
    return Object.freeze({
      lego: 'ui-frontend',
      target: impact.target,
      kind: impact.kind,
      description,
      owner,
      subLego: resolved.kind === 'unit' ? Object.freeze({
        id: resolved.entry.id,
        parentId: resolved.entry.parentId,
        version: resolved.entry.version,
        capability: resolved.entry.capability,
        trust: resolved.entry.trust ?? null,
        criticality: resolved.entry.criticality ?? null,
        lifecycle: resolved.entry.lifecycle ?? null,
        ports: resolved.entry.public.ports,
        dependsOn: resolved.entry.dependsOn.map((dependency) => `${dependency.subLego}#${dependency.port}@${dependency.versionRange}`),
      }) : null,
      files: Object.freeze([...new Set(files)].sort()),
      contractsAffected: impact.contracts,
      foreignContracts: impact.foreignContracts,
      dependencies: impact.dependents,
      surfaces: impact.surfaces,
      testImpact: impact.recommendedTests,
      risk: impact.risk,
      /**
       * Risk is blast radius; arbitration is consent. They usually agree, and
       * where they do not (a brand-new unit nobody depends on) the second one wins.
       */
      arbitrationWith: Object.freeze([
        ...new Set(impact.foreignContracts.map((entry) => entry.owner).filter(Boolean)),
        ...(addUnit ? ['manager'] : []),
      ]),
      requiresArbitration: impact.risk === 'high' || addUnit,
      addUnit,
    });
  }

  return Object.freeze({
    surfaces,
    unitsOnSurface,
    unitsForCapability,
    dependentsClosure,
    impactOf,
    planChange,
    ownContracts,
    foreignContracts: Object.freeze([...foreign].sort()),
    describe: () => Object.freeze({
      units: subLegos ? subLegos.list().length : 0,
      capabilities: capabilities ? capabilities.list().length : 0,
      surfaces: surfaces.length,
      tiers: TEST_TIERS,
    }),
  });
}

/** The selective test map as data (docs, `.ai/` cards, CI decisions). */
export function describeTestMap() {
  return Object.freeze({
    tiers: TEST_TIERS,
    suites: TIER_SUITES,
    rule: 'Run fast-contract first, escalate to boundary/browser when a surface is touched, to integration when a dependent exists, to full when risk is high.',
  });
}
