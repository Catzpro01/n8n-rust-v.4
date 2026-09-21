/**
 * Backend LEGO architecture gate — the checker core (P2.6).
 *
 * The rules live here; `architecture-gate.mjs` is the CLI around them and
 * `architecture-gate.selftest.mjs` plants violations against them. Keeping the
 * core in its own module means the selftest never has to import the CLI (which
 * would be a cycle) and the contract tests can call `runGate()` directly.
 *
 * Rules enforced:
 *
 *   R1 unowned-file           a source file no domain claims
 *   R2 forbidden-direction    an import the importer declares it must not make
 *   R3 undeclared-dependency  a cross-domain import with no dependsOn entry
 *   R4 internal-import        reaching past a domain's declared public surface
 *   R5 legacy-zone-growth     a new file added to the frozen legacy zone
 *   R6 registry-invalid       the manifest violates its own structural rules
 *   R7 contract-drift         public exports changed without a version bump
 *   R8 stale-allowance        a temporary allowance no import uses any more
 *   R9 version-incompatible   registry/lock version drift, a declared consumer
 *                             requirement the provider no longer satisfies, or
 *                             an undeclared breaking change (P2.7)
 *
 * Owner: manager (cross-domain contract governance). Pure Node, no deps.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadRegistry,
  validateRegistry,
  domainForPath,
  isPublicPath,
  isDependencyAllowed,
  getDomain,
  getAncestors,
} from '../../apps/n8n-lego/src/lego/registry.mjs';
import { classifyChange, satisfies } from '../../apps/n8n-lego/src/lego/compat.mjs';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_APP_ROOT = join(REPO_ROOT, 'apps', 'n8n-lego');

/* ------------------------------------------------------------------ scanning */

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries.sort()) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const STATIC_IMPORT_RE = /(?:^|[\n;])\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/** @returns {Array<{ specifier: string, line: number }>} relative specifiers only */
export function extractImports(source) {
  const found = [];
  for (const re of [STATIC_IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source)) !== null) {
      if (!match[1].startsWith('.')) continue;
      found.push({ specifier: match[1], line: source.slice(0, match.index).split('\n').length });
    }
  }
  return found;
}

function toRelative(appRoot, absolutePath) {
  return relative(appRoot, absolutePath).split(sep).join('/');
}

/* ------------------------------------------------------------------- the gate */

/**
 * @param {{ registry?: object, appRoot?: string }} [options]
 * @returns {Array<{ rule: string, file: string, line: number, message: string, fix: string }>}
 */
