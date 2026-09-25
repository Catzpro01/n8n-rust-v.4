/**
 * Install source — P6-S01 (Live community / private / custom node installation path).
 *
 * PUBLIC CONTRACT (`node.install-source@0.1.0`, domain `node-registry`).
 *
 * P6.3 says how an install TRANSACTS (resolve → prepare → verify → stage →
 * publish → activate). P6.4 says what the CLOSURE is. P6.17 says whether a node
 * may be ADMITTED. P6.12 says whether an artifact is ATTESTED. Every one of them
 * assumes the package is already in hand — and none of them says where it came
 * FROM.
 *
 * That gap is where the damage happens, and it is the gap the product actually
 * has: n8n instances install community nodes from npm, private nodes from an
 * operator's own registry, and custom nodes from a local path. Three sources,
 * three different trust stories, and until this contract existed they shared one
 * code path — which meant the difference between "the public registry, gated by
 * a tenant policy switch and verified against a shared attestation key" and "a
 * file somebody dropped on disk" was invisible to the admission pipeline. An
 * admission plan that cannot see the source cannot explain an install.
 *
 * This contract closes that hole. It owns the SOURCE RECORD, the TRUST ROOT each
 * kind of source must carry, the ADMISSION of a source onto a tenant, and the
 * ORDERED LIVE INSTALL PATH that composes the contracts above into one
 * reproducible plan. It is the same split the rest of P6 uses: pure values in,
 * frozen values out, the host does the IO.
 *
 * The three kinds, and why they are not one kind:
 *
 *   community  The public registry. Many packages, many publishers, so no single
 *              registry digest means anything — trust comes from the tenant's
 *              community-nodes policy (fail closed, off by default) plus the
 *              shared attestation key every community artifact is verified
 *              against (P6.12). A community source is only usable when the
 *              operator turned community nodes on.
 *
 *   private    The operator's own registry. The trust root is a PINNED DIGEST:
 *              a private registry that will serve anything is a public registry
 *              with extra steps, and the pin is what makes it private. A private
 *              source must also be explicitly allowed on the tenant — it is not
 *              implied by the community switch, because it is a different trust
 *              domain with a different operator.
 *
 *   custom     Local content. There is no registry digest to verify against,
 *              because there is no registry — so the only thing that can make it
 *              trustworthy is an EXPLICIT OPERATOR APPROVAL naming who approved
 *              it and when. This is also the only kind that may install with no
 *              network at all, which is exactly why it is the one that must not
 *              be reachable by accident.
 *
 * THE LIVE INSTALL PATH, in the only order it may happen:
 *
 *   admit-source → admit-node → resolve-closure → transact
 *
 * `admit-source`    this contract: may this source be used on this tenant at all.
 * `admit-node`      P6.17: may this node be admitted into this epoch.
 * `resolve-closure` P6.4: what else must come with it, in what order.
 * `transact`        P6.3: the transactional install that is opened last.
 *
 * A REFUSED source never reaches `admit-node`, and a REFUSED node never opens a
 * transaction. The plan is a value, so it can be filed, replayed and compared —
 * an install path that cannot be re-read is a story about the past.
 *
 * WHAT THIS IS NOT (P6-S01 scope walls, enforced by tests):
 *   - no fetch, no extraction, no filesystem, no network                  (P6.3)
 *   - no dependency resolution of its own — it consumes a closure      (P6.4)
 *   - no attestation verification of its own — it consumes a verdict    (P6.12)
 *   - no admission checks of its own — it consumes a plan               (P6.17)
 *   - no integrity chain, no freshness ledger                            (P6.16)
 *   - no epoch compilation — a source is registered AGAINST an epoch   (P6.2)
 *
 * Authority: nothing here installs anything and nothing here grants trust. The
 * host holds the write authority; this contract judges a source, orders the path
 * and refuses a path that could not have been walked.
 */
import { createHash } from 'node:crypto';

import {
  NODE_REGISTRY_SCHEMA_VERSION,
} from './node-registry.mjs';

export const INSTALL_SOURCE_CONTRACT = 'node.install-source@0.1.0';
export const INSTALL_SOURCE_CONTRACT_VERSION = '0.1.0';
export const INSTALL_SOURCE_SCHEMA_VERSION = 1;

