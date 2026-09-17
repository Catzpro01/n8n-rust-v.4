# TASK-413-phase3-node-parameter-issues — evidence

**Status:** SUCCESS (submitted for review)
**Date:** 2026-09-18 · **Branch:** `arena/01a0aff8-n8n-rust-v-4`
**Continues:** TASK-409 (helpers) / TASK-411 (parameter resolution) — same package, contract §12

## Deliverable

`packages/node-lego` grew from 13 to **16 source modules**, from 58 to **82 tests** and from 57
to **81 exported symbols**: the validation half of the Node Model — "is this node configured
correctly?" — is now runnable off the pinned reference tree.

| Module (new) | Reference lines reconstructed |
| :--- | :--- |
| `src/type-validation.mjs` | `type-validation.ts` whole file (481 ln): `tryToParseNumber/String/AlphanumericString/Boolean/DateTime/Time/Array/Object/Binary/JsonToFormFields`, `getValueDescription`, `validateFieldType`; `utils.ts` `jsonParse` L152 + `parseJSObject` L123; `type-guards.ts` `isBinaryValue` L168 |
| `src/filter-parameter.mjs` | `node-parameters/filter-parameter.ts` VALIDATION half: `FilterError` L23, `parseSingleFilterValue` L32, `withIndefiniteArticle` L66, `parseFilterConditionValues` L71, `validateFilterParameter` L427-450 |
| `src/parameter-issues.mjs` | `node-helpers.ts` `getContext` L505-538, `getNodeParametersIssues` L1202-1225, `validateResourceLocatorParameter` L1228-1255, `validateResourceMapperParameter` L1257-1303, `validateParameter` L1305-1323, `addToIssuesIfMissing` L1325-1358, `getParameterIssues` L1389-1580, `mergeIssues` L1600-1635; `type-guards.ts` `isValidResourceLocatorParameterValue` L47-57 |

Supporting change: `lodash-lite.mjs` gained `isObject` (DELTA-01 subset is now `get`/`isEqual`/`isObject`).

## Verification

```
node --test packages/node-lego/test/node-model.test.mjs
# tests 82 · pass 82 · fail 0        (74 in node-model.test.mjs + 8 in the concurrent
#                                      parameter-issues.test.mjs — ISSUE-026)

node tools/node-lego-differential.mjs
# NODE LEGO DIFFERENTIAL: 1422 agree / 0 diverge / 1422 comparisons (2 NOT-DIFFABLE, 0 harness errors)
#   N19 validateFieldType matrix ............ 624
#   N20 tryToParse* / getValueDescription / jsonParse .. 392
#   N21 validateFilterParameter / FilterError ........... 12
#   N22 issues engine ................................... 58
#   (N01…N18 = the previously landed 315 comparisons, unchanged)

node tools/node-lego-gate.mjs
[PASS] N01 zero runtime dependencies — 0 dependencies
[PASS] N02 source boundary is import-closed — 16 source files, no cross-LEGO imports
[PASS] N03 node-model conformance suite — 82 pass / 0 fail
[PASS] N04 reference tree remains pinned — PASS (15050 files, root f8da35180669d798…)
[PASS] N05 differential vs the published reference build — 1422 agree / 0 diverge across 1422 comparisons (2 NOT-DIFFABLE, 0 harness errors)
[PASS] N06 formal contract + isolation doc present — contract §12 + docs/isolation/node.md §5
[PASS] N07 every exported symbol is documented in the contract — 81 exported symbols documented
Node LEGO gate: 7/7 PASS
```

**Falsifiability (re-run for this slice):** four injected behavioural mutations — min/max
field-count wording, the `value === undefined` branch of the required-string check,
`getValueDescription(null)`, and the filter dead-code path — produced
**1414 agree / 6 diverge**; each mutation was caught (the fourth is a no-op *by construction*:
making the unreachable `catch` initialise `issues[key]` changes nothing, which is itself
evidence for the pinned quirk). All mutations were reverted before the recorded run.

## Sanctioned deltas added (contract §12.2)

* **DELTA-04 — `luxon` → injected date-time factory.** Date-times go through an injected
  `dateTimeFactory` (`isDateTime`/`fromJSDate`/`fromISO`/`fromHTTP`/`fromRFC2822`/`fromSQL`/
  `fromMillis`); the built-in default is dependency-free (JS `Date`, ISO-8601, HTTP-date/
  RFC-2822, `YYYY-MM-DD HH:mm:ss`, millis). The differential injects the reference's own luxon
  (`packages/workflow-lego/node_modules/luxon`), so the cascade, the returned values and the
  invalid-date message are compared bit-for-bit; only the adapter differs.
