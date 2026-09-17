# TASK-UTILS-02 — the deferred `utils.ts` trio: `sleep`, `sleepWithAbort`, `updateDisplayOptions`

**Status:** IMPLEMENTED (awaiting peer review) · **Lane:** `packages/node-lego` (node) ·
**Origin:** the three symbols `TASK-UTILS-01` recorded in the mechanical scope manifest
(`tools/node-lego-coverage.mjs` → `DEFERRED`) so the remainder of `utils.ts` could not be
silently dropped.

## What was deferred, and why it was not ported back then

| Symbol | Reference | Why it was deferred | What closed it |
| :--- | :--- | :--- | :--- |
| `sleep` | `utils.ts` L239-241 | needs a timer seam (rule E01: no deps, deterministic tests) | `setUtilsTimerFns` (DELTA-06-style seam, globals by default) |
| `sleepWithAbort` | `utils.ts` L243-259 | additionally needs the `ManualExecutionCancelledError` the reference throws | boundary-local cancellation chain (DELTA-02) |
| `updateDisplayOptions` | `utils.ts` L316-326 | calls `merge({}, …)` from `lodash/merge` | DELTA-01 `lodash-lite.merge` subset, corpus-differentialled against the real lodash |

With these three ported, `tools/node-lego-coverage.mjs` reports **0 deferred**: every exported
symbol of the 17 pinned boundary files is classified (106 ported · 1 internal · 13 out-of-scope).

## Consequential decisions

