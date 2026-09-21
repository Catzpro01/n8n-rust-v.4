#!/usr/bin/env node
/**
 * Foundation 1.0 gate (P2.8-B).
 *
 *   node tools/lego/foundation-gate.mjs           # human report
 *   node tools/lego/foundation-gate.mjs --json    # machine report
 *
 * P2.6 checked the import graph. P2.7 checked versions and hierarchy. P2.8-B
 * checks that every LEGO describes itself in the Foundation 1.0 vocabulary, and
 * that the declarations are internally coherent:
 *
 *   F1 vocabulary        a declared value outside the legal set
 *   F2 missing-profile   a domain with no tier/trust/resources/communication
 *   F3 data-ownership    data owned by nobody, or by two domains
 *   F4 capability-grant  a capability granted beyond its trust level
 *   F5 state-class       an unclassified or illegal state class
 *   F6 failure-boundary  an untrusted/dangerous LEGO left in-process
 *   F7 node-contract     a creation route missing required metadata
 *   F8 secret-in-contract a literal secret in a public contract surface
 *   F9 endpoint-undeclared a hardcoded external URL with no network capability
 *
 * F8/F9 are the lightweight security gate §55 asks for: cheap textual checks at
 * the contract boundary, not a static analyser.
 *
 * Owner: manager. Pure Node, no dependencies.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry, getDomain, getAncestors } from '../../apps/n8n-lego/src/lego/registry.mjs';
import {
  ACTIVATION_STATES,
  CAPABILITIES,
  COMMUNICATION_MODES,
  FAILURE_BOUNDARIES,
  FOUNDATION,
  NODE_CONTRACT,
  PORTABILITY_PROFILES,
  RUNTIMES,
  STATE_CLASSES,
  TRUST_LEVELS,
  defaultCapabilitiesFor,
} from '../../apps/n8n-lego/src/lego/foundation.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_ROOT = join(REPO_ROOT, 'apps', 'n8n-lego');

/** Domains exempt from needing a full profile: pure governance/templates carry one anyway. */
const PROFILE_REQUIRED_KINDS = new Set(['domain', 'kernel', 'boundary', 'legacy', 'composition-root', 'governance', 'template']);

