# TASK RESULT: TASK-WORKFLOW-MODEL-03

- **STATUS**: `SUCCESS`
- **AGENT**: `arena-worker`
- **LEGO COMPONENT**: `workflow`
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18 (measured on base `f83c3f4b`)`

---

`packages/workflow-model-lego`'s `Workflow` class was still missing six of the reference's 27
members even after the frozen §6 surface was closed: `getStaticData`, `setTestStaticData`,
`getTriggerNodes`, `getPollNodes`, `queryNodes` and `getConnectionsBetweenNodes`. All six are now
reconstructed 1:1 from `reference/n8n/packages/workflow/src/workflow.ts` (L210-243, 246-248,
250-256, 258-264, 266-296, 892-925), and a `comm` over the reference's method declarations and
the reconstruction's now reports **27 vs 27 with an empty difference set in both directions** — the
aggregate is complete, not merely frozen-surface-complete. Rather than hand-writing expectations,
they are verified **differentially against the published `n8n-workflow@2.9.1` build** (the same
technique as `tools/node-lego-differential.mjs` N05): 3 fixture cases × 17 probes = **51
comparisons, 0 divergences**, each probe run on a freshly constructed pair so the stateful members
cannot leak. That differential immediately paid for itself — it caught a real defect in code that
TASK-01/02 had shipped and that all 61 tests were green on.

## The defect the differential caught

`src/errors.ts` set `this.name` to the class name on both error types. **Neither reference class
assigns `this.name`** (`errors/base/base.error.ts`, `@n8n/errors/src/application.error.ts:9-32`), so
both report the inherited `name === 'Error'` and only `constructor.name` carries the class name.
Six comparisons diverged (`mine: "ApplicationError"` vs `theirs: "Error"`). No existing test could
see it: `tests/reference/workflow-rust/fixtures.json` records `errorName: error.constructor?.name`
(`build-fixtures.mjs:255`), which is unaffected either way. The same read of `base.error.ts` showed
`UserError` was also missing `shouldReport`, `tags` and `extra`, and defaulted `level` to
`undefined` instead of `'info'` — which is precisely what makes `shouldReport` false. All fixed,
and now field-for-field equal to the published build:

```text
mine       UserError  name="Error" ctor=UserError level="info" shouldReport=false
reference  UserError  name="Error" ctor=UserError level="info" shouldReport=false
mine       ApplicationError name="Error" ctor=ApplicationError level="error"
```

---

## Machine evidence

```
$ npm --prefix packages/workflow-model-lego test
# tests 61        # conformance 46 + disabled-graph 8 + static-data-queries 7
# pass 61
# fail 0
# skipped 0
TEST_EXIT=0

$ ./node_modules/.bin/tsc -p tsconfig.json          # strict
TSC=0

$ node tests/compatibility/contract_conformance.mjs
RESULT: 42/42 CHECKS PASSED

$ python3 tests/integration/boundary_audit.py
AUDIT RESULT: PASS (all edges documented)

$ node tools/workflow-isolation-gate.mjs
gates: 11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED

$ NODE_PATH=$PWD/.runtime/node_modules node tests/reference/harness/run.js
REFERENCE TESTS: 18 PASS / 0 FAIL / 0 UNKNOWN

$ node tests/reference/workflow-rust/build-fixtures.mjs --check
fixtures match the pinned reference: 8 checksum, 6 diff, 6 shape, 6 rename, 9 traversal cases

$ npm run verify:all
VERIFY_ALL=0
```

Lane suites on the same tree: connection 58 · expression 46 · node 93 · validation 20 ·
persistence 13 · trigger 11 · webhook 10 · scheduler 9 (all exit 0).

## What the probes cover

| probe group | pinned behaviour |
| :--- | :--- |
| `getStaticData('global' \| 'node')` | lazy bucket creation, per-`node:<name>` key isolation, `ObservableObject` parenting so a write sets `staticData.__dataChanged` |
| error paths | `'node'` without a node → `ApplicationError`; unknown type → `ApplicationError` with `extra: { contextType }`; both with `name === 'Error'` |
| `setTestStaticData` | short-circuit on a **truthy** bucket, fall-through on a falsy one |
| `getTriggerNodes` / `getPollNodes` / `queryNodes` | `disabled === true` is skipped **before** the type lookup, so a disabled trigger is never offered to `checkFunction`; iteration is `Object.keys` insertion order |
| `getConnectionsBetweenNodes` | key-insertion order, `parseInt` re-parse of string keys, destination returned **by identity**, `null` sparse slots skipped, unknown sources contribute nothing |

Four negative controls assert the oracle actually discriminates: reversing `queryNodes` order,
forgetting the disabled filter, using presence instead of truthiness for the test-data
short-circuit, and copying the destination connection instead of referencing it.

## Honest limits

- The differential's oracle is `n8n-workflow@2.9.1` (a devDependency of `packages/workflow-lego`)
  while the pinned source tree is 2.9.4. The six members under test are identical between them;
  the delta is reported rather than hidden.
- `node_modules` is gitignored, so on a bare clone the reference build is absent. The differential
  then reports itself **skipped** with a fix hint and contributes nothing to the agreement count —
  it can never pass silently. On this tree it ran: `0 skipped`.
- The reference error constructors derive `tags.packageName` from `callsites()[2].getFileName()`.
  That needs the `callsites` package and reads the caller's path, so it is not reproduced; no
  fixture or differential observes it.

## Hygiene fix included

`docs/isolation/LEGO-MASTER-MAP.md` had **three** copies of the `TASK-WORKFLOW-MODEL-01` row, two of
`TASK-409-phase3-node-lego`, and one line with two table rows glued together
(`… **VERIFIED** || \`TASK-…`). That was an artefact of the keep-both conflict resolver used while
pushing TASK-02, i.e. my own. The glued row was split, superseded duplicates dropped, and the pool
table now has **18 rows with every task id exactly once** (verified by a counting script, not by
eye).
