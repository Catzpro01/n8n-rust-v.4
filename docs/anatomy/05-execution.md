# 05 - Execution Engine Anatomy

## 1. Orchestration Pipeline (`WorkflowExecute`)
The engine executes nodes along the resolved topological order:
1. Initialize `RunExecutionData` with start node and trigger data.
2. For each runnable node in the queue:
   - Resolve upstream input data (`ExecutionData`).
   - Resolve dynamic expressions in `parameters` via `WorkflowDataProxy`.
   - Call node execute method (`execute()` or `poll()`).
   - Store node output into execution data buffer.
   - Compute downstream target nodes based on output connection indices.
3. Handle errors: trigger error workflow or retry rules.
4. Mark execution status (`success`, `error`, `waiting`).
