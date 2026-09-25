/**
 * P6-S01 — Node admission pipeline. Contract `node.admission@0.1.0`.
 *
 * Matrix: the seven node classes and their trust *ceilings*, the fail-closed
 * first-failure rule, the fact that no class maps to CORE, the locality matrix
 * boundary, the consumer-contract replay for upgrades, and the scope walls.
 *
 * The trust/locality vocabulary is deliberately the plugin-runtime one
 * (`CORE`/`TRUSTED`/`ISOLATED`/`SANDBOXED`, `IN_PROCESS`/`WASM`/
 * `ISOLATED_PROCESS`/`REMOTE`), because that is the vocabulary the enforcement
 * primitives in `plugin-policy.mjs` and `plugin-locality.mjs` actually speak.
 * `node-registry.mjs` publishes a *different* pair of vocabularies (the
 * lowercase foundation trust levels and the runtime names) and mixing them is
 * a real bug, so a test pins the distinction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLUGIN_RUNTIME_LOCALITIES,
  PLUGIN_TRUST_CLASSES,
} from '../src/lego/plugin-runtime.mjs';
import {
  ADMISSION_BOUNDS,
  ADMISSION_DECISIONS,
  ADMISSION_REASONS,
  ADMISSION_STAGES,
  ADMISSION_STAGE_STATUSES,
  CONSUMER_CONTRACT_SURFACE,
  NODE_ADMISSION_CONTRACT,
  NODE_ADMISSION_CONTRACT_VERSION,
  NODE_ADMISSION_INPUT_SCHEMA_VERSION,
  NODE_ADMISSION_OPERATIONS,
  NODE_ADMISSION_PERMISSIONS,
  NODE_ADMISSION_RULES,
  NODE_ADMISSION_SCHEMA_VERSION,
  NODE_CLASSES,
  NODE_CLASS_TRUST_CEILING,
  NodeAdmissionError,
  admitNode,
  explainAdmission,
  validateCompatibility,
} from '../src/lego/node-admission.mjs';

const VOCAB = ['network', 'filesystem', 'subprocess', 'secrets', 'native', 'env'];

/** A minimal, fully legal candidate. Every test mutates one thing. */
function candidate(overrides = {}) {
  return {
    nodeClass: 'official',
    nodeType: 'n8n-nodes-base.httpRequest',
    typeVersion: '4.1',
    package: { name: 'n8n-nodes-base', version: '1.2.3' },
    provenance: { kind: 'package-registry', verified: true, digest: 'a'.repeat(64) },
    contract: { version: '1.0.0', parameters: [], credentials: [] },
    requestedCapabilities: [],
    ...overrides,
  };
}

const context = (overrides = {}) => ({ capabilityVocabulary: VOCAB, ...overrides });

function admitted(overrides = {}, ctx = {}) {
  const verdict = admitNode(candidate(overrides), context(ctx));
  assert.equal(verdict.decision, 'admit', explainAdmission(verdict));
  return verdict;
}

test('the contract is declared the way the registry expects', () => {
  assert.equal(NODE_ADMISSION_CONTRACT, 'node.admission@0.1.0');
  assert.equal(NODE_ADMISSION_CONTRACT_VERSION, '0.1.0');
  assert.equal(NODE_ADMISSION_SCHEMA_VERSION, 1);
  assert.equal(NODE_ADMISSION_INPUT_SCHEMA_VERSION, 1);
  assert.deepEqual([...NODE_ADMISSION_OPERATIONS], ['admit', 'describe']);
  assert.deepEqual([...NODE_ADMISSION_PERMISSIONS], ['node:read']);
  assert.equal(NODE_ADMISSION_RULES.classIsPolicy.includes('policy input'), true);
});

