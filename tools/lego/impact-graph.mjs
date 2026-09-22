#!/usr/bin/env node
/**
 * Impact graph and selective test selection (P2.8-B, §46–48).
 *
 *   node tools/lego/impact-graph.mjs                      # whole graph
 *   node tools/lego/impact-graph.mjs --target workflow    # what depends on workflow?
 *   node tools/lego/impact-graph.mjs --changed src/auth/routes.mjs
 *   node tools/lego/impact-graph.mjs --plan --target auth --change "add scope check"
 *   node tools/lego/impact-graph.mjs --json
 *
 * Answers the only two questions that matter before a change:
 *   "what depends on this?"  and  "so what do I have to run?"
 *
 * The graph is derived from the manifest the architecture gate already
 * enforces, so it cannot drift from reality — there is no second registry.
 *
 * Owner: manager. Pure Node, no dependencies.
 */
import { relative, resolve } from 'node:path';

import { loadRegistry, domainForPath, getDescendants, getAncestors } from '../../apps/n8n-lego/src/lego/registry.mjs';

/** Test tiers, cheapest first. A change selects the narrowest tier that still proves it. */
export const TEST_TIERS = Object.freeze({
  fast: { cost: 1, command: 'node --test test/lego-foundation.test.mjs', proves: 'the foundation vocabulary and registry still parse' },
  contract: { cost: 2, command: 'node --test test/lego-lifecycle.test.mjs test/lego-foundation.test.mjs', proves: 'contract versions, compatibility and upgrade rules hold' },
  boundary: { cost: 3, command: 'npm run lego:arch && npm run lego:arch:selftest && npm run lego:foundation', proves: 'no LEGO reached across a boundary' },
  integration: { cost: 4, command: 'cd apps/n8n-lego && node --test test/*.test.mjs', proves: 'the domains still work together in-process' },
  e2e: { cost: 5, command: 'node tests/e2e/lego-smoke.mjs && node tests/e2e/settings-compat.mjs', proves: 'the real editor UI still talks to the backend (CI, needs Chromium)' },
  full: { cost: 6, command: 'npm run lego:gate', proves: 'everything' },
});

/**
 * Build the dependency graph: for each domain, who it depends on and — the
 * expensive question to answer by hand — who depends on it.
 */
export function buildGraph(registry = loadRegistry({ reload: true })) {
  const nodes = new Map();
  for (const domain of registry.domains) {
    nodes.set(domain.id, {
      id: domain.id,
      owner: domain.owner,
      tier: domain.tier ?? null,
      contract: domain.contract?.id ?? null,
      contractVersion: domain.contract?.version ?? null,
      parent: domain.parent ?? null,
      dependsOn: [...(domain.dependsOn ?? [])],
      dependedOnBy: [],
      children: [],
      paths: [...(domain.paths ?? [])],
      tests: [...(domain.contract?.tests ?? [])],
    });
  }
  for (const domain of registry.domains) {
    for (const dependency of domain.dependsOn ?? []) {
      nodes.get(dependency)?.dependedOnBy.push(domain.id);
    }
    if (domain.parent) nodes.get(domain.parent)?.children.push(domain.id);
  }
  return nodes;
}

/**
 * Transitive impact of touching `id`: every LEGO that could observe the change.
 * Includes dependents (they call it), ancestors (they compose it) and
 * descendants (they live inside it).
 */
export function impactOf(id, registry = loadRegistry({ reload: true })) {
  const graph = buildGraph(registry);
  if (!graph.has(id)) throw new Error(`unknown LEGO '${id}'`);

  const direct = [...graph.get(id).dependedOnBy];
  const transitive = new Set();
  const queue = [...direct];
  while (queue.length > 0) {
    const current = queue.shift();
    if (transitive.has(current)) continue;
    transitive.add(current);
    queue.push(...(graph.get(current)?.dependedOnBy ?? []));
  }

  const descendants = getDescendants(id, registry).map((d) => d.id);
  const ancestors = getAncestors(id, registry).map((d) => d.id);

  return {
    target: id,
    contract: graph.get(id).contract,
    directDependents: direct,
    transitiveDependents: [...transitive].filter((d) => !direct.includes(d)),
    dependsOn: graph.get(id).dependsOn,
    descendants,
    ancestors,
    blastRadius: new Set([...direct, ...transitive, ...descendants, ...ancestors]).size,
  };
}

