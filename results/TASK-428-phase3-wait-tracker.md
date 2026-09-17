# TASK-428 — WaitTracker and Execution Resumption

Status: **VERIFIED** (approved in review sweep 24, `results/REVIEW-SWEEP-2026-09-18.md`)

Reconstructed `WaitTracker` and sub-workflow execution resumption 1:1 against n8n 2.9.4 CLI reference (`reference/n8n/packages/cli/src/wait-tracker.ts`, `workflow-helpers.ts`):
- Periodic polling (60s default) of upcoming waiting executions via `ExecutionRepository.getWaitingExecutions(windowMs)`
- Timer management and dispatch based on `waitTill` timestamp
- Leadership gating: tracks only when `instanceSettings.isLeader` is true, cleans up on `stopTracking`
- Validation guards: verifies execution exists, is not finished, and has a saved workflow id before resumption
- Dispatches execution via `workflowRunner.run(data, false, false, executionId)` with cached project ownership
- Duplicate resume suppression: intercepts `ExecutionAlreadyResumingError` gracefully
- Sub-workflow child completion tracking via `ActiveExecutions.getPostExecutePromise`:
  - Guards: `shouldRestartParentExecution(parentExecution)` (respects `shouldResume` boolean flag)
  - Updates waiting parent's `nodeExecutionStack[0].data` with child's `getDataLastExecutedNodeData(subworkflowResults)` via `updateParentExecutionWithChildResults`
  - Resumes parent execution only after child successfully finishes (skips when child enters 'waiting' state)
- Execution engine suite grown from 67 to **90/90 PASS** (+23 unit tests in `07-wait-tracker.test.mjs`, including 5 ISSUE-028 regression parity tests)
- Execution gate upgraded to **11/11 PASS** (new `E11` gate for waiting execution tracking & resumption, now 23/23 tests)
- Zero runtime dependencies, closed package boundary, reference tree unchanged, all 14 `verify:all` gates green.

## ISSUE-028 Correction (2026-09-18)
Addressed all 5 divergences flagged by review sweep 20:
1. `startedAt` is unconditionally included in the `data` literal passed to `workflowRunner.run`, ensuring exactly 6 keys are always present.
2. `triggerTime = waitTill.getTime() - now` without `Math.max(0, ...)` clamp, matching reference behavior.
3. Removed re-entry guard `if (this.#mainTimer) return` from `startTracking()`.
4. String / non-Date `waitTill` invokes `getTime()` directly without `new Date(...)` coercion, throwing `TypeError`.
5. Property access `!fullExecutionData.workflowData.id` without `?.`, throwing `TypeError` if `workflowData` is undefined.
All 5 items pinned with explicit regression assertions in `packages/execution-engine/test/07-wait-tracker.test.mjs`.