export function runGate({ registry = loadRegistry({ reload: true }), appRoot = DEFAULT_APP_ROOT } = {}) {
  const violations = [];
  const scanDirs = (registry.manifest.scan?.include ?? ['src', 'bin']).map((dir) => join(appRoot, dir));
  const files = scanDirs.flatMap((dir) => walk(dir));

  // R6 — the registry must be internally valid before it can judge anything.
  for (const problem of validateRegistry(registry)) {
    violations.push({
      rule: 'R6 registry-invalid',
      file: 'src/lego/manifest/domains.json',
      line: 0,
      message: problem,
      fix: 'Correct the manifest so it satisfies its own structural rules.',
    });
  }

  const allowanceUse = new Map((registry.allowances ?? []).map((allowance) => [allowance.id, 0]));
  const legacyFiles = new Set(registry.legacy?.files ?? []);

  for (const absolute of files) {
    const relPath = toRelative(appRoot, absolute);
    const owner = domainForPath(relPath, registry);

    // R1 — every backend source file must belong to a domain.
    if (!owner) {
      violations.push({
        rule: 'R1 unowned-file',
        file: relPath,
        line: 0,
        message: `no domain in the registry claims '${relPath}'`,
        fix: "Add the file to an existing domain's `paths`, or register a new domain with an owner.",
      });
      continue;
    }

    // R5 — the legacy strangler zone is frozen: it may shrink, never grow.
    if (owner.kind === 'legacy' && registry.legacy?.frozen && !legacyFiles.has(relPath)) {
      violations.push({
        rule: 'R5 legacy-zone-growth',
        file: relPath,
        line: 0,
        message: `'${relPath}' is a new file inside the frozen legacy zone '${owner.id}'`,
        fix: 'New code belongs in a contract-first domain, not in the legacy aggregate. Carve out a domain instead.',
      });
    }

    const source = readFileSync(absolute, 'utf8');
    for (const { specifier, line } of extractImports(source)) {
      const targetRel = toRelative(appRoot, resolve(dirname(absolute), specifier));
      if (targetRel.startsWith('..')) continue; // outside the app: not our graph
      const target = domainForPath(targetRel, registry);
      if (!target) {
        violations.push({
          rule: 'R1 unowned-file',
          file: relPath,
          line,
          message: `imports '${specifier}', which resolves to unowned path '${targetRel}'`,
          fix: 'Register the imported file under a domain in the manifest.',
        });
        continue;
      }
      if (target.id === owner.id) continue;

      const allowance = (registry.allowances ?? []).find(
        (entry) => entry.file === relPath && entry.imports === targetRel,
      );
      if (allowance) {
        allowanceUse.set(allowance.id, (allowanceUse.get(allowance.id) ?? 0) + 1);
        continue;
      }

      // A composition root exists precisely to wire implementations together.
      const isCompositionRoot = owner.compositionRoot === true;
      // The legacy zone keeps its historical reach until it is carved up.
      const legacyReachAllowed = owner.kind === 'legacy' && registry.legacy?.allowInternalImports === true;

      const verdict = isDependencyAllowed(owner.id, target.id, registry);
      if (!verdict.allowed && !isCompositionRoot) {
        violations.push({
          rule: verdict.rule === 'forbidden-direction' ? 'R2 forbidden-direction' : 'R3 undeclared-dependency',
          file: relPath,
          line,
          message: `${owner.id} -> ${target.id} via '${specifier}': ${verdict.reason}`,
          fix:
            verdict.rule === 'forbidden-direction'
              ? `Invert the dependency: '${target.id}' must not be reached from '${owner.id}'. Depend on a contract, or let the composition root wire it.`
              : `Declare '${target.id}' in the dependsOn list of '${owner.id}' — with a justified direction — or drop the import.`,
        });
      }

      // R4 — a permitted dependency may still only touch the public surface.
      // Reported independently of R2/R3: "you may not depend on this" and
      // "you reached into its internals" are two different mistakes, and an
      // author fixing one needs to see the other.
      const isInternalPath = /(^|\/)internal\//.test(targetRel);
      const outsidePublic = (target.public ?? []).length > 0 && !isPublicPath(targetRel, target);
      if ((isInternalPath || outsidePublic) && !isCompositionRoot && !legacyReachAllowed) {
        violations.push({
          rule: 'R4 internal-import',
          file: relPath,
          line,
          message: isInternalPath
            ? `'${targetRel}' is an internal implementation path of '${target.id}'`
            : `reaches into '${targetRel}', outside the public surface of '${target.id}' (${(target.public ?? []).join(', ')})`,
          fix: `Consume the public contract of '${target.id}' instead, or ask its owner (${target.owner}) to publish what you need.`,
        });
      }
    }
  }

  // R8 — an allowance nobody exercises is debt that should simply be deleted.
  for (const [id, uses] of allowanceUse) {
    if (uses > 0) continue;
    const allowance = registry.allowances.find((entry) => entry.id === id);
    violations.push({
      rule: 'R8 stale-allowance',
      file: 'src/lego/manifest/domains.json',
      line: 0,
      message: `allowance '${id}' (${allowance.from} -> ${allowance.to}) is no longer used by any import`,
      fix: 'The boundary healed — delete the allowance so it cannot silently re-open.',
    });
  }

  violations.push(...checkContractDrift(registry, appRoot));
  violations.push(...checkVersionCompatibility(registry));
  return violations;
}

/** R7 — published exports must match the contract lock, or the version must move. */
export function checkContractDrift(registry, appRoot = DEFAULT_APP_ROOT) {
  const problems = [];
  for (const contract of registry.contractLock?.contracts ?? []) {
    for (const [file, expected] of Object.entries(contract.exports ?? {})) {
      let source;
      try {
        source = readFileSync(join(appRoot, file), 'utf8');
      } catch {
        problems.push({
          rule: 'R7 contract-drift',
          file,
          line: 0,
          message: `contract '${contract.id}' v${contract.version} lists '${file}', which does not exist`,
          fix: 'Removing a contract file is BREAKING: bump the major version and notify the listed consumers.',
        });
        continue;
      }
      const actual = new Set(listExports(source));
      const missing = expected.filter((name) => !actual.has(name));
      const added = [...actual].filter((name) => !expected.includes(name));
      if (missing.length > 0) {
        problems.push({
          rule: 'R7 contract-drift',
          file,
          line: 0,
          message: `contract '${contract.id}' v${contract.version} promises ${missing.join(', ')} — no longer exported`,
          fix: `Removing an export is BREAKING: restore it, or bump '${contract.id}' to the next major and get sign-off from ${(contract.consumers ?? []).join(', ') || 'its consumers'}.`,
        });
      }
      if (added.length > 0) {
        problems.push({
          rule: 'R7 contract-drift',
          file,
          line: 0,
          message: `'${file}' exports ${added.join(', ')}, not listed in contract '${contract.id}' v${contract.version}`,
          fix: `Adding an export is MINOR: list it in contract-lock.json and bump '${contract.id}' — or keep the symbol internal.`,
        });
      }
    }
  }
  return problems;
}

/**
 * R9 — contract version compatibility (P2.7).
 *
 * Three ways versions go wrong once LEGOs nest, all of them silent without a
 * check:
 *
 *   a) the registry entry and the contract lock disagree about a version,
 *   b) a consumer declares `requires` that the provider's current version no
 *      longer satisfies,
 *   c) a contract moved from its recorded `previousVersion` in a way the
 *      compatibility model classifies as breaking, without the major bump and
 *      the changelog entry the policy demands.
 */