/** Which LEGOs does this set of changed files belong to? */
export function domainsForChangedFiles(files, registry = loadRegistry({ reload: true })) {
  const hits = new Map();
  const unowned = [];
  for (const file of files) {
    const normalized = file.replace(/^apps\/n8n-lego\//, '');
    const domain = domainForPath(normalized, registry);
    if (domain) {
      if (!hits.has(domain.id)) hits.set(domain.id, []);
      hits.get(domain.id).push(file);
    } else unowned.push(file);
  }
  return { domains: [...hits.entries()].map(([id, changed]) => ({ id, files: changed })), unowned };
}

/**
 * Select the cheapest sufficient test tier.
 * The rules are deliberately conservative: when in doubt, escalate. A gate that
 * under-tests to look fast is worse than no gate.
 */
export function selectTests(changed, registry = loadRegistry({ reload: true })) {
  const { domains, unowned } = domainsForChangedFiles(changed, registry);
  const reasons = [];
  let tier = 'fast';
  const escalate = (to, why) => {
    if (TEST_TIERS[to].cost > TEST_TIERS[tier].cost) tier = to;
    reasons.push(`${why} -> ${to}`);
  };

  if (unowned.length > 0) escalate('full', `${unowned.length} changed file(s) belong to no LEGO`);

  for (const { id, files } of domains) {
    const domain = registry.domains.find((candidate) => candidate.id === id);
    const impact = impactOf(id, registry);

    if (files.some((file) => file.includes('/manifest/') || file.endsWith('domains.json') || file.endsWith('contract-lock.json'))) {
      escalate('boundary', `'${id}' manifest or contract lock changed`);
    }
    if (files.some((file) => (domain.public ?? []).some((surface) => file.includes(surface)))) {
      escalate('contract', `'${id}' public contract surface touched`);
    }
    if (impact.directDependents.length > 0) {
      escalate('integration', `'${id}' has ${impact.directDependents.length} direct dependent(s)`);
    }
    if (impact.blastRadius >= 5) {
      escalate('full', `'${id}' blast radius is ${impact.blastRadius}`);
    }
    if (['compatibility', 'editor-ui-host', 'settings', 'legacy-rest'].includes(id)) {
      escalate('e2e', `'${id}' is on the editor-UI compatibility path`);
    }
    if (files.some((file) => file.includes('/lego/'))) {
      escalate('boundary', `'${id}' touches the LEGO foundation itself`);
    }
  }

  return { tier, ...TEST_TIERS[tier], reasons, domains: domains.map((d) => d.id), unowned };
}

/**
 * Dry-run / plan mode (§48): say what a change would do before doing it.
 * No apply step here on purpose — planning is the product; applying is the
 * developer's job, reviewed by the gates.
 */
export function plan({ target, change = '(unspecified)', registry = loadRegistry({ reload: true }) }) {
  const domain = registry.domains.find((candidate) => candidate.id === target);
  if (!domain) throw new Error(`unknown LEGO '${target}'`);
  const impact = impactOf(target, registry);
  const tests = selectTests(domain.paths ?? [], registry);

  return {
    target,
    intendedChange: change,
    owner: domain.owner,
    contractsAffected: [domain.contract?.id, ...impact.directDependents.map((id) => registry.domains.find((c) => c.id === id)?.contract?.id)].filter(Boolean),
    dependenciesAffected: impact.directDependents,
    transitivelyAffected: impact.transitiveDependents,
    testsRequired: { tier: tests.tier, command: tests.command, because: tests.reasons },
    resourceImpact: domain.resources ?? 'undeclared',
    securityImpact: {
      trust: domain.trust ?? 'undeclared',
      capabilities: domain.capabilities_granted ?? [],
      failureBoundary: domain.failureBoundary ?? 'undeclared',
    },
    risk: impact.blastRadius === 0 ? 'low' : impact.blastRadius < 3 ? 'medium' : 'high',
    rollback: `revert the change; re-run ${tests.command}`,
    apply: 'not performed — plan mode is advisory. Make the change, then run the tests above and `npm run lego:gate`.',
  };
}

/* ------------------------------------------------------------------- CLI */

const isCli = process.argv[1]?.endsWith('impact-graph.mjs');
if (isCli) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? null : argv[index + 1];
  };
  const asJson = argv.includes('--json');
  const registry = loadRegistry({ reload: true });

  const target = flag('--target');
  const changedArg = flag('--changed');
  let output;

  if (argv.includes('--plan')) {
    if (!target) throw new Error('--plan requires --target <lego-id>');
    output = plan({ target, change: flag('--change') ?? '(unspecified)', registry });
  } else if (changedArg) {
    const files = changedArg.split(',').map((file) => relative(process.cwd(), resolve(file)) || file);
    output = selectTests(files, registry);
  } else if (target) {
    output = impactOf(target, registry);
  } else {
    output = [...buildGraph(registry).values()].map((node) => ({
      id: node.id,
      dependsOn: node.dependsOn,
      dependedOnBy: node.dependedOnBy,
    }));
  }

  if (asJson) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
