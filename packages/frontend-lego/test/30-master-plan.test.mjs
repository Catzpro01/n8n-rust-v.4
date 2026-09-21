/**
 * The master project specification (`.ai/master/`): it must exist, stay readable, and be
 * reachable on purpose without being paid for by every task.
 *
 * The pack is retrieval context and is budget-enforced; the master set is the durable project
 * memory. These tests keep the two separate (no master document enters `packFiles()`), keep the
 * specification small enough to be read (per file and in total), and check that its claims are
 * wired to something: every document is reachable through `PRODUCT_TASK_INDEX`, all fifteen
 * official AI/Agent LEGO are represented, and every decision id a document names exists in the
 * recorded decision file. A specification that invents a decision id is a specification that
 * invents vocabulary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PACKAGE_ROOT } from '../src/manifests.mjs';
import {
  MASTER_PLAN_BUDGET,
  MASTER_PLAN_FILES,
  MASTER_PLAN_MAX_FILE,
  PRODUCT_TASK_INDEX,
  masterPlanFiles,
  packFiles,
  productContextFor,
} from '../src/knowledge.mjs';

const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');
const size = (relative) => statSync(join(REPO_ROOT, relative)).size;

const MASTER = masterPlanFiles();
const DECISIONS = JSON.parse(read('docs/n8n-lego/decisions/cross-agent-decisions.json'));

/** The fifteen official AI/Agent LEGO, by the names the plan uses for them. */
const OFFICIAL_LEGO = [
  'AI Foundation', 'Skill', 'Agent Machine', 'Memory', 'Workspace', 'Context & Session',
  'Universal Translation', 'Node Creator', 'Capability', 'MCP Adapter', 'Runtime Adapter',
  'Artifact', 'Approval', 'Agent Event & Work Trace', 'Token & Usage',
];

const allDocs = () => MASTER.map((file) => ({ file, body: read(file) }));

