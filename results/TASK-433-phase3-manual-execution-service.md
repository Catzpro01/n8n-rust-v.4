# TASK-433 — Manual Execution Service and Graph Re-wiring

Status: **SUBMITTED_FOR_REVIEW**

Reconstructed manual execution service and graph re-wiring algorithms 1:1 against n8n 2.9.4 CLI reference (`reference/n8n/packages/cli/src/manual-execution.service.ts`, `reference/n8n/packages/core/src/execution-engine/partial-execution-utils/*`, `reference/n8n/packages/core/src/execution-engine/workflow-execute.ts`):
- `DirectedGraph`:
  - Adjacency list representation of workflow nodes and connections.
  - Supports node and connection additions, connection queries, parent/child traversals.
  - Node removal with optional reconnection (`reconnectConnections: true`) bypassing intermediate nodes.
  - Cycle detection using Tarjan's Strongly Connected Components (SCC) algorithm.
  - Conversion between `Workflow` and `DirectedGraph` (`fromWorkflow`, `fromNodesAndConnections`, `toWorkflow`).
- Partial Execution Utilities:
  - `isTool(nodeTypeDescription, parameters)`: recognizes AI tool nodes and vector stores in `retrieve-as-tool` mode.
  - `filterDisabledNodes(graph)`: removes disabled nodes while reconnecting main input/output paths.
  - `rewireGraph(tool, graph, agentRequest)`: inserts virtual `PartialExecutionToolExecutor` (`@n8n/n8n-nodes-langchain.toolExecutor`), reroutes tool output and parent inputs, and eliminates original agent node.
  - `recreateNodeExecutionStack(graph, startNodes, runData, pinData)`: rebuilds `nodeExecutionStack`, `waitingExecution`, and `waitingExecutionSource` for restart points and partial executions.
  - `findTriggerForPartialExecution`, `findSubgraph`, `findStartNodes`, `handleCycles`, `cleanRunData`: complete graph traversal and state pruning for partial runs.
- `ManualExecutionService`:
  - `getExecutionStartNode(data, workflow)`: discovers start node prioritizing `triggerToStartFrom` and single `startNodes` backed by `pinData`.
  - `runManually(data, workflow, additionalData, executionId, pinData)`:
    - Trigger-start flow: handles `data.triggerToStartFrom?.data && data.startNodes?.length`, reconstructs execution stack, and initiates `processRunExecutionData`.
    - Full execution flow: handles `data.runData === undefined || data.executionMode === 'evaluation'`, detects tool destinations for graph rewiring, tracks connected HITL tools in `additionalRunFilterNodes`, and delegates to `WorkflowExecute.run()`.
    - Partial execution flow: validates `data.destinationNode` presence and delegates to `WorkflowExecute.runPartialWorkflow2()`.
- `WorkflowExecute.prototype.runPartialWorkflow2`:
  - Reconstructed and exposed on `WorkflowExecute` for partial execution of subgraphs.
- Test suite expanded from 122 to **144/144 PASS** (+22 new unit tests in `11-manual-execution.test.mjs`).
- Execution engine gate upgraded to **15/15 PASS** (new `E15` gate for `ManualExecutionService`).
- Zero runtime dependencies, closed package boundary, all 14 `verify:all` gates green.