/** Operations: register a source, admit it onto a tenant, plan the path, describe. */
export const INSTALL_SOURCE_OPERATIONS = Object.freeze(['register', 'admit', 'plan', 'describe']);

/**
 * Permission vocabulary is P6.1's plus the install grant. Reading a registry and
 * installing into it are different authorities and get different permissions;
 * a caller with only `node:read` may plan an install but never walk one.
 */
export const INSTALL_SOURCE_PERMISSIONS = Object.freeze(['node:read', 'node:install']);

/** The three real sources of a live node install. No fourth kind exists. */
export const INSTALL_SOURCE_KINDS = Object.freeze(['community', 'private', 'custom']);

/** What each kind of source pins its trust to. Exactly one per source. */
export const INSTALL_SOURCE_TRUST_ROOT_KINDS = Object.freeze(['attestation-key', 'registry-digest', 'operator-approval']);

/** The live install path, in the only order it may happen. */
export const INSTALL_SOURCE_PATH = Object.freeze(['admit-source', 'admit-node', 'resolve-closure', 'transact']);

/** Which contract each path step cites. The plan is legible without this repo. */
export const INSTALL_SOURCE_CITATIONS = Object.freeze({
  'admit-source': 'node.install-source@0.1.0',
  'admit-node': 'node.admission@0.1.0',
  'resolve-closure': 'registry.closure@0.1.0',
  transact: 'package.transaction@0.1.0',
});

/** The trust root each kind REQUIRES. A kind that may omit it has no trust story. */
export const INSTALL_SOURCE_TRUST_ROOT_BY_KIND = Object.freeze({
  community: 'attestation-key',
  private: 'registry-digest',
  custom: 'operator-approval',
});

/** How each kind names its artifact. Local content is not a remote URI. */
export const INSTALL_SOURCE_LOCATOR_KINDS = Object.freeze({
  community: 'remote-uri',
  private: 'remote-uri',
  custom: 'local-path',
});

export const INSTALL_SOURCE_VERDICTS = Object.freeze(['admit', 'refuse', 'incomplete']);

export const INSTALL_SOURCE_PATH_STATUSES = Object.freeze(['ready', 'refused', 'unknown']);

export const INSTALL_SOURCE_REASONS = Object.freeze([
  'install.source.identity',
  'install.source.kind',
  'install.source.locator',
  'install.source.trust_root',
  'install.source.epoch',
  'install.source.policy',
  'install.source.unregistered',
  'install.source.input',
  'install.source.epoch_mismatch',
]);

export const INSTALL_SOURCE_RULES = Object.freeze({
  registeredOnly: 'a source must be registered before it may install; an unregistered source is refused, never defaulted — the default source is the one nobody chose',
  trustRootPerKind: 'every kind pins the trust root its kind requires: community an attestation key, private a registry digest, custom an operator approval; a kind that may omit its trust root has no trust story',
  failClosedPolicy: 'community installs require the tenant community-nodes policy to be on, and private and custom installs require explicit allow-listing; absence of a policy is a refusal, not a permission',
  oneSourcePerInstall: 'one install resolves against exactly one source; a mixed install has no single trust story and cannot be explained',
  pinnedEpoch: 'a source is registered against exactly one compiled epoch and an install may only run against the epoch the source names; a source that can serve a different epoch mid-install is an anti-rollback hole (P6.16)',
  admissionBeforeTransaction: 'the source is admitted, then the node, then the closure, and only then does a transaction open; a refusal anywhere above never opens one',
  localIsNotRemote: "custom content is a local path and may not name a remote URI; a 'custom' source that fetches is a community source pretending not to be",
  reproducible: 'the plan is a frozen value carrying a digest, so two identical install intents against one source produce one plan and any change in the path is visible as a changed digest',
});

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export class InstallSourceError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'InstallSourceError';
    this.code = 'lego.contract_violation';
    this.meta = Object.freeze({ ...meta });
  }
}

const fail = (message, meta) => { throw new InstallSourceError(message, meta); };
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const SOURCE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const LOCAL_PATH_RE = /^(?:\.{0,2}\/|[A-Za-z]:[\\/]|[~])[^\s]*$/;
const URI_RE = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

