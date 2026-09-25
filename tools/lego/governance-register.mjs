/**
 * Governance register — validation and rendering for the program / slice / feature layer of the
 * canonical register `docs/n8n-lego/milestones.json` (governance reset, Issue #256).
 *
 * The register is the ONE source of truth. This module never writes it: `tools/lego/ai-pack.mjs`
 * uses `validateGovernanceRegister()` to refuse generating `.ai/master/MILESTONE_REGISTER.md` from an
 * invalid register, and `renderGovernanceSections()` to render the readable views. The unit test
 * `apps/n8n-lego/test/governance-register.test.mjs` runs the same validator, so a register that
 * breaks a rule fails both the generator freshness gate and the test suite.
 *
 * Rules encoded (all from the governance mandate #254/#255/#256):
 *  - top-level programs are exactly P0..P11 — no P12+ and never P24+;
 *  - P0-P6 and P9 are complete; P7, P8, P10 and P11 are planned (a status change is a Manager
 *    decision recorded here, and this list must be updated in the same change);
 *  - new work inside an existing P is a slice `Pn-Snn`, maintenance is `Pn-Mnn`; there is no P5.9;
 *  - legacy P12-P23 are consolidated into thematic future programs, each exactly once;
 *  - status / relevance come from the fixed vocabularies;
 *  - `implemented` requires a 40-hex merge SHA and evidence (an issue existing is not evidence);
 *  - superseded requires supersededBy; rejected / retired carry a recorded reason;
 *  - feature ids are unique and every slice reference resolves inside its own parent.
 */

export const TOP_LEVEL_PROGRAMS = Object.freeze(['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11']);
export const EXPECTED_PROGRAM_STATUS = Object.freeze({
  P0: 'complete', P1: 'complete', P2: 'complete', P3: 'complete', P4: 'complete', P5: 'complete', P6: 'complete',
  P7: 'planned', P8: 'planned', P9: 'complete', P10: 'planned', P11: 'planned',
});
export const LEGACY_FUTURE_MILESTONES = Object.freeze(['P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20', 'P21', 'P22', 'P23']);
export const FEATURE_REQUIRED_FIELDS = Object.freeze([
  'id', 'title', 'type', 'sourceIssue', 'parent', 'slice', 'owner', 'status', 'relevance',
  'dependencies', 'evidence', 'pr', 'mergeSha', 'relatedEvidence', 'supersededBy', 'replacement',
]);

const SHA = /^[0-9a-f]{40}$/;
const HISTORICAL_SLICE = /^(P\d+\.\d+(\.\d+)?(-[A-Za-z0-9]+)?|P\d+\.\d+-P\d+\.\d+|P3 Slice [A-Z])$/;
const NEW_SLICE = /^(P\d+)-(S|M)\d{2}$/;
const FUTURE_SLICE = /^(FUTURE-[A-Z-]+)-S\d{2}$/;
const FEATURE_ID = /^((P\d+|FUTURE-[A-Z-]+)-F-[A-Z0-9]+-\d{3}|GOV-F-\d{3})$/;

function programOfHistoricalSlice(id) {
  return id.match(/^(P\d+)[ .]/)?.[1] ?? null;
}