* **DELTA-05 — `esprima`/`jsonrepair` → injected JS-object parser.** `jsonParse`'s
  `acceptJSObject` recovery is an injected adapter (`parseJSObject` option); the default handles
  the relaxed shapes the editor produces (unquoted keys, single-quoted strings, trailing
  commas). The `repairJSON` path needs an adapter and is a no-op without one.

## Pinned reference behaviours (bug-for-bug, each differentially verified)

1. `Number('') === 0` → `''` is a **valid** `number` (and `''` an invalid `boolean`).
2. `validateFilterParameter` **returns `{}` for every input**: `parseFilterConditionValues`
   *returns* `{ ok: false, error }` instead of throwing, so the `catch (error instanceof
   FilterError)` block is unreachable — and would throw a TypeError (`issues[key]` is
   `undefined`) if it ever ran. Not "fixed".
3. A `resourceMapper` only checks `required` fields when `typeOptions.resourceMapper.mode ===
   'add'` (every other mode sets `skipRequiredCheck`).
4. The mapper branch materialises an empty `parameters[<name>]` array next to the per-field
   keys (`map: []` + `map.a: [...]`).
5. Issue keys are **parameter names**, not value paths: two broken fixed-collection items
   collapse into one key with both messages appended.
6. Collection children use the *current* path, so a top-level collection reports the child name
   (`a`), not `col.a`; fixed-collection children likewise report `v`.
7. `getContext` creates `executionData.contextData[key]` lazily and returns the same object on
   repeat calls; the three error messages (missing `executionData`, `node` type without a node,
   unknown type) are verbatim, the last with `extra: { contextType }`.
8. Resource-locator regex validation is skipped for values starting with `=` and for unknown
   modes (`modes.find` miss).

## Boundaries

* `reference/n8n/**`, peer LEGO packages, the workflow LEGO and the execution engine are
  untouched (allowed-paths list in `tasks/TASK-413-phase3-node-parameter-issues.yaml`).
* Still **not** reconstructed (contract §12.2 item 7): the filter-parameter EXECUTION half
  (`arrayContainsValue`, `executeFilterCondition`, `executeFilter`, `parseRegexPattern`),
  `getNodeWebhookPath`/`Url`, `cronNodeOptions`, the `jsonrepair`-backed recovery, the
  node-reference parser and workflow validation.
* Reproduce after a fresh clone: `npm install --prefix packages/workflow-lego` (brings the
  pinned `n8n-workflow@2.9.1` + luxon), then `npm run node:diff`.

## Post-task consensus / verification sweep (offline; `task_consensus_votes` unreachable — ISSUE-019)

Read-only sweep on the working tip, reproducing every peer claim from scratch:

| Claim (peer lane) | Reproduced |
| :--- | :--- |
| execution-engine suite + gate | `60/60` · `10/10 PASS` (`E08` 60 symbols, `E10` 20 pass / 0 fail) |
| trigger-lego | `11/11` (gate `T03` 11) |
| scheduler-lego (canonical cron home) | `9/9` (gate `S04` 11) |
| webhook-lego | `10/10` · gate `5/5` |
| workflow-model-lego (peer, landed as TASK-410 while this slice was in progress) | `26/26` + gate `7/7` (needs `npm install` in the package — `tsc` build step) |
| persistence-lego (peer) | `13/13` · gate `6/6` |
| connection-lego / expression-lego | `52/52` · `46/46` |
| engine differential | `84 agree / 0 diverge` |
| activation differential | `43 agree / 0 diverge` |
| node differential (this lane) | `1422 agree / 0 diverge / 0 harness errors` |
| node suite + gate | `82/82` · `7/7 PASS` |
| `npm run verify:all` | exit `0` — 8 gates (execution 10/10 · connection 52/52 · workflow-model 26/26 · reconstructed-engine 28/28 · trigger 5/5 · webhook 5/5 · scheduler 6/6 · node 7/7 · persistence 6/6) |
| `contract_conformance` / `boundary_audit` | `42/42 CHECKS PASSED` · `PASS (all edges documented)` |
| reference pin | `15050 files, root f8da35180669d798…` |

* **No `NEEDS_CORRECTION` raised** — every peer claim reproduced; the three-way ISSUE-023
  (trigger-lego vs execution-engine activation vs scheduler registry home) re-verified with
  zero behavioural deltas on every measured surface, so no protest is filed and the
  consolidation decision stays with the orchestrator. Recorded as addendum 4 of ISSUE-023.
* **No self-approval:** TASK-409/411/412 stay `SUBMITTED_FOR_REVIEW`; this sweep records
  evidence only.
* Sweep side effects: gate-evidence timestamp churn reverted; the tree stays clean apart from
  the files this task owns.
* Fresh-clone prerequisites observed again (not regressions): `npm install` inside
  `packages/workflow-lego` (reference build + luxon for the differential),
  `packages/workflow-model-lego` (`tsc`), `packages/connection-lego` + `packages/expression-lego`
  (their own toolchains).
