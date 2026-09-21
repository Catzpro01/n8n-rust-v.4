/**
 * The one version vocabulary.
 *
 * Units, contracts and payloads all need the same three questions answered — is
 * this a version, which of two is newer, and does it satisfy a declared range —
 * so they are answered here once. Two implementations of "compatible" is how a
 * system ends up with two answers to the same question.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */

/** Contract and unit versions are `MAJOR.MINOR.PATCH`. No pre-release vocabulary. */
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/** Version ranges a unit may declare. Deliberately small and unambiguous. */
export const RANGE_PATTERN = /^(\*|x|\d+\.(x|\*|\d+)(\.(x|\*|\d+))?|[\^~]\d+\.\d+\.\d+|[<>]=?\d+\.\d+\.\d+)(\s+[<>]=?\d+\.\d+\.\d+)?$/;

/** The range shapes the vocabulary allows, shown as data. */
export const RANGE_EXAMPLES = Object.freeze(['1.x', '^1.0.0', '~1.2.0', '>=1.2.0 <2.0.0', '*']);

/** How a consumer's required version relates to what a provider offers. */
export const COMPATIBILITY = Object.freeze(['compatible', 'minor-ahead', 'major-mismatch', 'invalid']);

export class VersionError extends Error {
  constructor(message, { value } = {}) {
    super(message);
    this.name = 'VersionError';
    this.code = 'frontend.version.invalid';
    this.value = value ?? null;
  }
}

export function isVersion(value) {
  return typeof value === 'string' && SEMVER_PATTERN.test(value);
}

export function isRange(value) {
  return typeof value === 'string' && RANGE_PATTERN.test(value.trim());
}

/** `1.2.3` -> `{ major: 1, minor: 2, patch: 3 }`; null when it is not a version. */
export function parseVersion(value) {
  if (!isVersion(value)) return null;
  const [major, minor, patch] = value.split('.').map(Number);
  return Object.freeze({ major, minor, patch, raw: value });
}

/** Numeric comparison. `-1` older, `0` equal, `1` newer. Throws on nonsense. */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a) throw new VersionError(`"${left}" is not a version`, { value: left });
  if (!b) throw new VersionError(`"${right}" is not a version`, { value: right });
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  return 0;
}

export function sameMajor(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  return Boolean(a && b && a.major === b.major);
}

export function majorOf(value) {
  return parseVersion(value)?.major ?? null;
}

export function minorOf(value) {
  return parseVersion(value)?.minor ?? null;
}

export function bump(version, part = 'patch') {
  const parsed = parseVersion(version);
  if (!parsed) throw new VersionError(`"${version}" is not a version`, { value: version });
  if (part === 'major') return `${parsed.major + 1}.0.0`;
  if (part === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`;
  if (part === 'patch') return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  throw new VersionError(`"${part}" is not a version part (major | minor | patch)`, { value: part });
}

/**
 * Evaluates a declared range against a concrete version.
 *
 * `^1.2.0` and `1.x` mean "same major"; `~1.2.0` and `1.2.x` mean "same minor";
 * `>=`/`<` compare directly. Anything else is not a range this vocabulary allows
 * and is rejected where it is declared.
 */
export function satisfiesRange(version, range) {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  const { major, minor, patch } = parsed;
  const spec = String(range ?? '').trim();
  if (spec === '' || spec === '*' || spec === 'x') return true;
  for (const clause of spec.split(/\s+/)) {
    let ok = false;
    if (clause.startsWith('^')) {
      ok = major === Number(clause.slice(1).split('.')[0]);
    } else if (clause.startsWith('~')) {
      const parts = clause.slice(1).split('.');
      ok = major === Number(parts[0]) && minor === Number(parts[1]);
    } else if (clause.startsWith('>=')) ok = compareVersions(version, clause.slice(2)) >= 0;
    else if (clause.startsWith('<=')) ok = compareVersions(version, clause.slice(2)) <= 0;
    else if (clause.startsWith('>')) ok = compareVersions(version, clause.slice(1)) > 0;
    else if (clause.startsWith('<')) ok = compareVersions(version, clause.slice(1)) < 0;
    else {
      const parts = clause.split('.');
      ok = Number(parts[0]) === major;
      if (ok && parts[1] !== undefined && !/^[x*]$/.test(parts[1])) ok = Number(parts[1]) === minor;
      if (ok && parts[2] !== undefined && !/^[x*]$/.test(parts[2])) ok = Number(parts[2]) === patch;
    }
    if (!ok) return false;
  }
  return true;
}

/**
 * How a consumer that requires `required` fares against a provider offering
 * `offered`. A major difference is never compatible; a provider ahead on the minor
 * is compatible (additive only) and is reported as such so a caller can decide
 * whether to require an upgrade.
 */
export function compatibilityOf(required, offered) {
  if (!isVersion(required) || !isVersion(offered)) {
    return Object.freeze({ state: 'invalid', detail: `not versions: required=${JSON.stringify(required)} offered=${JSON.stringify(offered)}` });
  }
  if (majorOf(required) !== majorOf(offered)) {
    return Object.freeze({ state: 'major-mismatch', detail: `required ${required}, offered ${offered} — different major version` });
  }
  const order = compareVersions(offered, required);
  if (order < 0) return Object.freeze({ state: 'minor-ahead', detail: `required ${required}, offered ${offered} — the provider is behind` });
  if (order === 0) return Object.freeze({ state: 'compatible', detail: `required ${required}, offered ${offered} — exact match` });
  return Object.freeze({ state: 'compatible', detail: `required ${required}, offered ${offered} — additive newer minor` });
}

/** The version vocabulary as data (docs, `.ai/` cards, tests). */
export function describeVersions() {
  return Object.freeze({
    pattern: SEMVER_PATTERN.source,
    rangePattern: RANGE_PATTERN.source,
    rangeExamples: RANGE_EXAMPLES,
    compatibility: COMPATIBILITY,
    rules: Object.freeze([
      'One vocabulary: units, contracts and payloads all compare versions with this module.',
      'A major difference is never compatible, in either direction.',
      'A provider ahead on the minor is compatible and reported as additive.',
      'Ranges are small on purpose: same-major, same-minor, and explicit bounds.',
    ]),
  });
}
