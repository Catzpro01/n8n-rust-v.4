# LEGO Contract: Workflow Execution Engine

**Component:** `packages/reconstructed-engine/runner.mjs`
**Reference:** n8n 2.9.4 execution anatomy (`packages/core/src/execution-engine/workflow-execute.ts`)
**Status:** IMPLEMENTED (standalone Node.js adapter)

This contract describes the small, dependency-free execution seam used by the
reconstructed engine. It is not a claim that the complete n8n Core execution
runtime has been replaced. The pinned reference remains the behavioral oracle;
this module is intentionally host-driven and accepts node handlers through a
registry.

## 1. Public interface

```js
class WorkflowExecutionEngine {
  constructor(workflowDefinition, options = {})
  registerNodeType(typeName, handler): this
  unregisterNodeType(typeName): boolean
  runWorkflow(startNodeName?, initialData?, runOptions?): Promise<ExecutionResult>
  cancel(reason?): void
}

// Function handler, kept for the original reconstructed-engine API.
(node, items, context) => NodeOutput | Promise<NodeOutput>

// Context-oriented handler adapter.
{
  execute(context): NodeOutput | Promise<NodeOutput>
}
```

`runWorkflow` also accepts one options object:

```js
engine.runWorkflow({
  startNodeName,
  initialData,
  maxNodeExecutions,
})
```

## 2. Workflow input

A workflow contains `nodes` and n8n-shaped `connections`:

```js
{
  nodes: [{ name, type, parameters, retryOnFail, maxTries,
            waitBetweenTries, onError, continueOnFail,
            alwaysOutputData, executeOnce, disabled }],
  connections: {
    [sourceName]: {
      main: [[{ node: targetName, type: 'main', index: inputIndex }]]
    }
  }
}
```

Node names are unique and are the graph keys. Connections to unknown nodes are
rejected before execution. The engine consumes all connection types for graph
validation but schedules only `main`; AI and other specialized connection types
remain an explicit future adapter boundary.

`initialData` is an array of raw JSON objects or execution items. If it is
omitted, the start node receives one item with `{ json: {} }`.

## 3. Scheduling semantics

1. An explicit `startNodeName` wins.
2. Disabled nodes are excluded from automatic start selection.
3. Otherwise the first enabled trigger-like node (`trigger`, `manual`, or `start`
in its type) is selected.
4. Otherwise the first enabled main-graph root is selected; if a disabled
trigger is the only structural root, the first enabled node is used instead.
5. A node runs only after every incoming main connection has delivered its
branch. Items from multiple input indexes are retained separately and exposed
through `context.getInputData(index)`.
6. A `main[outputIndex]` branch is delivered only to connections attached to
that output index; no branch is broadcast to unrelated outputs.
7. An empty output is recorded as a successful task and does not start a
downstream node. `alwaysOutputData` opts into one empty JSON item.
8. Cycles are bounded by `maxNodeExecutions` (default `1000`) and result in an
`ERROR` execution with code `MAX_NODE_EXECUTIONS` rather than an unbounded loop.

## 4. Execution data

Every executed node creates one task in `result.runData[nodeName]`:

```js
{
  startTime,
  executionIndex,
  executionTime,
  source: [{ previousNode, previousNodeOutput, previousNodeRun }],
  executionStatus: 'success' | 'error',
  data: { main: NodeOutput },
  error?: SerializedError,
}
```

The result also exposes:

- `outputs`: complete `main[outputIndex][itemIndex]` data;
- `data`: one-branch-compatible view (`outputs[node][0]` for a single-output
  node);
- `executionLog`: counts, duration, attempts, status and error details;
- `lastNodeExecuted` and the top-level execution status.

Node outputs are normalized into `NodeOutput`. Explicit `pairedItem` metadata is
never overwritten; otherwise the engine applies the documented one-input,
one-to-one, and single-output pairing defaults.

## 5. Node context

Handlers receive a `NodeExecutionContext` with:

| method/property | contract |
|---|---|
| `node` | current immutable node definition reference |
| `items`, `inputData` | flattened main input items |
| `getInputData(inputIndex = 0)` | items for one main input slot |
| `getNodeParameter(path, fallback, itemIndex = 0)` | parameter lookup with the supported data-proxy expressions |
| `getWorkflowDataProxy(itemIndex = 0)` | proxy for `$json`, `$binary`, `$input`, `$execution`, and prior-node reads |
| `getWorkflowStaticData()` | workflow-level static data object |
| `getExecutionData()` | current run-data map |
| `signal` | abort signal for cancellation-aware handlers |
| `runIndex`, `executionIndex`, `executionId` | current execution identity |

The proxy supports the safe, explicit forms used by this adapter, including
`={{ $json.field }}`, `={{ $input.first().json.field }}` and
`={{ $('Node').first().json.field }}`. It does not evaluate arbitrary JavaScript
or replace the reference expression sandbox.

## 6. Retry and error policy

- `retryOnFail: true` retries between 2 and 5 attempts; `maxTries` is clamped
to that range.
- `waitBetweenTries` is clamped to 0–5000 ms; the default is 1000 ms.
- `onError: 'continueRegularOutput'` emits a serialized error item on output 0.
- `onError: 'continueErrorOutput'` emits it on output 1.
- Legacy `continueOnFail: true` maps to `continueRegularOutput`.
- The default `stopWorkflow` policy records an error and prevents downstream
scheduling. The result status is `ERROR` and `finished` is `false`.
- Cancellation returns `CANCELED` and includes the cancellation error.

## 7. Ownership and non-responsibilities

This module owns graph scheduling, handler invocation, task aggregation,
retry/error routing, pairing defaults and the in-memory execution result.

It does **not** own:

- node catalog loading or node implementation logic;
- the reference Expression evaluator or arbitrary JavaScript execution;
- binary data storage, persistence, queue workers, webhook servers or
lifecycle hooks;
- credentials, secrets, database migrations or frontend behavior;
- changes under `reference/n8n/**`.

Those surfaces remain separate contracts and adapters. Any new cross-boundary
runtime dependency must be declared before it is added.
