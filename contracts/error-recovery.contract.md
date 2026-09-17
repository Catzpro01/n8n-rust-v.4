# LEGO Contract: Error Recovery (Retry & Error-Output Semantics)

| | |
|---|---|
| Owner | Agent 11 line (session `arena/01a0b103-n8n-rust-v-4`) |
| LEGO | `error-recovery` — retry policy, `onError` / `continueOnFail` routing, error-item normalisation |
| Reference | n8n 2.9.4, `packages/core/src/execution-engine/workflow-execute.ts`; `packages/workflow/src/{interfaces,node-helpers}.ts` |
| Implementation | `packages/reconstructed-engine/src/error-recovery-policy.ts` (pure, dependency-free) |
| Consumers | `packages/reconstructed-engine/runner.mjs` (legacy JS engine) · `src/execution-engine/workflow-execute.ts` (TS engine) |
| Tests | unit `test/{error-recovery-policy,paired-item-provenance}.test.mjs` + engine `test/engine-error-recovery.test.mjs` — 32/32 PASS; TS integration `test/ts-error-recovery.integration.mjs` — 3/3 PASS (needs `npm --prefix packages/reconstructed-engine run emit:cjs`, skips automatically otherwise) |
| Status | TESTED — `typecheck` 0 errors (16/16 packages), `test-run.mjs` + `test-enhanced.mjs` green, `isolation:check` 4/4 PASS (reference source untouched) |

## 1. Purpose
Own every **decision** about what happens when a node fails, so the execution engine never re-implements
error policy ad hoc: how many times a node is retried, how long to wait between tries, whether the
workflow stops or continues, and how failed items are shaped and routed. Behaviour is a 1:1 port of
n8n 2.9.4 — including its documented quirks (see §7).

## 2. Source anchors (verified, not modified)
| Behaviour | Source |
|---|---|
| `maxTries` / `waitBetweenTries` resolution | `workflow-execute.ts` L1600–L1613 |
| Retry loop (throw-based + soft-failure inner loop) | `workflow-execute.ts` L1614–L1680 |
| `executionError = { ...e, message, stack }` | `workflow-execute.ts` L1811 |
| `continueOnFail` / `onError` branch | `workflow-execute.ts` L1839–L1872 |
| Error item normalisation (`$error`/`$json`, `item.error`) | `workflow-execute.ts` L1900–L1918 |
| `handleNodeErrorOutput` — error items move to last main output | `workflow-execute.ts` L2463–L2561 |
| Extra “Error” output when `onError === 'continueErrorOutput'` | `node-helpers.ts` L1170–L1195 |
| `OnError` union + node fields | `interfaces.ts` L1296, L1306–L1312 |

## 3. Interface

```ts
resolveRetryPolicy(node)  -> { maxTries: number; waitBetweenTries: number }
resolveErrorOutcome(node) -> 'stop-workflow' | 'continue-regular-output' | 'continue-error-output'
runWithRetry(task, policy, { isFailedResult?, sleep? })
                          -> { status: 'success', data, tries, attempts }
                           | { status: 'error',   error, tries, attempts }
toExecutionError(error)   -> NodeError              // { ...e, message, stack }
normalizeOutputItems(out) -> INodeExecutionData[][]
isErrorItem(item)         -> boolean
splitErrorOutput(out, mainOutputCount) -> { data, errorItems }
executeNodeWithRecovery(node, task, options) -> RetryOutcome

# provenance item error ($getPairedItem)
resolvePairedItemRef(item)                       -> PairedItemData | undefined
createPairedItemResolver(runData, { strict? })   -> (destinationNode, sourceData, pairedItem) => item | null
withErrorItemProvenance(item, { resolver, source, connectionType? }) -> INodeExecutionData
splitErrorOutput(out, mainOutputCount, { resolver?, source?, connectionType? }) -> { data, errorItems }
```

## 4. Guarantees
1. **Retry policy** — `retryOnFail !== true` ⇒ `{ maxTries: 1, waitBetweenTries: 0 }`.
   Otherwise `maxTries = min(5, max(2, maxTries || 3))` and
   `waitBetweenTries = min(5000, max(0, waitBetweenTries || 1000))`. The `||` operator is preserved
   verbatim, so `0` falls back to the default (3 / 1000 ms).
2. **No sleeping before the first attempt** — the wait is applied only between tries
   (`waitedMs === 0` for `tryIndex === 0`).
3. **Soft failures retry too** — a result whose first item carries `json.error` is retried by the inner
   loop until `tryIndex === maxTries - 1` (L1655–L1680), then returned as-is (never thrown).
4. **Never throws** — `runWithRetry` returns `{ status: 'error' }` when all attempts fail; the caller
   applies `resolveErrorOutcome`. Errors are normalised with `toExecutionError`, preserving
   n8n-specific fields (`description`, `httpCode`, …).
5. **Outcome resolution** — continue iff `continueOnFail === true` **or**
   `onError ∈ { continueRegularOutput, continueErrorOutput }`; `onError === 'continueErrorOutput'`
   ⇒ `continue-error-output`, everything else that continues ⇒ `continue-regular-output`
   (i.e. `continueOnFail` routes through the regular output).
6. **Output shape** — all outputs are `INodeExecutionData[][]` (per-output branches). Flat arrays
   returned by legacy handlers are wrapped into one branch by the consumer (`toOutputBranches`).
