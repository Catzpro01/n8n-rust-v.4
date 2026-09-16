# 06 - Execution Data Anatomy (`INodeExecutionData`)

## 1. Core Data Envelope
All data passing between nodes strictly follows this envelope:
```typescript
interface INodeExecutionData {
  json: Record<string, any>;
  binary?: Record<string, IBinaryData>;
  pairedItem?: IPairedItemData | IPairedItemData[];
}
```

## 2. Multi-Item Semantics
- Nodes in n8n process arrays of items (`INodeExecutionData[]`).
- One input array can produce 0, 1, or multiple output items.
- Item pairing tracks lineage: which output item maps back to which input item index.
