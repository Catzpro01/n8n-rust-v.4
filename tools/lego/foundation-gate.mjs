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

  violations.push(...checkCapabilityContracts(registry));
  violations.push(...checkSurfaceAliases(registry));
  violations.push(...checkAiFoundation());
  violations.push(...checkNodeContract());
  violations.push(...checkContractSecurity(registry));
  return violations;
}

/**
 * F10–F13 — a capability must be a complete contract, not a name and a status.
 *
 * Before P2.10 a capability entry was `{id, status}`. That is enough to say a
 * feature exists and nowhere near enough for a consumer to negotiate with it:
 * it cannot tell what operations exist, what permission each needs, whether an
 * operation is idempotent, or which interaction class to expect. Consumers
 * filled the gap by inferring — operations from route existence, permissions
 * from implementation, lifecycle from file presence — and every one of those
 * inferences silently breaks when the implementation is replaced, which is
 * exactly what the architecture exists to allow.
 */
function checkCapabilityContracts(registry) {
  const problems = [];
  const push = (rule, where, message, fix) => problems.push({ rule, where, message, fix });
  const REQUIRED = ['operations', 'interaction', 'permissions', 'lifecycle', 'availability',
    'criticality', 'trust', 'transport', 'migrationState', 'degradation', 'replacement'];
  const LIFECYCLE = new Set(['declared', 'active', 'idle', 'degraded', 'deprecated', 'disabled', 'failed']);
  const AVAILABILITY = new Set(FOUNDATION.degradation?.states
    ?? ['available', 'degraded', 'capability-unavailable', 'optional-absent',
      'version-incompatible', 'permission-denied', 'migration-required', 'disabled', 'failed']);
  const TRANSPORTS = new Set(['in-process', 'worker', 'remote', 'mcp']);
  const seenOperations = new Map();

  for (const domain of registry.domains) {
    for (const capability of domain.capabilities ?? []) {
      const where = `capability '${capability.id}'`;

      for (const field of REQUIRED) {
        if (capability[field] === undefined) {
          push('F10 capability-contract', where, `missing required field '${field}'`,
            'A capability is a contract. Declare it in src/lego/manifest/domains.json.');
        }
      }
      if (capability.operations === undefined) continue;

      if (!Array.isArray(capability.operations)) {
        push('F10 capability-contract', where, 'operations must be an array', 'Use [] when none are declared yet.');
        continue;
      }

      // F11 — operations must be explicit and well-formed. No inference.
      const names = new Set();
      for (const operation of capability.operations) {
        const opWhere = `${where} operation '${operation.name ?? '(unnamed)'}'`;
        for (const field of ['name', 'interaction', 'permission', 'idempotent', 'status']) {
          if (operation[field] === undefined) {
            push('F11 operation-declaration', opWhere, `missing '${field}'`,
              'An operation declares its own name, interaction class, permission, idempotency and status.');
          }
        }
        if (names.has(operation.name)) {
          push('F11 operation-declaration', opWhere, 'duplicate operation name within the capability',
            'Operation names are unique per capability.');
        }
        names.add(operation.name);

        if (operation.interaction !== undefined && !COMMUNICATION_MODES.includes(operation.interaction)) {
          push('F12 interaction-validity', opWhere,
            `interaction '${operation.interaction}' is not one of ${COMMUNICATION_MODES.join(', ')}`,
            'There are exactly four interaction classes and no fifth may be added.');
        }
        if (operation.interaction !== undefined && !(capability.interaction ?? []).includes(operation.interaction)) {
          push('F12 interaction-validity', opWhere,
            `uses interaction '${operation.interaction}' which the capability does not advertise`,
            'The capability must advertise every interaction class its operations use.');
        }
        // A STREAM with no bounded policy is an unbounded buffer with extra steps.
        if (operation.interaction === 'stream' && operation.backpressure === undefined
            && capability.backpressure === undefined && operation.status !== 'unsupported'
            && operation.status !== 'planned') {
          push('F13 backpressure-declared', opWhere,
            'a stream operation declares no backpressure policy',
            'Declare buffer, drop, drop-oldest, coalesce, block, reject or terminate. An undeclared policy means unbounded buffering.');
        }
        if (operation.permission !== undefined && typeof operation.permission !== 'string') {
          push('F11 operation-declaration', opWhere, 'permission must be a string', 'Use a namespaced permission.');
        }
        const globalName = `${capability.id}.${operation.name}`;
        if (seenOperations.has(globalName)) {
          push('F11 operation-declaration', opWhere, 'duplicate fully-qualified operation id',
            'capability.operation must be globally unique.');
        }
        seenOperations.set(globalName, capability.id);
      }

      if (capability.lifecycle !== undefined && !LIFECYCLE.has(capability.lifecycle)) {
        push('F10 capability-contract', where, `lifecycle '${capability.lifecycle}' is not a declared state`,
          `Use one of ${[...LIFECYCLE].join(', ')}.`);
      }
      if (capability.availability !== undefined && !AVAILABILITY.has(capability.availability)) {
        push('F10 capability-contract', where, `availability '${capability.availability}' is not a declared degradation state`,
          'Use a declared degradation state so a consumer can branch on it.');
      }
      if (capability.transport !== undefined) {
        const { requires, supports } = capability.transport;
        if (requires !== undefined && !TRANSPORTS.has(requires)) {
          push('F10 capability-contract', where, `transport.requires '${requires}' is unknown`,
            `Use one of ${[...TRANSPORTS].join(', ')}.`);
        }
        for (const transport of supports ?? []) {
          if (!TRANSPORTS.has(transport)) {
            push('F10 capability-contract', where, `transport.supports '${transport}' is unknown`,
              `Use one of ${[...TRANSPORTS].join(', ')}.`);
          }
        }
        if (requires !== undefined && supports !== undefined && !supports.includes(requires)) {
          push('F10 capability-contract', where,
            `transport.requires '${requires}' is not in transport.supports`,
            'A capability must support the transport it requires.');
        }
      }
      // A capability may not claim more trust than the LEGO that owns it.
      if (capability.trust !== undefined && domain.trust !== undefined) {
        const rank = (id) => FOUNDATION.trust.levels[id]?.rank ?? 99;
        if (rank(capability.trust) < rank(domain.trust)) {
          push('F10 capability-contract', where,
            `claims trust '${capability.trust}', higher than its owning domain '${domain.id}' ('${domain.trust}')`,
            'A capability cannot be more trusted than the LEGO that provides it.');
        }
      }
    }
  }
  return problems;
}