/** Returns an array of human-readable violations; empty means valid. */
export function validateGovernanceRegister(register) {
  const errors = [];
  const fail = (message) => errors.push(message);
  const gov = register?.governance;
  if (!gov) return ['register has no governance block'];
  const statuses = new Set(gov.statusVocabulary ?? []);
  const relevances = new Set(gov.relevanceVocabulary ?? []);
  const programStatuses = new Set(gov.programStatusVocabulary ?? []);
  for (const word of ['implemented', 'in-progress', 'planned', 'proposed', 'blocked', 'deferred', 'superseded', 'retired', 'rejected']) {
    if (!statuses.has(word)) fail(`statusVocabulary lacks "${word}"`);
  }
  for (const word of ['active', 'maintenance', 'deprecated', 'archived']) {
    if (!relevances.has(word)) fail(`relevanceVocabulary lacks "${word}"`);
  }

  const programs = register.programs ?? [];
  const futures = register.futurePrograms ?? [];
  const ids = programs.map((program) => program.id);
  if (JSON.stringify(ids) !== JSON.stringify(TOP_LEVEL_PROGRAMS)) fail(`programs must be exactly ${TOP_LEVEL_PROGRAMS.join(',')} in order (got ${ids.join(',')})`);
  const sliceOwner = new Map();

  const checkSlice = (slice, parentId, isFuture) => {
    if (!slice.id) return fail(`${parentId}: slice without id`);
    if (sliceOwner.has(slice.id)) fail(`slice ${slice.id} is declared twice`);
    sliceOwner.set(slice.id, parentId);
    if (/^P5\.9\b/.test(slice.id)) fail('P5.9 is forbidden — P5 debt is P5-Mnn');
    if (isFuture) {
      const match = slice.id.match(FUTURE_SLICE);
      if (!match || match[1] !== parentId) fail(`${slice.id}: future-program slices are named ${parentId}-Snn`);
    } else if (NEW_SLICE.test(slice.id)) {
      if (slice.id.match(NEW_SLICE)[1] !== parentId) fail(`${slice.id} sits under ${parentId}`);
    } else if (HISTORICAL_SLICE.test(slice.id)) {
      if (programOfHistoricalSlice(slice.id) !== parentId) fail(`${slice.id} sits under ${parentId}`);
      if (slice.status !== 'implemented') fail(`${slice.id}: historical slices are immutable completed history`);
    } else {
      fail(`${slice.id}: slice id is neither historical (Pn.m) nor Pn-Snn / Pn-Mnn`);
    }
    if (!statuses.has(slice.status)) fail(`${slice.id}: status "${slice.status}" is not in the vocabulary`);
    if (slice.status === 'implemented') {
      if (!SHA.test(slice.mergeSha ?? '')) fail(`${slice.id}: implemented without a 40-hex merge SHA`);
      if (!slice.evidence) fail(`${slice.id}: implemented without evidence`);
    } else if (slice.mergeSha) {
      fail(`${slice.id}: a ${slice.status} slice cannot carry a merge SHA`);
    }
  };

  for (const program of programs) {
    if (!programStatuses.has(program.status)) fail(`${program.id}: program status "${program.status}" is not in the program vocabulary`);
    if (EXPECTED_PROGRAM_STATUS[program.id] && program.status !== EXPECTED_PROGRAM_STATUS[program.id]) {
      fail(`${program.id}: status "${program.status}" differs from the recorded Manager decision "${EXPECTED_PROGRAM_STATUS[program.id]}"`);
    }
    if (!Array.isArray(program.slices) || program.slices.length === 0) fail(`${program.id}: no slices`);
    for (const slice of program.slices ?? []) checkSlice(slice, program.id, false);
    if (program.status === 'complete' && !(program.slices ?? []).some((slice) => slice.status === 'implemented')) {
      fail(`${program.id}: complete without one implemented slice`);
    }
  }

  const legacySeen = [];
  for (const future of futures) {
    if (!/^FUTURE-[A-Z-]+$/.test(future.id)) fail(`${future.id}: future programs are FUTURE-<THEME>`);
    if (/^P\d+$/.test(future.id)) fail(`${future.id}: a future program is never a P number`);
    legacySeen.push(...(future.legacyMilestones ?? []));
    for (const slice of future.slices ?? []) checkSlice(slice, future.id, true);
  }
  const sortedLegacy = [...legacySeen].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  if (JSON.stringify(sortedLegacy) !== JSON.stringify(LEGACY_FUTURE_MILESTONES)) {
    fail(`legacy P12-P23 must each map to exactly one future program (got ${sortedLegacy.join(',')})`);
  }

  const parents = new Set([...ids, ...futures.map((future) => future.id), 'GOVERNANCE']);
  const featureIds = new Set();
  for (const feature of register.features ?? []) {
    for (const field of FEATURE_REQUIRED_FIELDS) if (!(field in feature)) fail(`${feature.id ?? '?'}: missing "${field}"`);
    if (!FEATURE_ID.test(feature.id ?? '')) fail(`${feature.id}: feature id format`);
    if (featureIds.has(feature.id)) fail(`${feature.id}: duplicate feature id`);
    featureIds.add(feature.id);
    if (!feature.id.startsWith(feature.parent === 'GOVERNANCE' ? 'GOV-' : `${feature.parent}-F-`)) fail(`${feature.id}: id prefix must match parent ${feature.parent}`);
    if (!parents.has(feature.parent)) fail(`${feature.id}: unknown parent ${feature.parent}`);
    if (!statuses.has(feature.status)) fail(`${feature.id}: status "${feature.status}"`);
    if (!relevances.has(feature.relevance)) fail(`${feature.id}: relevance "${feature.relevance}"`);
    if (!Array.isArray(feature.sourceIssue) || feature.sourceIssue.length === 0) fail(`${feature.id}: sourceIssue must name at least one issue`);
    if (feature.slice !== null) {
      if (!sliceOwner.has(feature.slice)) fail(`${feature.id}: slice ${feature.slice} does not exist`);
      else if (sliceOwner.get(feature.slice) !== feature.parent) fail(`${feature.id}: slice ${feature.slice} belongs to ${sliceOwner.get(feature.slice)}, not ${feature.parent}`);
    }
    if (feature.status === 'implemented') {
      if (!feature.evidence) fail(`${feature.id}: implemented without evidence`);
      if (feature.type !== 'governance' && !SHA.test(feature.mergeSha ?? '')) fail(`${feature.id}: implemented without a 40-hex merge SHA`);
    }
    if (feature.status === 'superseded' && !feature.supersededBy) fail(`${feature.id}: superseded without supersededBy`);
    if ((feature.status === 'rejected' || feature.status === 'retired') && !(feature.note || feature.evidence)) fail(`${feature.id}: ${feature.status} without a recorded reason`);
  }
  return errors;
}

