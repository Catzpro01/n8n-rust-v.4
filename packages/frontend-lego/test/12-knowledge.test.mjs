/**
 * The `.ai/` knowledge pack: it must be true, small, and retrievable by level.
 *
 * A pack that rots is worse than no pack — it teaches an agent something that is
 * no longer so. These tests compare the pack against the manifests it summarizes,
 * enforce the size budgets that keep it from becoming a prompt document, and check
 * that every path it references exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  CONTEXT_LEVELS,
  PACK_ROOT,
  REFERENCE_FILES,
  TASK_INDEX,
  contextFor,
  describePack,
  packFiles,
} from '../src/knowledge.mjs';
import { PACKAGE_ROOT, loadManifests } from '../src/manifests.mjs';

const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');
const size = (relative) => statSync(join(REPO_ROOT, relative)).size;

test('every file the pack references exists — a dangling pointer is a broken pack', () => {
  for (const file of packFiles()) {
    assert.ok(size(file) > 0, `${file} exists and is not empty`);
  }
  assert.ok(REPO_ROOT.endsWith('n8n-rust-v.4'), 'the pack is read from the repository root');
  assert.ok(read(`${PACK_ROOT}/README.md`).includes('Context levels'), 'the entry point explains the ladder');
});

test('no file exceeds its budget: the pack stays retrievable, not readable-in-full', () => {
  for (const level of CONTEXT_LEVELS) {
    for (const file of level.files) {
      assert.ok(size(file) <= level.maxBytes, `${level.id} file ${file} is ${size(file)} B (budget ${level.maxBytes} B)`);
    }
  }
  const total = packFiles().reduce((sum, file) => sum + size(file), 0);
  assert.ok(total <= 80 * 1024, `the whole pack is ${total} B — it must stay under 80 KB`);
  assert.equal(CONTEXT_LEVELS.length, 5, 'L0 to L4, one purpose each');
});

test('the level ladder is ordered and each level answers one question', () => {
  assert.deepEqual(CONTEXT_LEVELS.map((level) => level.id), ['L0', 'L1', 'L2', 'L3', 'L4']);
  for (const level of CONTEXT_LEVELS) {
    assert.ok(level.files.length > 0 || level.id === 'L4', `${level.id} points at a file (L4 is source by definition)`);
    assert.ok(level.answers.length > 10);
  }
  assert.match(read(`${PACK_ROOT}/README.md`), /\| \*\*L0\*\* \|/, 'the README carries the table');
});

test('a task retrieves a small, specific set — and never the whole pack', () => {
  const upgrading = contextFor({ kind: 'upgrade-unit' });
  assert.equal(upgrading.level, 'L3');
  assert.match(upgrading.recipe, /R4/);
  assert.deepEqual(upgrading.files, ['.ai/constitution.md', '.ai/cards/recipes.md', '.ai/index/units.json']);
  assert.ok(upgrading.files.length < packFiles().length, 'a task never loads everything');

  const unknown = contextFor({ kind: 'something-nobody-planned' });
  assert.equal(unknown.known, false);
  assert.equal(unknown.level, 'L1');
  assert.match(unknown.advice, /No recipe matches/);
  assert.equal(unknown.files.includes('.ai/cards/recipes.md'), false, 'an unknown task does not get the recipe list');

  const contractTask = contextFor({ kind: 'change-contract', contract: 'contracts/settings.contract.md' });
  assert.ok(contractTask.files.includes('contracts/settings.contract.md'), 'the named contract joins the set');
  assert.ok(CONTEXT_LEVELS[0].files.every((file) => contractTask.files.includes(file)), 'L0 is always loaded');
  assert.deepEqual(Object.keys(TASK_INDEX).includes('unknown'), true);
  assert.equal(describePack().tasks.length, Object.keys(TASK_INDEX).length);
});

test('the unit index matches the sub-LEGO manifest, unit for unit', () => {
  const manifests = loadManifests();
  const index = JSON.parse(read(REFERENCE_FILES.units));
  assert.equal(index.units.length, manifests.subLegos.length, 'no unit is missing from the pack');
  assert.equal(index.maxDepth, 2);
  const byId = new Map(index.units.map((entry) => [entry.id, entry]));
  for (const unit of manifests.subLegos) {
    const entry = byId.get(unit.id);
    assert.ok(entry, `${unit.id} is in the pack`);
    assert.equal(entry.parentId ?? null, unit.parentId ?? null, `${unit.id} parent`);
    assert.equal(entry.owner, unit.owner, `${unit.id} owner`);
    assert.equal(entry.version, unit.version, `${unit.id} version`);
    assert.deepEqual(entry.ports, unit.public.ports, `${unit.id} ports`);
    assert.deepEqual(entry.tests, unit.tests, `${unit.id} tests`);
    assert.equal(entry.trust, unit.trust ?? 'feature', `${unit.id} trust`);
    assert.equal(entry.criticality, unit.criticality ?? 'optional', `${unit.id} criticality`);
    assert.equal(entry.lifecycle, unit.lifecycle ?? 'available', `${unit.id} lifecycle`);
  }
  assert.deepEqual(index.counts, {
    units: manifests.subLegos.length,
    roots: manifests.subLegos.filter((unit) => (unit.parentId ?? null) === null).length,
    ports: manifests.subLegos.reduce((sum, unit) => sum + unit.public.ports.length, 0),
    dependencies: manifests.subLegos.reduce((sum, unit) => sum + (unit.dependsOn?.length ?? 0), 0),
    owners: new Set(manifests.subLegos.map((unit) => unit.owner)).size,
  });
});

test('the capability index matches the declared catalog, and claims nothing installed', () => {
  const manifests = loadManifests();
  const index = JSON.parse(read(REFERENCE_FILES.capabilities));
  assert.equal(index.declared.length, manifests.capabilities.length);
  for (const declaration of manifests.capabilities) {
    const entry = index.declared.find((value) => value.id === declaration.id);
    assert.ok(entry, `${declaration.id} is indexed`);
    assert.equal(entry.activation, declaration.activation);
    assert.equal(entry.criticality, declaration.criticality);
    assert.equal(entry.trust, declaration.trust);
    assert.equal(entry.lifecycle, declaration.lifecycle);
    assert.deepEqual(entry.surfaces, declaration.surfaces);
    assert.equal(entry.installed, false, `${declaration.id} is declared, not installed`);
  }
  assert.deepEqual(index.registered, [], 'nothing is registered at boot');
  assert.deepEqual(index.vocabularies.lifecycle, ['available', 'installed', 'loaded', 'active', 'idle', 'unloaded', 'disabled']);
  assert.deepEqual(index.vocabularies.trust, ['core', 'feature', 'extension', 'untrusted']);
  assert.deepEqual(index.vocabularies.criticality, ['core', 'optional', 'enhancement']);
});

test('the contract index names real files and real owners', () => {
  const index = JSON.parse(read(REFERENCE_FILES.contracts));
  const roles = new Set(['own', 'foreign', 'planned', 'legacy']);
  for (const entry of index.contracts) {
    assert.ok(roles.has(entry.role), `${entry.path} has a known role (${entry.role})`);
    assert.ok(size(entry.path) > 0, `${entry.path} exists on disk`);
    assert.equal(typeof entry.owner, 'string');
    assert.ok(entry.owner.length > 0, `${entry.path} names an owner`);
  }
  const own = index.contracts.filter((entry) => entry.role === 'own').map((entry) => entry.path);
  assert.deepEqual(own, ['contracts/frontend.contract.md', 'contracts/frontend-sub-lego.contract.md']);
  const legacy = index.contracts.find((entry) => entry.role === 'legacy');
  assert.equal(legacy.path, 'contracts/micro-frontend.contract.md');
  assert.match(index.rules.join(' '), /superseded/);
});

test('the pack never carries implementation, and the runtime never carries the pack', () => {
  for (const file of packFiles().filter((value) => value.endsWith('.json'))) {
    const text = read(file);
    assert.equal(text.includes('function'), false, `${file} carries no code`);
    assert.equal(/(^|[^a-z])require\(/.test(text), false, `${file} carries no module loading`);
  }
  // The knowledge module is data + a lookup: it must not read the filesystem, or the
  // browser could end up paying for the pack.
  const source = read('packages/frontend-lego/src/knowledge.mjs');
  assert.equal(source.includes("node:fs"), false);
  assert.equal(source.includes('readFileSync'), false);
  const manifestSource = read('packages/frontend-lego/src/manifests.mjs');
  assert.ok(manifestSource.includes('node:fs'), 'loading catalogs stays in the one Node-only module');
});

test('the constitution keeps the hard stops an agent must not talk itself out of', () => {
  const constitution = read(`${PACK_ROOT}/constitution.md`);
  for (const rule of [
    /Rust is LOCKED/,
    /no React, no Svelte, no Web\s+Components/i,
    /No HTTP between local LEGO/,
    /Never push to `main`/,
    /agent-05/,
    /declared ≠ installed ≠ loaded ≠ active|Declared ≠ installed/i,
  ]) {
    assert.match(constitution, rule, `the constitution states ${rule}`);
  }
  const decisions = read(REFERENCE_FILES.decisions);
  assert.match(decisions, /D22 —/, 'the superseded micro-frontend decision is recorded');
  assert.match(read(REFERENCE_FILES.dependencies), /micro-frontend\.contract\.md/);
});