const digestOf = (text) => createHash('sha256').update(text).digest('hex');

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

/**
 * Register a source. This is the only way a source comes to exist, and it is
 * deliberately strict: a record that names no trust root is not a source, it is
 * a URL somebody typed.
 *
 * @param {object} source
 * @param {string} source.id          stable slug, e.g. `npm-public` / `acme-registry` / `ops-local`
 * @param {'community'|'private'|'custom'} source.kind
 * @param {string} source.locator     remote URI for community/private, local path for custom
 * @param {object} source.trustRoot   `{ kind, ... }` — must match the kind's requirement
 * @param {number} source.epochNumber the compiled epoch this source is registered against
 * @param {string} source.epochDigest `sha256:<64 hex>` digest of that epoch
 * @param {object} [source.policy]    operator-declared limits (maxPackages, allowedScopes)
 * @returns {Readonly<object>} a frozen source record
 */
export function registerInstallSource(source = {}) {
  if (!isPlainObject(source)) fail('registerInstallSource expects an object', { code: 'install.source.input', field: 'source' });
  const { id, kind, locator, trustRoot, epochNumber, epochDigest, policy } = source;

  if (!isNonEmptyString(id) || !SOURCE_ID_RE.test(id)) {
    fail(`source id ${JSON.stringify(id)} is not a stable slug: a source that cannot be named cannot be audited`, { code: 'install.source.identity', field: 'id' });
  }
  if (!INSTALL_SOURCE_KINDS.includes(kind)) {
    fail(`source kind ${JSON.stringify(kind)} is not one of ${INSTALL_SOURCE_KINDS.join(', ')}`, { code: 'install.source.kind', field: 'kind' });
  }

  // Local is not remote, and remote is not local. A 'custom' source that names a
  // URI is a community source that has not admitted what it is.
  const locatorKind = INSTALL_SOURCE_LOCATOR_KINDS[kind];
  if (!isNonEmptyString(locator)) {
    fail(`a ${kind} source must name a ${locatorKind}`, { code: 'install.source.locator', field: 'locator' });
  }
  if (locatorKind === 'remote-uri' && !URI_RE.test(locator)) {
    fail(`a ${kind} source names a remote artifact and ${JSON.stringify(locator)} is not a URI`, { code: 'install.source.locator', field: 'locator' });
  }
  if (locatorKind === 'local-path' && URI_RE.test(locator)) {
    fail(`a custom source is local content and ${JSON.stringify(locator)} is a URI: a source that fetches is not custom`, { code: 'install.source.locator', field: 'locator' });
  }
  if (locatorKind === 'local-path' && !LOCAL_PATH_RE.test(locator)) {
    fail(`a custom source must name a path on this host and ${JSON.stringify(locator)} is not one`, { code: 'install.source.locator', field: 'locator' });
  }

  if (!isPlainObject(trustRoot)) {
    fail(`a ${kind} source must carry a trust root`, { code: 'install.source.trust_root', field: 'trustRoot' });
  }
  const required = INSTALL_SOURCE_TRUST_ROOT_BY_KIND[kind];
  if (trustRoot.kind !== required) {
    fail(`a ${kind} source pins '${required}' and this one pins ${JSON.stringify(trustRoot.kind)}`, { code: 'install.source.trust_root', field: 'trustRoot.kind' });
  }
  validateTrustRoot(kind, trustRoot);

  if (!Number.isInteger(epochNumber) || epochNumber < 0) {
    fail(`a source is registered against a compiled epoch and ${JSON.stringify(epochNumber)} is not an epoch number`, { code: 'install.source.epoch', field: 'epochNumber' });
  }
  if (!isNonEmptyString(epochDigest) || !DIGEST_RE.test(epochDigest)) {
    fail(`epoch digest ${JSON.stringify(epochDigest)} is not 'sha256:<64 hex>'; a source pinned to nothing is pinned to everything`, { code: 'install.source.epoch', field: 'epochDigest' });
  }
  if (policy !== undefined && !isPlainObject(policy)) fail('policy must be an object or undefined', { code: 'install.source.input', field: 'policy' });

  return deepFreeze({
    ok: true,
    schemaVersion: INSTALL_SOURCE_SCHEMA_VERSION,
    contract: INSTALL_SOURCE_CONTRACT,
    id,
    kind,
    locator,
    locatorKind,
    trustRoot: Object.freeze({ ...trustRoot }),
    epochNumber,
    epochDigest,
    policy: policy ? Object.freeze({ ...policy }) : null,
    sourceDigest: digestOf(stableJson({ id, kind, locator, trustRoot, epochNumber, epochDigest })),
  });
}

