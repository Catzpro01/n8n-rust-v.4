# LEGO Contract: Workflow Definition

## 1. Data Schema
```typescript
interface WorkflowContract {
  id: string;
  name: string;
  nodes: NodeContract[];
  connections: Record<string, Record<string, ConnectionContract[][]>>;
  settings?: Record<string, any>;
  staticData?: Record<string, any>;
}
```

## 2. Invariants
- `nodes`: Must contain unique node names.
- `connections`: Source and destination node names must exist in `nodes`.
- Graph must be acyclic (no cycles) for execution traversal.