test('every master document exists, is a document, and can be read on its own', () => {
  assert.equal(MASTER.length, Object.keys(MASTER_PLAN_FILES).length);
  assert.ok(MASTER.length >= 20, `${MASTER.length} master documents`);
  for (const file of MASTER) {
    assert.ok(file.startsWith('.ai/master/'), `${file} lives in the master area`);
    assert.ok(existsSync(join(REPO_ROOT, file)), `${file} exists`);
    const body = read(file);
    // A curated view may open with a provenance comment and a "this is not the canonical
    // document" callout before its title. Strip only those two shapes -- an HTML comment and a
    // leading blockquote -- and the first line must still be the title.
    const titled = body.replace(/^<!--[\s\S]*?-->\s*/, '').replace(/^(?:>[^\n]*\n)+\s*/, '');
    assert.match(titled, /^# /, `${file} opens with a title`);
    assert.match(body, /\*\*(Status|The|Canonical)/, `${file} says what it is`);
    assert.ok(size(file) > 1500, `${file} says something (${size(file)} B)`);
  }
});

test('the specification is budgeted: 256 KB in total, 32 KB per document', () => {
  const total = MASTER.reduce((sum, file) => sum + size(file), 0);
  assert.ok(total <= MASTER_PLAN_BUDGET, `the master set is ${total} B — budget ${MASTER_PLAN_BUDGET} B`);
  for (const file of MASTER) {
    const bytes = size(file);
    assert.ok(bytes <= MASTER_PLAN_MAX_FILE, `${file} is ${bytes} B — max ${MASTER_PLAN_MAX_FILE} B`);
  }
  assert.ok(total > 40 * 1024, `the set is a specification, not a placeholder (${total} B)`);
});

test('the specification is not retrieval context: it never enters the pack', () => {
  const pack = packFiles();
  for (const file of MASTER) {
    assert.equal(pack.includes(file), false, `${file} is loaded on purpose, not by default`);
  }
  assert.ok(pack.every((file) => !file.startsWith('.ai/master/')), 'no master document is in the pack');
  assert.ok(pack.some((file) => file.startsWith('.ai/frontend/')), 'the pack still has its own levels');
});

test('every product task resolves to a master document, and the fallback is declared', () => {
  const seen = new Set();
  for (const kind of Object.keys(PRODUCT_TASK_INDEX)) {
    const resolved = productContextFor({ kind });
    assert.equal(resolved.kind, kind, `${kind} resolves to itself`);
    assert.ok(resolved.question.endsWith('?'), `${kind} asks a question`);
    assert.ok(resolved.files.length >= 1, `${kind} names at least one document`);
    assert.equal(resolved.budget, MASTER_PLAN_BUDGET, `${kind} reports the master budget`);
    for (const file of resolved.files) {
      assert.ok(MASTER.includes(file), `${kind} resolves to a master document (${file})`);
      seen.add(file);
    }
  }
  for (const file of MASTER) {
    assert.ok(seen.has(file), `${file} is reachable from some product task`);
  }
  // An unknown kind is not a crash and not a guess: it falls back to the project entry.
  const unknown = productContextFor({ kind: 'ai-everything' });
  assert.equal(unknown.kind, 'project', 'an unknown task fails closed to the project entry');
  assert.deepEqual(unknown.files, productContextFor({ kind: 'project' }).files);
});

test('all fifteen official AI/Agent LEGO are represented, with their publication state', () => {
  const legoDoc = read(MASTER_PLAN_FILES.aiLego);
  for (const lego of OFFICIAL_LEGO) {
    assert.ok(legoDoc.includes(lego), `the AI/Agent plan represents ${lego}`);
  }
  assert.match(legoDoc, /publicationPending/, 'unpublished LEGO are marked, not invented');
  assert.match(legoDoc, /contract-only/, 'a contract-only LEGO says so');
  for (const id of ['XA-11', 'XA-12', 'XA-13', 'XA-14', 'XA-15', 'XA-16', 'XA-17']) {
    assert.ok(legoDoc.includes(id), `${id} is named in the AI/Agent plan`);
  }
  // The two worlds are separate, and the workforce document says so.
  const workforce = read(MASTER_PLAN_FILES.workforce);
  assert.match(workforce, /Product\/runtime agents|product\/runtime/i, 'product agents are defined');
  assert.match(workforce, /Development workforce agents|development workforce/i, 'workforce agents are defined');
  assert.match(workforce, /source of truth/i, 'the source of truth is stated');
});

test('the one foundation, three experiences rule is documented', () => {
  const experience = read(MASTER_PLAN_FILES.experience);
  for (const entry of ['AI Assistant', 'AI Copilot', 'AI Node', 'AI status bar']) {
    assert.ok(experience.includes(entry), `the master plan describes ${entry}`);
  }
  assert.match(experience, /Execution AI/, 'Execution AI is described');
  assert.match(experience, /a Copilot mode, not an experience of its own|Copilot mode/, 'Execution AI is a Copilot mode');
  assert.match(experience, /Never a permanent panel|never a permanent panel/, 'panels are not permanent');
});

test('progressive disclosure says what is never rendered, at any level', () => {
  const disclosure = read(MASTER_PLAN_FILES.disclosure);
  for (const forbidden of ['chain-of-thought', 'credentials', 'the complete memory store', 'every MCP tool of every server']) {
    assert.ok(disclosure.includes(forbidden), `the disclosure rules forbid ${forbidden}`);
  }
  for (const level of ['**L0**', '**L1**', '**L2**', '**L3**', '**L4**']) {
    assert.ok(disclosure.includes(level), `${level} is defined`);
  }
  assert.match(disclosure, /Default state is L0 \+ L1/, 'the default is shallow disclosure');
});

test('the state contract covers every surface state the brief names', () => {
  const states = read(MASTER_PLAN_FILES.states);
  for (const state of ['empty', 'loading', 'error', 'unavailable', 'degraded', 'permission-denied', 'approval-required', 'responsive', 'accessibility']) {
    assert.ok(states.includes('`' + state + '`'), `the ${state} state is defined`);
  }
  assert.match(states, /Every surface renders all ten states/, 'coverage is the rule, not the hope');
  for (const outcome of ['capability-unavailable', 'operation-unpublished', 'version-incompatible', 'migration-required', 'feature-unsupported']) {
    assert.ok(states.includes(outcome), `${outcome} stays distinguishable`);
  }
});

test('localization and accessibility cover the declared locale set', () => {
  const accessibility = read(MASTER_PLAN_FILES.accessibility);
  for (const locale of ['`id`', '`en`', '`ar`', '`zh`', '`ru`', '`jv`']) {
    assert.ok(accessibility.includes(locale), `${locale} is covered`);
  }
  assert.match(accessibility, /RTL/, 'the right-to-left locale is handled');
  assert.match(accessibility, /never colour-only|colour alone/, 'status never depends on colour');
  assert.match(accessibility, /keyboard/i, 'keyboard reachability is specified');
});

test('the contract matrix consumes declarations and never inspects an implementation', () => {
  const matrix = read(MASTER_PLAN_FILES.matrix);
  assert.match(matrix, /publicationPending/, 'unpublished concepts are marked, not invented');
  assert.match(matrix, /Presentation names vs backend vocabulary/, 'presentation names are separated from backend vocabulary');
  assert.match(matrix, /silent alias/, 'presentation names are never silent aliases');
  for (const decision of ['XA-11', 'XA-12', 'XA-13', 'XA-14', 'XA-15', 'XA-16', 'XA-17']) {
    assert.ok(matrix.includes(decision), `${decision} is recorded in the matrix`);
  }
});

test('the project documents state the current, corrected architecture facts', () => {
  const project = read(MASTER_PLAN_FILES.project);
  const coreLego = read(MASTER_PLAN_FILES.coreLego);
  const status = read(MASTER_PLAN_FILES.status);
  const blockers = read(MASTER_PLAN_FILES.blockers);
  assert.match(project, /26 current core LEGO domains|26\*\* core LEGO domains|26 current core LEGO/, 'the domain count is 26');
  assert.match(coreLego, /nested LEGO|Nested LEGO/, 'nested LEGO is defined');
  assert.match(coreLego, /legacy-rest/, 'the legacy boundary is named');
  assert.match(status, /cb71dbb201d635b15b49933764c2c2336e745809/, 'the protected main baseline is named');
  assert.match(status, /6f7b66da/, 'the backend baseline is named');
  assert.match(status, /NOT READY/, 'scale-out readiness is stated honestly');
  assert.match(blockers, /Scale-out: \*\*NOT READY\*\*|NOT READY/, 'the blockers start with scale-out');
  assert.match(blockers, /newExecutionId|store\.mjs/, 'the scale-out blocker cites its evidence');
  for (const id of ['B-1', 'B-2', 'B-3', 'B-10', 'B-12']) {
    assert.ok(blockers.includes(id), `${id} is recorded`);
  }
});

test('the decisions record separates what is settled from what is open', () => {
  const decisions = read(MASTER_PLAN_FILES.decisions);
  assert.match(decisions, /Universal Translation is an official LEGO target/, 'the translation decision is recorded');
  for (const area of ['Translation', 'Workspace', 'Capability', 'Agent Machine', 'GitHub']) {
    assert.ok(decisions.includes(area), `${area} appears in the decision record`);
  }
  assert.match(decisions, /never be reopened silently|never deleted|Superseding a row is allowed/, 'superseding rules are stated');
  assert.match(decisions, /cross-agent-decisions\.json/, 'the machine-readable register is named');
});

test('the phases, the provider taxonomy and the scenarios are specified', () => {
  const phases = read(MASTER_PLAN_FILES.phases);
  for (const phase of ['**0**', '**1**', '**2**', '**3**', '**5**', '**8**', '**10**', '**11**']) {
    assert.ok(phases.includes(phase), `phase ${phase} is specified`);
  }
  assert.match(phases, /architecture first -> contract second -> test third|Architecture first/, 'the order of work is stated');
  const providers = read(MASTER_PLAN_FILES.providers);
  for (const kind of ['model-provider', 'tool-provider', 'application-provider', 'agent-runtime', 'simulation-runtime']) {
    assert.ok(providers.includes(kind), `${kind} is in the taxonomy`);
  }
  const scenarios = read(MASTER_PLAN_FILES.scenarios);
  const numbered = scenarios.match(/^## \d+\./gm) ?? [];
  assert.ok(numbered.length >= 7, `${numbered.length} reference scenarios are documented`);
  assert.match(scenarios, /contract-compatible with the\s+general Agent Machine/, 'scenarios stay contract-compatible');
});

test('the security model forbids chain-of-thought and unrestrained actions', () => {
  const security = read(MASTER_PLAN_FILES.security);
  assert.match(security, /chain-of-thought/i, 'reasoning storage is forbidden');
  assert.match(security, /Nesting does not grant authority/, 'authority is not inherited');
  assert.match(security, /fail(s)? closed/i, 'unknowns fail closed');
  assert.match(security, /No unrestricted host access|workspace boundary is mandatory/i, 'host access is bounded');
  const workspace = read(MASTER_PLAN_FILES.workspace);
  assert.match(workspace, /scope/i, 'the action scope is documented');
  assert.match(workspace, /must not|never/i, 'the non-goals are stated');
});

test('the context/session/token documents carry the invariant and the honesty rules', () => {
  const context = read(MASTER_PLAN_FILES.context);
  assert.match(context, /Conversation  !=  Session|Conversation\s+!=\s+Session/, 'the separation invariant is stated');
  assert.match(context, /Memory survives context replacement/, 'memory is not the window');
  for (const state of ['NORMAL', 'PREPARE', 'ROLLOVER']) {
    assert.ok(context.includes(state), `the ${state} rollover state is documented`);
  }
  const tokens = read(MASTER_PLAN_FILES.tokens);
  assert.match(tokens, /reported/, 'reported usage is named');
  assert.match(tokens, /estimated/, 'estimated usage is named');
  assert.match(tokens, /never fabricate|not shown at all|fabricated number/, 'fabrication is forbidden');
});

test('the reader test exists: thirty questions, each pointing at a document that is here', () => {
  const project = read(MASTER_PLAN_FILES.project);
  const start = project.indexOf('## 11. Reading test');
  assert.ok(start > 0, 'the master plan carries the reading test');
  const section = project.slice(start, project.indexOf('## See also', start));
  const rows = [...section.matchAll(/^\| (\d+) \| (.+?) \| (.+?) \|$/gm)];
  assert.ok(rows.length >= 30, `the reading test lists ${rows.length} questions`);
  assert.deepEqual(
    rows.map((row) => Number(row[1])),
    rows.map((_, index) => index + 1),
    'the questions are numbered 1..N with no gap',
  );
  for (const [, number, question, target] of rows) {
    assert.match(question.trim(), /\?$/, `question ${number} is a question`);
    const files = [...target.matchAll(/`([^`]+)`/g)]
      .map((match) => /([A-Z0-9_]+\.md)/.exec(match[1]))
      .filter(Boolean)
      .map((match) => match[1]);
    assert.ok(files.length >= 1, `question ${number} points at a document`);
    for (const file of files) {
      assert.ok(MASTER.some((candidate) => candidate.endsWith('/' + file)), `question ${number} points at ${file}, which exists`);
    }
  }
  const addressed = new Set();
  for (const { body } of allDocs()) {
    for (const match of body.matchAll(/XA-\d+/g)) addressed.add(match[0]);
  }
  assert.ok(addressed.size >= 17, `${addressed.size} decision ids are named across the specification`);
});

test('no master document repeats a retired count or restates generated data as its own source', () => {
  for (const { file, body } of allDocs()) {
    assert.equal(/\b25\s+(core\s+)?(LEGO\s+)?domains?\b/i.test(body), false, `${file} does not claim 25 domains`);
    assert.equal(/\b25\s+core\s+LEGO\b/i.test(body), false, `${file} does not claim 25 core LEGO`);
  }
  const project = read(MASTER_PLAN_FILES.project);
  assert.match(project, /projection, not a source/, 'the domain table says it is a projection');
  assert.match(project, /domains\.json/, 'and names the registry it projects');
  const status = read(MASTER_PLAN_FILES.status);
  assert.match(status, /registry wins/, 'the status document submits to the registry');
});

test('every document is cross-referenced, and every decision it names is recorded', () => {
  for (const { file, body } of allDocs()) {
    const others = MASTER.filter((candidate) => candidate !== file)
      .filter((candidate) => body.includes(candidate.split('/').pop()));
    assert.ok(others.length >= 1, `${file} references at least one sibling document`);
  }
  const recorded = new Set(DECISIONS.decisions.map((decision) => decision.id));
  const named = new Set();
  for (const { body } of allDocs()) {
    for (const match of body.matchAll(/XA-\d+/g)) named.add(match[0]);
  }
  assert.ok(named.size >= 7, `${named.size} decision ids are named`);
  for (const id of named) {
    assert.ok(recorded.has(id), `${id} is named by the plan and exists in the decision record`);
  }
});
