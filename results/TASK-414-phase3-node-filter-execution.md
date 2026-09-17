# TASK-414-phase3-node-filter-execution — evidence

**Status:** SUCCESS (submitted for review)
**Date:** 2026-09-18 · **Branch:** `arena/01a0aff8-n8n-rust-v-4`
**Continues:** TASK-409 / TASK-411 / TASK-413 — same package, contract §12

## Deliverable

The last piece of the `node-helpers.ts` / `filter-parameter.ts` surface listed as out of scope in
contract §12.2 item 7 is reconstructed. `packages/node-lego` is now **18 source modules**,
**93 tests** and **87 exported symbols**.

| Module | Reference lines reconstructed |
| :--- | :--- |
| `src/filter-parameter.mjs` (extended) | `parseRegexPattern` L196-207, `arrayContainsValue` L209-220, `executeFilterCondition` L222-404 (incl. the reference's intentional case fall-through), `executeFilter` L409-424 |
| `src/webhook-path.mjs` (new) | `getNodeWebhookPath` L1057-1084, `getNodeWebhookUrl` L1087-1101 |
| `src/cron-node-options.mjs` (new) | `cronNodeOptions` L56-241 — verbatim data literal (byte-compared against the published build) |

New delta (contract §12.2): **DELTA-06** — the two `LoggerProxy.warn` call sites now go through an
injected logger (default no-op, rule E01), and the DELTA-04 `dateTimeFactory` travels in the same
`metadata` object so date conditions are parsed by the same factory as the rest of the package.

## Verification

```
node --test packages/node-lego/test/*.test.mjs
# tests 93 · pass 93 · fail 0   (74 node-model + 8 parameter-issues + 11 filter-execution)

node tools/node-lego-differential.mjs
# NODE LEGO DIFFERENTIAL: 1609 agree / 0 diverge / 1609 comparisons (2 NOT-DIFFABLE, 0 harness errors)
#   N23 executeFilter / executeFilterCondition / arrayContainsValue .. 163
#   N24 getNodeWebhookPath / getNodeWebhookUrl / cronNodeOptions ....... 18
#   (N01…N22 = the previously landed 1428 comparisons, unchanged)

node tools/node-lego-gate.mjs
[PASS] N01 zero runtime dependencies — 0 dependencies
[PASS] N02 source boundary is import-closed — 18 source files, no cross-LEGO imports
[PASS] N03 node-model conformance suite — 93 pass / 0 fail
[PASS] N04 reference tree remains pinned — PASS (15050 files, root f8da35180669d798…)
[PASS] N05 differential vs the published reference build — 1609 agree / 0 diverge across 1609 comparisons (2 NOT-DIFFABLE, 0 harness errors)
[PASS] N06 formal contract + isolation doc present — contract §12 + docs/isolation/node.md §5
[PASS] N07 every exported symbol is documented in the contract — 87 exported symbols documented
Node LEGO gate: 7/7 PASS
```

**Falsifiability (re-run for this slice):** three injected behavioural mutations — string
`contains` → strict equality, `ignoreCase` forced off, lower-casing dropped from the webhook-path
node name — produced **1598 agree / 11 diverge**; all were reverted before the recorded run.

## Behaviours pinned while porting (each verified against the published build)

1. `executeFilterCondition`'s outer `switch` has **no `break`** after the `number`, `dateTime`,
   `boolean`, `array` and `object` cases, so an unknown operation falls through to the next type
   and finally logs `Unknown filter parameter operator "<type>:<operation>"` and returns `false`.
   The port keeps the fall-through (with an explicit comment) instead of "fixing" it.
2. `exists`/`notExists` run on the *parsed* value: a `NaN` left value becomes the string `'NaN'`
   for a string condition, so `Number.isNaN('NaN')` is false and the field counts as existing.
3. Boolean `false` handling depends on `options.version`: v1 uses `Boolean('false') === true`
   (so `equals` against `false` is false), v2 uses `tryToParseBoolean('false') === false` (true).
4. `parseRegexPattern` accepts `/pattern/flags` literals (`/abc/i`) and otherwise compiles the raw
   pattern — an invalid pattern throws the engine's own `SyntaxError`, as upstream.
5. Empty/`notEmpty` object conditions only work because the reference's operator definitions set
   `singleValue: true` (the right side is then not parsed at all).
6. `getNodeWebhookPath` short-circuits on `restartWebhook === true`, returns `path || webhookId`
   when `isFullPath === true`, and otherwise builds `<workflowId>/<lower-cased URI-encoded node
   name>/<path>`. `getNodeWebhookUrl` forces `isFullPath = false` for dynamic paths
   (`:id`, `x/:id`) and strips one leading `/`.
7. `cronNodeOptions` is pure data: the port is a verbatim copy of L56-241 and the differential
   compares the whole structure (2430 bytes of JSON) plus the mode list.

## Boundaries

* `reference/n8n/**`, peer LEGO packages and the execution engine are untouched.
* Remaining out of scope (contract §12.2 item 8): the `jsonrepair`-backed `repairJSON` recovery
  (DELTA-05), `node-reference-parser-utils.ts` and workflow validation. With this task, every
  other function of `node-helpers.ts` (L1-1949) and `node-parameters/filter-parameter.ts` is
  reconstructed.
* Reproduce after a fresh clone: `npm install --prefix packages/workflow-lego` (brings the pinned
  `n8n-workflow@2.9.1` + luxon), then `npm run node:diff`.

## Post-task consensus / verification sweep (offline; `task_consensus_votes` unreachable — ISSUE-019)

Read-only sweep on the working tip, reproducing every peer claim from scratch (no trust in the
peer narrative; nothing outside this lane's allowed paths was written):

| Claim (peer lane) | Reproduced |
| :--- | :--- |
| execution-engine suite | `60/60` |
| trigger-lego / scheduler-lego | `11/11` · `9/9` |
| webhook-lego / persistence-lego | `10/10` · `13/13` |
| connection-lego / expression-lego / workflow-model-lego | `52/52` · `46/46` · `26/26` |
| engine differential | `84 agree / 0 diverge` |
| activation differential | `65 agree / 0 diverge` |
| node differential (this lane) | `1609 agree / 0 diverge / 0 harness errors` |
| node suite + gate | `93/93` · `7/7 PASS` (`N03` 93, `N05` 1609, `N07` 87 symbols) |
| `npm run verify:all` | exit `0` — 8 gates (execution 10/10 · connection 52/52 · workflow-model 26/26 · reconstructed-engine 28/28 · trigger 5/5 · webhook 5/5 · scheduler 6/6 · node 7/7 · persistence 6/6) |
| `contract_conformance` / `boundary_audit` | `42/42 CHECKS PASSED` · `PASS (all edges documented)` |
| reference pin | `15050 files, root f8da35180669d798…` |

* **No `NEEDS_CORRECTION` raised** — every peer claim reproduced; the ISSUE-023 three-way
  (trigger-lego vs execution-engine activation vs scheduler registry home) keeps zero behavioural
  deltas on every measured surface, so no protest is filed and the consolidation decision stays
  with the orchestrator (addendum 4 already records the earlier run).
* **No self-approval:** TASK-409 / 411 / 412 / 413 / 414 all stay `SUBMITTED_FOR_REVIEW`; this
  sweep records evidence only.
* Sweep side effects: gate-evidence timestamp churn reverted; the tree stays clean apart from the
  files this task owns.