test('the pipeline stages are Issue #95\'s order, unchanged', () => {
  assert.deepEqual([...ADMISSION_STAGES], [
    'identify',
    'verify-metadata',
    'verify-provenance',
    'resolve-contract',
    'resolve-capabilities',
    'resolve-trust',
    'resolve-locality',
    'validate-resources',
    'validate-compatibility',
    'health-selftest',
    'decide',
  ]);
  assert.equal(ADMISSION_BOUNDS.maxStages, ADMISSION_STAGES.length);
  assert.deepEqual([...ADMISSION_STAGE_STATUSES], ['passed', 'failed', 'skipped']);
  assert.deepEqual([...ADMISSION_DECISIONS], ['admit', 'reject']);
});

// -------------------------------------------------------------------- classes

test('all seven Issue #95 node classes are distinguished', () => {
  assert.deepEqual([...NODE_CLASSES], [
    'official',
    'verified-community',
    'unverified-community',
    'private',
    'custom',
    'native-rust',
    'native-portable',
  ]);
  for (const nodeClass of NODE_CLASSES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(NODE_CLASS_TRUST_CEILING, nodeClass),
      `${nodeClass} has a declared trust ceiling`,
    );
  }
});

test('NO node class maps to CORE — origin, language and official status grant no trust', () => {
  // The single most important assertion in this file. Issue #95: "Rust is not
  // automatically trusted", "Official does not mean unrestricted capability",
  // "Community code should not inherit Core authority". The table therefore has
  // no CORE row at all.
  const ceilings = Object.values(NODE_CLASS_TRUST_CEILING);
  assert.ok(!ceilings.includes('CORE'), `no class may map to CORE, got ${ceilings.join(', ')}`);
  assert.ok(ceilings.every((c) => PLUGIN_TRUST_CLASSES.includes(c)));
});

test('official and native-rust share a TRUSTED ceiling and nothing higher', () => {
  assert.equal(NODE_CLASS_TRUST_CEILING.official, 'TRUSTED');
  assert.equal(NODE_CLASS_TRUST_CEILING['native-rust'], 'TRUSTED');
  // Rust earns exactly what official earns — no provenance bonus for the language.
  assert.equal(NODE_CLASS_TRUST_CEILING['native-rust'], NODE_CLASS_TRUST_CEILING.official);
});

test('community and portable classes are never above ISOLATED', () => {
  const order = [...PLUGIN_TRUST_CLASSES];
  for (const nodeClass of ['verified-community', 'private', 'unverified-community', 'custom', 'native-portable']) {
    assert.ok(
      order.indexOf(NODE_CLASS_TRUST_CEILING[nodeClass]) > order.indexOf('TRUSTED'),
      `${nodeClass} must not reach TRUSTED`,
    );
  }
});

test('the trust/locality vocabulary is the plugin-runtime one, not the registry one', () => {
  // node-registry.mjs publishes lowercase foundation levels and runtime names.
  // The enforcement primitives speak uppercase postures and localities. Pinning
  // the distinction here stops a future edit from silently mixing them.
  assert.ok(PLUGIN_TRUST_CLASSES.includes('SANDBOXED'));
  assert.ok(!PLUGIN_TRUST_CLASSES.includes('untrusted'));
  assert.ok(PLUGIN_RUNTIME_LOCALITIES.includes('WASM'));
  assert.ok(!PLUGIN_RUNTIME_LOCALITIES.includes('wasm'));
});

// ------------------------------------------------------------------- admitted

test('a clean official candidate is admitted at its class ceiling', () => {
  const verdict = admitted();
  assert.equal(verdict.nodeClass, 'official');
  assert.equal(verdict.trustClass, 'TRUSTED');
  assert.equal(verdict.locality, 'IN_PROCESS');
  assert.equal(verdict.identity, 'n8n-nodes-base.httpRequest@4.1');
  assert.deepEqual([...verdict.reasons], ['ADMITTED']);
  assert.equal(verdict.failedStage, null);
  assert.equal(verdict.trace.filter((entry) => entry.status === 'passed').length, ADMISSION_STAGES.length - 1);
});

test('every class is admissible when its own rules are met', () => {
  for (const nodeClass of NODE_CLASSES) {
    const verdict = admitNode(candidate({ nodeClass }), context());
    assert.equal(verdict.decision, 'admit', `${nodeClass}: ${explainAdmission(verdict)}`);
    assert.equal(verdict.trustClass, NODE_CLASS_TRUST_CEILING[nodeClass]);
  }
});