/** Each trust root carries the field its kind actually needs to be checkable. */
function validateTrustRoot(kind, trustRoot) {
  if (kind === 'community') {
    if (!isNonEmptyString(trustRoot.keyId)) {
      fail("a community source must name the attestation key its artifacts are verified against; 'the public registry' is not a key", { code: 'install.source.trust_root', field: 'trustRoot.keyId' });
    }
  }
  if (kind === 'private') {
    if (!isNonEmptyString(trustRoot.digest) || !DIGEST_RE.test(trustRoot.digest)) {
      fail(`a private source must pin its registry to 'sha256:<64 hex>' and ${JSON.stringify(trustRoot.digest)} is not one: an unpinned private registry is a public one`, { code: 'install.source.trust_root', field: 'trustRoot.digest' });
    }
  }
  if (kind === 'custom') {
    if (!isNonEmptyString(trustRoot.approvedBy)) {
      fail('a custom source must name the operator who approved it; local content with no approver is an unowned file', { code: 'install.source.trust_root', field: 'trustRoot.approvedBy' });
    }
    if (!isNonEmptyString(trustRoot.approvedAt) || !ISO_RE.test(trustRoot.approvedAt)) {
      fail(`a custom source approval must carry an ISO-8601 Z timestamp and ${JSON.stringify(trustRoot.approvedAt)} is not one`, { code: 'install.source.trust_root', field: 'trustRoot.approvedAt' });
    }
  }
}

/** @returns {boolean} whether `value` is a source this contract produced. */
export function isInstallSource(value) {
  return (
    isPlainObject(value) &&
    value.ok === true &&
    value.contract === INSTALL_SOURCE_CONTRACT &&
    value.schemaVersion === INSTALL_SOURCE_SCHEMA_VERSION &&
    isNonEmptyString(value.id) &&
    INSTALL_SOURCE_KINDS.includes(value.kind) &&
    isNonEmptyString(value.locator) &&
    isPlainObject(value.trustRoot) &&
    INSTALL_SOURCE_TRUST_ROOT_KINDS.includes(value.trustRoot.kind) &&
    Number.isInteger(value.epochNumber) &&
    isNonEmptyString(value.epochDigest) &&
    isNonEmptyString(value.sourceDigest) &&
    Object.isFrozen(value)
  );
}

const requireSource = (value, fn) => {
  if (!isInstallSource(value)) {
    fail(`${fn} expects a source from registerInstallSource`, { code: 'install.source.unregistered', got: typeof value });
  }
};

/* ------------------------------------------------------------------ *
 * Admission
 * ------------------------------------------------------------------ */

const check = (name, outcome, message) => Object.freeze({ check: name, outcome, message });

/**
 * May this source be used on this tenant at all?
 *
 * Fail closed on every axis. The absence of a policy is a refusal for private
 * and custom sources, because an operator who has said nothing has not permitted
 * anything; and for a community source it is a refusal too, because the tenant
 * switch defaults to off.
 *
 * @param {object} source  from `registerInstallSource`
 * @param {object} [options]
 * @param {object} [options.policy] tenant policy: `{ communityNodesEnabled, allowedKinds }`
 * @param {object|null} [options.epoch] the compiled epoch the install runs against
 * @returns {Readonly<object>} `{ ok, verdict, checks, failures, unknowns, message }`
 */