function lockRowsFor(registry, domainId) {
  return (registry.contractLock?.contracts ?? []).filter((contract) => contract.domain === domainId);
}

export function checkVersionCompatibility(registry) {
  const problems = [];
  const lockByDomain = new Map();
  for (const contract of registry.contractLock?.contracts ?? []) {
    lockByDomain.set(contract.domain, contract);

    // (a) registry vs lock — only for the domain's PRIMARY contract. A domain
    // may publish several contracts (lego-foundation publishes three), so the
    // entry names which one its `contract.version` refers to.
    const domain = getDomain(contract.domain, registry);
    const isPrimary = domain?.contract?.id
      ? domain.contract.id === contract.id
      : lockRowsFor(registry, contract.domain).length === 1;
    if (isPrimary && domain?.contract?.version && domain.contract.version !== contract.version) {
      problems.push({
        rule: 'R9 version-incompatible',
        file: 'src/lego/contracts/contract-lock.json',
        line: 0,
        message: `contract '${contract.id}' is locked at ${contract.version} but domain '${domain.id}' declares ${domain.contract.version}`,
        fix: 'The registry and the contract lock must agree — update whichever is stale.',
      });
    }

    // (c) undeclared breaking change
    if (contract.previousVersion) {
      const change = classifyChange(contract.previousVersion, contract.version, { migrations: contract.migrations ?? [] });
      if (change.kind === 'breaking' && !(contract.changelog ?? []).length) {
        problems.push({
          rule: 'R9 version-incompatible',
          file: 'src/lego/contracts/contract-lock.json',
          line: 0,
          message: `contract '${contract.id}' ${contract.previousVersion} -> ${contract.version} is breaking (${change.reason}) with no changelog entry`,
          fix: `A breaking change needs a changelog entry and sign-off from ${(contract.consumers ?? []).join(', ') || 'its consumers'}.`,
        });
      }
      if (change.kind === 'downgrade') {
        problems.push({
          rule: 'R9 version-incompatible',
          file: 'src/lego/contracts/contract-lock.json',
          line: 0,
          message: `contract '${contract.id}' went backwards: ${contract.previousVersion} -> ${contract.version}`,
          fix: 'A contract version must never decrease.',
        });
      }
    }
  }

  // (b) declared consumer requirements
  for (const domain of registry.domains) {
    for (const [providerId, range] of Object.entries(domain.requires ?? {})) {
      const provider = getDomain(providerId, registry);
      if (!provider) {
        problems.push({
          rule: 'R9 version-incompatible',
          file: 'src/lego/manifest/domains.json',
          line: 0,
          message: `'${domain.id}' requires unknown LEGO '${providerId}'`,
          fix: 'Reference a registered LEGO id.',
        });
        continue;
      }
      const actual = provider.contract?.version;
      const verdict = satisfies(actual, range);
      if (!verdict.satisfied) {
        problems.push({
          rule: 'R9 version-incompatible',
          file: 'src/lego/manifest/domains.json',
          line: 0,
          message: `'${domain.id}' requires '${providerId}' ${range} but it publishes ${actual}: ${verdict.reason}`,
          fix: `Either widen '${domain.id}'.requires after verifying compatibility, or hold '${providerId}' at a satisfying version.`,
        });
      }
    }
  }

  // A sub-LEGO whose ancestor chain is broken cannot be reasoned about at all.
  for (const domain of registry.domains) {
    if (!domain.parent) continue;
    const ancestors = getAncestors(domain.id, registry);
    if (ancestors.length === 0) {
      problems.push({
        rule: 'R9 version-incompatible',
        file: 'src/lego/manifest/domains.json',
        line: 0,
        message: `sub-LEGO '${domain.id}' declares parent '${domain.parent}' but the chain does not resolve`,
        fix: 'Fix the parent reference so the hierarchy is a valid tree.',
      });
    }
  }

  return problems;
}

export function listExports(source) {
  const names = [];
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
    /export\s+class\s+([A-Za-z0-9_$]+)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(source)) !== null) names.push(match[1]);
  }
  const braced = /export\s*\{([^}]*)\}(?!\s*from)/g;
  let match;
  while ((match = braced.exec(source)) !== null) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/* --------------------------------------------------------------------- report */

export function formatReport(violations, registry = loadRegistry()) {
  const lines = [
    'n8n-lego backend LEGO architecture gate',
    `  registry:  ${registry.domains.length} domains, ${registry.allowances.length} temporary allowance(s)`,
    `  contracts: ${registry.contractLock.contracts.length} locked public contract(s)`,
    '',
  ];
  if (violations.length === 0) {
    lines.push('OK — every backend import respects its declared boundary.');
  } else {
    for (const violation of violations) {
      lines.push(violation.rule);
      lines.push(`  at ${violation.file}${violation.line ? `:${violation.line}` : ''}`);
      lines.push(`  ${violation.message}`);
      lines.push(`  fix: ${violation.fix}`);
      lines.push('');
    }
    lines.push(`${violations.length} boundary violation(s).`);
  }
  return `${lines.join('\n')}\n`;
}
