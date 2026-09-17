# Reconstructed engine — failure policy (reference-faithful)

| | |
| :--- | :--- |
| Module | `packages/reconstructed-engine` (`error-policy.mjs` + `runner.mjs` integration) |
| Reference | n8n `2.9.4` (`packages/core/src/execution-engine/workflow-execute.ts`, `packages/workflow/src/node-helpers.ts`, `packages/nodes-base/nodes/Code/Code.node.ts`) — read-only, never modified |
| Tests | `error-policy.test.mjs` (16 tests) + `runner.test.mjs` (5 tests) via `npm run reconstructed-engine:test` |
| Status | Implemented per `TASK-ENGINE-ERROR-01` (POOL-003 lineage) |

## 1. Ported rules (each read off source, with line citations)

| ID | Rule | Reference | Port |
| :--- | :--- | :--- | :--- |
| R1 | Retry budget: `retryOnFail===true` → `maxTries=min(5,max(2,maxTries\|\|3))`, `wait=min(5000,max(0,wait\|\|1000))`; else 1 try, no wait | `workflow-execute.ts:1600-1613` | `retryPlanFor()` — literal, including `\|\|` default semantics |
| R2 | Wait happens BEFORE tries 2..N; `executionError` is reset before each retry | `:1615-1630` | retry loop in `runner.mjs`; wait count asserted (`[25,25]` for 3 tries) |
| R3 | Soft failure — first item of first branch with `json.error !== undefined` (only `undefined` passes; `null` fails) re-runs inside the try budget | `:1670-1690` | `isSoftFailure()` + inner re-run loop |
| R4 | Error record `{...e, message, stack}`; task gets `error` + `executionStatus:'error'` | `:1781-1826` | `toErrorRecord()` (Sentry reporting has no equivalent here) |
| R5 | `continueOnFail===true` **or** `onError ∈ {continueRegularOutput, continueErrorOutput}` → input (`main[0]`) becomes the node output and execution continues; otherwise the task is stored WITHOUT data and execution stops | `:1843-1900` | `shouldContinueOnError()` + stop/continue branches |
| R6 | Merge loop: `{$error,$json}` → `error=$error, json={error}`; `item.error` set → `json={error:message}` (plain `{error}` json untouched) | `:1902-1917` | `mergeErrorInfo()` (clone-then-mutate; same observable result) |
| R7 | Success + `continueErrorOutput` → error-signalled items (`item.error`, or `json={error}` sole key, or `json={error,message}` two keys) move to the LAST main output with paired merge `{...paired.json, ...item.json}`; last branch REPLACED | `:1720` + `:2463-2560` | `splitErrorOutput()` — runs BEFORE paired assignment and BEFORE R6, like the reference |
| R8 | `continueErrorOutput` appends an extra `Main` output (`category:'error'`, last) | `node-helpers.ts:1170` | approximated via wired-connection count (see §2) |
| R9 | `OnError = 'continueErrorOutput' \| 'continueRegularOutput' \| 'stopWorkflow'` | `interfaces.ts:1296` | `CONTINUE_MODES` |
| R10 | Nodes convert per-item throws to `{json:{error},pairedItem}` items behind `continueOnFail()` instead of throwing (Code node both modes) | `Code.node.ts:246-293` | node-implementation pattern, not engine code; covered by R7 tests |

Order of operations on the success path mirrors the reference exactly: invoke → R3 re-runs → R7 split (continueErrorOutput only) → paired assignment → R6 merge → `alwaysOutputData` → route. On the continue-after-error path only R6 runs (the reference never splits passthrough input).

## 2. Documented adaptations (no node-type registry / hooks / persistence yet)

1. **Error-branch index.** The reference uses the declared output count (`getNodeOutputs`). We use `max(wired, returned, 2) - 1`. Exact when the error branch is wired (the editor writes it last) and for all single-output nodes. Known limit: multi-output node + error branch UNWIRED resolves one index too low — needs declared outputs (Node LEGO dependency).
2. **Paired merge.** The reference resolves pairs via `WorkflowDataProxy.$getPairedItem` across runs/inputs; we resolve `pairedItem.item` against this node's current input. Unresolvable pairs move unmerged — the same fallback the reference uses on proxy-null.
3. **Sleep injection.** `runWorkflow(..., {sleep})` defaults to a `setTimeout` promise (R2); tests inject a recorder. Zero waits are still awaited in the R3 loop, like the reference.
4. **Stop path.** The reference re-queues the failed node for restart; this engine has no restart API yet (needs the persistence LEGO). Run data + `lastNodeExecuted` are preserved so restart can be added without changing this policy.

## 3. Deliberate reproduction (flagged, test-pinned)

**Hard throw + `continueErrorOutput` routes the input passthrough to output 0, NOT to the error branch.** This is what `workflow-execute.ts:1843-1860` (passthrough at index 0 for both continue modes) combined with the routing loop (`:1985-2017`, only indexes holding data fire) says. The error branch fires via the R7 success-path split — i.e. for nodes that return error items rather than throw (the R10 pattern). Pinned by `engine routes thrown-error passthrough to output 0 even with continueErrorOutput (code-literal R5)`.

**Open verification:** if a live run of n8n 2.9.4 disagrees (docs prose suggests error-branch routing on hard throw), file a contract decision and update this spec + the test — same process as D-08/D-04. Do not "fix" the port from memory.

## 4. Deferred (out of scope for this task)

Error workflows (`settings.errorWorkflow`), `waitTill`/waiting, `rewireOutputLogTo` (AI-723), execution hooks (`nodeExecuteBefore/After`, `sendChunk`), restart-from-failed-node, multi-input `waitingExecution` joins, `executionOrder:'v1'` sorting, binary-data conversion, close functions, sub-node (AI tool) execution results. None of them change the R1–R10 rules above.
