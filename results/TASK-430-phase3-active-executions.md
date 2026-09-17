# TASK-430 — ActiveExecutions Registry and Lifecycle

Status: **SUBMITTED_FOR_REVIEW**

Reconstructed `ActiveExecutions` in-memory execution registry and lifecycle 1:1 against n8n 2.9.4 CLI reference (`reference/n8n/packages/cli/src/active-executions.ts`):
- In-memory active execution management (`activeExecutions`) and response mode mappings.
- `add()` handles both new executions (persistence creation, concurrency reservation, running status) and resuming executions (optimistic `requireStatus: 'waiting'` update, `ExecutionAlreadyResumingError` handling).
- Automated cleanup via `postExecutePromise` settlement: deletes completed/failed executions while preserving waiting executions without holding workflow references.
- Workflow execution and response promise attachment (`attachWorkflowExecution`, `attachResponsePromise`, `resolveResponsePromise`, `resolveExecutionResponsePromise`).
- Streaming HTTP response support via `sendChunk()` with NDJSON serialization and flush.
- Structured execution cancellation (`stopExecution`) handling cancelable workflows, deferred promise rejection, and `execution-cancelled` event emissions.
- Status, query, and error handling (`has`, `getStatus`, `setStatus`, `getActiveExecutions`, `getExecutionOrFail` throwing `ExecutionNotFoundError`).
- Graceful shutdown (`shutdown`) with concurrency disable, running execution cancellation, and drain loops.
- Execution error hierarchy expanded: `ExecutionNotFoundError`, `ExecutionCancelledError`, `ManualExecutionCancelledError`, `TimeoutExecutionCancelledError`, `SystemShutdownExecutionCancelledError`.
- Test suite expanded from 85 to **95/95 PASS** (+10 new unit tests in `08-active-executions.test.mjs`).
- Execution engine gate upgraded to **12/12 PASS** (new `E12` gate for active executions lifecycle).
- Zero runtime dependencies, closed package boundary, all 14 `verify:all` gates green.
