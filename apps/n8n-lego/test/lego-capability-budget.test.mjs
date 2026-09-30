/**
 * P2-M01 — Lazy tool/skill discovery + token-aware capability budgets
 * (activated from FUTURE-AI-ECOSYSTEM-S01; legacy P18, issue #234 / #418).
 *
 * Tests the five canonical P2-M01 deliverables plus P5 authority/security and
 * boundary invariants:
 *   1. Lazy tool / skill discovery (FUTURE-AI-ECOSYSTEM-F-P18-001)
 *   2. Progressive capability discovery (FUTURE-AI-ECOSYSTEM-F-P18-002)
 *   3. On-demand tool schema loading (FUTURE-AI-ECOSYSTEM-F-P18-003)
 *   4. Token / context-aware capability budgets (FUTURE-AI-ECOSYSTEM-F-P18-004)
 *   5. Agent runtime workload admission (FUTURE-AI-ECOSYSTEM-F-P18-005)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPABILITY_BUDGET_CONTRACT,
  CAPABILITY_BUDGET_VERSION,
  CAPABILITY_KINDS,
  DISCOVERY_TIERS,
  CAPABILITY_AVAILABILITY,
  CAPABILITY_SIDE_EFFECTS,
  BUDGET_SCOPES,
  TOKEN_PROVENANCE,
  ADMISSION_POLICIES,
  ADMISSION_DECISIONS,
  CAPABILITY_BUDGET_LIMITS,
  CAPABILITY_ID_PATTERN,
  CAPABILITY_ERROR_CODES,
  CapabilityBudgetError,
  assertNoSecretsInCapability,
  estimateCapabilityTokens,
  createCapabilityBudget,
  createCapabilityDiscoveryCatalog,
  admitAgentWorkload,
} from '../src/lego/capability-budget.mjs';
import { createSkillRegistry } from '../src/lego/skill.mjs';
import { createTokenUsageFoundation } from '../src/lego/token-usage.mjs';
import { createAgentMachineRuntime } from '../src/lego/agent-machine-runtime.mjs';

function makeSampleCatalog(options = {}) {
  const catalog = createCapabilityDiscoveryCatalog(options);
  let httpSchemaCalls = 0;
  let sqlSchemaCalls = 0;
  let triageSchemaCalls = 0;
  let triageProcedureCalls = 0;

  catalog.register({
    id: 'tool.http.get',
    kind: 'tool',
    summary: 'Fetch a JSON or text resource over HTTP GET (read-only).',
    tags: ['http', 'network', 'fetch'],
    requiredCapabilities: ['ai.tool-gateway'],
    sideEffects: 'read-only',
    priority: 30,
    summaryTokens: 18,
    schemaTokens: 60,
    loadSchema: () => {
      httpSchemaCalls += 1;
      return {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'HTTPS target URL' },
          timeoutMs: { type: 'integer', description: 'Request timeout in ms' },
        },
        required: ['url'],
      };
    },
  });

  catalog.register({
    id: 'tool.sql.query',
    kind: 'tool',
    summary: 'Execute a parameterized read-only SQL query against data tables.',
    tags: ['sql', 'database', 'query'],
    requiredCapabilities: ['ai.tool-gateway', 'data-tables.query'],
    sideEffects: 'read-only',
    priority: 20,
    summaryTokens: 20,
    schemaTokens: 90,
    loadSchema: () => {
      sqlSchemaCalls += 1;
      return {
        type: 'object',
        properties: {
          statement: { type: 'string', description: 'Parameterized SELECT query' },
          parameters: { type: 'array', description: 'Positional bind parameters' },
          maxRows: { type: 'integer', description: 'Row cap' },
        },
        required: ['statement'],
      };
    },
  });

  catalog.register({
    id: 'skill.incident.triage',
    kind: 'skill',
    summary: 'Structured workflow failure triage and root-cause classification procedure.',
    tags: ['triage', 'incident', 'diagnostics'],
    requiredCapabilities: ['ai.skill', 'observability.diagnostics'],
    sideEffects: 'read-only',
    priority: 40,
    summaryTokens: 22,
    schemaTokens: 50,
    procedureTokens: 120,
    loadSchema: () => {
      triageSchemaCalls += 1;
      return {
        type: 'object',
        properties: {
          executionId: { type: 'string', description: 'Failed execution identifier' },
        },
        required: ['executionId'],
      };
    },
    loadProcedure: () => {
      triageProcedureCalls += 1;
      return {
        steps: [
          { id: 'collect-diagnostics', action: 'Inspect execution diagnostics bundle' },
          { id: 'classify-root-cause', action: 'Map failure to deterministic taxonomy' },
        ],
      };
    },
  });

  return {
    catalog,
    counts: () => ({
      httpSchemaCalls,
      sqlSchemaCalls,
      triageSchemaCalls,
      triageProcedureCalls,
    }),
  };
}

test('contract constants and vocabularies are frozen and deterministic', () => {
  assert.equal(CAPABILITY_BUDGET_CONTRACT, 'ai.capability-budget@1.0.0');
  assert.equal(CAPABILITY_BUDGET_VERSION, '1.0.0');
  assert.ok(Object.isFrozen(CAPABILITY_KINDS));
  assert.ok(Object.isFrozen(DISCOVERY_TIERS));
  assert.ok(Object.isFrozen(CAPABILITY_AVAILABILITY));
  assert.ok(Object.isFrozen(CAPABILITY_SIDE_EFFECTS));
  assert.ok(Object.isFrozen(BUDGET_SCOPES));
  assert.ok(Object.isFrozen(TOKEN_PROVENANCE));
  assert.ok(Object.isFrozen(ADMISSION_POLICIES));
  assert.ok(Object.isFrozen(ADMISSION_DECISIONS));
  assert.ok(Object.isFrozen(CAPABILITY_BUDGET_LIMITS));
  assert.ok(Object.isFrozen(CAPABILITY_ERROR_CODES));
  assert.deepEqual(DISCOVERY_TIERS, ['L0_INDEX', 'L1_SUMMARY', 'L2_SCHEMA', 'L3_PROCEDURE']);

  assert.throws(
    () => new CapabilityBudgetError('UNKNOWN_CODE', 'bad'),
    /unknown error code/,
  );
  const err = new CapabilityBudgetError(CAPABILITY_ERROR_CODES.INVALID, 'bad input', { field: 'x' });
  assert.equal(err.code, 'CAPABILITY_BUDGET_INVALID');
  assert.ok(Object.isFrozen(err.details));
  assert.ok(CAPABILITY_ID_PATTERN.test('tool.http.get'));
});

test('F-P18-001: lazy tool and skill discovery never invokes schema or procedure loaders during registration, indexing, summarizing, or search', () => {
  const { catalog, counts } = makeSampleCatalog();

  // Registration must not invoke any loader.
  assert.deepEqual(counts(), {
    httpSchemaCalls: 0,
    sqlSchemaCalls: 0,
    triageSchemaCalls: 0,
    triageProcedureCalls: 0,
  });

  // L0 index lookup must not invoke any loader.
  const idx = catalog.getIndexEntry('tool.http.get');
  assert.equal(idx.tier, 'L0_INDEX');
  assert.equal(idx.id, 'tool.http.get');
  assert.equal(idx.kind, 'tool');
  assert.ok(idx.indexTokens > 0);
  assert.ok(idx.indexTokens <= idx.summaryTokens);

  // L1 summary lookup must not invoke any loader.
  const summary = catalog.describeSummary('skill.incident.triage', {
    declaredCapabilities: ['ai.skill', 'observability.diagnostics'],
    authorizedCapabilities: ['skill.incident.triage', 'ai.skill', 'observability.diagnostics'],
  });
  assert.equal(summary.tier, 'L1_SUMMARY');
  assert.equal(summary.declared, true);
  assert.equal(summary.authorized, true);
  assert.equal(summary.schemaLoaded, false);

  // L0 and L1 discovery scans must not invoke any loader.
  const l0Scan = catalog.discover({ tier: 'L0_INDEX' });
  assert.equal(l0Scan.returnedCount, 3);
  assert.equal(l0Scan.authorityGranted, false);

  const l1Scan = catalog.discover({
    tier: 'L1_SUMMARY',
    query: 'http',
    declaredCapabilities: ['ai.tool-gateway'],
    authorizedCapabilities: ['tool.http.get', 'ai.tool-gateway'],
  });
  assert.equal(l1Scan.returnedCount, 1);
  assert.equal(l1Scan.items[0].id, 'tool.http.get');

  // Prove zero schema or procedure loads occurred across all discovery operations.
  assert.deepEqual(counts(), {
    httpSchemaCalls: 0,
    sqlSchemaCalls: 0,
    triageSchemaCalls: 0,
    triageProcedureCalls: 0,
  });
  const st = catalog.stats();
  assert.equal(st.schemaLoadCalls, 0);
  assert.equal(st.procedureLoadCalls, 0);
  assert.equal(st.discoveryCalls, 2);
});

test('F-P18-002: progressive capability discovery filters by query, tags, kinds, availability, limit, and tokenBudget', () => {
  const { catalog } = makeSampleCatalog();

  // Filter by tag and kind.
  const sqlOnly = catalog.discover({
    tier: 'L1_SUMMARY',
    tags: ['sql'],
    kinds: ['tool'],
  });
  assert.equal(sqlOnly.returnedCount, 1);
  assert.equal(sqlOnly.items[0].id, 'tool.sql.query');

  // Token budget truncation during L1 discovery: 3 items cost 22 + 18 + 20 = 60 tokens.
  // With tokenBudget = 40, only the top two priority items (22 + 18 = 40) fit.
  const budgeted = catalog.discover({
    tier: 'L1_SUMMARY',
    tokenBudget: 40,
  });
  assert.equal(budgeted.totalMatched, 3);
  assert.equal(budgeted.returnedCount, 2);
  assert.equal(budgeted.droppedCount, 1);
  assert.equal(budgeted.consumedTokens, 40);
  assert.equal(budgeted.truncatedByBudget, true);
  assert.deepEqual(
    budgeted.items.map((i) => i.id),
    ['skill.incident.triage', 'tool.http.get'],
  );

  // Bulk discover() refuses L2_SCHEMA and L3_PROCEDURE tiers.
  assert.throws(
    () => catalog.discover({ tier: 'L2_SCHEMA' }),
    (err) => err.code === CAPABILITY_ERROR_CODES.INVALID,
  );
  assert.throws(
    () => catalog.discover({ tier: 'L3_PROCEDURE' }),
    (err) => err.code === CAPABILITY_ERROR_CODES.INVALID,
  );
});

test('F-P18-003: on-demand tool schema and skill procedure loading loads only selected items and supports optional caching', () => {
  let loaderCount = 0;
  const catalog = createCapabilityDiscoveryCatalog();
  catalog.register({
    id: 'tool.cached.search',
    kind: 'tool',
    summary: 'Search indexed workflow artifacts.',
    tags: ['search'],
    requiredCapabilities: ['ai.tool-gateway'],
    sideEffects: 'read-only',
    cacheSchema: true,
    loadSchema: () => {
      loaderCount += 1;
      return {
        type: 'object',
        properties: {
          q: { type: 'string' },
        },
        required: ['q'],
      };
    },
  });

  const declared = ['ai.tool-gateway'];
  const authorized = ['tool.cached.search', 'ai.tool-gateway'];

  const first = catalog.loadSchema('tool.cached.search', {
    declaredCapabilities: declared,
    authorizedCapabilities: authorized,
  });
  assert.equal(first.tier, 'L2_SCHEMA');
  assert.equal(first.status, 'loaded');
  assert.equal(loaderCount, 1);
  assert.ok(Object.isFrozen(first.schema));
  assert.ok(Object.isFrozen(first.schema.properties));

  // Second load uses cached validated schema without re-running loader callback.
  const second = catalog.loadSchema('tool.cached.search', {
    declaredCapabilities: declared,
    authorizedCapabilities: authorized,
  });
  assert.equal(second.schema, first.schema);
  assert.equal(loaderCount, 1);
  assert.equal(catalog.stats().schemaLoadCalls, 1);
});

test('F-P18-004: token and context-aware capability budgets track allocations, enforce ceilings, and record honest provenance', () => {
  const est = estimateCapabilityTokens({ type: 'object', properties: { a: { type: 'string' } } });
  assert.equal(est.status, 'estimated');
  assert.equal(est.estimator, 'utf8-quarter-byte-v1');
  assert.ok(est.tokens > 0);

  const rep = estimateCapabilityTokens({ type: 'object' }, 42);
  assert.equal(rep.status, 'reported');
  assert.equal(rep.estimator, null);
  assert.equal(rep.tokens, 42);

  assert.throws(
    () => estimateCapabilityTokens({ type: 'object' }, 0),
    (err) => err.code === CAPABILITY_ERROR_CODES.INVALID,
  );

  const budget = createCapabilityBudget({
    maxContextTokens: 1000,
    maxCapabilityBudgetTokens: 200,
    maxLoadedSchemas: 2,
    reserveResponseTokens: 200,
  });

  const a1 = budget.allocate({
    capabilityId: 'tool.http.get',
    kind: 'tool',
    tier: 'L2_SCHEMA',
    tokens: 80,
    tokenStatus: 'reported',
    scope: 'run',
    scopeRef: 'run-1',
    contextTokensUsed: 500,
  });
  assert.equal(a1.deduplicated, false);
  assert.equal(a1.allocation.tokens, 80);

  // Idempotent duplicate allocation of the same (scope, scopeRef, capabilityId, tier) does not double-count.
  const a1Dup = budget.allocate({
    capabilityId: 'tool.http.get',
    kind: 'tool',
    tier: 'L2_SCHEMA',
    tokens: 80,
    tokenStatus: 'reported',
    scope: 'run',
    scopeRef: 'run-1',
    contextTokensUsed: 500,
  });
  assert.equal(a1Dup.deduplicated, true);
  assert.equal(budget.snapshot({ scope: 'run', scopeRef: 'run-1', contextTokensUsed: 500 }).allocatedTokens, 80);

  // Second schema allocation of 90 tokens brings total to 170 <= 200 and schema count to 2 <= 2.
  budget.allocate({
    capabilityId: 'tool.sql.query',
    kind: 'tool',
    tier: 'L2_SCHEMA',
    tokens: 90,
    tokenStatus: 'reported',
    scope: 'run',
    scopeRef: 'run-1',
    contextTokensUsed: 500,
  });

  const snap = budget.snapshot({ scope: 'run', scopeRef: 'run-1', contextTokensUsed: 500 });
  assert.equal(snap.allocatedTokens, 170);
  assert.equal(snap.remainingCapabilityTokens, 30);
  assert.equal(snap.loadedSchemaCount, 2);
  assert.equal(snap.remainingSchemaSlots, 0);

  // Third L2 schema fails because maxLoadedSchemas (2) is reached.
  assert.throws(
    () =>
      budget.allocate({
        capabilityId: 'skill.incident.triage',
        kind: 'skill',
        tier: 'L2_SCHEMA',
        tokens: 10,
        scope: 'run',
        scopeRef: 'run-1',
        contextTokensUsed: 500,
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.EXHAUSTED && err.details.reason === 'max-loaded-schemas-exceeded',
  );

  // Release one schema and verify slot is recovered, then test context-window exhaustion.
  budget.release({ allocationId: a1.allocation.allocationId });
  assert.throws(
    () =>
      budget.allocate({
        capabilityId: 'skill.incident.triage',
        kind: 'skill',
        tier: 'L2_SCHEMA',
        tokens: 80,
        scope: 'run',
        scopeRef: 'run-1',
        contextTokensUsed: 650, // 1000 - 650 - 200(reserve) - 90(allocated) = 60 < 80
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.EXHAUSTED && err.details.reason === 'context-window-budget-exceeded',
  );

  // Reset scope clears all allocations for that scope.
  const resetRes = budget.resetScope({ scope: 'run', scopeRef: 'run-1' });
  assert.equal(resetRes.removed, 1);
  assert.equal(budget.snapshot({ scope: 'run', scopeRef: 'run-1' }).allocatedTokens, 0);
});

test('F-P18-005: agent runtime workload admission enforces atomic reject and degrade-to-lazy policies', () => {
  const { catalog, counts } = makeSampleCatalog();
  const declared = ['ai.tool-gateway', 'data-tables.query', 'ai.skill', 'observability.diagnostics'];
  const authorized = [
    'tool.http.get',
    'tool.sql.query',
    'skill.incident.triage',
    ...declared,
  ];

  // Case 1: Strict 'reject' policy when total tokens (50 + 60 + 90 = 200) exceed budget (120).
  const strictBudget = createCapabilityBudget({
    maxContextTokens: 2000,
    maxCapabilityBudgetTokens: 120,
    maxLoadedSchemas: 5,
    reserveResponseTokens: 200,
  });

  const rejected = admitAgentWorkload({
    catalog,
    budget: strictBudget,
    declaredCapabilities: declared,
    authorizedCapabilities: authorized,
    workload: {
      workloadId: 'workload-strict-1',
      scope: 'run',
      scopeRef: 'run-strict-1',
      contextTokensUsed: 100,
      admissionPolicy: 'reject',
      requestedCapabilities: [
        { id: 'skill.incident.triage', tier: 'L2_SCHEMA', priority: 40 },
        { id: 'tool.http.get', tier: 'L2_SCHEMA', priority: 30 },
        { id: 'tool.sql.query', tier: 'L2_SCHEMA', priority: 20 },
      ],
    },
  });

  assert.equal(rejected.admitted, false);
  assert.equal(rejected.decision, 'rejected');
  assert.equal(rejected.reason, CAPABILITY_ERROR_CODES.EXHAUSTED);
  // Atomic rollback: zero tokens remain allocated after rejection!
  assert.equal(rejected.budgetSnapshot.allocatedTokens, 0);
  assert.equal(rejected.budgetSnapshot.loadedSchemaCount, 0);
  // And sql.query schema loader was never even called because pre-check saw budget exhaustion.
  assert.equal(counts().sqlSchemaCalls, 0);

  // Case 2: 'degrade-to-lazy' policy with maxCapabilityBudgetTokens = 140:
  // - skill.incident.triage (L2_SCHEMA = 50 tokens, priority 40) -> admitted at L2_SCHEMA (50 used)
  // - tool.http.get (L2_SCHEMA = 60 tokens, priority 30) -> admitted at L2_SCHEMA (110 used)
  // - tool.sql.query (L2_SCHEMA = 90 tokens, priority 20) -> exceeds remaining 30, degrades to L1_SUMMARY (20 tokens, total 130 <= 140), and sql.query loadSchema() is NEVER called!
  const degradeBudget = createCapabilityBudget({
    maxContextTokens: 2000,
    maxCapabilityBudgetTokens: 140,
    maxLoadedSchemas: 5,
    reserveResponseTokens: 200,
  });

  const degraded = admitAgentWorkload({
    catalog,
    budget: degradeBudget,
    declaredCapabilities: declared,
    authorizedCapabilities: authorized,
    workload: {
      workloadId: 'workload-degrade-1',
      scope: 'run',
      scopeRef: 'run-degrade-1',
      contextTokensUsed: 100,
      admissionPolicy: 'degrade-to-lazy',
      requestedCapabilities: [
        { id: 'skill.incident.triage', tier: 'L2_SCHEMA', priority: 40 },
        { id: 'tool.http.get', tier: 'L2_SCHEMA', priority: 30 },
        { id: 'tool.sql.query', tier: 'L2_SCHEMA', priority: 20 },
      ],
    },
  });

  assert.equal(degraded.admitted, true);
  assert.equal(degraded.decision, 'degraded');
  assert.deepEqual(degraded.degradedCapabilities, ['tool.sql.query']);
  assert.equal(degraded.budgetSnapshot.allocatedTokens, 130);
  assert.equal(degraded.budgetSnapshot.loadedSchemaCount, 2);
  assert.equal(counts().sqlSchemaCalls, 0, 'degraded tool must not invoke its L2 schema loader');

  const sqlAdmitted = degraded.admittedCapabilities.find((c) => c.id === 'tool.sql.query');
  assert.equal(sqlAdmitted.requestedTier, 'L2_SCHEMA');
  assert.equal(sqlAdmitted.admittedTier, 'L1_SUMMARY');
  assert.equal(sqlAdmitted.schema, null);
});

test('P5 security invariant: capability discovery is not authorization and never grants access', () => {
  const { catalog, counts } = makeSampleCatalog();
  const declared = ['ai.tool-gateway', 'data-tables.query'];
  // Caller is only authorized for tool.http.get, NOT tool.sql.query.
  const authorized = new Set(['tool.http.get', 'ai.tool-gateway']);

  const discovered = catalog.discover({
    tier: 'L1_SUMMARY',
    declaredCapabilities: declared,
    authorizedCapabilities: authorized,
  });
  assert.equal(discovered.authorityGranted, false);
  const sqlCard = discovered.items.find((i) => i.id === 'tool.sql.query');
  assert.equal(sqlCard.declared, true);
  assert.equal(sqlCard.authorized, false);
  assert.equal(authorized.has('tool.sql.query'), false, 'discovery must never mutate caller authorization');

  // Attempting to load the discovered tool's schema fails closed with UNAUTHORIZED.
  assert.throws(
    () =>
      catalog.loadSchema('tool.sql.query', {
        declaredCapabilities: declared,
        authorizedCapabilities: authorized,
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.UNAUTHORIZED,
  );
  assert.equal(counts().sqlSchemaCalls, 0, 'unauthorized loadSchema must never invoke the loader callback');

  // Attempting to admit a workload with an unauthorized capability fails closed.
  const budget = createCapabilityBudget();
  assert.throws(
    () =>
      admitAgentWorkload({
        catalog,
        budget,
        declaredCapabilities: declared,
        authorizedCapabilities: authorized,
        workload: {
          workloadId: 'workload-unauth',
          requestedCapabilities: [{ id: 'tool.sql.query', tier: 'L2_SCHEMA' }],
        },
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.UNAUTHORIZED,
  );
});

test('P5 security invariant: raw secrets and credential fields are rejected at registration, schema load, procedure load, and workload admission', () => {
  const catalog = createCapabilityDiscoveryCatalog();

  // 1. Secret token in L1 summary at registration time.
  assert.throws(
    () =>
      catalog.register({
        id: 'tool.leaky.summary',
        kind: 'tool',
        summary: 'Uses token ghp_1234567890abcdefghijklmnopqrstuv in summary',
        sideEffects: 'read-only',
        loadSchema: () => ({ type: 'object' }),
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.SECRET_REJECTED,
  );

  // 2. Credential field name in loaded L2 schema.
  catalog.register({
    id: 'tool.leaky.schema-key',
    kind: 'tool',
    summary: 'Tool whose schema leaks an apiKey property.',
    sideEffects: 'read-only',
    loadSchema: () => ({
      type: 'object',
      properties: {
        apiKey: { type: 'string' },
      },
    }),
  });
  assert.throws(
    () =>
      catalog.loadSchema('tool.leaky.schema-key', {
        authorizedCapabilities: ['tool.leaky.schema-key'],
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.SECRET_REJECTED,
  );

  // 3. Raw secret value in loaded L2 schema description/default.
  catalog.register({
    id: 'tool.leaky.schema-val',
    kind: 'tool',
    summary: 'Tool whose schema leaks a Bearer secret in default value.',
    sideEffects: 'read-only',
    loadSchema: () => ({
      type: 'object',
      properties: {
        header: { type: 'string', default: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' },
      },
    }),
  });
  assert.throws(
    () =>
      catalog.loadSchema('tool.leaky.schema-val', {
        authorizedCapabilities: ['tool.leaky.schema-val'],
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.SECRET_REJECTED,
  );

  // 4. Raw private key in skill L3 procedure.
  catalog.register({
    id: 'skill.leaky.proc',
    kind: 'skill',
    summary: 'Skill whose procedure leaks a PEM private key.',
    sideEffects: 'read-only',
    loadSchema: () => ({ type: 'object' }),
    loadProcedure: () => ({
      steps: [{ id: 's1', note: '-----BEGIN RSA PRIVATE KEY-----' }],
    }),
  });
  assert.throws(
    () =>
      catalog.loadProcedure('skill.leaky.proc', {
        authorizedCapabilities: ['skill.leaky.proc'],
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.SECRET_REJECTED,
  );

  // Direct helper verification.
  assert.throws(
    () => assertNoSecretsInCapability({ client_secret: 'abc' }),
    (err) => err.code === CAPABILITY_ERROR_CODES.SECRET_REJECTED,
  );
});

test('boundary conditions: invalid inputs, undeclared capabilities, missing tools, unavailable providers, malformed schemas, catalog full, and CAS concurrency', () => {
  const catalog = createCapabilityDiscoveryCatalog({ maxCatalogSize: 2, maxSchemaBytes: 256 });

  // Invalid registration inputs.
  assert.throws(() => catalog.register(null), (err) => err.code === CAPABILITY_ERROR_CODES.INVALID);
  assert.throws(
    () =>
      catalog.register({
        id: 'bad id with spaces',
        kind: 'tool',
        summary: 'bad',
        sideEffects: 'read-only',
        loadSchema: () => ({ type: 'object' }),
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.INVALID,
  );
  assert.throws(
    () =>
      catalog.register({
        id: 'tool.empty.summary',
        kind: 'tool',
        summary: '   ',
        sideEffects: 'read-only',
        loadSchema: () => ({ type: 'object' }),
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.INVALID,
  );
  assert.throws(
    () =>
      catalog.register({
        id: 'tool.unknown.field',
        kind: 'tool',
        summary: 'Valid summary',
        sideEffects: 'read-only',
        extraField: true,
        loadSchema: () => ({ type: 'object' }),
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.INVALID,
  );

  // Register 2 valid items to hit maxCatalogSize = 2.
  catalog.register({
    id: 'tool.alpha',
    kind: 'tool',
    summary: 'Alpha tool',
    requiredCapabilities: ['cap.declared'],
    sideEffects: 'read-only',
    loadSchema: () => ({ type: 'object', properties: { x: { type: 'string' } } }),
  });

  // Duplicate id conflict.
  assert.throws(
    () =>
      catalog.register({
        id: 'tool.alpha',
        kind: 'tool',
        summary: 'Duplicate alpha tool',
        sideEffects: 'read-only',
        loadSchema: () => ({ type: 'object' }),
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.CONFLICT,
  );

  catalog.register({
    id: 'tool.malformed',
    kind: 'tool',
    summary: 'Tool returning malformed schema',
    sideEffects: 'read-only',
    loadSchema: () => ({ properties: { notTyped: 'bad' } }), // missing schema.type and non-object propDef
  });

  // 3rd registration fails closed with CATALOG_FULL (never evicts tool.alpha).
  assert.throws(
    () =>
      catalog.register({
        id: 'tool.overflow',
        kind: 'tool',
        summary: 'Overflow tool',
        sideEffects: 'read-only',
        loadSchema: () => ({ type: 'object' }),
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.CATALOG_FULL,
  );
  assert.equal(catalog.size(), 2);

  // Missing capability -> NOT_FOUND.
  assert.throws(
    () => catalog.getIndexEntry('tool.does.not.exist'),
    (err) => err.code === CAPABILITY_ERROR_CODES.NOT_FOUND,
  );

  // Undeclared required capability -> UNDECLARED.
  assert.throws(
    () =>
      catalog.loadSchema('tool.alpha', {
        declaredCapabilities: ['some.other.cap'],
        authorizedCapabilities: ['tool.alpha', 'cap.declared'],
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.UNDECLARED,
  );

  // Malformed schema -> MALFORMED_SCHEMA.
  assert.throws(
    () =>
      catalog.loadSchema('tool.malformed', {
        authorizedCapabilities: ['tool.malformed'],
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.MALFORMED_SCHEMA,
  );

  // Availability transition + CAS version check + unavailable rejection.
  const updated = catalog.updateAvailability('tool.alpha', 'unavailable', { expectedVersion: 1 });
  assert.equal(updated.availability, 'unavailable');
  assert.equal(updated.version, 2);
  assert.throws(
    () => catalog.updateAvailability('tool.alpha', 'available', { expectedVersion: 1 }),
    (err) => err.code === CAPABILITY_ERROR_CODES.CONFLICT,
  );
  assert.throws(
    () =>
      catalog.loadSchema('tool.alpha', {
        declaredCapabilities: ['cap.declared'],
        authorizedCapabilities: ['tool.alpha', 'cap.declared'],
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.UNAVAILABLE,
  );

  // Budget CAS concurrency conflict detection.
  const budget = createCapabilityBudget();
  const initialVersion = budget.version();
  budget.allocate({
    capabilityId: 'tool.alpha',
    kind: 'tool',
    tier: 'L1_SUMMARY',
    tokens: 15,
    scope: 'run',
    scopeRef: 'run-cas',
    expectedVersion: initialVersion,
  });
  // Concurrent writer using stale initialVersion must fail closed with CONFLICT.
  assert.throws(
    () =>
      budget.allocate({
        capabilityId: 'tool.malformed',
        kind: 'tool',
        tier: 'L1_SUMMARY',
        tokens: 15,
        scope: 'run',
        scopeRef: 'run-cas',
        expectedVersion: initialVersion,
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.CONFLICT,
  );
});

test('integration with P2 AI foundation: skill registry, token-usage store, and agent-machine-runtime', async () => {
  const skillRegistry = createSkillRegistry();
  let skillBodyLoads = 0;
  skillRegistry.register(
    {
      id: 'skill.workflow.audit',
      contractVersion: '1.0.0',
      implementationVersion: '1.0.0',
      owner: 'manager',
      title: 'Workflow Audit Skill',
      description: 'Audits workflow graph invariants before execution.',
      trust: 'core',
      requiredCapabilities: ['ai.skill'],
      produces: ['audit-report'],
    },
    {
      load: () => {
        skillBodyLoads += 1;
        return {
          procedure: ['Validate trigger nodes', 'Verify edge closure'],
          rules: ['Never mutate workflow state'],
        };
      },
    },
  );

  const { catalog } = makeSampleCatalog();
  catalog.register({
    id: 'skill.workflow.audit',
    kind: 'skill',
    summary: skillRegistry.describe('skill.workflow.audit').description,
    tags: ['audit', 'workflow'],
    requiredCapabilities: ['ai.skill'],
    sideEffects: 'read-only',
    priority: 50,
    loadSchema: () => ({
      type: 'object',
      properties: { workflowId: { type: 'string' } },
      required: ['workflowId'],
    }),
    loadProcedure: () => {
      skillRegistry.transition('skill.workflow.audit', 'available');
      skillRegistry.transition('skill.workflow.audit', 'selected');
      skillRegistry.load('skill.workflow.audit');
      const body = skillRegistry.bodyOf('skill.workflow.audit');
      return {
        steps: body.procedure.map((step, idx) => ({ id: `step-${idx + 1}`, action: step })),
      };
    },
  });

  assert.equal(skillBodyLoads, 0, 'registering bridge into discovery catalog keeps skillRegistry lazy');

  const budget = createCapabilityBudget({
    maxContextTokens: 4096,
    maxCapabilityBudgetTokens: 512,
    maxLoadedSchemas: 4,
    reserveResponseTokens: 512,
  });

  const declared = ['ai.skill', 'ai.tool-gateway', 'observability.diagnostics'];
  const authorized = [
    'skill.workflow.audit',
    'tool.http.get',
    'ai.skill',
    'ai.tool-gateway',
    'observability.diagnostics',
  ];

  const admission = admitAgentWorkload({
    catalog,
    budget,
    declaredCapabilities: declared,
    authorizedCapabilities: authorized,
    workload: {
      workloadId: 'agent-run-42',
      scope: 'run',
      scopeRef: 'agent-run-42',
      contextTokensUsed: 400,
      requestedCapabilities: [
        { id: 'skill.workflow.audit', tier: 'L3_PROCEDURE', priority: 50 },
        { id: 'tool.http.get', tier: 'L2_SCHEMA', priority: 30 },
      ],
    },
  });

  assert.equal(admission.admitted, true);
  assert.equal(admission.decision, 'admitted');
  assert.equal(skillBodyLoads, 1, 'L3_PROCEDURE admission triggered skillRegistry.load on demand');

  // Record the admitted capability token usage into canonical ai.token-usage@1.0.0 foundation.
  let seq = 0;
  const usageFoundation = createTokenUsageFoundation({
    now: () => '2026-09-30T12:00:00.000Z',
    newId: () => `rec-${++seq}`,
  });
  const usageRecord = usageFoundation.record({
    requestId: 'req-agent-run-42-cap-budget',
    scopeLevel: 'run',
    scopeRef: 'agent-run-42',
    kind: 'modelInput',
    value: admission.budgetSnapshot.allocatedTokens,
    unit: 'tokens',
    status: 'estimated',
    source: 'ai.capability-budget',
    estimator: 'utf8-quarter-byte-v1',
  });
  assert.equal(usageRecord.value, admission.budgetSnapshot.allocatedTokens);

  // Execute a bounded run on AgentMachineRuntime only after admission succeeded.
  const runtime = createAgentMachineRuntime({
    onNode: async (node) => ({ nodeId: node.id, admittedCapabilities: admission.admittedCapabilities.length }),
  });
  const created = runtime.create({
    machineId: 'mach-p2-m01',
    agentId: 'agent-p2-m01',
    taskId: 'task-p2-m01',
    sessionReference: 'session-p2-m01',
    budgets: { maxSteps: 4, maxDurationMs: 5000, maxReferences: 4 },
  });
  assert.equal(created.lifecycle, 'created');
  assert.equal(runtime.describe({ machineId: 'mach-p2-m01' }).machineId, 'mach-p2-m01');
});

test('schema structural boundary guards: circular references, prototype pollution, depth/property/byte/token ceilings, and loader failures', () => {
  const catalog = createCapabilityDiscoveryCatalog({
    maxSchemaBytes: 300,
    maxSchemaTokensPerItem: 50,
  });

  // 1. Circular schema reference -> MALFORMED_SCHEMA.
  catalog.register({
    id: 'tool.circular',
    kind: 'tool',
    summary: 'Tool with circular schema object.',
    sideEffects: 'read-only',
    loadSchema: () => {
      const a = { type: 'object', properties: {} };
      a.properties.self = a;
      return a;
    },
  });
  assert.throws(
    () => catalog.loadSchema('tool.circular', { authorizedCapabilities: ['tool.circular'] }),
    (err) => err.code === CAPABILITY_ERROR_CODES.MALFORMED_SCHEMA && /circular/i.test(err.message),
  );

  // 2. Non-plain object (class instance) -> MALFORMED_SCHEMA.
  class CustomField {}
  catalog.register({
    id: 'tool.nonplain',
    kind: 'tool',
    summary: 'Tool with class instance inside schema.',
    sideEffects: 'read-only',
    loadSchema: () => ({
      type: 'object',
      properties: { field: new CustomField() },
    }),
  });
  assert.throws(
    () => catalog.loadSchema('tool.nonplain', { authorizedCapabilities: ['tool.nonplain'] }),
    (err) => err.code === CAPABILITY_ERROR_CODES.MALFORMED_SCHEMA && /plain objects/i.test(err.message),
  );

  // 3. Function inside schema -> MALFORMED_SCHEMA.
  catalog.register({
    id: 'tool.fn',
    kind: 'tool',
    summary: 'Tool with function inside schema.',
    sideEffects: 'read-only',
    loadSchema: () => ({
      type: 'object',
      properties: { field: { type: 'string', validate: () => true } },
    }),
  });
  assert.throws(
    () => catalog.loadSchema('tool.fn', { authorizedCapabilities: ['tool.fn'] }),
    (err) => err.code === CAPABILITY_ERROR_CODES.MALFORMED_SCHEMA && /non-serializable/i.test(err.message),
  );

  // 4. Schema exceeding maxSchemaBytes (300) / maxSchemaTokensPerItem (50) -> MALFORMED_SCHEMA.
  catalog.register({
    id: 'tool.oversized',
    kind: 'tool',
    summary: 'Tool with oversized schema.',
    sideEffects: 'read-only',
    loadSchema: () => ({
      type: 'object',
      properties: {
        huge: { type: 'string', description: 'x'.repeat(400) },
      },
    }),
  });
  assert.throws(
    () => catalog.loadSchema('tool.oversized', { authorizedCapabilities: ['tool.oversized'] }),
    (err) => err.code === CAPABILITY_ERROR_CODES.MALFORMED_SCHEMA,
  );

  // 5. Throwing loader callback -> UNAVAILABLE.
  catalog.register({
    id: 'tool.throwing.loader',
    kind: 'tool',
    summary: 'Tool whose loader throws an unexpected provider error.',
    sideEffects: 'read-only',
    loadSchema: () => {
      throw new Error('provider socket closed');
    },
  });
  assert.throws(
    () =>
      catalog.loadSchema('tool.throwing.loader', {
        authorizedCapabilities: ['tool.throwing.loader'],
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.UNAVAILABLE && /provider socket closed/.test(err.message),
  );
});

test('workload admission boundary cases: pre-exhausted context window, L1 fallback exhaustion rollback, duplicate capabilities, and stale budget version', () => {
  const { catalog } = makeSampleCatalog();
  const declared = ['ai.tool-gateway', 'data-tables.query', 'ai.skill', 'observability.diagnostics'];
  const authorized = ['tool.http.get', 'tool.sql.query', 'skill.incident.triage', ...declared];

  const budget = createCapabilityBudget({
    maxContextTokens: 500,
    maxCapabilityBudgetTokens: 100,
    maxLoadedSchemas: 2,
    reserveResponseTokens: 100,
  });

  // 1. Pre-exhausted context window (contextTokensUsed 450 + reserve 100 >= 500).
  const preExhausted = admitAgentWorkload({
    catalog,
    budget,
    declaredCapabilities: declared,
    authorizedCapabilities: authorized,
    workload: {
      workloadId: 'workload-ctx-full',
      contextTokensUsed: 450,
      requestedCapabilities: [{ id: 'tool.http.get', tier: 'L2_SCHEMA' }],
    },
  });
  assert.equal(preExhausted.admitted, false);
  assert.equal(preExhausted.decision, 'rejected');
  assert.equal(preExhausted.reason, CAPABILITY_ERROR_CODES.EXHAUSTED);

  // 2. Degrade-to-lazy where even L1_SUMMARY fallback exceeds remaining budget -> atomic rollback!
  const tinyBudget = createCapabilityBudget({
    maxContextTokens: 500,
    maxCapabilityBudgetTokens: 55,
    maxLoadedSchemas: 2,
    reserveResponseTokens: 100,
  });
  // skill.incident.triage L2_SCHEMA costs 50 tokens (fits in 55, leaving 5 tokens).
  // tool.http.get degrades to L1_SUMMARY which costs 18 tokens (> 5 remaining) -> entire workload must reject and roll back skill.incident.triage!
  const fallbackExhausted = admitAgentWorkload({
    catalog,
    budget: tinyBudget,
    declaredCapabilities: declared,
    authorizedCapabilities: authorized,
    workload: {
      workloadId: 'workload-fallback-exhausted',
      scope: 'run',
      scopeRef: 'run-fb-ex',
      contextTokensUsed: 50,
      admissionPolicy: 'degrade-to-lazy',
      requestedCapabilities: [
        { id: 'skill.incident.triage', tier: 'L2_SCHEMA', priority: 40 },
        { id: 'tool.http.get', tier: 'L2_SCHEMA', priority: 30 },
      ],
    },
  });
  assert.equal(fallbackExhausted.admitted, false);
  assert.equal(fallbackExhausted.decision, 'rejected');
  assert.equal(fallbackExhausted.budgetSnapshot.allocatedTokens, 0, 'atomic rollback must leave 0 allocated tokens');

  // 3. Duplicate capability in workload -> INVALID.
  assert.throws(
    () =>
      admitAgentWorkload({
        catalog,
        budget,
        declaredCapabilities: declared,
        authorizedCapabilities: authorized,
        workload: {
          workloadId: 'workload-dup',
          requestedCapabilities: [
            { id: 'tool.http.get', tier: 'L1_SUMMARY' },
            { id: 'tool.http.get', tier: 'L2_SCHEMA' },
          ],
        },
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.INVALID,
  );

  // 4. Stale expectedBudgetVersion -> CONFLICT.
  assert.throws(
    () =>
      admitAgentWorkload({
        catalog,
        budget,
        declaredCapabilities: declared,
        authorizedCapabilities: authorized,
        workload: {
          workloadId: 'workload-stale-ver',
          expectedBudgetVersion: 999,
          requestedCapabilities: [{ id: 'tool.http.get', tier: 'L1_SUMMARY' }],
        },
      }),
    (err) => err.code === CAPABILITY_ERROR_CODES.CONFLICT,
  );
});
