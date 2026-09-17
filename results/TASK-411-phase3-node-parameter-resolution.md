# TASK-411-phase3-node-parameter-resolution — evidence

**Status:** SUCCESS (submitted for review)
**Date:** 2026-09-18 · **Branch:** `arena/01a0aff8-n8n-rust-v-4`
**Continues:** TASK-409-phase3-node-lego (same package; contract §12)

## Deliverable

`packages/node-lego` grew from 10 to 13 source modules and from 45 to **58 tests**; the
parameter resolver that the editor and the validation path use is now runnable off the pinned
reference tree.

| New/changed module | Reference lines reconstructed |
| :--- | :--- |
| `src/parameter-resolution.mjs` | `node-helpers.ts` `getParameterDependencies` L542-575, `getParameterResolveOrder` L577-656, `getNodeParameters` L658-1056 |
| `src/deep-copy.mjs` | `utils.ts` `deepCopy` L53-87 (verbatim: `toJSON`-first, `WeakMap` cycles, plain-object clones) |
| `src/expression-helpers.mjs` | `expressions/expression-helpers.ts` `isExpression` L1-10 |
| `src/errors.mjs` (extended) | `@n8n/errors` `application.error.ts` — `ApplicationError` incl. the pinned `name === 'Error'` quirk |
| `src/connection-io.mjs`, `src/lodash-lite.mjs`, `src/index.mjs` | `getNodeOutputs` now uses the reference's `deepCopy`; lodash delta shrinks to `get`/`isEqual`; 57 exported symbols |

## Verification

```
node --test packages/node-lego/test/*.test.mjs
# tests 58 · pass 58 · fail 0

node tools/node-lego-differential.mjs
# NODE LEGO DIFFERENTIAL: 315 agree / 0 diverge / 315 comparisons (2 NOT-DIFFABLE, 0 harness errors)
# reference: n8n-workflow@2.9.1 (published build of the pinned version)

node tools/node-lego-gate.mjs
[PASS] N01 zero runtime dependencies — 0 dependencies
[PASS] N02 source boundary is import-closed — 13 source files, no cross-LEGO imports
[PASS] N03 node-model conformance suite — 58 pass / 0 fail
[PASS] N04 reference tree remains pinned — Reference integrity check: PASS (15050 files, root f8da35180669d798…)
[PASS] N05 differential vs the published reference build — 315 agree / 0 diverge across 315 comparisons (2 NOT-DIFFABLE, 0 harness errors)
[PASS] N06 formal contract + isolation doc present — contract §12 + docs/isolation/node.md §5
[PASS] N07 every exported symbol is documented in the contract — 57 exported symbols documented
Node LEGO gate: 7/7 PASS
```

## What the differential added

| Group | Comparisons | Content |
| :--- | ---: | :--- |
| `N16` | 56 | 14 fixtures (plain values, `displayOptions` match/mismatch, duplicate names, `noDataExpression`, `resourceLocator`, collection single/multiple, fixedCollection multiple/single/default-only/empty/hidden-fields, `null` values, `/`-root rules) × `returnDefaults` × `returnNoneDisplayed` |
| `N17` | 11 | dependency-cycle termination, self-dependency, unknown fixedCollection option throw, `Date` through `deepCopy`, `onlySimpleTypes + dataIsResolved`, `parentType=collection`, `noDataExpression` on a number, non-array fixedCollection element, collection defaults, hidden parameter with defaults, empty collection value |
| `N18` | 9 | `deepCopy` (Date, primitives, function, cycle, nested array, prototype), `isExpression` matrix, `ApplicationError`/`NodeOperationError` field surfaces |

**Falsifiability (re-run for this slice):** two injected mutations — removing the
fixedCollection "value would get lost" early return and making `deepCopy` keep `Date` objects —
produced `313 agree / 2 diverge`; both were reverted before the recorded run.

## Reference behaviours pinned while porting (bug-for-bug, each verified)

1. `noDataExpression` strips the leading `=` **only** on the `returnDefaults` path (the
   non-defaults branch `continue`s before the strip).
2. A collection with no values returns the collection default itself — child defaults are never
   materialised (`parentType === 'collection'` skips `undefined` children).
3. `getParameterResolveOrder`'s unresolved-dependency `continue` advances only the *dependency*
   loop, so a dependency cycle is re-queued once and then resolved anyway: cycles terminate
   instead of hanging, and both parameters come back when none-displayed values are requested.
   The `ApplicationError('Could not resolve parameter dependencies…')` guard stays in place.
4. A non-array `fixedCollection` element is iterated with `for…of`: a string yields one empty
   object per character (the reference guards only the outer value).
5. `ApplicationError` never sets `name`, so guard errors surface as `name === 'Error'`.

## Boundaries

* `reference/n8n/**`, peer LEGO packages and the execution engine are untouched (allowed-paths
  list in `tasks/TASK-411-phase3-node-parameter-resolution.yaml`).
* Still **not** reconstructed (contract §12.2.5): the parameter-issues engine
  (`getNodeParametersIssues`, `getParameterIssues`, `mergeIssues` — needs the field-type
  validation and `filter-parameter.ts` ports), `getContext`, webhook path helpers.
* Reproduce after a fresh clone: `npm install --prefix packages/workflow-lego`, then
  `npm run node:diff`.

## Post-task consensus / verification sweep (offline; `task_consensus_votes` unreachable, ISSUE-019)

Read-only sweep on the working tip, reproducing every peer claim from scratch:

| Claim (peer lane) | Reproduced |
| :--- | :--- |
| execution-engine suite + gate | `60/60` · `10/10 PASS` (`E08 60 exported symbols`, `E10 20 pass / 0 fail`) |
| trigger-lego | `11/11` |
| scheduler-lego | `9/9` |
| webhook-lego | `10/10` |
| connection-lego | `52/52` (tsc build + suite) |
| expression-lego | `46/46` |
| engine differential | `84 agree / 0 diverge` |
| activation differential | `43 agree / 0 diverge` |
| node differential (this lane) | `315 agree / 0 diverge / 0 harness errors` |
| node suite + gate | `58/58` · `7/7 PASS` |
| workflow-model-lego (peer) | `26/26` (tsc build + suite; needs `npm install` in the package) |
| persistence-lego (peer) | `13/13` · gate `6/6` |
| reconstructed-engine | `28/28` |
| `npm run verify:all` | exit `0` — 8 gates: execution 10/10 · connection 52/52 · workflow-model 26/26 · reconstructed-engine 28/28 · trigger 5/5 · webhook 5/5 · scheduler 6/6 · node 7/7 · persistence 6/6 |
| `contract_conformance` / `boundary_audit` | `42/42 CHECKS PASSED` · `PASS (all edges documented)` |
| reference pin | `15050 files, root f8da35180669d798…` |

* **No `NEEDS_CORRECTION` raised** — every claim reproduced. Known non-green instrument remains
  `tests/integration/result_integrity_audit.py` (pre-existing T1 empty-ops in older peer files,
  documented by TASK-ENGINE-VERIFY-02; not rewritten, per ISSUE-020).
* **No self-approval:** TASK-409 and TASK-410 stay `SUBMITTED_FOR_REVIEW`; this sweep records
  evidence only.
* Sweep side effects: gate-evidence timestamp churn reverted; tree clean apart from the files
  these tasks own.
* Fresh-clone prerequisite observed again (not a regression): `workflow-model-lego`'s `npm test`
  runs `tsc` first, so `npm install` inside that package is required before `verify:all`
  (documented by its own README; the failure mode without it is `sh: 1: tsc: not found`, exit 127).