export function admitInstallSource(source, { policy = {}, epoch = null } = {}) {
  requireSource(source, 'admitInstallSource');
  if (!isPlainObject(policy)) fail('policy must be an object', { code: 'install.source.policy', field: 'policy' });
  const { communityNodesEnabled = false, allowedKinds = null } = policy;

  const checks = [];

  // registered — a value that is not a record this contract produced never gets
  // past the require above, so this is a pass by construction. It is still a
  // named check, because an install path that does not say it verified the source
  // is not explaining anything.
  checks.push(check('registered', 'pass', `source '${source.id}' is a registered ${source.kind} source`));

  // policy — the tenant switch. Community is gated by its own knob; private and
  // custom need explicit allow-listing, because they are separate trust domains.
  if (source.kind === 'community') {
    checks.push(communityNodesEnabled === true
      ? check('policy', 'pass', 'the tenant policy permits community nodes')
      : check('policy', 'fail', 'the tenant policy does not permit community nodes: an operator who left the switch off has not opted in'));
  } else {
    const allowed = Array.isArray(allowedKinds) ? allowedKinds : [];
    checks.push(allowed.includes(source.kind)
      ? check('policy', 'pass', `the tenant policy explicitly allows ${source.kind} sources`)
      : check('policy', 'fail', `the tenant policy does not allow ${source.kind} sources: ${source.kind} is a separate trust domain and is not implied by the community switch`));
  }

  // trust — re-checked here rather than trusted from registration, because a
  // source is a value and values travel.
  try {
    validateTrustRoot(source.kind, source.trustRoot);
    checks.push(check('trust', 'pass', `the ${source.kind} source pins ${source.trustRoot.kind}`));
  } catch {
    checks.push(check('trust', 'fail', `the ${source.kind} source no longer pins ${INSTALL_SOURCE_TRUST_ROOT_BY_KIND[source.kind]}`));
  }

  // epoch — the source must name the epoch the install is running against. If the
  // caller supplied no epoch we do not know, and unknown is never a pass.
  if (epoch === null) {
    checks.push(check('epoch', 'unknown', 'no epoch was supplied to admit against'));
  } else if (epoch.epochDigest === source.epochDigest) {
    checks.push(check('epoch', 'pass', `the source is pinned to epoch ${source.epochNumber}`));
  } else {
    checks.push(check('epoch', 'fail', `the source is pinned to epoch ${source.epochDigest} and the install is against ${epoch.epochDigest}: a source that can serve another epoch mid-install is an anti-rollback hole`));
  }

  const failures = Object.freeze(checks.filter((entry) => entry.outcome === 'fail'));
  const unknowns = Object.freeze(checks.filter((entry) => entry.outcome === 'unknown').map((entry) => entry.check));
  const verdict = failures.length > 0 ? 'refuse' : (unknowns.length > 0 ? 'incomplete' : 'admit');

  return deepFreeze({
    ok: verdict === 'admit',
    schemaVersion: INSTALL_SOURCE_SCHEMA_VERSION,
    contract: INSTALL_SOURCE_CONTRACT,
    sourceId: source.id,
    kind: source.kind,
    verdict,
    checks: Object.freeze(checks),
    failures: Object.freeze(failures.map((entry) => Object.freeze({ check: entry.check, message: entry.message }))),
    unknowns,
    message: verdict === 'admit'
      ? `source '${source.id}' may install on this tenant`
      : (failures.length > 0
        ? `refused: ${failures.map((entry) => entry.check).join(', ')}`
        : `incomplete: no check failed and ${unknowns.length} had no evidence (${unknowns.join(', ')})`),
  });
}

/* ------------------------------------------------------------------ *
 * The live install path
 * ------------------------------------------------------------------ */

/**
 * The ordered path a live install walks, as one reproducible value.
 *
 * Every step names the contract that owns it, so a plan can be read without this
 * repository open. A step is `ready` when the caller supplied the verdict that
 * contract produced, `refused` when that verdict was a refusal, and `unknown`
 * when the verdict was not supplied at all — and an unknown step makes the whole
 * plan incomplete rather than admitting on silence.
 *
 * @param {object} source from `registerInstallSource`
 * @param {object} [inputs]
 * @param {object} [inputs.policy]    tenant policy for `admitInstallSource`
 * @param {object|null} [inputs.epoch] the compiled epoch the install runs against
 * @param {object|null} [inputs.admission] a plan from P6.17 `planAdmission`
 * @param {object|null} [inputs.closure]   a closure from P6.4 `resolveDependencyClosure`
 * @returns {Readonly<object>} the frozen plan
 */