7. **Error-item provenance (`$getPairedItem`)** — when a resolver and the node's `source` are
   supplied, an error item is enriched with the JSON of its origin item:
   `{ ...item, json: { ...sourceItem.json, ...item.json } }` (`workflow-execute.ts` L2524–L2560,
   resolver ported from `workflow-data-proxy.ts` L922–L1035, including the recursive ancestry walk,
   `sourceOverwrite`, and the ambiguity check). If the source is missing, the item carries no
   `pairedItem`, or the walk fails, the item passes through unchanged (L2525–L2527).
8. **Error-output split** — with `continueErrorOutput`, item-level errors detected by `isErrorItem`
   (`item.error`, or `json.error` as the only key, or `json.error` + `json.message`) are moved out of
   outputs `0..n-2` into the last main output, exactly like `handleNodeErrorOutput`.

## 5. Non-responsibilities
- Does **not** execute nodes, resolve expressions, or touch credentials.
- Does **not** emit hooks/events (`nodeExecuteAfter`, `sendChunk`) and does not report to Sentry —
  those stay in the execution/observability LEGO.
- Does **not** implement `$getPairedItem` resolution for error items (see §7).
- Does **not** modify `reference/n8n/**`, `crates/**`, `apps/**`, or any frontend file.

## 6. Dependencies
| Dependency | Class | Direction |
|---|---|---|
| `packages/reconstructed-engine/runner.mjs` | CONSUMER | inbound |
| Node fields (`retryOnFail`, `maxTries`, `waitBetweenTries`, `onError`, `continueOnFail`) | SHARED (`INode`) | read-only |
| Timer (`setTimeout`) | INJECTABLE | `options.sleep` |

## 7. Known upstream behaviour kept verbatim (deviations would break 1:1 parity)
1. **Hard-throw + `continueErrorOutput` passes the input data through the *Success* output**, not the
   Error output (`workflow-execute.ts` L1848–L1855). This is the behaviour users report upstream
   (n8n issue #23224, “output goes to success branch despite being an error”). The item-level path
   (§4.7) is the mechanism that actually populates the Error branch.
2. **`$getPairedItem` is ported as a standalone resolver** (`createPairedItemResolver`), not through
   `WorkflowDataProxy`. Upstream throws five different error types on failure; the port returns `null`
   by default so callers keep the upstream fallback (“push the item unchanged”), and offers
   `strict: true` for the throwing behaviour. `$getPairedItem` also stays reachable from expressions
   in the Expression LEGO — this module is the *engine-side* consumer, not a replacement.
3. **Hardcoded retry limits** (2/3/5 tries, 0/1000/5000 ms) are duplicated from upstream, including the
   upstream `TODO` to move them into `NodeSettings.vue`.

## 8. Verification
```bash
npm --prefix packages/reconstructed-engine run test:unit   # 32 tests: retry/routing + provenance unit & JS engine
node packages/reconstructed-engine/test-run.mjs            # legacy regression demo -> VERIFIKASI BERHASIL
node packages/reconstructed-engine/test-enhanced.mjs       # 14-LEGO integration -> VERIFIKASI BERHASIL
npm --prefix packages/reconstructed-engine run typecheck   # 0 errors (16/16 paket LEGO hijau)

# integrasi engine TypeScript: butuh kompilasi (impor relatif tanpa ekstensi, module commonjs)
npm --prefix packages/reconstructed-engine run emit:cjs
npm --prefix packages/reconstructed-engine run test:ts-integration
```
Gate: every change must keep all of the above green (PROJECT_RULES #6).

## 9. Findings fixed while integrating (pre-existing, outside this LEGO)
| Id | Finding | Fix |
|---|---|---|
| ISSUE-ERR-RECOVERY-01 | `tsc --noEmit` reported 26 errors in `packages/reconstructed-engine`: 24× TS2835 (extensionless relative imports under `moduleResolution: NodeNext`), 2× TS2339 (`.length` on `unknown`), 1× TS6059 (`src/index.ts` re-exports `../runner.mjs` outside `rootDir`). | Resolved together with the parallel session on this branch: the package now uses `module: commonjs` / `moduleResolution: node` (extensionless imports stay), `src/index.ts` re-exports every LEGO as a namespace (`export * as XLEGO`) which removes the ambiguous-barrel errors, and the two `unknown` values are cast. `typecheck` is 0 errors and all 16 LEGO packages typecheck clean. |
| ISSUE-ERR-RECOVERY-02 | TS execution engine crashed at runtime for every handler that returns a flat item array (`normalizeItems: items.map is not a function`), so `ReconstructedWorkflowEngine.executeWorkflow()` could not run at all — the 14-LEGO “VERIFIED” status only ever exercised `runner.mjs`. | Handler output is normalised to `INodeExecutionData[][]` (flat arrays are wrapped into output 0) — same rule as `toOutputBranches()` in `runner.mjs` and matching n8n, where node output is per-output. Verified by `test/ts-error-recovery.integration.mjs`. |
| ISSUE-ERR-RECOVERY-03 | The reconstructed TS engine built `executionData.source` as `{ main: [[ ISourceData ]] }` (nested), while n8n's `ITaskDataConnectionsSource` is `{ main: [ ISourceData \| null ] }` (`interfaces.ts` L2721-L2727, built at `workflow-execute.ts` L803-L813). Any consumer indexing `source.main[inputIndex]` — including error-item provenance — silently got an array. | Source construction aligned to upstream (flat). Only two consumers existed: `taskData.source` flattening (unchanged result for both shapes) and the new provenance call. |
