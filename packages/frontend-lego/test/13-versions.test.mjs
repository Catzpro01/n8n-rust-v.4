/**
 * The one version vocabulary.
 *
 * Units, contracts and payloads must not disagree about what "compatible" means,
 * so there is exactly one implementation and this file proves it is the one in use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CHANGE_KINDS,
  COMPATIBILITY,
  RANGE_EXAMPLES,
  VersionError,
  bump,
  compareVersions,
  classifyChange,
  compatibilityOf,
  describeVersions,
  isRange,
  isVersion,
  majorOf,
  minorOf,
  parseVersion,
  sameMajor,
  satisfiesRange,
} from '../src/versions.mjs';
import { PACKAGE_ROOT } from '../src/manifests.mjs';
import { vocabularyOf } from '../src/vocabulary.mjs';
import { RANGE_EXAMPLES as SUBLEGO_RANGES, satisfies } from '../src/sublegos.mjs';

test('a version is three numbers and nothing else', () => {
  assert.equal(isVersion('1.2.3'), true);
  assert.equal(isVersion('1.2'), false);
  assert.equal(isVersion('v1.2.3'), false);
  assert.equal(isVersion('1.2.3-beta.1'), false, 'no pre-release vocabulary: it would have to be honoured everywhere');
  assert.equal(isVersion(null), false);
  assert.deepEqual(parseVersion('2.10.4'), { major: 2, minor: 10, patch: 4, raw: '2.10.4' });
  assert.equal(parseVersion('2.10'), null);
  assert.equal(majorOf('3.0.1'), 3);
  assert.equal(minorOf('3.4.1'), 4);
});

test('comparison is numeric, not lexical', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1, '10 is newer than 9, whatever the strings say');
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(sameMajor('1.2.3', '1.9.0'), true);
  assert.equal(sameMajor('1.2.3', '2.0.0'), false);
  assert.throws(() => compareVersions('1.2', '1.2.3'), (error) => {
    assert.ok(error instanceof VersionError);
    assert.equal(error.code, 'frontend.version.invalid');
    return true;
  });
});

test('ranges stay small and unambiguous', () => {
  assert.deepEqual(RANGE_EXAMPLES, ['1.x', '^1.0.0', '~1.2.0', '>=1.2.0 <2.0.0', '*']);
  for (const range of RANGE_EXAMPLES) assert.equal(isRange(range), true, `${range} is a declared shape`);
  assert.equal(satisfiesRange('1.4.0', '^1.0.0'), true);
  assert.equal(satisfiesRange('2.0.0', '^1.0.0'), false);
  assert.equal(satisfiesRange('1.2.9', '~1.2.0'), true);
  assert.equal(satisfiesRange('1.3.0', '~1.2.0'), false);
  assert.equal(satisfiesRange('1.5.0', '>=1.2.0 <2.0.0'), true);
  assert.equal(satisfiesRange('2.0.0', '>=1.2.0 <2.0.0'), false);
  assert.equal(satisfiesRange('9.9.9', '*'), true);
  assert.equal(satisfiesRange('nonsense', '*'), false);
});

test('compatibility speaks the canonical change kinds, never a second dialect', () => {
  const same = compatibilityOf('1.0.0', '1.0.0');
  assert.equal(same.kind, 'unchanged');
  assert.equal(same.satisfied, true);
  assert.deepEqual(compatibilityOf('1.0.0', '1.0.0').kind, classifyChange('1.0.0', '1.0.0').kind);

  const additive = compatibilityOf('1.0.0', '1.4.0');
  assert.equal(additive.kind, 'compatible');
  assert.equal(additive.move, 'minor');
  assert.equal(additive.satisfied, true, 'a provider ahead on the minor is compatible');

  const behind = compatibilityOf('1.4.0', '1.2.0');
  assert.equal(behind.kind, 'downgrade');
  assert.equal(behind.satisfied, false, 'a downgrade never satisfies a requirement');

  const breaking = compatibilityOf('1.9.0', '2.0.0');
  assert.equal(breaking.kind, 'breaking');
  assert.equal(breaking.move, 'major');
  assert.equal(breaking.satisfied, false);

  const migration = compatibilityOf('1.0.0', '1.1.0', { migrations: ['1.1.0'] });
  assert.equal(migration.kind, 'migration-required');
  assert.equal(compatibilityOf('0.2.0', '0.3.0').kind, 'breaking', '0.x is provisional: a minor may break');

  const invalid = compatibilityOf('1.0', '1.0.0');
  assert.equal(invalid.kind, 'invalid');
  assert.equal(invalid.satisfied, false, 'a requirement nobody can compare is not satisfied');
  assert.equal(invalid.comparable, false);
  assert.deepEqual(COMPATIBILITY, ['unchanged', 'compatible', 'migration-required', 'breaking', 'downgrade', 'invalid']);
  assert.deepEqual(CHANGE_KINDS, ['unchanged', 'compatible', 'migration-required', 'breaking', 'downgrade']);
  // The change kinds are quoted from the backend foundation, not invented here.
  assert.deepEqual(vocabularyOf('changeKind').values, CHANGE_KINDS);
});

test('bump moves one part and resets the ones below it', () => {
  assert.equal(bump('1.2.3'), '1.2.4');
  assert.equal(bump('1.2.3', 'minor'), '1.3.0');
  assert.equal(bump('1.2.3', 'major'), '2.0.0');
  assert.throws(() => bump('1.2.3', 'epoch'), /not a version part/);
});

test('there is exactly one implementation of the range rules in the package', () => {
  const sublegos = readFileSync(join(PACKAGE_ROOT, 'src', 'sublegos.mjs'), 'utf8');
  const registry = readFileSync(join(PACKAGE_ROOT, 'src', 'registry.mjs'), 'utf8');
  const boot = readFileSync(join(PACKAGE_ROOT, 'src', 'boot.mjs'), 'utf8');
  // The rules live in versions.mjs; sublegos delegates and keeps the public name.
  assert.equal(/function compare\(/.test(sublegos), false, 'the local comparison helper is gone');
  assert.match(sublegos, /satisfiesRange\(version, range\)/, 'sublegos delegates to the shared vocabulary');
  assert.equal(/const SEMVER_PATTERN =/.test(sublegos), false, 'no second SEMVER pattern');
  assert.equal(/const RANGE_PATTERN =/.test(sublegos), false, 'no second RANGE pattern');
  for (const source of [registry, boot]) {
    // A module that compares a major by hand is a second answer waiting to drift.
    assert.equal(/\.split\('\.'\)\[0\][^\n]*===/.test(source), false, 'no hand-rolled major comparison');
  }
  // The public name still behaves exactly as before, so existing declarations hold.
  assert.deepEqual(SUBLEGO_RANGES, RANGE_EXAMPLES);
  for (const [version, range] of [['1.4.0', '^1.0.0'], ['2.0.0', '^1.0.0'], ['1.2.3', '1.2.x'], ['0.9.0', '>=1.0.0']]) {
    assert.equal(satisfies(version, range), satisfiesRange(version, range), `${version} in ${range}`);
  }
});

test('the vocabulary is published as data', () => {
  const model = describeVersions();
  assert.equal(model.rangeExamples.length, 5);
  assert.deepEqual(model.compatibility, COMPATIBILITY);
  assert.deepEqual(model.changeKinds, CHANGE_KINDS);
  assert.deepEqual(model.moves, ['none', 'patch', 'minor', 'major']);
  assert.match(model.rules.join(' '), /major difference is never compatible/);
  assert.ok(isRange('~1.2.0'));
  assert.equal(isRange('~1.2'), false, 'a partial range is not one of the declared shapes');
});
