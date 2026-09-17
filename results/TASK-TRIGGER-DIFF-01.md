# TASK-TRIGGER-DIFF-01 — Activation-lifecycle differential (ISSUE-023 evidence)

**Status: SUCCESS** — `node tools/activation-differential.mjs` → **43 agree / 0 diverge / 0 harness errors**;
the one real behavioral divergence class (trigger-lego `toCronExpression` subset of reference) is **fixed
failing-first** with a falsifiability control, all suites green on the branch.

## What was built

`tools/activation-differential.mjs` — informational harness (exit 0 with findings, exit 1 only on harness
breakage), same conventions as `tools/engine-differential.mjs`. 12 scenarios over identical fixtures on
A = `packages/trigger-lego`, B = `packages/execution-engine` activation surface: S1 trigger lifecycle,
S2 cron registration contexts, S3 activation error, S4 poll rollback (± trigger response), S5 duplicate
cron guard, S6 too-short interval, S7 closeTrigger taxonomy (per-package error classes), S8 `everyX`,
S9 custom-expression trim, S10 disabled nodes, S11 `removeAll`, S12 multi-node/multi-expression.
Injected transports (timer/onDuplicate/errorReporter) compared as signal presence; reference oracles
cited per scenario (`active-workflows.ts`, `scheduled-task-manager.ts` L52-161, `cron.ts` L52-72,
`workflow.ts` queryNodes L272-293).

## Divergences found → fixed (trigger-lego)

| # | Scenario | Divergence | Reference | Fix |
| - | -------- | ---------- | --------- | --- |
| 1 | S8 `everyX` minutes | T threw `Unsupported poll mode: everyX`; E registered `R */7 * * * *` | `cron.ts` L57-59 | `defaultToCronExpression` → 1:1 port of `toCronExpression` (random second via injectable `randomInt`, everyX/everyWeek/everyMonth, `.trim()` fallback, `UserError` throw removed) — now exported from `index.mjs` |
| 2 | S9 custom expression | T stored `'  0 5 * * * *  '` untrimmed | `cron.ts` L72 | covered by the same port |
| 3 | (found while fixing) | `.map(this.toCronExpression)` leaked the array index into the new `randomInt` 2nd param | — | call site → `.map((item) => this.toCronExpression(item))` |

Falsifiability: `git stash` of the fix → **5 DIVERGE / 38 agree**; `stash pop` → 43/0. A peer's parallel
ISSUE-023 addendum (D1/D6, independent instrument) recorded the same root cause before this fix; my
addendum records the resolution.

## Regression + env fixes

- trigger-lego tests 9/9 → **11/11** (cron.ts L52-72 table with fixed random + everyX activation shape);
  gate T03 expectation 9→11, **trigger gate 5/5**.
- `packages/execution-engine/package.json` `test`: `node --test test/` → `node --test "test/*.test.mjs"`
  (bare-directory form = MODULE_NOT_FOUND on Node v22.22.3; glob form runs the identical suite) —
  ISSUE-022 precedent, execution-engine **60/60** confirmed both ways.

## Full matrix on this branch

trigger-lego 11/11 · execution-engine 60/60 · expression-lego 46/46 · connection-lego 52/52 ·
reconstructed-engine via `verify:all` **exit 0** · execution gate 10/10 · trigger gate 5/5 ·
engine differential 84/0 · activation differential 43/0 · conformance 42/42 · boundary PASS.

## Post-task review sweep

- Read peers' `results/TASK-405-phase3-connection-lego.md`, `TASK-ENGINE-ACTIVATION-01.md`,
  `TASK-ENGINE-VERIFY-02.md` + ISSUE-023 body and its first addendum before writing; no peer result file
  overwritten (this task created only `results/TASK-TRIGGER-DIFF-01.md`).
- ISSUE-023 ownership/consolidation remains **OPEN for the orchestrator** — this task delivered the
  evidence instrument + zero-divergence state, per the issue's own prescription.

**Files:** `tools/activation-differential.mjs` (new), `packages/trigger-lego/src/active-workflows.mjs`,
`packages/trigger-lego/src/index.mjs`, `packages/trigger-lego/test/lifecycle.test.mjs` (+2 tests),
`tools/trigger-lego-gate.mjs` (T03 9→11), `packages/execution-engine/package.json` (test glob),
`docs/isolation/CROSS-AGENT-ISSUES.md` (ISSUE-023 second addendum), `tasks/TASK-TRIGGER-DIFF-01.yaml`.