/**
 * F14 — surface aliases must resolve deterministically.
 *
 * UI vocabulary and capability identity are allowed to differ ("executions" vs
 * `execution`). What is not allowed is for the mapping to be ambiguous or
 * guessed, because then two components resolve the same word differently.
 */
function checkSurfaceAliases(registry) {
  const problems = [];
  const push = (message, fix) => problems.push({ rule: 'F14 surface-alias', where: 'manifest.surfaceAliases', message, fix });
  const aliases = registry.surfaceAliases?.aliases;
  if (!aliases) return problems;

  const domainIds = new Set(registry.domains.map((domain) => domain.id));
  const seen = new Set();
  for (const alias of aliases) {
    if (!alias.surface || !alias.canonical) {
      push(`alias ${JSON.stringify(alias)} is missing 'surface' or 'canonical'`, 'Both are required.');
      continue;
    }
    if (seen.has(alias.surface)) {
      push(`surface word '${alias.surface}' is aliased twice`, 'A surface word resolves to exactly one canonical id.');
    }
    seen.add(alias.surface);
    if (!domainIds.has(alias.canonical)) {
      push(`alias '${alias.surface}' points at unknown domain '${alias.canonical}'`,
        'An alias must resolve to a real domain.');
    }
    // The dangerous case: a surface word that is ALSO a real domain id but
    // points somewhere else. Resolution order would then decide the answer.
    if (domainIds.has(alias.surface) && alias.surface !== alias.canonical) {
      push(`surface word '${alias.surface}' is itself a domain id but aliases to '${alias.canonical}'`,
        'This makes resolution order-dependent. Rename the surface word or drop the alias.');
    }
  }
  return problems;
}