test('a declared trust class may be more isolated, never more permissive', () => {
  // More isolated: accepted, and it becomes the effective class.
  const stricter = admitted({ declaredTrustClass: 'SANDBOXED' });
  assert.equal(stricter.trustClass, 'SANDBOXED');
  assert.equal(stricter.locality, 'WASM');

  // Less isolated: refused, and it names itself.
  const verdict = admitNode(
    candidate({ nodeClass: 'unverified-community', declaredTrustClass: 'CORE' }),
    context(),
  );
  assert.equal(verdict.decision, 'reject');
  assert.equal(verdict.failedStage, 'resolve-trust');
  assert.deepEqual([...verdict.reasons], ['TRUST_CLASS_OVER_CEILING']);
});

test('an AI-authored node must be SANDBOXED', () => {
  const verdict = admitNode(candidate({ aiAuthored: true }), context());
  assert.equal(verdict.decision, 'reject');
  assert.equal(verdict.failedStage, 'resolve-trust');
  assert.deepEqual([...verdict.reasons], ['AI_AUTHOR_NOT_SANDBOXED']);

  const allowed = admitNode(
    candidate({ nodeClass: 'custom', aiAuthored: true, declaredTrustClass: 'SANDBOXED' }),
    context(),
  );
  assert.equal(allowed.decision, 'admit');
  assert.equal(allowed.trustClass, 'SANDBOXED');
});

// ----------------------------------------------------------------- fail-closed

test('the first failing stage ends the pipeline and later stages are skipped', () => {
  const verdict = admitNode(
    candidate({
      nodeClass: 'not-a-class',
      package: null,
      provenance: null,
      contract: null,
    }),
    context(),
  );
  assert.equal(verdict.decision, 'reject');
  assert.equal(verdict.failedStage, 'identify');
  assert.deepEqual([...verdict.reasons], ['UNKNOWN_NODE_CLASS']);
  const statuses = verdict.trace.map((entry) => entry.status);
  assert.equal(statuses[0], 'failed');
  assert.ok(statuses.slice(1).every((status) => status === 'skipped'), 'nothing after the failure runs');
  assert.equal(verdict.trace.length, ADMISSION_STAGES.length - 1);
  // A skipped stage records no reason — it did not run, so it has no opinion.
  for (const entry of verdict.trace.slice(1)) assert.equal(entry.reason, null);
});

