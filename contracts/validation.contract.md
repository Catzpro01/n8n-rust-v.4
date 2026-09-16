# LEGO Contract: Validation Rules

## 1. Contract Inputs & Outputs
- Input: `WorkflowContract`
- Output: `{ valid: boolean; errors: ValidationError[] }`

## 2. Validation Checks
1. `NodeUniqueness`: No duplicate node names.
2. `DanglingConnections`: No connections pointing to non-existent nodes.
3. `CycleDetection`: Tarjan's or DFS topological validation to detect cycles.
4. `DisabledHandling`: Disabled nodes do not execute and do not pass upstream data unless explicitly configured.
