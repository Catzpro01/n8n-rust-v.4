# 04 - Node System Anatomy

## 1. Node Model (`INode`)
```typescript
interface INode {
  id: string;
  name: string;
  type: string;           // e.g. "n8n-nodes-base.httpRequest"
  typeVersion: number;    // Semantic versioning for nodes
  position: [number, number];
  disabled?: boolean;
  notes?: string;
  parameters: Record<string, any>;
  credentials?: Record<string, any>;
}
```

## 2. Node Execution Lifecycles
- `INodeType`: The blueprint describing node parameters, outputs, inputs, and execute method.
- `execute()`: Invoked for batch processing of incoming data items.
- `poll()`: Invoked periodically for polling triggers.
- `webhook()`: Invoked when an incoming HTTP webhook hits the specific node path.
