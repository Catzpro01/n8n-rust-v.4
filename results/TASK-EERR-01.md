# TASK-EERR-01 — ISSUE-024: NodeOperationError 3-way differential + failing-first faithful-ization

**Status: SUCCESS** — `node tools/error-surface-differential.mjs` (R = real `n8n-workflow@2.9.1`
build, A = node-lego, B = execution-engine) measured **2 agree / 14 diverge** on identical
construction matrices; after failing-first fixes in BOTH lanes: **4 agree / 14 documented-delta /
0 diverge**. Falsifiability: `git stash` of the fixes → **16 DIVERGE**; pop → 0. Suites: node-lego
**101/101** (+8 regression tests), execution-engine **67/67** (+7); gates **10/10 + 7/7**;
`verify:all` real exit 0.

## Divergences found → fixed in both lanes (reference: node-operation.error.ts / node.error.ts / execution-base.error.ts)

| # | Corner | Before (A and B) | Reference | Fix |
| - | ------ | ---------------- | --------- | --- |
| 1 | default `level` | `'error'` | **`'warning'`** (L33) | both |
| 2 | `options.message` override | ignored | `if (options.message) this.message = …` (L30) | both |
| 3 | `description` fallback + collapse | option only | falls back to `error.description` (L40); `message === description → undefined` (L41-43) | both |
| 4 | `context` shape | A: `options.context ?? {}`; B: `options.context` (undefined) | always `{ runIndex, itemIndex, metadata }` (L37-39; option set per node-api.error.ts L24-36) | both (lane `options.context` merged for compat) |
| 5 | `functionality` default | undefined | **`'regular'`** (execution-base.error.ts L31) | both; exec-engine header note updated (documented boundary superseded for this class) |
| 6 | `type` | B missing | `options.type` (L36-37) | B sets it; A already did |
| 7 | COMMON_ERRORS | absent | message containing e.g. `ETIMEDOUT` is **replaced** by the descriptive text; original preserved in `messages` (L44-46 → node.error.ts L12-47, L137-166) | both (verbatim table + `setDescriptiveErrorMessage` incl. `messageMapping`) |
| 8 | reflection | re-wrap built a new instance | `error instanceof NodeOperationError → return error` (L16-18) | both — **source-pinned**: the published 2.9.1 build predates this guard (S6 records the build/source delta) |
| 9 | string wrap + cause | A: no wrap/cause; B: inner `error.cause` forwarding | string → `new ApplicationError(error, { level: 'warning' })` (L19-21); an Error cause is deliberately **not observable** (execution-base.error.ts L47-51 assigns only non-Error causes) | both; intermediate fix (cause = error) was corrected after the differential showed the build observes `causePresent: false` — the recorded intermediate state is in the harness git history |

## Documented deltas (NOT regressions, classified `DIVERGE-DOCUMENTED` by the harness)

`tags`/`extra`: the published build's surface comes from the **external `@n8n/errors` package**
(observed `tags = {packageName: 'workflow-lego'}`, `extra` undefined; the 2.9.4 `NodeError` passes
neither). Both ports keep the classic surface `tags.node` / `extra.nodeName` by lane decision —
noted in both `errors.mjs` headers and in the harness.

## Version delta pinned by the harness (S6)

The 2.9.1 build does not reflect re-wraps; the 2.9.4 source (reconstruction target) does
(L16-18). The harness compares A/B against the source expectation and prints R's observed value
as a build/source note — the same pattern as the existing DELTA pins in the node-model suite.

## Files

`tools/error-surface-differential.mjs` (new) · `packages/node-lego/src/errors.mjs` (rewrite) ·
`packages/node-lego/test/error-surface.test.mjs` (new, 8 tests) ·
`packages/execution-engine/src/errors.mjs` (rewrite + header note) ·
`packages/execution-engine/test/06-error-surface.test.mjs` (new, 7 tests) ·
`tools/node-lego-gate.mjs` (N03 93→101).

## ISSUE-024 disposition

The instrument the issue prescribed now exists and both implementations are behaviorally identical
on every measured corner (remaining deltas documented as the external-package surface). Options
A/B consolidation remains the orchestrator's call — now with a complete behavioral evidence base
(`node tools/error-surface-differential.mjs`).
