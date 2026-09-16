# Cross-LEGO Dependencies (Agent 3: Execution Data + Expression)

Rule: `DO NOT MODIFY FIRST`. Every entry below is a dependency discovered in
`reference/n8n` 2.9.4 source that crosses into another agent's LEGO. Nothing in
the other LEGOs was changed; these are coordination requests.

---

## D-01

```text
Dependency:
Expression → Workflow

Reason:
WorkflowDataProxy resolves $('X') / $node['X'] / .item using graph queries:
  - workflow.getNode(name)                 (existence check, $nodeVersion, $nodeId, $webhookId, params)
  - workflow.nodes[name]
  - workflow.getNodeConnectionIndexes(contextNode, X, 'main')  → default output branch
  - workflow.getParentNodes(node, type?)   → pairing legality ("no connection" error)
  - workflow.getChildNodes(node, 'ALL_NON_MAIN')
  - workflow.getParentMainInputNode(node)
  - workflow.queryNodes(...)               ($agentInfo)
  - workflow.getPinDataOfNode(name)        (manual mode pin data)
  - workflow.settings.timezone / binaryMode / executionOrder
  - workflow.nodeTypes.getByNameAndVersion (agent info)
Source: packages/workflow/src/workflow-data-proxy.ts, workflow-data-proxy-helpers.ts, expression.ts

Required API:
A stable read-only graph/query contract exposing the members above (name-keyed).

Owner:
Agent 1

Action:
Coordination required – add these members to contracts/workflow.contract.md as
"read API consumed by Expression". No change made here.
```

## D-02

```text
Dependency:
Workflow → Expression  (inverse direction, creates a cycle)

Reason:
packages/workflow/src/workflow.ts L134: `this.expression = new Expression(this);`
and the proxy calls back `workflow.expression.getParameterValue` for $parameter /
$evaluateExpression. Expression cannot be constructed without a Workflow, and
Workflow eagerly constructs Expression.

Required API:
Decision whether Workflow keeps owning the Expression instance (current) or the
engine injects it. Any change touches workflow.ts (Agent 1).

Owner:
Agent 1 (file) / Agent 3 (consumer)

Action:
Coordination required. Documented as "must stay together for now" in
docs/isolation/expression.md §12.
```

## D-03

```text
Dependency:
Expression → Node Model

Reason:
  - INode shape: name, type, typeVersion, id, parameters, webhookId, disabled
  - NodeHelpers.getNodeParameters (resolving $parameter / $('X').params)
  - NodeHelpers.getContext (node/flow context)
  - SCRIPTING_NODE_TYPES, AGENT_LANGCHAIN_NODE_TYPE constants (augmentation, agent info)
Source: workflow-data-proxy.ts imports from './node-helpers', './constants', './interfaces'

Required API:
INode type + NodeHelpers.getNodeParameters/getContext signatures frozen in
contracts/node.contract.md.

Owner:
Agent 2

Action:
Coordination required. No change made.
```

## D-04

```text
Dependency:
Execution Data → Node Model

Reason:
  - IExecuteData.node: INode
  - IRunData / IPinData / IWaitingForExecution are keyed by node NAME (not id)
  - ISourceData.previousNode is a node name
Renaming a node therefore requires rewriting execution data keys (handled by
Workflow.renameNode today).

Required API:
Guarantee in node.contract.md that `name` is the stable runtime key (already
stated there: "name is the primary reference key").

Owner:
Agent 2

Action:
Already satisfied by contracts/node.contract.md §2. No change needed; noted.
```

## D-05

```text
Dependency:
Execution Data → Workflow

Reason:
  - IRunExecutionData.resultData.pinData mirrors workflow.pinData
  - startData.destinationNode: IDestinationNode (workflow graph target)
  - Which input array becomes connectionInputData depends on
    workflow.settings.executionOrder ('v1' vs legacy) – prepareConnectionInputData

Required API:
pinData and settings.executionOrder in workflow.contract.md.

Owner:
Agent 1

Action:
Coordination required.
```

## D-06

```text
Dependency:
Expression / Execution Data → Execution Engine (n8n-core)  [analysis only]

Reason:
  - WorkflowExecute re-indexes input pairedItem and runs assignPairedItems (pairing rules)
  - NodeExecutionContext._getNodeParameter supplies additionalKeys ($execution/$vars/$secrets)
    and post-processes results (cleanupParameterData, ensureType, extractValue, schema validation)
  - BinaryDataService resolves IBinaryData.id

Required API:
None new. Engine is out of scope (task §5). Behaviour is captured as contract
invariants + reference tests instead of code movement.

Owner:
Engine (not assigned in this phase)

Action:
No modification. Documented in both isolation docs.
```

## D-07

```text
Dependency:
Execution Data → Persistence (@n8n/db)

Reason:
ExecutionRepository serialises IRunExecutionData with `flatted` and calls
migrateRunExecutionData on read (v0 → v1).

Required API:
Persistence must keep calling migrateRunExecutionData; wire format is flatted JSON.

Owner:
Agent 4

Action:
Informational. No change.
```