test('each stage rejects its own malformed input', () => {
  const cases = [
    ['identify', { nodeType: 'Not A Type' }, 'BAD_NODE_TYPE'],
    ['identify', { typeVersion: 'zero' }, 'BAD_TYPE_VERSION'],
    ['identify', { identity: 'lie@1.0' }, 'IDENTITY_MISMATCH'],
    ['verify-metadata', { package: null }, 'MISSING_PACKAGE_METADATA'],
    ['verify-metadata', { package: { name: 'Has Spaces' } }, 'BAD_PACKAGE_NAME'],
    ['verify-metadata', { package: { name: 'x'.repeat(300) } }, 'BAD_PACKAGE_NAME'],
    ['verify-provenance', { provenance: null }, 'MISSING_PROVENANCE'],
    ['verify-provenance', { provenance: { kind: 'vibes', verified: true } }, 'BAD_PROVENANCE_KIND'],
    ['verify-provenance', { provenance: { kind: 'package-registry', verified: false } }, 'PROVENANCE_UNVERIFIED'],
    ['verify-provenance', { provenance: { kind: 'attested-build', verified: true } }, 'ATTESTATION_REQUIRED'],
    ['resolve-contract', { contract: null }, 'MISSING_CONTRACT'],
    ['resolve-contract', { contract: { version: '1.0', parameters: [] } }, 'BAD_CONTRACT_VERSION'],
    ['resolve-contract', { contract: { version: '1.0.0', parameters: 'none' } }, 'MISSING_PARAMETERS'],
    ['resolve-contract', { contract: { version: '1.0.0', parameters: [], credentials: 'x' } }, 'CREDENTIAL_BINDING_LOST'],
    ['resolve-contract', { contract: { version: '1.0.0', parameters: [], uiMetadata: 7 } }, 'UI_METADATA_LOST'],
    ['resolve-capabilities', { requestedCapabilities: 'network' }, 'UNKNOWN_CAPABILITY'],
    ['resolve-capabilities', { requestedCapabilities: ['telepathy'] }, 'UNKNOWN_CAPABILITY'],
    ['resolve-trust', { nodeClass: 'official', declaredTrustClass: 'CORE' }, 'TRUST_CLASS_OVER_CEILING'],
    ['resolve-locality', { requestedLocality: 'MOON' }, 'UNKNOWN_LOCALITY'],
    ['resolve-locality', { nodeClass: 'unverified-community', requestedLocality: 'IN_PROCESS' }, 'LOCALITY_NOT_ALLOWED'],
    ['validate-resources', { resourceProfile: { telepathy: 1 } }, 'UNKNOWN_RESOURCE_FIELD'],
    ['validate-resources', { concurrency: 'whenever' }, 'UNKNOWN_CONCURRENCY'],
    ['validate-compatibility', { compatibility: 'perfect' }, 'COMPATIBILITY_BREAKING'],
    ['validate-compatibility', { compatibility: 'breaking' }, 'COMPATIBILITY_BREAKING'],
    ['health-selftest', { health: { state: 'quarantined' } }, 'NODE_QUARANTINED'],
    ['health-selftest', { health: { state: 'failing' } }, 'NODE_UNHEALTHY'],
    ['health-selftest', { selfTest: { passed: false } }, 'NODE_UNHEALTHY'],
    ['health-selftest', { health: { state: 'vibing' } }, 'NODE_UNHEALTHY'],
  ];
  for (const [stage, overrides, reason] of cases) {
    const verdict = admitNode(candidate(overrides), context());
    assert.equal(verdict.decision, 'reject', `${stage}/${reason}: expected a rejection`);
    assert.equal(verdict.failedStage, stage, `${reason} should fail at ${stage}, failed at ${verdict.failedStage}`);
    assert.deepEqual([...verdict.reasons], [reason], `${stage} should report ${reason}`);
    assert.ok(ADMISSION_REASONS.includes(reason), `${reason} is a declared reason-code`);
  }
});

test('an absent optional field is never silently defaulted into a pass', () => {
  // Fail-closed means the missing *required* things refuse. Optional things are
  // genuinely optional — but a missing nodeClass is not "default to official".
  const verdict = admitNode({ nodeType: 'n8n-nodes-base.set', typeVersion: '3' }, context());
  assert.equal(verdict.decision, 'reject');
  assert.deepEqual([...verdict.reasons], ['UNKNOWN_NODE_CLASS']);
});

// ------------------------------------------------------------------ provenance

test('a revoked artifact is refused even when everything else is clean', () => {
  const digest = 'b'.repeat(64);
  const verdict = admitNode(
    candidate({ provenance: { kind: 'attested-build', verified: true, digest, attestationRef: 'att-1' } }),
    context({
      revocations: { isRevoked: (value) => value === digest },
    }),
  );
  assert.equal(verdict.decision, 'reject');
  assert.equal(verdict.failedStage, 'verify-provenance');
  assert.deepEqual([...verdict.reasons], ['ARTIFACT_REVOKED']);

  const clean = admitted({
    provenance: { kind: 'attested-build', verified: true, digest, attestationRef: 'att-1' },
  });
  assert.equal(clean.decision, 'admit');
});

test('an unverified artifact is refused rather than assumed', () => {
  const verdict = admitNode(candidate({ provenance: { kind: 'package-registry', verified: false } }), context());
  assert.equal(verdict.decision, 'reject');
  assert.deepEqual([...verdict.reasons], ['PROVENANCE_UNVERIFIED']);
});

// --------------------------------------------------------------- capabilities