/**
 * F15 — the AI Foundation stays contract-only and vendor-neutral.
 *
 * The specific risk this guards is a vendor name leaking out of an `examples`
 * array and into an id, a required field or a default. Once that happens the
 * contract is no longer provider-neutral and every other provider must be bent
 * to fit the first one's shape.
 */
function checkAiFoundation() {
  const problems = [];
  const push = (message, fix) => problems.push({ rule: 'F15 ai-vendor-neutral', where: 'manifest/ai-foundation.json', message, fix });
  const file = join(APP_ROOT, 'src', 'lego', 'manifest', 'ai-foundation.json');
  if (!existsSync(file)) return problems;
  const ai = JSON.parse(readFileSync(file, 'utf8'));

  const VENDORS = ['9router', 'composio', 'hermes', 'claude', 'gemini', 'antigravity',
    'openclaw', 'deepseek', 'mirofish', 'openai', 'anthropic'];

  // Vendor names are permitted ONLY inside an `examples` array or free prose.
  // They are forbidden in any structural position: ids, keys, defaults.
  const walk = (node, path, insideExamples) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`, insideExamples));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        const lowerKey = key.toLowerCase();
        for (const vendor of VENDORS) {
          if (lowerKey.includes(vendor)) {
            push(`vendor '${vendor}' appears as an object KEY at ${path}.${key}`,
              'Vendor names belong in an examples array, never in a structural key.');
          }
        }
        walk(value, `${path}.${key}`, insideExamples || key === 'examples');
      }
      return;
    }
    if (typeof node !== 'string') return;
    // Structural string positions: ids, contract names, enum-ish fields.
    const structural = /\.(id|contract|name|kind|type|default|permission|transport)$/.test(path)
      || /\.(ids|contracts|kinds|types|operations|concepts)\[/.test(path);
    if (!structural || insideExamples) return;
    const lower = node.toLowerCase();
    for (const vendor of VENDORS) {
      if (lower.includes(vendor)) {
        push(`vendor '${vendor}' appears in a structural field at ${path} ('${node}')`,
          'A contract must not name a vendor in an id, contract, kind or default.');
      }
    }
  };
  walk(ai, 'ai', false);

  if (ai.status !== 'contract-only') {
    push(`status is '${ai.status}', expected 'contract-only'`,
      'While no implementation exists, the manifest must say so.');
  }
  return problems;
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

export { getDomain };

/* ------------------------------------------------------------- selftest */

/**
 * Foundation gate fixtures.
 *
 * The architecture gate has had a selftest since P2.6 on the principle that a
 * gate nobody has watched fail is a decoration. The foundation gate did not,
 * and P2.10 added six rules (F10–F15) to it — so it gets the same treatment.
 *
 * Each fixture mutates a clone of the real registry to plant exactly one
 * violation and requires that rule to fire. The negative control requires that
 * a pristine registry raises nothing, which is what stops a rule from being
 * "detected" simply because the gate fails on everything.
 */
export const FOUNDATION_CASES = Object.freeze([
  {
    name: 'a capability with no operations field',
    rule: 'F10 capability-contract',
    mutate: (registry) => { delete registry.byId.get('settings').capabilities[0].operations; },
  },
  {
    name: 'a capability whose transport is unknown',
    rule: 'F10 capability-contract',
    mutate: (registry) => { registry.byId.get('settings').capabilities[0].transport = { requires: 'carrier-pigeon', supports: ['carrier-pigeon'] }; },
  },
  {
    name: 'a capability requiring a transport it does not support',
    rule: 'F10 capability-contract',
    mutate: (registry) => { registry.byId.get('settings').capabilities[0].transport = { requires: 'remote', supports: ['in-process'] }; },
  },
  {
    name: 'an operation missing its permission',
    rule: 'F11 operation-declaration',
    mutate: (registry) => { delete registry.byId.get('settings').capabilities[0].operations[0].permission; },
  },
  {
    name: 'two operations with the same name in one capability',
    rule: 'F11 operation-declaration',
    mutate: (registry) => {
      const capability = registry.byId.get('settings').capabilities[0];
      capability.operations.push({ ...capability.operations[0] });
    },
  },
  {
    name: 'an operation using a fifth interaction class',
    rule: 'F12 interaction-validity',
    mutate: (registry) => { registry.byId.get('settings').capabilities[0].operations[0].interaction = 'rpc'; },
  },
  {
    name: 'an operation using a class its capability does not advertise',
    rule: 'F12 interaction-validity',
    mutate: (registry) => { registry.byId.get('settings').capabilities[0].operations[0].interaction = 'batch'; },
  },
  {
    name: 'a stream operation with no backpressure policy',
    rule: 'F13 backpressure-declared',
    mutate: (registry) => {
      const capability = registry.byId.get('realtime').capabilities[0];
      for (const operation of capability.operations) delete operation.backpressure;
    },
  },
  {
    name: 'a surface alias pointing at a domain that does not exist',
    rule: 'F14 surface-alias',
    mutate: (registry) => { registry.surfaceAliases.aliases[0].canonical = 'no-such-domain'; },
  },
  {
    name: 'two aliases claiming the same surface word',
    rule: 'F14 surface-alias',
    mutate: (registry) => {
      const [first] = registry.surfaceAliases.aliases;
      registry.surfaceAliases.aliases.push({ ...first, canonical: 'workflow' });
    },
  },
  {
    name: 'a capability more trusted than the LEGO that owns it',
    rule: 'F10 capability-contract',
    mutate: (registry) => {
      const domain = registry.byId.get('reference-lego');
      domain.trust = 'community';
      domain.failureBoundary = 'sandboxed';
      domain.capabilities[0].trust = 'core';
    },
  },
]);

function cloneForFoundation(registry) {
  const domains = JSON.parse(JSON.stringify(registry.domains));
  return {
    ...registry,
    domains,
    surfaceAliases: JSON.parse(JSON.stringify(registry.surfaceAliases ?? { aliases: [] })),
    byId: new Map(domains.map((domain) => [domain.id, domain])),
  };
}

/** Runs the foundation fixtures plus a negative control. */
export function runFoundationSelftest() {
  const base = loadRegistry({ reload: true });
  const results = [];
  for (const testCase of FOUNDATION_CASES) {
    const registry = cloneForFoundation(base);
    testCase.mutate(registry);
    const violations = runFoundationGate(registry);
    results.push({
      name: testCase.name,
      expectedRule: testCase.rule,
      detected: violations.some((violation) => violation.rule === testCase.rule),
      saw: [...new Set(violations.map((violation) => violation.rule))],
    });
  }
  const clean = runFoundationGate(cloneForFoundation(base));
  results.push({
    name: 'negative control: the real registry raises nothing',
    expectedRule: '(none)',
    detected: clean.length === 0,
    saw: [...new Set(clean.map((violation) => violation.rule))],
  });
  return results;
}

const isCli = process.argv[1]?.endsWith('foundation-gate.mjs');
if (isCli && process.argv.includes('--selftest')) {
  const results = runFoundationSelftest();
  let passed = 0;
  for (const result of results) {
    if (result.detected) passed += 1;
    process.stdout.write(`${result.detected ? 'PASS' : 'FAIL'}  ${result.name} (expects ${result.expectedRule})\n`);
    if (!result.detected) process.stdout.write(`      saw: ${result.saw.join(', ') || '(nothing)'}\n`);
  }
  process.stdout.write(`\nfoundation selftest: ${passed}/${results.length} checks passed\n`);
  process.exit(passed === results.length ? 0 : 1);
} else if (isCli) {
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
