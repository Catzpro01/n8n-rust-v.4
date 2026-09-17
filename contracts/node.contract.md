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

---

## 12. Phase-3 reconstruction (`packages/node-lego`, TASK-409)

The Phase-2 contract above describes the Node Model *as data/type contracts*. Phase 3 adds a
runnable, dependency-free JavaScript reconstruction of the **pure-function surface** of that
model — the part the Workflow Model and the Execution LEGO import at runtime.

### 12.1 Module map (all paths under `packages/node-lego/src/`)

| Module | Reconstructs (pinned source) | Reference oracle |
|---|---|---|
| `connection-io.mjs` | `node-helpers.ts` `getConnectionTypes` L1104, `getNodeInputs` L1117, `getNodeOutputs` L1140, `isSubNodeType` L247, `isTriggerNode` L1671, `isExecutable` L1675, `nodeAcceptsInputType` L1921, `nodeHasOutputType` L1949 | `test/node-helpers.test.ts` |
| `conditions.mjs` | `checkConditions` L330, `evaluateFeature` L265, `getNodeFeatures` L275 | `test/node-helpers.conditions.test.ts` |
| `display.mjs` | `getPropertyValues` L290, `displayParameter` L403, `displayParameterPath` L469 | `test/node-helpers.conditions.test.ts` |
| `node-validation.mjs` | `node-validation.ts` whole file (88 ln): `validateNodeCredentials` L24, `isNodeConnected` L67, `isTriggerLikeNode` L92 | `test/node-validation.test.ts` (18 cases) |
| `parameter-utils.mjs` | `node-parameters/path-utils.ts` (`resolveRelativePath`), `rename-node-utils.ts` (`renameFormFields`), `node-parameter-value-type-guard.ts` (all guards), `type-guards.ts` L15/L60/L93 guards, `node-helpers.ts` `getParameterValueByPath` L1369 | `test/node-parameters/*.test.ts`, `test/rename-node-utils.test.ts` |
| `parameter-type-validation.mjs` | `node-parameters/parameter-type-validation.ts` (272 ln) incl. `validateNodeParameters` | `test/node-parameters/parameter-type-validation.test.ts` (806 ln) |
| `properties.mjs` | `node-helpers.ts` `mergeNodeProperties` L1641, `getVersionedNodeType` L1661, `isNodeWithWorkflowSelector` L1688, `resolveResourceAndOperation` L1692, `makeDescription` L1741, `isToolType`/`isHitlToolType`/`isTool` L1761-1814, `makeNodeName` L1816, `isDefaultNodeName` L1849, `getUpdatedToolDescription` L1864, `getToolDescriptionForNode` L1890, `getSubworkflowId` L1908; `type-guards.ts` L21-39 property guards | `test/node-helpers.test.ts` |
| `parameter-resolution.mjs` | `node-helpers.ts` `getParameterDependencies` L542, `getParameterResolveOrder` L577, `getNodeParameters` L658-1056 | `test/node-helpers.test.ts` `describe('getNodeParameters')` L34-3466, `noDataExpression` L6321-6524 |
| `deep-copy.mjs` | `utils.ts` `deepCopy` L53-87 (the copy the Node Model uses — **not** lodash `cloneDeep`) | differential N18 |
| `expression-helpers.mjs` | `expressions/expression-helpers.ts` `isExpression` (the only expressions surface the Node Model owns) | differential N18 |
| `errors.mjs` | `errors/node-operation.error.ts` + `errors/abstract/{node,execution-base}.error.ts` + `@n8n/errors` `application.error.ts` — **validation/resolution boundary only** | differential N09/N10/N17/N18 |
| `lodash-lite.mjs` | the `lodash/{get,isEqual,isObject}` helpers `node-helpers.ts`/`type-validation.ts` import, plus `escapeRegExp`, `mapValues` and `cloneDeep` for `node-reference-parser-utils.ts` and `base.error.ts` (DELTA-01) | `node-model.test.mjs`, differential `N25` |
| `json-repair.mjs` | `jsonrepair@3.13.1` (ISC) as bundled by the published reference build — the `jsonParse(..., { repairJSON: true })` path (`utils.ts` L5/L164-170) — ported verbatim from the resolved UMD bundle (903 ln) | differential `N26`, `test/utils.test.ts` `describe('JSON repair')` L162-290 |
| `type-validation.mjs` | `type-validation.ts` (481 ln): `tryToParseNumber` L15, `tryToParseString` L24, `tryToParseAlphanumericString` L38, `tryToParseBoolean` L48, `tryToParseDateTime` L72, `tryToParseTime` L114, `tryToParseArray` L124, `tryToParseObject` L146, `tryToParseBinary` L162, `tryToParseJsonToFormFields` L206, `getValueDescription` L272, `tryToParseUrl` L284, `tryToParseJwt` L305, `validateFieldType` L326-481; `utils.ts` `jsonParse` L152 (+`parseJSObject` L123); `type-guards.ts` `isBinaryValue` L168 | `test/type-validation.test.ts` (512 ln), differential N19/N20 |
| `filter-parameter.mjs` | `node-parameters/filter-parameter.ts` whole file: `FilterError` L23, `parseSingleFilterValue` L32, `withIndefiniteArticle` L66, `parseFilterConditionValues` L71, `parseRegexPattern` L196, `arrayContainsValue` L209, `executeFilterCondition` L222-404, `executeFilter` L409-424, `validateFilterParameter` L427-450 | `test/filter-parameter.test.ts`, differential N21/N23 |
| `webhook-path.mjs` | `node-helpers.ts` `getNodeWebhookPath` L1057-1084, `getNodeWebhookUrl` L1087-1101 | `test/node-helpers.test.ts` L6211, differential N24 |
| `cron-node-options.mjs` | `node-helpers.ts` `cronNodeOptions` L56-241 (verbatim data literal) | differential N24 (byte-compared) |
| `parameter-issues.mjs` | `node-helpers.ts` `getContext` L505-538, `getNodeParametersIssues` L1202, `validateResourceLocatorParameter` L1228, `validateResourceMapperParameter` L1257, `validateParameter` L1305, `addToIssuesIfMissing` L1325, `getParameterIssues` L1389-1580, `mergeIssues` L1600-1635; `type-guards.ts` `isValidResourceLocatorParameterValue` L47-57 | `test/node-helpers.test.ts` `describe('getParameterIssues')` L3683 + `required parameters validation` L4270, differential N22 |
| `node-reference-parser.mjs` | `node-reference-parser-utils.ts` whole file (643 ln): `hasDotNotationBannedChar` L16, `backslashEscape` L17, `dollarEscape` L30, `applyAccessPatterns` L42, `extractReferencesInNodeExpressions` L491-643 + the private expression/candidate parsers, `ACCESS_PATTERNS` and the duplicate/canonical mapping; `errors/base/operational.error.ts` | `test/node-reference-parser-utils.test.ts` (788 ln, 15 ported cases), differential `N25` |