test('a capability over the class ceiling is refused at resolve-trust', () => {
  // `secrets` is a foundation capability a community-class node may not hold.
  const verdict = admitNode(
    candidate({ nodeClass: 'verified-community', requestedCapabilities: ['network', 'secrets'] }),
    context(),
  );
  assert.equal(verdict.decision, 'reject');
  assert.equal(verdict.failedStage, 'resolve-trust');
  assert.deepEqual([...verdict.reasons], ['CAPABILITY_OVER_CEILING']);
  assert.equal(verdict.trace.find((entry) => entry.stage === 'resolve-capabilities').status, 'passed');
});

test('the same capability is legal for one class and illegal for another', () => {
  // `network` is a foundation default grant at the `verified` level and is NOT
  // granted at `community`. Same capability token, different class ceiling, and
  // the ceiling is the class — not the capability name.
  const official = admitted({ requestedCapabilities: ['network'] });
  assert.equal(official.decision, 'admit');
  assert.equal(official.trustClass, 'TRUSTED');

  const community = admitNode(
    candidate({ nodeClass: 'verified-community', requestedCapabilities: ['network'] }),
    context(),
  );
  assert.equal(community.decision, 'reject');
  assert.equal(community.failedStage, 'resolve-trust');
  assert.deepEqual([...community.reasons], ['CAPABILITY_OVER_CEILING']);

  // A community node with no capability request is perfectly legal.
  const bare = admitNode(candidate({ nodeClass: 'verified-community' }), context());
  assert.equal(bare.decision, 'admit');
  assert.equal(bare.trustClass, 'ISOLATED');
});

test('admission grants nothing: the pipeline evaluates with no operator grants', () => {
  // A node may *carry* a grant list in its own declaration, but admission does
  // not honour it — grants are a request-time concern owned by plugin-policy.
  // Accepting one here would let a package admit itself by writing its own
  // grant list, which is exactly the authority-inheritance bug §11 forbids.
  const smuggled = admitNode(
    candidate({ nodeClass: 'verified-community', requestedCapabilities: ['network'], grants: ['network'] }),
    context(),
  );
  assert.equal(smuggled.decision, 'reject');
  assert.deepEqual([...smuggled.reasons], ['CAPABILITY_OVER_CEILING']);
});

test('the verdict carries no capability grant of its own', () => {
  const verdict = admitted({ requestedCapabilities: ['network'] });
  assert.deepEqual(Object.keys(verdict).sort(), [
    'compatibility',
    'decision',
    'failedStage',
    'failureDetail',
    'identity',
    'locality',
    'nodeClass',
    'reasons',
    'trace',
    'trustClass',
  ].sort());
});

test('requested capabilities are bounded', () => {
  const tooMany = Array.from({ length: ADMISSION_BOUNDS.maxCapabilities + 1 }, (_, index) => `cap${index}`);
  assert.throws(
    () => admitNode(candidate({ requestedCapabilities: tooMany }), context()),
    (error) => error instanceof NodeAdmissionError && error.code === 'lego.contract_violation',
  );
});

// -------------------------------------------------------------------- locality

test('locality is chosen inside the trust-class matrix', () => {
  const sandboxed = admitNode(candidate({ nodeClass: 'unverified-community' }));
  assert.equal(sandboxed.locality, 'WASM');
  const official = admitted();
  assert.equal(official.locality, 'IN_PROCESS');
  const community = admitNode(candidate({ nodeClass: 'verified-community' }));
  assert.equal(community.locality, 'ISOLATED_PROCESS');
});

test('a locality outside the class row is refused with the allowed row named', () => {
  const verdict = admitNode(
    candidate({ nodeClass: 'unverified-community', requestedLocality: 'IN_PROCESS' }),
    context(),
  );
  assert.equal(verdict.decision, 'reject');
  const entry = verdict.trace.find((item) => item.stage === 'resolve-locality');
  assert.equal(entry.status, 'failed');
  assert.ok(entry.detail.includes('SANDBOXED may not execute as IN_PROCESS'), entry.detail);
});

