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

/**
 * How a version move is classified — quoted from the backend foundation
 * (`lego.contract-compat` v1.0.0, owner manager), never re-invented. One question,
 * one vocabulary: whether the consumer keeps working, must migrate, must change, is
 * being offered something older, or is asking about something unchanged.
 */
export const CHANGE_KINDS = Object.freeze(['unchanged', 'compatible', 'migration-required', 'breaking', 'downgrade']);

/** The change kinds plus `invalid`, which is the frontend's fail-closed answer for nonsense input. */
export const COMPATIBILITY = Object.freeze([...CHANGE_KINDS, 'invalid']);

/** The granular move, kept apart from the kind so `kind` keeps its canonical meaning. */
export const VERSION_MOVES = Object.freeze(['none', 'patch', 'minor', 'major']);

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
 * Classifies a version move with the canonical vocabulary — the same classifier the
 * backend foundation publishes, so "compatible" cannot mean two things. `migrations`
 * names versions that need a data/state migration even when they are semver
 * compatible; they are declared, never inferred.
 */
export function classifyChange(from, to, { migrations = [] } = {}) {
  if (!isVersion(from) || !isVersion(to)) {
    return Object.freeze({
      kind: 'invalid',
      move: 'none',
      satisfied: false,
      detail: `not versions: from=${JSON.stringify(from)} to=${JSON.stringify(to)}`,
    });
  }
  const a = parseVersion(from);
  const b = parseVersion(to);
  const move = a.major !== b.major ? 'major' : a.minor !== b.minor ? 'minor' : a.patch !== b.patch ? 'patch' : 'none';
  const order = compareVersions(to, from);
  if (order === 0) return Object.freeze({ kind: 'unchanged', move, satisfied: true, detail: `${from} → ${to}: same version` });
  if (order < 0) {
    return Object.freeze({ kind: 'downgrade', move, satisfied: false, detail: `${to} is older than ${from}; a downgrade is never automatic` });
  }
  if (b.major !== a.major) {
    return Object.freeze({ kind: 'breaking', move, satisfied: false, detail: `major ${a.major} → ${b.major}: consumers must be updated and sign off` });
  }
  if (a.major === 0 && b.minor !== a.minor) {
    return Object.freeze({ kind: 'breaking', move, satisfied: false, detail: `0.x contract: minor ${a.minor} → ${b.minor} may break; 0.x is provisional` });
  }
  const crossed = migrations.filter((version) => isVersion(version) && compareVersions(version, from) > 0 && compareVersions(version, to) <= 0);
  if (crossed.length > 0) {
    return Object.freeze({ kind: 'migration-required', move, satisfied: true, detail: `crosses declared migration point(s) ${crossed.join(', ')}` });
  }
  return Object.freeze({
    kind: 'compatible',
    move,
    satisfied: true,
    detail: b.minor !== a.minor ? `additive minor ${a.minor} → ${b.minor}` : `patch ${a.patch} → ${b.patch}`,
  });
}

/**
 * How a consumer that requires `required` fares against a provider offering
 * `offered`, in the same vocabulary. `satisfied` is the yes/no the UI needs; `kind`
 * is the canonical classification of the move — never a second dialect for it.
 * @param {{ migrations?: string[] }} [options] declared migration points
 */
export function compatibilityOf(required, offered, { migrations = [] } = {}) {
  const change = classifyChange(required, offered, { migrations });
  const satisfied = change.kind === 'unchanged' || change.kind === 'compatible' || change.kind === 'migration-required';
  return Object.freeze({
    kind: change.kind,
    move: change.move,
    satisfied,
    detail: `required ${required}, offered ${offered} — ${change.detail}`,
    /** Deterministic: a requirement nobody can compare is not satisfied. */
    comparable: change.kind !== 'invalid',
  });
}

/** The version vocabulary as data (docs, `.ai/` cards, tests). */
export function describeVersions() {
  return Object.freeze({
    pattern: SEMVER_PATTERN.source,
    rangePattern: RANGE_PATTERN.source,
    rangeExamples: RANGE_EXAMPLES,
    compatibility: COMPATIBILITY,
    changeKinds: CHANGE_KINDS,
    moves: VERSION_MOVES,
    rules: Object.freeze([
      'One vocabulary: units, contracts and payloads all compare versions with this module.',
      'The change kinds are quoted from the contract that owns them; the frontend adds only `invalid`, its fail-closed answer for nonsense input.',
      'A major difference is never compatible, in either direction.',
      'A provider ahead on the minor is compatible and reported as additive.',
      '`move` carries the granularity (patch/minor/major); `kind` keeps its canonical meaning.',
      'Ranges are small on purpose: same-major, same-minor, and explicit bounds.',
    ]),
  });
}
