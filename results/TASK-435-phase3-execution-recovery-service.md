# TASK-435 — Execution Recovery Service, Crash Deactivation, and Artificial Task Data

Status: **SUBMITTED_FOR_REVIEW**

Reconstructed `ExecutionRecoveryService`, `ARTIFICIAL_TASK_DATA`, `NodeCrashedError`, and `WorkflowCrashedError` 1:1 against n8n 2.9.4 CLI reference (`reference/n8n/packages/cli/src/executions/execution-recovery.service.ts`, `reference/n8n/packages/cli/src/constants.ts`, `reference/n8n/packages/cli/src/errors/node-crashed.error.ts`, and `reference/n8n/packages/cli/src/errors/workflow-crashed.error.ts`):
- `NodeCrashedError` & `WorkflowCrashedError` (`src/errors.mjs`):
  - `NodeCrashedError` extends `NodeOperationError` with reference description and documentation links pointing to out-of-memory handling.
  - `WorkflowCrashedError` extends `OperationalError` signaling abnormal instance termination.
- `ARTIFICIAL_TASK_DATA` (`src/execution-recovery.mjs`):
  - Frozen object structure with `main: [[{ json: { isArtificialRecoveredEventItem: true }, pairedItem: undefined }]]`.
- `ExecutionRecoveryService` (`src/execution-recovery.mjs`):
  - Dual constructor supporting both positional arguments (matching upstream DI) and options bag for flexible testing/integration.
  - Follower guard (`instanceSettings.isFollower`): immediately exits without modifying records.
  - `amendWithoutLogs(executionId)`: marks orphaned executions as crashed in execution repository and re-reads state.
  - `amend(executionId, messages)`:
    - Filters out finished executions with data (`success`, `error`, `canceled`).
    - Reconstructs missing run data from `n8n.node.started` and `n8n.node.finished` event logs.
    - Synthesizes `taskData` with `ARTIFICIAL_TASK_DATA` and computed runtime for completed nodes.
    - Synthesizes `NodeCrashedError` and `WorkflowCrashedError` on crashed nodes that started but never received a finish event.
    - Preserves existing pre-crash task data without overwriting.
    - Computes `stoppedAt` using event timestamp helpers (supporting `Date`, Luxon-like `DateTime`, and numeric timestamps).
  - Lifecycle hook execution (`workflowExecuteAfter`) and push event dispatch (`executionRecovered`) upon recovery.
  - `autoDeactivateWorkflowsIfNeeded(workflowIds)`:
    - Analyzes the last N executions (`maxLastExecutions`, default 3).
    - If all of the last N executions are crashed, deactivates workflow (`updateActiveState(workflowId, false)`).
    - Resolves appropriate notification recipient: project admin for team projects, project owner for personal projects, fallback to instance owner.
    - Sends email notification via `userManagementMailer.notifyWorkflowAutodeactivated`.
    - Broadcasts `workflowAutoDeactivated` via push connection.
    - Updates remaining `running` or `new` executions for the workflow to `crashed`.
- Test suite expanded from 157 to **167/167 PASS** (+10 new unit tests in `13-execution-recovery.test.mjs`).
- Execution engine gate upgraded to **17/17 PASS** (new `E17` gate for `ExecutionRecoveryService`).
- Zero runtime dependencies, closed package boundary, all 14 `verify:all` gates green.