export function runFoundationGate(registry = loadRegistry({ reload: true })) {
  const violations = [];
  const push = (rule, where, message, fix) => violations.push({ rule, where, message, fix });

  const dataOwners = new Map();

  for (const domain of registry.domains) {
    const where = `domain '${domain.id}'`;

    // F2 — every LEGO must describe itself in the foundation vocabulary.
    if (PROFILE_REQUIRED_KINDS.has(domain.kind)) {
      for (const field of ['tier', 'trust', 'stateOwner', 'communication', 'resources', 'failureBoundary']) {
        if (domain[field] === undefined) {
          push('F2 missing-profile', where, `missing Foundation 1.0 field '${field}'`,
            'Declare it in src/lego/manifest/domains.json — see manifest/foundation.json for the legal values.');
        }
      }
    }

    // F1 — vocabulary conformance.
    if (domain.tier !== undefined && !FOUNDATION.legoModel.tiers.includes(domain.tier)) {
      push('F1 vocabulary', where, `tier '${domain.tier}' is not one of ${FOUNDATION.legoModel.tiers.join(', ')}`, 'Use a declared tier.');
    }
    if (domain.trust !== undefined && !TRUST_LEVELS.includes(domain.trust)) {
      push('F1 vocabulary', where, `trust '${domain.trust}' is not one of ${TRUST_LEVELS.join(', ')}`, 'Use a declared trust level.');
    }
    if (domain.failureBoundary !== undefined && !FAILURE_BOUNDARIES.includes(domain.failureBoundary)) {
      push('F1 vocabulary', where, `failureBoundary '${domain.failureBoundary}' is not one of ${FAILURE_BOUNDARIES.join(', ')}`, 'Use a declared failure boundary.');
    }
    for (const mode of domain.communication ?? []) {
      if (!COMMUNICATION_MODES.includes(mode)) {
        push('F1 vocabulary', where, `communication mode '${mode}' is not one of ${COMMUNICATION_MODES.join(', ')}`, 'Use call, event, stream or batch.');
      }
    }
    for (const capability of domain.capabilities_granted ?? []) {
      if (!CAPABILITIES.includes(capability)) {
        push('F1 vocabulary', where, `capability '${capability}' is not one of ${CAPABILITIES.join(', ')}`, 'Use a declared capability.');
      }
    }
    if (domain.resources) {
      for (const [dimension, legal] of Object.entries(FOUNDATION.resources.classes)) {
        const value = domain.resources[dimension];
        if (value !== undefined && !legal.includes(value)) {
          push('F1 vocabulary', where, `resources.${dimension} '${value}' is not one of ${legal.join(', ')}`, 'Use a declared resource class.');
        }
      }
    }

    // F5 — state classification.
    if (domain.stateOwner !== undefined && domain.stateOwner !== 'none' && !STATE_CLASSES.includes(domain.stateOwner)) {
      push('F5 state-class', where, `stateOwner '${domain.stateOwner}' is not a declared state class (${STATE_CLASSES.join(', ')})`,
        'Classify the state as persistent, runtime, cache, configuration or derived — hidden global state is forbidden.');
    }

    // F3 — data ownership is single-writer, like code ownership.
    if (domain.dataOwner !== undefined && domain.dataOwner !== 'none') {
      if (dataOwners.has(domain.dataOwner)) {
        push('F3 data-ownership', where,
          `data '${domain.dataOwner}' is claimed by both '${dataOwners.get(domain.dataOwner)}' and '${domain.id}'`,
          'Exactly one domain owns a given dataset; others consume it through its contract.');
      } else dataOwners.set(domain.dataOwner, domain.id);
    }
    // A domain holding persistent state must own data or depend on storage.
    if (domain.stateOwner === 'persistent') {
      const ownsData = domain.dataOwner && domain.dataOwner !== 'none';
      const usesStorage = (domain.dependsOn ?? []).includes('storage') || domain.id === 'storage';
      if (!ownsData && !usesStorage) {
        push('F3 data-ownership', where, 'holds persistent state but neither owns data nor depends on the storage contract',
          'Declare a dataOwner, or depend on storage — persistence without an owner is how data gets orphaned.');
      }
    }

    // F4 — trust never implicitly grants a capability.
    for (const capability of domain.capabilities_granted ?? []) {
      const defaults = defaultCapabilitiesFor(domain.trust);
      if (!defaults.includes(capability) && !(domain.capabilityJustification ?? {})[capability]) {
        push('F4 capability-grant', where,
          `capability '${capability}' is outside the default grant for trust '${domain.trust}' and carries no justification`,
          `Add capabilityJustification['${capability}'] explaining why, or lower the requirement.`);
      }
    }

    // F6 — an untrusted or community LEGO may not sit in-process.
    if ((domain.trust === 'community' || domain.trust === 'untrusted') && domain.failureBoundary === 'in-process-safe') {
      push('F6 failure-boundary', where,
        `trust '${domain.trust}' with failureBoundary 'in-process-safe' — untrusted code must not be able to take down the core`,
        'Use `sandboxed` or `worker-isolated`.');
    }

    // A sub-LEGO must not claim a wider trust level than its parent.
    for (const ancestor of getAncestors(domain.id, registry)) {
      const rank = (id) => FOUNDATION.trust.levels[id]?.rank ?? 99;
      if (domain.trust && ancestor.trust && rank(domain.trust) < rank(ancestor.trust)) {
        push('F4 capability-grant', where,
          `claims trust '${domain.trust}', which is higher than its ancestor '${ancestor.id}' ('${ancestor.trust}')`,
          'A sub-LEGO cannot be more trusted than the LEGO that contains it.');
      }
    }
  }

  violations.push(...checkNodeContract());
  violations.push(...checkContractSecurity(registry));
  return violations;
}

