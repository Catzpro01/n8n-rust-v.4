# LEGO Contract: Node Model

## 1. Data Schema
```typescript
interface NodeContract {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  disabled?: boolean;
  parameters: Record<string, any>;
  credentials?: Record<string, any>;
}
```

## 2. Invariants
- `name` is the primary reference key across all connection mappings.
- `typeVersion` must match an available specification schema.
