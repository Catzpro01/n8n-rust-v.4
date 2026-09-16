# 03 - Workflow Anatomy: Graph Structure & Model

## 1. Data Structure Definition (`Workflow`)
A Workflow instance represents a directed acyclic graph (DAG):
- `id`: Unique identifier (string).
- `name`: Human-readable label.
- `nodes`: Array of `INodeUi` / `INode`.
- `connectionsBySourceNode`: Adjacency list mapping source node to target nodes:
  `Record<NodeName, Record<ConnectionType, IConnection[][]>>`
- `connectionsByDestinationNode`: Inverted adjacency list for fast upstream traversal.
- `settings`: Execution settings (e.g. `saveDataErrorExecution`, `timeout`, `executionTimeout`).
- `staticData`: Long-lived state for polling triggers.
- `pinData`: Mock data for developer testing without running upstream nodes.

## 2. Connection Model
Connection Types:
- `main`: Standard sequential data flow.
- `ai_tool`, `ai_memory`, `ai_languageModel`: LangChain/AI agent sub-connections.

## 3. Core Graph Traversal Operations
- `getNode(name: string): INode | null`
- `getParentNodes(nodeName: string, type?: string, depth?: number): string[]`
- `getChildNodes(nodeName: string, type?: string, depth?: number): string[]`
- `getStartNode(startNode?: string): INode | null`
- Cycle detection & topological sort order generation.
