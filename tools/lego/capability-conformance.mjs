#!/usr/bin/env node
/**
 * Capability conformance check (P2.6).
 *
 *   node tools/lego/capability-conformance.mjs           # human report
 *   node tools/lego/capability-conformance.mjs --json    # machine report
 *
 * P2 shipped a runtime capability registry inside the compatibility layer
 * (`src/compat/capability.mjs`) that answers unknown `/rest/*` paths with
 * `501 {code:'unsupported', meta:{feature, owner, phase}}`. P2.6 makes the
 * backend LEGO registry the source of truth for *who owns what*. Two registries
 * would drift within a phase, so this check binds them:
 *
 *   for every REST feature the compat layer advertises,
 *     a capability with the matching `restFeature` must exist in the LEGO
 *     registry, and the owner + phase the frontend sees over the wire must be
 *     the owner + phase the architecture declares.
 *
 * The compat table stays the runtime mechanism (prefix matching, logging); the
 * manifest stays the governance record. This is the seam that keeps them equal.
 *
 * Owner: manager. Consumed by: Agent 1 (frontend reads owner/phase from the 501
 * meta), every domain owner (their 501s must name them).
 */
import { UNSUPPORTED_FEATURES } from '../../apps/n8n-lego/src/compat/capability.mjs';
import { listCapabilities, loadRegistry } from '../../apps/n8n-lego/src/lego/registry.mjs';

export function checkCapabilityConformance(registry = loadRegistry({ reload: true })) {
  const problems = [];
  const capabilities = listCapabilities(registry);
  const byRestFeature = new Map();
  for (const domain of registry.domains) {
    for (const capability of domain.capabilities ?? []) {
      if (!capability.restFeature) continue;
      if (byRestFeature.has(capability.restFeature)) {
        problems.push({
          kind: 'duplicate-rest-feature',
          feature: capability.restFeature,
          message: `restFeature '${capability.restFeature}' is claimed by '${byRestFeature.get(capability.restFeature).id}' and '${capability.id}'`,
        });
        continue;
      }
      byRestFeature.set(capability.restFeature, { id: capability.id, domain, capability });
    }
  }

  const seen = new Set();
  for (const entry of UNSUPPORTED_FEATURES) {
    if (seen.has(entry.feature)) continue;
    seen.add(entry.feature);
    const match = byRestFeature.get(entry.feature);
    if (!match) {
      problems.push({
        kind: 'unregistered-capability',
        feature: entry.feature,
        message: `the compat layer advertises '${entry.feature}' (owner '${entry.owner}', phase '${entry.phase}') but no LEGO capability declares restFeature '${entry.feature}'`,
        fix: 'Add the capability (with restFeature) to the owning domain in src/lego/manifest/domains.json.',
      });
      continue;
    }
    if (match.domain.id !== entry.owner) {
      problems.push({
        kind: 'owner-mismatch',
        feature: entry.feature,
        message: `501 meta says owner '${entry.owner}', the registry says '${match.domain.id}' (capability '${match.id}')`,
        fix: 'Make the compat table agree with the registry — the registry is authoritative for ownership.',
      });
    }
    const declaredPhase = match.capability.phase ?? match.domain.phase;
    if (entry.phase !== declaredPhase && !String(declaredPhase).includes(entry.phase.replace('+', ''))) {
      problems.push({
        kind: 'phase-mismatch',
        feature: entry.feature,
        message: `501 meta says phase '${entry.phase}', the registry says '${declaredPhase}' for '${match.id}'`,
        fix: 'Align the phase in one place; the frontend plans its roadmap from the 501 meta.',
      });
    }
  }

  return { problems, checked: seen.size, capabilities: capabilities.length };
}

const isCli = process.argv[1]?.endsWith('capability-conformance.mjs');
if (isCli) {
  const result = checkCapabilityConformance();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ok: result.problems.length === 0, ...result }, null, 2)}\n`);
  } else {
    process.stdout.write(`capability conformance: ${result.checked} REST features vs ${result.capabilities} registered capabilities\n\n`);
    for (const problem of result.problems) {
      process.stdout.write(`${problem.kind}: ${problem.message}\n`);
      if (problem.fix) process.stdout.write(`  fix: ${problem.fix}\n`);
    }
    if (result.problems.length === 0) {
      process.stdout.write('OK — the runtime capability table and the LEGO registry agree on every owner and phase.\n');
    } else {
      process.stdout.write(`\n${result.problems.length} conformance problem(s).\n`);
    }
  }
  process.exit(result.problems.length === 0 ? 0 : 1);
}