test('a localityShape override can only move within the matrix', () => {
  // external would pick REMOTE, but SANDBOXED has no REMOTE row — so the class
  // default wins. An override can never widen authority.
  const verdict = admitNode(
    candidate({ nodeClass: 'unverified-community', localityShape: { external: true } }),
    context(),
  );
  assert.equal(verdict.decision, 'admit');
  assert.equal(verdict.locality, 'WASM');
});

// ------------------------------------------------------------------- resources

test('a resource profile over the caller limit is refused with the field named', () => {
  const verdict = admitNode(
    candidate({ resourceProfile: { memory: 8192, cpu: 4 } }),
    context({ resourceLimits: { memory: 2048 } }),
  );
  assert.equal(verdict.decision, 'reject');
  assert.equal(verdict.failedStage, 'validate-resources');
  assert.deepEqual([...verdict.reasons], ['RESOURCE_LIMIT_EXCEEDED']);
  const entry = verdict.trace.find((item) => item.stage === 'validate-resources');
  assert.ok(entry.detail.includes('memory 8192 exceeds the limit 2048'), entry.detail);
});

test('a resource profile within the limit is admitted', () => {
  const verdict = admitted({ resourceProfile: { memory: 512 }, concurrency: 'parallel-safe' });
  assert.equal(verdict.decision, 'admit');
});

// ------------------------------------------------------- consumer contract

test('the consumer-facing surface is the one Issue #95 enumerates', () => {
  assert.deepEqual([...CONSUMER_CONTRACT_SURFACE], [
    'nodeType',
    'typeVersion',
    'parameters',
    'expressions',
    'credentials',
    'uiMetadata',
    'importExport',
    'executionSemantics',
  ]);
});

test('an unchanged surface replays as unchanged', () => {
  const surface = {
    nodeType: 'n8n-nodes-base.httpRequest',
    typeVersion: '4.1',
    parameters: [{ name: 'url' }],
    expressions: ['{{$json.x}}'],
    credentials: ['httpBasicAuth'],
    uiMetadata: { color: '#404040' },
    importExport: { exportable: true },
    executionSemantics: 'pure-http',
  };
  const replay = validateCompatibility(surface, { ...surface });
  assert.equal(replay.ok, true);
  assert.equal(replay.kind, 'unchanged');
  assert.deepEqual(replay.changed, []);
});

test('a runtime move alone does not change the consumer contract', () => {
  // Rule 3: where a node runs is a policy outcome, not a contract change.
  const incumbent = { nodeType: 'n8n-nodes-base.set', typeVersion: '3', parameters: [], executionSemantics: 'set' };
  const upgraded = { ...incumbent, requestedLocality: 'ISOLATED_PROCESS' };
  const replay = validateCompatibility(upgraded, incumbent);
  assert.equal(replay.ok, true);
  assert.equal(replay.kind, 'unchanged');
});

test('a changed executionSemantics or nodeType is breaking, not a migration', () => {
  const incumbent = { nodeType: 'n8n-nodes-base.set', typeVersion: '3', executionSemantics: 'set', parameters: [] };
  const semantics = validateCompatibility({ ...incumbent, executionSemantics: 'async' }, incumbent);
  assert.equal(semantics.ok, false);
  assert.equal(semantics.kind, 'breaking');
  assert.ok(semantics.fatal.includes('executionSemantics'));

  const identity = validateCompatibility({ ...incumbent, nodeType: 'n8n-nodes-base.code' }, incumbent);
  assert.equal(identity.ok, false);
  assert.equal(identity.kind, 'breaking');
});

test('a changed parameter or UI surface is a migration, not a break', () => {
  const incumbent = { nodeType: 'n8n-nodes-base.set', typeVersion: '3', parameters: [{ name: 'a' }], uiMetadata: { color: '#000' } };
  const upgraded = { ...incumbent, parameters: [{ name: 'a' }, { name: 'b' }] };
  const replay = validateCompatibility(upgraded, incumbent);
  assert.equal(replay.ok, true);
  assert.equal(replay.kind, 'migration-required');
  assert.deepEqual(replay.changed, ['parameters']);
});