export function planLiveInstall(source, inputs = {}) {
  requireSource(source, 'planLiveInstall');
  if (!isPlainObject(inputs)) fail('inputs must be an object', { code: 'install.source.input', field: 'inputs' });
  const { policy = {}, epoch = null, admission = null, closure = null } = inputs;

  const sourceVerdict = admitInstallSource(source, { policy, epoch });
  const sourceAdmitted = sourceVerdict.verdict === 'admit';
  const sourceRefused = sourceVerdict.verdict === 'refuse';

  // A source that is not admitted never reaches the node. This is the whole
  // point: the cheap check runs first so the expensive one does not have to be
  // argued about. Refused is a fact and incomplete is an absence, and a plan
  // reporting an absent check as ready would be admitting on silence.
  const refused = [];
  const unknown = [];
  if (sourceRefused) refused.push('admit-source');
  else if (!sourceAdmitted) unknown.push('admit-source');

  // admit-node — P6.17. No plan supplied is unknown, not pass.
  if (!sourceAdmitted) {
    (sourceRefused ? refused : unknown).push('admit-node');
  } else if (admission === null) {
    unknown.push('admit-node');
  } else if (admission.ok !== true) {
    refused.push('admit-node');
  }

  // resolve-closure — P6.4. No closure supplied is unknown.
  if (!sourceAdmitted) {
    (sourceRefused ? refused : unknown).push('resolve-closure');
  } else if (closure === null) {
    unknown.push('resolve-closure');
  }

  // transact — P6.3. Opens only once everything above is settled.
  if (unknown.length > 0) unknown.push('transact');
  else if (refused.length > 0) refused.push('transact');

  const steps = INSTALL_SOURCE_PATH.map((name) => {
    const citation = INSTALL_SOURCE_CITATIONS[name];
    let status = 'ready';
    let detail = `ready via ${citation}`;
    if (name === 'admit-source') {
      status = sourceAdmitted ? 'ready' : (sourceRefused ? 'refused' : 'unknown');
      detail = sourceVerdict.message;
    } else if (refused.includes(name)) {
      status = 'refused';
      detail = !sourceAdmitted
        ? `the source is not admitted, so '${name}' is never reached`
        : (name === 'admit-node'
          ? 'P6.17 refused this node: a node the registry will not admit is not installed'
          : 'a step above was refused, so no transaction opens');
    } else if (unknown.includes(name)) {
      status = 'unknown';
      detail = !sourceAdmitted
        ? `the source is not admitted, so '${name}' is never reached`
        : (name === 'admit-node'
          ? 'no admission plan was supplied: a node nobody checked is not admitted'
          : (name === 'resolve-closure'
            ? 'no dependency closure was supplied: an install that ignores its closure installs half a node'
            : 'the steps above are not settled, so there is nothing to transact yet'));
    }
    return Object.freeze({ step: name, contract: citation, status, detail });
  });

  // A status outside the vocabulary is a bug in this contract, not an input
  // problem, so it is asserted here rather than leaking into a plan.
  for (const entry of steps) {
    if (!INSTALL_SOURCE_PATH_STATUSES.includes(entry.status)) {
      fail(`path step '${entry.step}' resolved to '${entry.status}', which is not one of ${INSTALL_SOURCE_PATH_STATUSES.join(', ')}`, { code: 'install.source.input', field: 'steps' });
    }
  }

  const verdict = refused.length > 0 ? 'refuse' : (unknown.length > 0 ? 'incomplete' : 'admit');
  const opensTransaction = verdict === 'admit';
  const message = verdict === 'admit'
    ? `the live install path for '${source.id}' is admitted: ${INSTALL_SOURCE_PATH.join(' \u2192 ')}`
    : (verdict === 'refuse'
      ? `refused: ${refused.join(', ')}`
      : `incomplete: no step was refused and ${unknown.length} had no evidence (${unknown.join(', ')})`);

  return buildPlan(source, sourceVerdict, steps, unknown, epoch, opensTransaction, verdict, message);
}

/**
 * Assemble the plan. Every plan carries all four steps and a digest over its own
 * body, so a refused plan is still a plan a caller can file and re-read.
 */