1. **DELTA-01 `merge` is a semantics port, not a "reasonable" deep merge.** Probed against the
   reference build's bundled `lodash/merge` 4.17.21 before a line was written, then pinned by a
   corpus differential (68 shapes in the development corpus, 26 shipped in `N28`): arrays merge
   **by index** (`[1,2,3]` + `['x']` → `['x',2,3]`, sparse `undefined` elements skipped),
   `undefined` never overwrites (it only materialises a missing key), sources walk `keysIn`
   (inherited enumerable keys are copied: `Object.create({ inherited: 1 })` keeps `inherited`),
   `__proto__` is skipped while `constructor`/`prototype` are plain keys (the "merge into the
   destination object" rule would otherwise write onto the global `Object` — the corpus asserts
   `Object.x` stays `undefined`), non-plain objects (Date, Map, RegExp, class instances) are
   attached **by reference** and merged *into*, and a key the target does not have yet receives a
   **deep clone** whose prototype is preserved. Cycles are copied with an ancestor chain
   (`copy.self === copy.self.self`, `copy.self !== copy` — lodash's own shape), while shared-but-
   acyclic references are cloned independently.
2. **DELTA-02 gains the cancellation chain `sleepWithAbort` raises.** `ExecutionBaseError`
   (`errors/abstract/execution-base.error.ts` L11-62) → `ExecutionCancelledError(executionId,
   reason)` → `ManualExecutionCancelledError` (message `'The execution was cancelled manually'`,
   `level 'warning'`, `extra { executionId }`, `reason 'manual'`). The published build's own-key
   order is reproduced exactly (`level, tags, extra, description, cause, errorResponse, timestamp,
   context, lineNumber, functionality, name, reason`) and `name` **is** set to
   `this.constructor.name` here — unlike the DELTA-03 `ApplicationError` quirk. `ExecutionBaseError`
   therefore moves from *out-of-scope* to *ported* in the `N08` audit (the rest of the hierarchy,
   `NodeError`/`BaseError`, stays out of scope). The same classes exist in
   `packages/execution-engine/src/errors.mjs`; consolidation stays **ISSUE-024**.
3. **Timer seam, not a behavioural change.** `setUtilsTimerFns({ setTimeout, clearTimeout })`
   defaults to the globals, so shipped behaviour is the reference's `setTimeout`/`clearTimeout`
   pair — the DELTA-06 pattern (like `setUtilsLogger`). `updateDisplayOptions` needs no seam.

## Pinned reference quirks (do NOT "fix")

* `sleepWithAbort` rejects with `extra.executionId === ''` — the reference passes the empty string
  at both call sites (`utils.ts` L244, L252).
* The abort listener is registered `{ once: true }` and is **never removed** on a normal resolve;
  `clearTimeout` runs only on the abort path.
* An already-aborted signal rejects **without scheduling a timer**.
* `updateDisplayOptions` shallow-copies each property (`{ ...nodeProperty }`, so the caller's array
  and property objects are untouched) but the merge target is a fresh `{}` per property; display
  options the property does not have come back as the caller's own nested values.

## Evidence

| Check | Result |
| :--- | :--- |
| `npm --prefix packages/node-lego test` | **145 pass / 0 fail / 0 cancelled** (136 → 145, +9 tests) |
| `node tools/node-lego-differential.mjs` | **1822 agree / 0 diverge / 0 harness errors** — 29 groups (1797 → 1822; new `N28` = 15 batches, `N29` = 4 async batches) |
| `npm run node:gate` | **8/8 PASS** — `N03` 145 tests, `N05` 1822/0, `N07` 125 symbols documented, `N08` 120 symbols classified (106/1/13/**0 deferred**) |
| `npm run verify:all` | exit 0 (all lanes) |
| Export surface | 117 → **125** (`sleep`, `sleepWithAbort`, `updateDisplayOptions`, `setUtilsTimerFns`, `merge`, `ExecutionBaseError`, `ExecutionCancelledError`, `ManualExecutionCancelledError`) |

`N29` is the harness's first **async** scenario group (`asyncScenario`, top-level `await` before the
report): it drives the real `sleep`/`sleepWithAbort` paths on both sides with tiny durations and
compares outcomes only, never elapsed times.

### Falsifiability (each mutation measured, then reverted byte-identical)

| Probe | Expected failure | Measured |
| :--- | :--- | :--- |
| `merge` concatenates arrays instead of merging by index | `N28` diverge | **2 `[DIVERGE]`** |
| abort rejects with a generic `Error` | `N28`/`N29` diverge | **2 `[DIVERGE]`** |
| `updateDisplayOptions` shallow-spreads instead of merging | `N28` diverge | **2 `[DIVERGE]`** |
| `sleep` removed from `src/index.mjs` | `N08` unclassified symbol | `[DRIFT] sleep … classify it` |
| a test that never settles (`await new Promise(() => {})`) | `N03` must fail | **N03 FAIL** — the new cancelled-test guard (see below) |

### Gate hardening found while writing the tests

The first run of the new suite reported `# tests 145 / # pass 136 / # fail 0` — nine tests were
**cancelled** (`Promise resolution is still pending but the event loop has already resolved`)
because one of them awaited a timer that was never fired, and the old `N03` pin
(`pass === '136'`, `fail === '0'`) matched anyway: a stuck suite could pass the gate. `N03` now
asserts `# cancelled === 0` and `# tests === # pass` in addition to the exact count, and the probe
above shows a hanging test failing the gate.

## Boundary

Touched only `packages/node-lego/**` (4 source files, 1 test file), the three node tools, the
node contract/doc/README/master-map and the gate evidence. No file under `reference/n8n/**`,
`crates/**`, `apps/**`, the frontend or a peer package was modified (`N02` still reports 21 source
files, all imports relative or `node:`; `N01` still 0 dependencies).

## Consensus review sweep (dual phase, offline — ISSUE-019)

| Phase | What was checked | Finding |
| :--- | :--- | :--- |
| 1 — before starting | review queue + scope manifest | every `SUBMITTED_FOR_REVIEW` result already had a verdict; the only unclaimed work item that is not an orchestrator decision was the manifest's own `DEFERRED` trio, whose owners are named in-tree. ISSUE-023/024/026 are consolidation/ownership calls, ISSUE-025 is Rust-tooling. |
| 2 — after finishing | lane suite, differential, gate, `verify:all`, falsifiability | 145/145 · 1822/0 · 8/8 · exit 0 · 5 probes caught; recorded as a first vote and **left for a peer verdict** (no self-approval). |

**Reviewer recipe:** `npm --prefix packages/node-lego test` (145), `node
tools/node-lego-differential.mjs` (1822/0), `npm run node:gate` (8/8), then re-inject any probe
from the table above to watch the matching check fail.
