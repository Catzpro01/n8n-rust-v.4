# LEGO Contract: Connection Model

## 1. Data Schema
```typescript
interface ConnectionContract {
  node: string;
  type: "main" | "ai_tool" | "ai_memory" | "ai_languageModel";
  index: number;
}
```

## 2. Invariants
- Output index must be `>= 0` and within the declared output count of the source node.
- Input index must be `>= 0` and within the declared input count of the destination node.