function buildPlan(source, sourceVerdict, steps, unknown, epoch, opensTransaction, verdict, message) {
  const planDigest = digestOf(stableJson({
    sourceId: source.id,
    sourceDigest: source.sourceDigest,
    epochDigest: source.epochDigest,
    verdict,
    steps: steps.map((entry) => [entry.step, entry.contract, entry.status]),
  }));

  return deepFreeze({
    ok: verdict === 'admit',
    schemaVersion: INSTALL_SOURCE_SCHEMA_VERSION,
    contract: INSTALL_SOURCE_CONTRACT,
    sourceId: source.id,
    kind: source.kind,
    epochNumber: source.epochNumber,
    epochDigest: source.epochDigest,
    verdict,
    steps: Object.freeze(steps),
    unknowns: Object.freeze([...unknown]),
    sourceVerdict,
    opensTransaction,
    path: Object.freeze([...INSTALL_SOURCE_PATH]),
    planDigest,
    message,
  });
}

/** @returns {boolean} whether `value` is a plan this contract produced. */
export function isLiveInstallPlan(value) {
  // `ok` is deliberately NOT part of the guard: a refused plan is still a plan,
  // and a type guard that rejects the refusals makes them uninspectable.
  return (
    isPlainObject(value) &&
    value.contract === INSTALL_SOURCE_CONTRACT &&
    value.schemaVersion === INSTALL_SOURCE_SCHEMA_VERSION &&
    isNonEmptyString(value.sourceId) &&
    INSTALL_SOURCE_VERDICTS.includes(value.verdict) &&
    Array.isArray(value.steps) &&
    value.steps.length === INSTALL_SOURCE_PATH.length &&
    typeof value.opensTransaction === 'boolean' &&
    isNonEmptyString(value.planDigest) &&
    Object.isFrozen(value)
  );
}

/**
 * Whether a plan may open a package transaction. False for every non-admit
 * verdict, which is the single invariant that keeps a refused install from ever
 * reaching P6.3.
 */
export function liveInstallOpensTransaction(plan) {
  if (!isLiveInstallPlan(plan)) fail('liveInstallOpensTransaction expects a plan from planLiveInstall', { code: 'install.source.unregistered', got: typeof plan });
  return plan.opensTransaction;
}

/** The plan as one line, for a log or a UI row. */
export function formatLiveInstallPlan(plan) {
  if (!isLiveInstallPlan(plan)) fail('formatLiveInstallPlan expects a plan from planLiveInstall', { code: 'install.source.unregistered', got: typeof plan });
  const ready = plan.steps.filter((entry) => entry.status === 'ready').length;
  return `${plan.sourceId} (${plan.kind}) ${plan.verdict} ${ready}/${plan.steps.length} steps opens-transaction=${plan.opensTransaction} ${plan.planDigest.slice(0, 12)}`;
}

/** Deterministic digest of a plan — two identical paths have one digest. */
export function liveInstallPlanDigest(plan) {
  if (!isLiveInstallPlan(plan)) fail('liveInstallPlanDigest expects a plan from planLiveInstall', { code: 'install.source.unregistered', got: typeof plan });
  return plan.planDigest;
}

/* ------------------------------------------------------------------ *
 * Describe
 * ------------------------------------------------------------------ */

/** The contract, for a UI or a docs page. No arguments, no state. */
export function describeInstallSource() {
  return deepFreeze({
    ok: true,
    contract: INSTALL_SOURCE_CONTRACT,
    version: INSTALL_SOURCE_CONTRACT_VERSION,
    schemaVersion: INSTALL_SOURCE_SCHEMA_VERSION,
    operations: INSTALL_SOURCE_OPERATIONS,
    permissions: INSTALL_SOURCE_PERMISSIONS,
    kinds: INSTALL_SOURCE_KINDS,
    trustRoots: INSTALL_SOURCE_TRUST_ROOT_BY_KIND,
    locatorKinds: INSTALL_SOURCE_LOCATOR_KINDS,
    path: INSTALL_SOURCE_PATH,
    citations: INSTALL_SOURCE_CITATIONS,
    verdicts: INSTALL_SOURCE_VERDICTS,
    rules: INSTALL_SOURCE_RULES,
    reasons: INSTALL_SOURCE_REASONS,
  });
}

/** The schema version this contract expects from its inputs (P6.1's). */
export const INSTALL_SOURCE_INPUT_SCHEMA_VERSION = NODE_REGISTRY_SCHEMA_VERSION;