export function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[item[key]] = (counts[item[key]] ?? 0) + 1;
  return counts;
}

const cell = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const short = (sha) => (sha ? `\`${sha.slice(0, 8)}\`` : '—');
const issues = (list) => (list ?? []).map((n) => `#${n}`).join(', ') || '—';

function nextSlice(program) {
  return (program.slices ?? []).find((slice) => slice.status === 'in-progress')
    ?? (program.slices ?? []).find((slice) => slice.status === 'planned')
    ?? null;
}

/** Markdown sections rendered into the generated MILESTONE_REGISTER.md. */
export function renderGovernanceSections(register) {
  const gov = register.governance;
  const programs = register.programs ?? [];
  const futures = register.futurePrograms ?? [];
  const features = register.features ?? [];
  const byParent = new Map();
  for (const feature of features) {
    if (!byParent.has(feature.parent)) byParent.set(feature.parent, []);
    byParent.get(feature.parent).push(feature);
  }
  const statusOrder = gov.statusVocabulary;
  const featureCounts = countBy(features, 'status');
  const top = programs.map((program) => {
    const done = program.slices.filter((slice) => slice.status === 'implemented').length;
    const next = nextSlice(program);
    return `| **${program.id}** | ${cell(program.title)} | **${program.status.toUpperCase()}** | ${done}/${program.slices.length} | ${(byParent.get(program.id) ?? []).length} | ${next ? `\`${next.id}\` (${next.status})` : '—'} |`;
  });
  const futureTop = futures.map((future) => {
    const next = nextSlice(future);
    return `| **${future.id}** | ${cell(future.title)} | ${future.legacyMilestones.join(', ')} | ${issues(future.legacyIssues)} | ${future.status} | ${(byParent.get(future.id) ?? []).length} | ${next ? `\`${next.id}\`` : '—'} |`;
  });
  const sliceTable = (slices) => ['| Slice | Title | Status | PR | Merge SHA | Issue |', '| --- | --- | --- | --- | --- | --- |',
    ...slices.map((slice) => `| \`${slice.id}\` | ${cell(slice.title)} | ${slice.status} | ${slice.pr ? `#${slice.pr}` : '—'} | ${short(slice.mergeSha)} | ${slice.issue ? `#${slice.issue}` : '—'} |`)].join('\n');
  const featureTable = (list) => ['| Feature | Title | Status | Relevance | Slice | Issues | Merge SHA |', '| --- | --- | --- | --- | --- | --- | --- |',
    ...list.map((feature) => `| \`${feature.id}\` | ${cell(feature.title)} | ${feature.status} | ${feature.relevance} | ${feature.slice ? `\`${feature.slice}\`` : '—'} | ${issues(feature.sourceIssue)} | ${short(feature.mergeSha)} |`)].join('\n');
  const detail = (entity) => {
    const list = byParent.get(entity.id) ?? [];
    const extra = [entity.acceptance ? `**Acceptance:** ${entity.acceptance}` : '', entity.legacyLadder ? `**Historical ladder:** ${entity.legacyLadder}` : '',
      entity.domainAffinity ? `**Domain affinity (#254 mapping):** ${entity.domainAffinity.join('; ')}` : '',
      entity.designDecisions ? `**Design decisions:** ${entity.designDecisions.join(' ')}` : ''].filter(Boolean).join('\n\n');
    return `### ${entity.id} — ${entity.title} (${entity.status})

${entity.scope ?? entity.rule ?? ''}${extra ? `\n\n${extra}` : ''}

**Source issues:** ${issues(entity.sourceIssues ?? entity.legacyIssues)}

<details><summary>Slices (${entity.slices.length})</summary>

${sliceTable(entity.slices)}

</details>

<details><summary>Features (${list.length}: ${Object.entries(countBy(list, 'status')).map(([s, n]) => `${n} ${s}`).join(', ') || 'none'})</summary>

${list.length ? featureTable(list) : '_none_'}

</details>`;
  };
  return `## Programs P0–P11 (top level)

| Program | Title | Status | Slices implemented | Features | Next slice |
| --- | --- | --- | --- | --- | --- |
${top.join('\n')}

> ${gov.noNewTopLevelMilestones}

## Future programs (legacy P12–P23, consolidated)

| Program | Title | Legacy milestones | Legacy issues | Status | Features | Next slice |
| --- | --- | --- | --- | --- | --- | --- |
${futureTop.join('\n')}

Legacy traceability: legacy issue → feature (\`sourceIssue\`) → program (\`parent\`) → future slice (\`slice\`).

## Feature registry summary

| Status | Features |
| --- | --- |
${statusOrder.map((status) => `| ${status} | ${featureCounts[status] ?? 0} |`).join('\n')}
| **total** | **${features.length}** |

Relevance: ${Object.entries(countBy(features, 'relevance')).map(([r, n]) => `${r} ${n}`).join(', ')}.

## Governance rules

- **Intake flow:** ${gov.intakeFlow.join(' → ')}.
- **Completion:** ${gov.completionRule}
${gov.deliveryModel ? `- **Delivery model (${gov.deliveryModel.decision}):** Slice = ${gov.deliveryModel.slice}, Task = ${gov.deliveryModel.task}, PR = ${gov.deliveryModel.pr}. ${gov.deliveryModel.invariant} Slice completion gate: ${gov.deliveryModel.completionGate.map((g, i) => `(${i + 1}) ${g}`).join('; ')}.\n` : ''}- **Slice naming:** ${Object.entries(gov.sliceNaming).map(([k, v]) => `${k}: ${v}`).join('; ')}.
- **Status vocabulary:** ${gov.statusVocabulary.map((s) => `\`${s}\``).join(', ')}. **Relevance:** ${gov.relevanceVocabulary.map((s) => `\`${s}\``).join(', ')}.
- **Invariants:** ${gov.invariants.join('; ')}.
- **Pointer scope:** ${gov.pointerScope}
- **Branches:** ${gov.branchPolicy}
- **Runner protocol:** ${gov.runnerProtocol}

## Program detail

${programs.map(detail).join('\n\n')}

## Future program detail

${futures.map(detail).join('\n\n')}

## Governance items

${featureTable(byParent.get('GOVERNANCE') ?? [])}
`;
}