/** F7 — every declared creation route must carry the metadata the AI decision needs. */
function checkNodeContract() {
  const problems = [];
  const required = ['id', 'name', 'use', 'implementation', 'runtimes', 'resources', 'portability', 'trust', 'security', 'migration', 'status'];
  const seen = new Set();
  for (const route of NODE_CONTRACT.creationRoutes.routes) {
    const where = `creation route '${route.id ?? '(unnamed)'}'`;
    for (const field of required) {
      if (route[field] === undefined) {
        problems.push({ rule: 'F7 node-contract', where, message: `missing '${field}'`, fix: 'A route without this cannot be chosen by the decision model.' });
      }
    }
    if (seen.has(route.id)) {
      problems.push({ rule: 'F7 node-contract', where, message: 'duplicate route id', fix: 'Route ids are unique.' });
    }
    seen.add(route.id);
    for (const runtime of route.runtimes ?? []) {
      if (!RUNTIMES.includes(runtime)) {
        problems.push({ rule: 'F7 node-contract', where, message: `runtime '${runtime}' is not declared in the foundation`, fix: `Use one of ${RUNTIMES.join(', ')}.` });
      }
    }
    if (route.portability && !PORTABILITY_PROFILES.includes(route.portability)) {
      problems.push({ rule: 'F7 node-contract', where, message: `portability '${route.portability}' is not a declared profile`, fix: `Use one of ${PORTABILITY_PROFILES.join(', ')}.` });
    }
    if (route.trust && !TRUST_LEVELS.includes(route.trust)) {
      problems.push({ rule: 'F7 node-contract', where, message: `trust '${route.trust}' is not a declared level`, fix: `Use one of ${TRUST_LEVELS.join(', ')}.` });
    }
  }
  if (NODE_CONTRACT.creationRoutes.routes.length !== 12) {
    problems.push({
      rule: 'F7 node-contract',
      where: 'node-contract.json',
      message: `${NODE_CONTRACT.creationRoutes.routes.length} creation routes declared, expected the 12 the architecture defines`,
      fix: 'Adding or removing a route is an architecture decision — record an ADR.',
    });
  }
  // The activation state machine must be total and legal.
  for (const [from, tos] of Object.entries(FOUNDATION.activation.transitions)) {
    if (!ACTIVATION_STATES.includes(from)) {
      problems.push({ rule: 'F1 vocabulary', where: 'foundation.activation', message: `unknown state '${from}'`, fix: 'Fix the transition table.' });
    }
    for (const to of tos) {
      if (!ACTIVATION_STATES.includes(to)) {
        problems.push({ rule: 'F1 vocabulary', where: 'foundation.activation', message: `transition to unknown state '${to}'`, fix: 'Fix the transition table.' });
      }
    }
  }
  return problems;
}

/**
 * F8/F9 — the lightweight security gate at the contract boundary.
 * Textual, cheap, and deliberately narrow: a public contract must not carry a
 * literal secret, nor reach a hardcoded external endpoint without declaring the
 * network capability.
 */
const SECRET_RE = /(?:api[_-]?key|secret|password|token|private[_-]?key)\s*[:=]\s*['"][^'"\s]{12,}['"]/gi;
const URL_RE = /['"]https?:\/\/([a-z0-9.-]+)[^'"]*['"]/gi;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'example.test', 'n8n.io', 'docs.n8n.io']);

function checkContractSecurity(registry) {
  const problems = [];
  for (const domain of registry.domains) {
    for (const surface of domain.public ?? []) {
      const files = surface.endsWith('.mjs') ? [surface] : [`${surface}/index.mjs`];
      for (const file of files) {
        const absolute = join(APP_ROOT, file);
        if (!existsSync(absolute)) continue;
        const source = readFileSync(absolute, 'utf8');

        SECRET_RE.lastIndex = 0;
        let match;
        while ((match = SECRET_RE.exec(source)) !== null) {
          problems.push({
            rule: 'F8 secret-in-contract',
            where: file,
            message: `possible literal secret in a public contract: ${match[0].slice(0, 40)}…`,
            fix: 'Secrets never live in a contract. Resolve them through the credentials domain at call time.',
          });
        }

        URL_RE.lastIndex = 0;
        while ((match = URL_RE.exec(source)) !== null) {
          const host = match[1];
          if (LOCAL_HOSTS.has(host)) continue;
          const granted = domain.capabilities_granted ?? [];
          if (!granted.includes('network')) {
            problems.push({
              rule: 'F9 endpoint-undeclared',
              where: file,
              message: `contract references external endpoint '${host}' but '${domain.id}' does not declare the 'network' capability`,
              fix: "Declare 'network' in capabilities_granted with a justification, or remove the hardcoded endpoint.",
            });
          }
        }
      }
    }
  }
  return problems;
}

const isCli = process.argv[1]?.endsWith('foundation-gate.mjs');
if (isCli) {
  const registry = loadRegistry({ reload: true });
  const violations = runFoundationGate(registry);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ok: violations.length === 0, violations }, null, 2)}\n`);
  } else {
    process.stdout.write(`Foundation ${FOUNDATION.foundationVersion} gate — ${registry.domains.length} LEGOs, ${NODE_CONTRACT.creationRoutes.routes.length} node creation routes\n\n`);
    for (const violation of violations) {
      process.stdout.write(`${violation.rule}\n  at ${violation.where}\n  ${violation.message}\n  fix: ${violation.fix}\n\n`);
    }
    process.stdout.write(
      violations.length === 0
        ? 'OK — every LEGO declares a coherent Foundation 1.0 profile.\n'
        : `${violations.length} foundation violation(s).\n`,
    );
  }
  process.exit(violations.length === 0 ? 0 : 1);
}

export { getDomain };