### 12.2 Explicit deltas (everything not 1:1)

1. **`lodash` → `lodash-lite.mjs`.** DELTA-01. The reference imports exactly two lodash
   helpers in `node-helpers.ts` (`lodash/get`, `lodash/isEqual`); a LEGO must stay
   dependency-free (gate `N01`). Both are reimplemented and pinned by tests (`get`/`toPath`
   path grammar, `isEqual` value semantics incl. `Date`), plus `isObject` for the `object`
   field type of `type-validation.ts`. `deepCopy` is the reference's own
   `utils.ts` helper and is reconstructed verbatim (`src/deep-copy.mjs`) — including its
   `toJSON`-first behaviour, so a `Date` parameter becomes an ISO string.
   Slice 5 added the helpers the reference's error/parser boundary pulls in:
   `escapeRegExp` and `mapValues` (1:1 with lodash, oracle-compared through the reference
   build's own bundled lodash) and `cloneDeep`. **`cloneDeep` is not `deepCopy`:** lodash keeps
   `Date`/`RegExp`/`Map`/`Set` and cycles (pinned by the `N25` mixed-structure comparison),
   whereas the reference `deepCopy` is `toJSON`-first; both coexist in `lodash-lite.mjs`
   because `node-reference-parser-utils.ts` calls lodash's `cloneDeep`, not `deepCopy`.
2. **Error class is a boundary-local reconstruction.** DELTA-02. `NodeOperationError`
   keeps the reference `name`, `message`, `level`, `node`, `context`, `messages`,
   `timestamp` — verified field-by-field (`N09/N10`) — but the *hierarchy*
   (`ExecutionBaseError`/`NodeError`/`ApplicationError`) stays outside this LEGO.
   Slice 5 added `OperationalError` (`errors/base/operational.error.ts`) with the same
   surface contract: `level` defaults to `'warning'`, `tags` to `{}`, and the pinned DELTA-03
   quirk that the base constructor never assigns `name`, so `name === 'Error'`.
   Consolidation with `packages/execution-engine/src/errors.mjs` is ISSUE-024.
3. **`ApplicationError` name quirk.** DELTA-03 (pinned, not a deviation): the reference
   imports `ApplicationError` from `@n8n/errors`, whose constructor never sets `name` — so the
   resolve-order guard throws an error whose `name === 'Error'` while `level === 'error'`.
   `src/errors.mjs` reproduces that exactly; the differential compares `name`, `message`,
   `level`, `extra` and `tags`.
4. **`luxon` → injected date-time factory.** DELTA-04. The reference parses date-times with
   `luxon` (`DateTime.fromISO`/`fromHTTP`/`fromRFC2822`/`fromSQL`/`fromMillis`/`fromJSDate`).
   A LEGO must stay dependency-free, so `tryToParseDateTime`/`validateFieldType` take an
   injected `dateTimeFactory` implementing that subset; the built-in default understands JS
   `Date`, ISO-8601, HTTP-date/RFC-2822 and `YYYY-MM-DD HH:mm:ss` strings and returns a plain
   `{ isValid, toISO, toJSDate, toMillis }` value instead of a `DateTime`. The differential
   injects the reference's own luxon, so the format cascade, the `startsWith('=')`-free error
   handling and every returned value are compared bit-for-bit — only the adapter differs.
5. **`esprima`/`jsonrepair` → injected adapters with real defaults.** DELTA-05. `jsonParse`'s
   `acceptJSObject` recovery is the reference's esprima-backed `parseJSObject`; here it is an
   injected adapter (`parseJSObject` option, used by `tryToParseObject` and
   `tryToParseJsonToFormFields`) whose default handles the relaxed shapes the editor produces
   (unquoted keys, single-quoted strings, trailing commas). The `repairJSON` path is **no longer
   a no-op**: its default `repairJSONParser` is `src/json-repair.mjs`, a verbatim port of the
   exact `jsonrepair@3.13.1` bundle the reference resolves (`n8n-workflow@2.9.1`'s
   `node_modules/jsonrepair`), so malformed JSON is repaired exactly as upstream — same repaired
   text, same `JSONRepairError` positions. An injected adapter still overrides it. Both paths
   are exercised differentially (N20 for the JS-object parser, N26 = 76 end-to-end repair cases
   for jsonrepair) and by the ported oracle block.
6. **Pinned behavioural quirks found while porting** (each verified against the published
   build, i.e. bug-for-bug): `noDataExpression` strips the leading `=` only on the
   `returnDefaults` path; a collection never materialises child defaults when no values are
   set; `getParameterResolveOrder`'s unresolved-dependency `continue` only advances the
   dependency loop, so cycles terminate with both parameters resolved; and a non-array
   `fixedCollection` element is iterated with `for…of` (a string yields one empty object per
   character). All are covered by `N16/N17` comparisons. Slice 3 added: `Number('')` is `0`, so
   an empty string is a *valid* `number` field and `''` is an *invalid* `boolean`;
   `validateFilterParameter` is a no-op — `parseFilterConditionValues` *returns* a
   `{ ok: false }` Result, so the `catch (error instanceof FilterError)` block is unreachable
   and reaching it would throw (`issues[key]` is `undefined`); a `resourceMapper` only checks
   required fields when `typeOptions.resourceMapper.mode === 'add'`; the mapper branch
   materialises an empty `parameters[<name>]` array next to the per-field keys; issue keys are
   *parameter names*, not value paths (two broken fixed-collection items collapse into one
   key, appending both messages); `getContext` creates `executionData.contextData[key]` lazily
   and the resource-locator regex is skipped for values starting with `=`. Covered by
   `N19`…`N22`.
7. **Filter execution logs through an injected logger.** DELTA-06. The reference's two
   `LoggerProxy.warn` call sites (`Unknown filter parameter operator …` in
   `executeFilterCondition`, `Unknown filter combinator …` in `executeFilter`) go through a
   logger carried on the `metadata`/options object, defaulting to a no-op (rule E01). Date
   conditions are compared through the `toMillis()` of whatever the DELTA-04
   `dateTimeFactory` returned, and the same metadata carries that factory into
   `parseSingleFilterValue`, so no date library is imported.
8. **Not reconstructed (out of Node Model scope, listed so absence is explicit):** workflow
   validation (`validateWorkflow` and friends — reconstructed in `packages/validation-lego`).
   With the jsonrepair port (DELTA-05) every module this LEGO's boundary names is now runnable
   in `packages/node-lego`. Everything else in `node-helpers.ts` L1-1949 and
   `node-parameters/filter-parameter.ts` is now reconstructed. `renameFormFields` is reconstructed though not re-exported by the
   published build (internal call site only).

### 12.3 Acceptance evidence

* `tools/node-lego-gate.mjs` — gates `N01`…`N06` (`docs/isolation/evidence/node-lego-gate.json`).
* `tools/node-lego-differential.mjs` — 26 scenario groups / 1771 comparisons against the
  published `n8n-workflow@2.9.1` build (the version the pinned reference commit ships):
  **1771 agree / 0 diverge**, 2 NOT-DIFFABLE (`renameFormFields`, private `getPropertyValues`).
  `N26` (76 comparisons) drives `jsonParse({ repairJSON: true })` over the oracle's 25 repair
  cases plus jsonrepair's wider feature list, so the port is compared end-to-end against the
  reference build's own bundled jsonrepair.
  `N25` covers the node-reference parser (80 comparisons); `cloneDeep`/`mapValues`/
  `escapeRegExp` are absent from the published surface, so they are compared against the
  reference build's own bundled `lodash` via `PORT_ONLY_SURFACE`, with the reference side
  degrading to lodash.
  Falsifiability: injected behavioral mutations (empty-array rule, expression short-circuit,
  the fixedCollection "value would get lost" early return, `deepCopy`'s `toJSON` handling,
  the min/max field-count wording, the required-`undefined` check, `getValueDescription`'s
  `null` wording, string `contains` → equality, dropped `ignoreCase`, dropped webhook-path
  lower-casing) each produced a `DIVERGE`, so the harness is not vacuous. Slice-5 probe:
  dropping `dollarEscape` in `applyAccessPatterns` (4 divergences), reordering
  `ITEM_TO_DATA_ACCESSORS` (1) and disabling the `Date` branch of `cloneDeep` (2) are all
  caught — the last one required making the `N25` probes slot-safe (a `Date`-prototype object
  without the internal `[[DateValue]]` slot passes `instanceof Date` but throws on every
  `Date` method). Slice-6 probe: dropping jsonrepair's Python-constant branch (2 divergences)
  and disabling its trailing-comma repair (14 divergences, 4 repair sites) are both caught.
* `packages/node-lego/test/node-model.test.mjs` — 74 cases, oracle-cited;
  `packages/node-lego/test/filter-execution.test.mjs` — 11 cases (filter execution, webhook
  paths, `cronNodeOptions`); `packages/node-lego/test/node-reference-parser.test.mjs` — 15
  cases, ported from `test/node-reference-parser-utils.test.ts`; plus
  `packages/node-lego/test/parameter-issues.test.mjs` — 8 cases (concurrent lane, retained and
  corrected against REF where its expectations encoded an unfaithful detail — ISSUE-026) and
  the 8-case error-surface suite from `TASK-EERR-01` and `test/json-repair.test.mjs` — 6 cases,
  the oracle's 25 repair expectations grouped + the ported wider feature set / error positions —
  **122 pass / 0 fail** in total.

### 12.4 Exported symbol list (98 — gate `N07` asserts every one is named here)

| | | | | | |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ApplicationError` | `FilterError` | `JSONRepairError` | `NodeConnectionTypes` | `NodeOperationError` | `OperationalError` |
| `applyAccessPatterns` | `jsonrepair` | | | | |
| `arrayContainsValue` | `assertIsValidNodeParameterValueType` | `assertParamIsArray` | `assertParamIsBoolean` | `assertParamIsNumber` | `assertParamIsOfAnyTypes` |
| `assertParamIsString` | `backslashEscape` | `checkConditions` | `cloneDeep` | `cronNodeOptions` | `deepCopy` |
| `defaultDateTimeFactory` | `defaultParseJSObject` | `displayParameter` | `displayParameterPath` | `dollarEscape` | `escapeRegExp` |
| `executeFilter` | `executeFilterCondition` | `extractReferencesInNodeExpressions` | `get` | `getConnectionTypes` | `getContext` |
| `getNodeFeatures` | `getNodeInputs` | `getNodeOutputs` | `getNodeParameters` | `getNodeParametersIssues` | `getNodeWebhookPath` |
| `getNodeWebhookUrl` | `getParameterIssues` | `getParameterValueByPath` | `getPropertyValues` | `getSubworkflowId` | `getToolDescriptionForNode` |
| `getUpdatedToolDescription` | `getValueDescription` | `getVersionedNodeType` | `hasDotNotationBannedChar` | `isAssignmentCollectionValue` | `isBinaryValue` |
| `isDefaultNodeName` | `isEqual` | `isExecutable` | `isExpression` | `isFilterValue` | `isHitlToolType` |
| `isINodeProperties` | `isINodePropertyOptions` | `isINodePropertyOptionsList` | `isNodeConnected` | `isNodeParameterValue` | `isNodeParameters` |
| `isNodeWithWorkflowSelector` | `isResourceLocatorValue` | `isResourceMapperValue` | `isSubNodeType` | `isTool` | `isToolType` |
| `isTriggerLikeNode` | `isTriggerNode` | `isValidNodeParameterValueType` | `jsonParse` | `makeDescription` | `makeNodeName` |
| `mapValues` | `mergeIssues` | `mergeNodeProperties` | `nodeAcceptsInputType` | `nodeHasOutputType` | `renameFormFields` |
| `resolveRelativePath` | `toPath` | `tryToParseAlphanumericString` | `tryToParseArray` | `tryToParseBinary` | `tryToParseBoolean` |
| `tryToParseDateTime` | `tryToParseJsonToFormFields` | `tryToParseJwt` | `tryToParseNumber` | `tryToParseObject` | `tryToParseString` |
| `tryToParseTime` | `tryToParseUrl` | `validateFieldType` | `validateFilterParameter` | `validateNodeCredentials` | `validateNodeParameters` |
