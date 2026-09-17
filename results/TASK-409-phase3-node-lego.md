# TASK-409-phase3-node-lego — evidence

**Status:** SUCCESS (submitted for review)
**Date:** 2026-09-18 · **Branch:** `arena/01a0aff8-n8n-rust-v-4`
**Scope:** Phase-3 JavaScript reconstruction of the Node Model pure-function surface, from the
pinned `reference/n8n` sources, as a zero-dependency ESM package.

## Deliverable

`packages/node-lego` — 10 source modules, 45 tests, 0 dependencies.

| Module | Lines reconstructed (pinned source) |
| :--- | :--- |
| `src/connection-io.mjs` | `node-helpers.ts` L247-258, L1104-1200, L1671-1686, L1921-1966 |
| `src/conditions.mjs` | `node-helpers.ts` L265-287, L330-401 |
| `src/display.mjs` | `node-helpers.ts` L290-328, L403-503 |
| `src/node-validation.mjs` | `node-validation.ts` (88 ln, whole file) |
| `src/parameter-utils.mjs` | `path-utils.ts` (24 ln), `rename-node-utils.ts` (29 ln), `node-parameter-value-type-guard.ts` (127 ln), `type-guards.ts` L15-39/L60-97, `node-helpers.ts` L1369-1375 |
| `src/parameter-type-validation.mjs` | `parameter-type-validation.ts` (272 ln, whole file) |
| `src/properties.mjs` | `node-helpers.ts` L1641-1919 |
| `src/errors.mjs` | `node-operation.error.ts` + `abstract/{node,execution-base}.error.ts` (validation boundary) |
| `src/lodash-lite.mjs` | DELTA-01: the `lodash/{get,isEqual,cloneDeep}` subset (no dependencies allowed) |
| `src/index.mjs` | 54-symbol public surface, all documented in `contracts/node.contract.md` §12 |

## Verification

```
node --test packages/node-lego/test/*.test.mjs
# tests 45 · pass 45 · fail 0

node tools/node-lego-differential.mjs
# NODE LEGO DIFFERENTIAL: 234 agree / 0 diverge / 234 comparisons (2 NOT-DIFFABLE, 0 harness errors)
# reference: n8n-workflow@2.9.1 (published build of the pinned version)

node tools/node-lego-gate.mjs
[PASS] N01 zero runtime dependencies — 0 dependencies
[PASS] N02 source boundary is import-closed — 10 source files, no cross-LEGO imports
[PASS] N03 node-model conformance suite — 45 pass / 0 fail
[PASS] N04 reference tree remains pinned — Reference integrity check: PASS (15050 files, root f8da35180669d798…)
[PASS] N05 differential vs the published reference build — 234 agree / 0 diverge across 234 comparisons (2 NOT-DIFFABLE, 0 harness errors)
[PASS] N06 formal contract + isolation doc present — contract §12 + docs/isolation/node.md §5
[PASS] N07 every exported symbol is documented in the contract — 54 exported symbols documented
Node LEGO gate: 7/7 PASS

npm run verify:all   # isolation:check + reconstructed-engine + execution:gate 10/10 +
                     # connection-lego 52/52 + trigger:gate 5/5 + webhook:gate 5/5 + node:gate 7/7 → exit 0
node tests/compatibility/contract_conformance.mjs   # RESULT: 42/42 CHECKS PASSED
python3 tests/integration/boundary_audit.py         # AUDIT RESULT: PASS (all edges documented)
```

## Differential method (and why it is acceptance-grade)

`tools/node-lego-differential.mjs` runs 15 scenario groups (N01…N15) **twice** — against the
reconstruction and against the *published* `n8n-workflow@2.9.1` build (resolved from
`packages/workflow-lego/node_modules`, where the Phase-2 LEGO already declares it as a
devDependency; it is the version the pinned reference commit ships). Outcomes (values, thrown
class names/messages, error field shapes) are compared one by one.

* **234 comparisons, 234 agree, 0 diverge.** Acceptance (DIFF-01) is MATCH, and it holds.
* **2 NOT-DIFFABLE surfaces** listed explicitly: `renameFormFields` (not re-exported by the
  published build — internal call site only) and `getPropertyValues` (private in the reference
  module; covered through `displayParameter` scenarios).
* **Falsifiability checked:** injecting two behavioral mutations (dropping the
  `checkConditions` empty-actual-values rule and the `displayParameter` expression
  short-circuit) produced `2 diverge / 232 agree`, each mutation caught by a distinct
  comparison; both were reverted before the recorded run. The harness is not vacuous.

### Divergences the harness caught during development (both fixed in the port)

1. **`getConnectionTypes`** — the pinned source filters *after* mapping, so a literal
   `undefined` entry throws `TypeError: Cannot read properties of undefined (reading 'type')`;
   the first port silently dropped it. Now verbatim (pinned quirk, asserted in the suite).
2. **`NodeOperationError`** — the reference raises `NodeOperationError` (name, `level: 'info'`,
   `node` identity, `context`, `messages`, `timestamp`); the first port raised a local
   `NodeParameterValidationError`. `src/errors.mjs` now matches field-for-field.
   Duplication with `packages/execution-engine/src/errors.mjs` recorded as **ISSUE-024**.

## Scope / boundaries

* `reference/n8n/**`, `packages/workflow-lego/**`, `packages/execution-engine/**` and all peer
  LEGO packages are untouched (allowed-paths list in `tasks/TASK-409-phase3-node-lego.yaml`).
* Explicitly **not** reconstructed (contract §12.2.3): the parameter-issues engine
  (`getNodeParameters`, `getNodeParametersIssues`, `getParameterIssues`), `getContext`, webhook
  path helpers, `filter-parameter.ts` (expressions track).
* Reproduce the differential after a fresh clone: `npm install --prefix packages/workflow-lego`
  (brings the pinned `n8n-workflow@2.9.1`), then `npm run node:diff`.

## Artifacts

* `packages/node-lego/**` (source + suite), `tools/node-lego-differential.mjs`,
  `tools/node-lego-gate.mjs`, `docs/isolation/evidence/node-lego-gate.json`
* `contracts/node.contract.md` §12 (module map, deltas, acceptance evidence),
  `docs/isolation/node.md` §5 (isolation record), README status row, `LEGO-MASTER-MAP.md` §5 row
* `docs/isolation/CROSS-AGENT-ISSUES.md` ISSUE-024 (error-model consolidation)
