/**
 * Architecture rules as data: the contract document, the code and the tests must
 * agree. A rule that only exists in prose is a rule that will drift.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ARCHITECTURE_RULES,
  CONFORMANCE_STATES,
  checkConformance,
  describeConformance,
  ruleById,
  ruleIds,
} from '../src/conformance.mjs';
import { PACKAGE_ROOT } from '../src/manifests.mjs';
import { createFrontendLego } from '../src/lego.mjs';

const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const TEST_DIR = join(PACKAGE_ROOT, 'test');
const CONTRACT = readFileSync(join(REPO_ROOT, 'contracts', 'frontend.contract.md'), 'utf8');

test('each rule carries an id, a statement, a vocabulary and the suite that proves it', () => {
  assert.deepEqual(ruleIds()[0], 'A1');
  assert.equal(new Set(ruleIds()).size, ARCHITECTURE_RULES.length, 'rule ids are unique');
  for (const rule of ARCHITECTURE_RULES) {
    assert.match(rule.id, /^A\d+$/);
    assert.ok(rule.statement.length > 30, `${rule.id} states something`);
    assert.ok(Array.isArray(rule.vocabulary) && rule.vocabulary.length > 0, `${rule.id} names its vocabulary`);
    assert.ok(existsSync(join(TEST_DIR, rule.enforcedBy)), `${rule.id} → ${rule.enforcedBy} exists`);
    assert.match(rule.contract, /^§\d+/);
    assert.equal(ruleById(rule.id), rule);
  }
  assert.equal(ruleById('A999'), null);
  const described = describeConformance();
  assert.deepEqual(described.states, CONFORMANCE_STATES);
  assert.equal(described.rules.length, ARCHITECTURE_RULES.length);
  assert.match(described.rule, /prose that disagrees is a defect in the prose/);
});

test('the contract document cites every rule the code declares', () => {
  for (const rule of ARCHITECTURE_RULES) {
    assert.ok(CONTRACT.includes(rule.id), `contracts/frontend.contract.md mentions ${rule.id}`);
  }
  // The rules block is machine-readable too: a JSON fence carries the same ids.
  const block = CONTRACT.split('```json').map((part) => part.split('```')[0]).find((part) => part.includes('"A1"'));
  assert.ok(block, 'the contract carries a JSON rule block');
  const parsed = JSON.parse(block.slice(block.indexOf('[')));
  assert.deepEqual(parsed.map((rule) => rule.id), ruleIds());
});

test('a live assembly passes every check, and each check names its rule', () => {
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  const result = frontend.conformance();
  assert.equal(result.ok, true, JSON.stringify(result.checks.filter((check) => check.state === 'fail')));
  assert.equal(result.rules, ARCHITECTURE_RULES.length);
  assert.equal(result.checks.length, ARCHITECTURE_RULES.length);
  assert.deepEqual([...new Set(result.checks.map((check) => check.ruleId))].sort(), [...ruleIds()].sort());
  for (const check of result.checks) assert.equal(check.state, 'pass', `${check.ruleId}: ${check.detail}`);
});

test('the checker fails closed: something that is not an assembly is rejected, not guessed', () => {
  assert.equal(checkConformance(null).ok, false);
  assert.equal(checkConformance({}).ok, false);
  assert.equal(checkConformance({}).checks[0].ruleId, null);
  const frontend = createFrontendLego({ app: { name: 'n8n-lego', version: '0.1.0' } });
  assert.equal(frontend.conformance().ok, true, 'and a real assembly still passes');
});

test('the conformance module declares its own dependency direction honestly', () => {
  const source = readFileSync(join(PACKAGE_ROOT, 'src', 'conformance.mjs'), 'utf8');
  const imports = [...source.matchAll(/from '\.\/([\w-]+)\.mjs'/g)].map((match) => match[1]).sort();
  assert.ok(imports.length >= 10, 'it reads the vocabularies it checks');
  for (const name of ['lego', 'adapters/index', 'client']) {
    assert.equal(imports.includes(name), false, `conformance must not depend on ${name}`);
  }
  assert.equal(/from 'node:/.test(source), false, 'and it stays browser-safe');
});
