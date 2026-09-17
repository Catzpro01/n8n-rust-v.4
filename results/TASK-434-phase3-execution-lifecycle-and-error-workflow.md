# TASK-434 — Execution Lifecycle Hooks, Error Workflow Dispatch, and Save Settings

Status: **SUBMITTED_FOR_REVIEW**

Reconstructed execution lifecycle hooks, error workflow dispatch, and save settings 1:1 against n8n 2.9.4 CLI reference (`reference/n8n/packages/cli/src/execution-lifecycle/*` and `reference/n8n/packages/cli/src/executions/failed-run-factory.ts`):
- `toSaveSettings(workflowSettings, config)` (`src/save-settings.mjs`):
  - Resolves execution persistence behavior (`error`, `success`, `manual`, `progress`) against workflow settings and global execution defaults (`DEFAULT_SAVE_CONFIG`).
  - Safely handles `null` or `undefined` workflow settings without throwing.
  - Normalizes `'DEFAULT'`, `'all'`, `'none'`, and boolean settings into deterministic flags.
- `FailedRunFactory` and `generateFailedExecutionFromError(mode, error, node, startTime, storageConfig)` (`src/failed-run-factory.mjs`):
  - Constructs compliant failed execution `IRun` structures for pre-execution errors, permission rejections, and early termination.
  - Generates `startData`, `lastNodeExecuted`, `resultData.runData[node.name]` error task data, and initial `nodeExecutionStack` when a node is provided.
  - Preserves clean `runData` and storage mode tags when node is omitted.
  - Integrated into `WorkflowRunner` and `subworkflow-execution.mjs`, replacing ad-hoc inline factories.
- `executeErrorWorkflow(workflowData, fullRunData, mode, executionId, retryOf, context)` (`src/error-workflow.mjs`):
  - Constructs `workflowErrorData` for execution failures (with execution ID, URL, last node executed, error, mode, retryOf, and runtime data) or trigger poller failures.
  - Evaluates `workflowData.settings?.errorWorkflow` for external error workflows.
  - Implements anti-recursion loop guard: blocks invoking the error workflow if an error workflow failed and is its own error workflow.
  - Evaluates internal error triggers (`n8n-nodes-base.errorTrigger`) when no external error workflow is specified.
  - Handles cached project resolution via `ownershipService` and passes to `workflowExecutionService.executeErrorWorkflow`.
- `saveExecutionProgress(workflowId, executionId, nodeName, data, executionData, options)` (`src/error-workflow.mjs`):
  - Records intermediate node execution progress into database repository with `requireNotFinished: true` and `requireNotCanceled: true`.
  - Catches database lock and connection errors gracefully, logging to logger and forwarding to `errorReporter` without interrupting execution.
- Test suite expanded from 144 to **157/157 PASS** (+13 new unit tests in `12-execution-lifecycle.test.mjs`).
- Execution engine gate upgraded to **16/16 PASS** (new `E16` gate for `executeErrorWorkflow`, `toSaveSettings`, `FailedRunFactory`).
- Zero runtime dependencies, closed package boundary, all 14 `verify:all` gates green.
