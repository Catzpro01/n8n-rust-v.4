# Node Model Contract

**Reference:** n8n `2.9.4` (`n8n@2.9.4`, commit `b6dc2787c45677a29a9612cd27eb911302961a83`)
**Package:** `n8n-workflow@2.9.1` (`reference/n8n/packages/workflow`)
**Boundary module added:** `packages/workflow/src/node-model/index.ts` (pure re-export barrel; no code moved)
**Status source of truth:** this contract was written **from the source**, not vice-versa. Where a previous draft of this file disagreed with the source, the source wins.

---

## 1. Scope of the Node Model LEGO

The Node Model owns the **definitions and contracts** of a node: what a node *is* and *declares* — not how it is *executed, routed, scheduled, stored, or rendered*.

| Aspect | Symbol(s) | Defined in |
|---|---|---|
| Node instance (identity) | `INode`, `INodes`, `IPinData` | `src/interfaces.ts` (L1297–1335) |
| Node credentials reference on an instance | `INodeCredentials`, `INodeCredentialsDetails` | `src/interfaces.ts` (L1287–1294) |
| Failure-policy flags | `OnError` (`'continueErrorOutput' \| 'continueRegularOutput' \| 'stopWorkflow'`) | `src/interfaces.ts` (L1296) |
| Parameter values | `INodeParameters`, `NodeParameterValue`, `NodeParameterValueType`, `INodeParameterResourceLocator`, `IResourceLocatorResult` | `src/interfaces.ts` (L1371–1444) |
| Parameter definitions | `INodeProperties` + all `INodeProperty*` sub-types, `IDisplayOptions`, `DisplayCondition` | `src/interfaces.ts` (L1428–1816) |
| Node type (lifecycle) | `INodeType` | `src/interfaces.ts` (L1867–1917) |
| Versioned node type | `IVersionedNodeType`, `VersionedNodeType` | `src/interfaces.ts` (L2026), `src/versioned-node-type.ts` |
| New context-API base class | `abstract class Node` | `src/interfaces.ts` (L2016) |
| Node type description | `INodeTypeBaseDescription`, `INodeTypeDescription` | `src/interfaces.ts` (L2100, L2349) |
| Connection types | `NodeConnectionTypes` (const), `NodeConnectionType`, `nodeConnectionTypes` | `src/interfaces.ts` (L2249–2269) |
| Input/output definitions | `INodeInputConfiguration`, `INodeOutputConfiguration`, `INodeFilter` | `src/interfaces.ts` (L2271–2300) |
| Issues | `INodeIssues`, `INodeIssueData`, `INodeIssueObjectProperty`, `INodeIssueTypes` | `src/interfaces.ts` (L2052–2073) |
| Registry **interface** | `INodeTypes` | `src/interfaces.ts` (L2540) |
| Loading DTOs | `KnownNodesAndCredentials`, `LoadedNodesAndCredentials`, `INodeTypeData`, `NodeLoadingDetails` | `src/interfaces.ts` (L2546–2575) |
| Helper functions | `NodeHelpers` (~35 pure functions) | `src/node-helpers.ts` |
| Node validation | `validateNodeCredentials`, `isNodeConnected`, `isTriggerLikeNode` | `src/node-validation.ts` |
| Parameter utilities | `filter-parameter`, `parameter-type-validation`, `node-parameter-value-type-guard`, `path-utils`, `rename-node-utils` | `src/node-parameters/*` |

---

## 2. Instance contract (`INode`)

A node **instance** inside a workflow JSON:

```ts
interface INode {
  id: string;                 // unique id (uuid), assigned on creation
  name: string;               // unique per workflow, display + reference key
  type: string;               // node type id, e.g. 'n8n-nodes-base.httpRequest'
  typeVersion: number;        // selected version of the node type
  position: [number, number]; // canvas coordinates
  parameters: INodeParameters;
  credentials?: INodeCredentials;   // { [credentialType]: { id, name } } — reference only, NO secrets
  disabled?: boolean;
  notes?: string; notesInFlow?: boolean;
  retryOnFail?: boolean; maxTries?: number; waitBetweenTries?: number;
  alwaysOutputData?: boolean; executeOnce?: boolean;
  onError?: OnError;
  /** @deprecated superseded by onError, still written/read for backwards compat */
  continueOnFail?: boolean;
  webhookId?: string;
  extendsCredential?: string;
  rewireOutputLogTo?: NodeConnectionType;
  forceCustomOperation?: { resource: string; operation: string };
}
```

