# TASK-432 — Subworkflow Execution Runtime and Trigger Discovery

Status: **SUBMITTED_FOR_REVIEW**

Reconstructed sub-workflow execution runtime and trigger discovery 1:1 against n8n 2.9.4 CLI reference (`reference/n8n/packages/cli/src/workflow-execute-additional-data.ts`, `reference/n8n/packages/cli/src/utils.ts`):
- `findSubworkflowStart(nodes)`:
  - Scans nodes for dedicated `n8n-nodes-base.executeWorkflowTrigger`.
  - Falls back to `STARTING_NODES` (`@n8n/n8n-nodes-langchain.manualChatTrigger`, `n8n-nodes-base.manualTrigger`, `n8n-nodes-base.start`).
  - Throws `SubworkflowOperationError` if no entry trigger node exists in the sub-workflow.
- `getRunData(workflowData, inputData, parentExecution)`:
  - Discovers starting node and prepares `nodeExecutionStack` with input items mapped to `main[0]`.
  - Sets default empty object `{ json: {} }` when no input data is supplied.
  - Constructs `IWorkflowExecutionDataProcess` with `executionMode: 'integrated'`.
- `getBase(params)`:
  - Assembles baseline execution parameters including user, workflow settings, timeouts, and timezone.
- `executeWorkflow(workflowInfo, additionalData, options, context)`:
  - Resolves sub-workflow data from inline code or database repository by ID.
  - Generates integrated run data and registers sub-execution in `ActiveExecutions`.
  - Dispatches `workflow-executed` event.
  - Supports `doNotWaitToFinish: true`: immediately returns `{ executionId, data: [null] }`.
  - Dispatches sub-execution through `WorkflowExecute`, updating repository with running status.
  - Success & Waiting: captures completion or `status === 'waiting'`, finalizes in `ActiveExecutions`, extracts output data via `getDataLastExecutedNodeData`, and returns `executionId`, `data`, and `waitTill`.
  - Error: generates structured failed execution runData via `failedRunFactory`, writes error state to `executionRepository`, and re-throws error.
- Expanded error model: added `SubworkflowOperationError` extending `OperationalError`.
- Test suite expanded from 110 to **122/122 PASS** (+12 new unit tests in `10-subworkflow-execution.test.mjs`).
- Execution engine gate upgraded to **14/14 PASS** (new `E14` gate for subworkflow execution runtime).
- Zero runtime dependencies, closed package boundary, all 14 `verify:all` gates green.
