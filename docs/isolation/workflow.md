# Phase 2 LEGO Isolation Blueprint: Workflow Model

## 1. Goal & Boundary Definition
Isolate the pure Workflow Model from `reference/n8n/packages/workflow` into an independent LEGO component without breaking existing n8n functionality:
- Input: Workflow JSON object (`id`, `name`, `nodes`, `connections`, `settings`, `staticData`).
- Output: Validated Directed Acyclic Graph (DAG) with adjacency list and helper methods.

## 2. Invariants & Responsibilities
- **Scope**:
  - `Workflow` class definition
  - Node connection mapping (`connectionsBySourceNode`, `connectionsByDestinationNode`)
  - Graph traversal methods (`getNode`, `getParentNodes`, `getChildNodes`, `getStartNode`)
  - Acyclic validation (cycle detection)
- **Out of Scope (Do NOT touch in this phase)**:
  - Node execution runtime (`n8n-core`)
  - Expression evaluation (`WorkflowDataProxy`)
  - Database persistence
  - Webhook listener

## 3. Preservation of n8n Compatibility
- `reference/n8n/` remains the golden baseline.
- No changes to external interfaces.
- Isolated internally, connected externally.