Invariants (observed in code/tests):

* `name` is the human-facing reference used by expressions (`$('Name')`) and by `IConnections`.
* `credentials` holds only `{ id, name }` pointers; secret material never enters the Node Model.
* `parameters` values are `NodeParameterValueType` (`string | number | boolean | null | undefined` plus structured `ResourceLocator` / `ResourceMapper` / `Filter` / `AssignmentCollection` values) or expression strings (`={{ ... }}`).

## 3. Type description contract (`INodeTypeBaseDescription` / `INodeTypeDescription`)

Required fields (compile-time, enforced by TS):

* Base: `displayName`, `name`, `group` (`'input'|'output'|'organization'|'schedule'|'transform'|'trigger'[]`), `description`.
* Full: everything in base **plus** `version: number | number[]`, `defaults: NodeDefaults`, `inputs`, `outputs`, `properties: INodeProperties[]`.

Semantics:

* `inputs` / `outputs` are either arrays of `NodeConnectionType | INode(Input|Output)Configuration` **or** an `ExpressionString` computed per instance (see `NodeHelpers.getNodeInputs/getNodeOutputs` which evaluate the expression against the node's parameters).
* `version` on a multi-version node is a `number[]`; the concrete instance selects one via `INode.typeVersion`.
* `credentials?: INodeCredentialDescription[]` declares *which* credential types are accepted/required — display-gated by `displayOptions` and validated by `validateNodeCredentials()`.
* `webhooks?: IWebhookDescription[]` declares webhook endpoints **as data**. Registration, persistence and HTTP dispatch are NOT Node Model responsibility.
* `properties` is the declarative parameter schema (display rules, defaults, validation, routing hooks `routing`).

## 4. Lifecycle contract (`INodeType`)

```ts
interface INodeType {
  description: INodeTypeDescription;
  execute?(this: IExecuteFunctions, response?: EngineResponse): Promise<NodeOutput>;
  supplyData?(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData>;
  onMessage?(context: IExecuteFunctions, data: INodeExecutionData): Promise<NodeOutput>;
  poll?(this: IPollFunctions): Promise<INodeExecutionData[][] | null>;
  trigger?(this: ITriggerFunctions): Promise<ITriggerResponse | undefined>;
  webhook?(this: IWebhookFunctions): Promise<IWebhookResponseData>;
  methods?: {
    loadOptions?: {...};  listSearch?: {...};  credentialTest?: {...};
    resourceMapping?: {...};  localResourceMapping?: {...};  actionHandler?: {...};
  };
  webhookMethods?: { default?: {...}; setup?: {...}; };
  customOperations?: { [resource]: { [operation]: fn } };  // alternative to `execute`
}
```

* `NodeOutput = INodeExecutionData[][] | NodeExecutionWithMetadata[][] | EngineRequest | null`.
* A node SHOULD define either `execute` **or** `customOperations`, not both (source comment at `customOperations`).
* The `I*Functions` contexts are the **boundary types** toward the execution engine: declared here, implemented in `n8n-core` (`packages/core/src/execution-engine/node-execution-context`).
* `abstract class Node` (new context API) exposes the same lifecycle with `execute/webhook/poll` taking context as the first parameter; node classes opt in by extending it (e.g. `Webhook.node.ts`, `Form.node.ts`, `ChatTrigger.node.ts`).

## 5. Versioning contract

* `VersionedNodeType(nodeVersions, description)`:
  * `currentVersion = description.defaultVersion ?? max(keys(nodeVersions))` (`versioned-node-type.ts`).
  * `getNodeType(version?)` returns `nodeVersions[version]` or the current version's type — **no fallback if the exact version key is absent** (returns `undefined` at runtime; callers handle it).
* `NodeHelpers.getVersionedNodeType(object, version?)` unwraps `IVersionedNodeType → INodeType`; passes plain `INodeType` through.
* `NodeHelpers.mergeNodeProperties(merged, source)` overlays collections (used to build per-version descriptions).

## 6. I/O & connections contract

* Connection kinds (`NodeConnectionTypes`): `main`, `ai_agent`, `ai_chain`, `ai_document`, `ai_embedding`, `ai_languageModel`, `ai_memory`, `ai_outputParser`, `ai_retriever`, `ai_reranker`, `ai_textSplitter`, `ai_tool`, `ai_vectorStore`.
* `IConnections`: `{ [sourceNodeName]: { [connectionType]: Array<Array<IConnection | null>> } }` — graph edges keyed by node **name**; writing/graph management belongs to the Workflow LEGO.
* `INodeInputConfiguration` supports `required`, `maxConnections`, `filter: { nodes?, excludedNodes? }`, `category`; `INodeOutputConfiguration` is equivalent plus `category: 'error'`.
* `NodeHelpers.getNodeInputs/getNodeOutputs(workflow, node, nodeTypeData)` resolve static arrays or evaluate the `ExpressionString` form; `getConnectionTypes()` maps entries to plain connection types.

## 7. Parameters contract

* `NodeHelpers.getNodeParameters(nodePropertiesArray, nodeValues, returnDefaults, returnNoneDisplayed, node, nodeTypeDescription, options?)` computes effective parameter values: applies defaults, evaluates display conditions (`displayParameter`, version-aware via `node.typeVersion`), resolves collections, and applies `parameterDependencies` resolution order. Missing non-displayed values are dropped unless `returnNoneDisplayed`.
* `NodeHelpers.getNodeParametersIssues(...)` / `getParameterIssues(...)` produce `INodeIssues` (validation errors, credential issues) without throwing; `getNodeWebhookPath/getNodeWebhookUrl` derive webhook paths/urls from `IWebhookDescription`s.
* `validateNodeParameters()` (`node-parameters/parameter-type-validation.ts`) asserts typed values (`string|number|boolean|array|object`) per property at runtime.
* Display conditions: `displayParameter()` checks `displayOptions.show/hide` (with `_cnd` short forms and `@version` gating); this is pure function — no editor state involved.

## 8. Registry contract (`INodeTypes`) — interface only

```ts
interface INodeTypes {
  getByName(nodeType: string): INodeType | IVersionedNodeType;
  getByNameAndVersion(nodeType: string, version?: number): INodeType;
  getKnownTypes(): IDataObject;
}
```

The Node Model owns **only this interface**. Implementations live outside this LEGO (`packages/cli/src/node-types.ts`, `packages/@n8n/task-runner/src/node-types.ts`, `packages/core/nodes-testing/node-types.ts`, `packages/workflow/test/node-types.ts`).

## 9. Errors owned by Node Model (raised *against* nodes)

`errors/node-api.error.ts` (`NodeApiError`), `errors/node-operation.error.ts` (`NodeOperationError`), `errors/node-ssl.error.ts`, `errors/abstract/node.error.ts` (`NodeError` base). Throwing/handling them is execution-time behaviour; the classes themselves are shared contracts and are NOT re-exported by the `node-model` barrel (they remain at `n8n-workflow` root via `export * from './errors'`).

## 10. Stability & change rules

1. Any change to symbols listed above is a **public API change**: consumers live in `nodes-base` (478 `*.node.ts` classes + 248 credential files), `@n8n/nodes-langchain`, `n8n-core`, `n8n` CLI (REST: `NodeTypesController` serves descriptions), `editor-ui` (NDV panel), `@n8n/task-runner`, `@n8n/ai-workflow-builder.ee`, `eslint-plugin-community-nodes`.
2. The `node-model` barrel is append-only for now; moving implementations requires contract revision + cross-agent coordination.
3. Behavioural semantics (defaults, display rules, versioning fallbacks) follow the source as documented above — do not "fix" semantics to match external assumptions; update this contract instead.

---

## 11. Interfaces consumed from other LEGOs (CONTRACT FIRST declarations)

Validated against source 2.9.4 on 2026-09-17 — full evidence: `docs/isolation/node-interface-validation.md`.

### From Workflow LEGO (Agent 1) — validated ✅

| Interface (provided by `packages/workflow/src/workflow.ts` / `src/common/`) | Signature (source-verified) | Semantics the Node Model relies on |
|---|---|---|
| `Workflow.getNode` | `(nodeName: string) => INode \| null` | name-keyed lookup; returns `null` for unknown names — never throws |
| `Workflow.getNodes` | `(nodeNames: string[]) => INode[]` | silently skips unknown names (result may be shorter) |
| `getConnectedNodes` | `(connections: IConnections, nodeName: string, connectionType?: NodeConnectionType \| 'ALL' \| 'ALL_NON_MAIN', depth?: number, checkedNodesIncoming?: string[]) => string[]` | defaults `main` + `depth=-1` (unlimited); returns node names; unknown node → `[]` |
| `getParentNodes` / `getChildNodes` | same basis, adjacency pre-mapped | traversal over `IConnections` |

Types consumed: `INode`, `IConnections`, `NodeConnectionType` — all owned by this contract;
Agent 1 consumes them from here (rule 4 cross-reference for their contract update).

### Provided to Workflow LEGO — FROZEN PORTS (agent-1 DEPENDENCY_REQUEST MSG-01, answered 2026-09-17)

These four signatures are **frozen** (no renames, no type changes). Changing them after
Agent 5 verification invalidates the Workflow-LEGO digest baseline. Source-verified against
`n8n@2.9.4`; the `node-model` barrel re-exports all four.

| Port | Symbol | Exact source signature (n8n@2.9.4) | Freeze |
|---|---|---|---|
| P-NODE-MODEL | `node-helpers::getNodeParameters` | `(nodePropertiesArray: INodeProperties[], nodeValues: INodeParameters \| null, returnDefaults: boolean, returnNoneDisplayed: boolean, node: Pick<INode,'typeVersion'> \| null, nodeTypeDescription: INodeTypeDescription \| null, options?: GetNodeParametersOptions) => INodeParameters \| null` | ✅ name & shape |
| P-NODE-MODEL | `node-helpers::getNodeOutputs` | `(workflow: Workflow, node: INode, nodeTypeData: INodeTypeDescription) => Array<NodeConnectionType \| INodeOutputConfiguration>` | ✅ name & shape |
| P-NODE-RENAME | `node-parameters/rename-node-utils::renameFormFields` | `(node: INode, renameField: (v: NodeParameterValueType) => NodeParameterValueType) => void` — **mutates in place**; only rewrites `parameters.formFields.values[*].html` where `fieldType === 'html'` | ✅ name & shape |
| P-NODE-REFERENCE | `node-reference-parser-utils::applyAccessPatterns` | `(expression: string, previousName: string, newName: string) => string` — early-returns the input unchanged when `previousName` is absent | ✅ name & shape |

Host-side opacity notes (accepted, documented, not source behavior):

1. `packages/workflow-lego` declares `getNodeParameters`' 7th param as `options?: unknown`
   — a deliberate widening of `GetNodeParametersOptions`; source shape is the authority above.
2. `getNodeOutputs`' first param is declared `unknown` host-side (source: `Workflow`).
   Per agent-1 ISSUE-004: output resolution at runtime calls into the **expression runtime**
   (`workflow.expression.getSimpleParameterValue`), not Workflow internals — consistent with
   this contract's "no expression evaluation" boundary.
3. ⚠️ **Type correction against agent-1's draft port:** `applyAccessPatterns` takes/returns
   **`string`**, not `NodeParameterValueType`. Passing values keyed from parameters must be
   guarded to strings (numbers/booleans would break `Expression.includes` inside). Port
   semantics unchanged; the source type is the frozen one.


### From Expression runtime (Agent 4 hand-off per the agent-2 role manifest)

| Interface | Direction | Note |
|---|---|---|
| `isExpression(value)` (`src/expressions/expression-helpers.ts`) | Node parameters → expression detection only | `node-helpers.ts` *detects* expression strings but never **evaluates** them; evaluation stays outside the node-parameters boundary (responsibility #2) |
| `IWorkflowDataProxy*` / `Expression` | consumed by execution, not by the Node Model proper | listed for transparency; no node-model function evaluates expressions |

### From Execution LEGO (Agent 3) — type-only

`IRunExecutionData` (type-only import in `node-helpers.ts`), `ITaskData` (via `EngineResult`).
The role-granted read scope `src/run-execution-data/**` is used read-only; its runtime-state
types (`IRun`, `IRunData`, …) remain owned by Execution and are deliberately not re-exported
by the `node-model` barrel. The item-level contract (`INodeExecutionData[]` =
`[{ json, binary, pairedItem?, ... }]`) *is* owned here (barrel group 7) per responsibility #4.