test('the pipeline replays the consumer contract against the incumbent', () => {
  const incumbent = {
    nodeType: 'n8n-nodes-base.httpRequest',
    typeVersion: '4.1',
    parameters: [],
    executionSemantics: 'pure-http',
  };
  const breaking = admitNode(candidate({ ...incumbent, executionSemantics: 'streaming' }), context({ incumbent }));
  assert.equal(breaking.decision, 'reject');
  assert.equal(breaking.failedStage, 'validate-compatibility');
  assert.deepEqual([...breaking.reasons], ['SEMANTICS_CHANGED']);

  const safe = admitted({ ...incumbent }, { incumbent });
  assert.equal(safe.compatibility, 'unchanged');
});

test('a candidate that declares itself breaking is refused even with no incumbent', () => {
  const verdict = admitNode(candidate({ compatibility: 'breaking' }), context());
  assert.equal(verdict.decision, 'reject');
  assert.equal(verdict.failedStage, 'validate-compatibility');
});

// --------------------------------------------------------------------- health

test('a quarantined node is refused regardless of its metadata', () => {
  const verdict = admitNode(candidate({ health: { state: 'quarantined' } }), context());
  assert.equal(verdict.decision, 'reject');
  assert.equal(verdict.failedStage, 'health-selftest');
  assert.deepEqual([...verdict.reasons], ['NODE_QUARANTINED']);
  // Quarantine outranks every other observation: a perfect package is still out.
  assert.equal(verdict.trace.filter((entry) => entry.status === 'passed').length, ADMISSION_STAGES.length - 2);
});

test('a healthy node with a passing self-test is admitted', () => {
  const verdict = admitted({ health: { state: 'healthy' }, selfTest: { passed: true } });
  assert.equal(verdict.decision, 'admit');
});

// --------------------------------------------------------------- explain / err

test('explainAdmission names the failing stage and never returns a bare boolean', () => {
  const ok = admitted();
  assert.ok(explainAdmission(ok).startsWith('admitted n8n-nodes-base.httpRequest@4.1 as TRUSTED on IN_PROCESS'));

  const bad = admitNode(candidate({ nodeClass: 'nope' }), context());
  const text = explainAdmission(bad);
  assert.ok(text.startsWith('rejected at identify:'), text);
  assert.ok(text.includes('nodeClass must be one of'), text);
});

test('explainAdmission rejects a malformed verdict', () => {
  assert.throws(
    () => explainAdmission({ decision: 'maybe' }),
    (error) => error instanceof NodeAdmissionError && error.code === 'lego.contract_violation',
  );
});

test('a malformed call is a contract violation, not a rejection', () => {
  assert.throws(
    () => admitNode(null),
    (error) => error instanceof NodeAdmissionError && error.code === 'lego.contract_violation',
  );
  assert.throws(
    () => admitNode(candidate(), 'not-a-context'),
    (error) => error instanceof NodeAdmissionError && error.code === 'lego.contract_violation',
  );
});

// ------------------------------------------------------------------ determinism

test('equal candidates produce equal verdicts', () => {
  const a = admitNode(candidate(), context());
  const b = admitNode(candidate(), context());
  assert.deepEqual(a, b);
});

test('the verdict is derived: the same candidate never yields two decisions', () => {
  for (let round = 0; round < 5; round += 1) {
    assert.equal(admitNode(candidate(), context()).decision, 'admit');
    assert.equal(
      admitNode(candidate({ nodeClass: 'unverified-community' }), context()).decision,
      'admit',
    );
    assert.equal(admitNode(candidate({ provenance: { kind: 'x', verified: true } }), context()).decision, 'reject');
  }
});

test('the verdict is frozen and its trace is bounded', () => {
  const verdict = admitted();
  assert.ok(Object.isFrozen(verdict));
  assert.ok(Object.isFrozen(verdict.trace));
  assert.ok(verdict.trace.every((entry) => Object.isFrozen(entry)));
  assert.ok(verdict.trace.length <= ADMISSION_BOUNDS.maxStageTrace);
});
