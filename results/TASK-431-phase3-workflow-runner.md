# TASK-431 — WorkflowRunner Execution Coordinator

Status: **SUBMITTED_FOR_REVIEW**

Reconstructed `WorkflowRunner` central workflow execution coordinator 1:1 against n8n 2.9.4 CLI reference (`reference/n8n/packages/cli/src/workflow-runner.ts`):
- Coordinates execution lifecycles across `ActiveExecutions`, `WorkflowExecute`, `ExecutionLifecycleHooks`, and `ExecutionRepository`.
- `processError`:
  - Suppresses benign errors: returns early on `ExecutionNotFoundError`, `ExecutionCancelledError`, and messages matching cancellation.
  - Queue-mode false-positive mitigation: validates whether execution already succeeded in the database before error marking.
  - Assembles `fullRunData` with status `'error'`, finished `false`, and structured error payloads via `createRunExecutionData`.
  - Finalizes execution in `ActiveExecutions` and fires the `workflowExecuteAfter` lifecycle hook.
- `run`:
  - Registers execution in `ActiveExecutions` with support for restarted execution IDs.
  - Validates workflow node credentials via `credentialsPermissionChecker` and halts execution cleanly with `failedRunFactory` if rejected.
  - Binds and forwards execution `responsePromise`.
  - Determines execution dispatch (`runMainProcess` vs `enqueueExecution` in queue mode).
  - Handles asynchronous post-execution error logging while ignoring expected cancellation signals.
- `runMainProcess`:
  - Loads static workflow data on demand when `loadStaticData` is requested.
  - Manages pinData preservation for manual and evaluation execution modes.
  - Configures `WorkflowExecuteAdditionalData` bindings: `setExecutionStatus`, `sendDataToUI`, and lifecycle hooks.
  - Registers `sendResponse` hook resolving response promises on completion.
  - Configures real-time streaming: hooks `sendChunk` to format and flush NDJSON chunks when `streamingEnabled: true`.
  - Dynamically calculates relative execution timeouts from `startedAt` for resumed waiting executions.
  - Automatically cancels expired executions immediately or via timer callbacks with `TimeoutExecutionCancelledError`.
- `enqueueExecution`:
  - Dispatches execution jobs to `scalingService` with queue priority based on `realtime`.
  - Manages job cancellation and handles BullMQ stalled worker errors with `MaxStalledCountError`.
- Added `MaxStalledCountError` extending `OperationalError` to `errors.mjs`.
- Test suite expanded from 100 to **110/110 PASS** (+10 new unit tests in `09-workflow-runner.test.mjs`).
- Execution engine gate upgraded to **13/13 PASS** (new `E13` gate for `WorkflowRunner`).
- Zero runtime dependencies, closed package boundary, all 14 `verify:all` gates green.
