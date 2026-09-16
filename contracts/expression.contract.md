# LEGO Contract: Expression

**Derived from:** n8n 2.9.4 source (`packages/workflow/src/expression.ts`, `workflow-data-proxy.ts`, `expression-sandboxing.ts`, `expression-evaluator-proxy.ts`, `extensions/*`, `packages/core/src/execution-engine/node-execution-context/node-execution-context.ts`) and runtime observation (`tests/reference/expression/*`).
**Owner:** Agent 3
**Status:** TESTED

## 1. Interface

```typescript
// packages/workflow/src/expression.ts
class Expression {
  constructor(workflow: Workflow);

  getParameterValue(
    parameterValue: NodeParameterValueType | INodeParameterResourceLocator,
    runExecutionData: IRunExecutionData | null,
    runIndex: number,
    itemIndex: number,
    activeNodeName: string,
    connectionInputData: INodeExecutionData[],
    mode: WorkflowExecuteMode,
    additionalKeys: IWorkflowDataProxyAdditionalKeys,
    executeData?: IExecuteData,
    returnObjectAsString?: boolean,      // default false
    selfData?: IDataObject,              // default {}
    contextNodeName?: string,            // default activeNodeName
  ): NodeParameterValueType;

  resolveSimpleParameterValue(/* same args, single leaf, + siblingParameters */): NodeParameterValue | INodeParameters | ...;
  getSimpleParameterValue(node, value, mode, additionalKeys, executeData?, defaultValue?);   // no run data
  getComplexParameterValue(node, value, mode, additionalKeys, executeData?, defaultValue?, selfData?);
  static resolveWithoutWorkflow(expression: string, data?: IDataObject);
  static initializeGlobalContext(data: IDataObject): void;
}

const isExpression = (v: unknown): v is string => typeof v === 'string' && v.charAt(0) === '=';

// packages/workflow/src/workflow-data-proxy.ts
class WorkflowDataProxy {
  constructor(workflow, runExecutionData, runIndex, itemIndex, activeNodeName, connectionInputData,
              siblingParameters, mode, additionalKeys, executeData?, defaultReturnRunIndex = -1,
              selfData = {}, contextNodeName = activeNodeName, envProviderState?);
  getDataProxy(opts?: { throwOnMissingExecutionData: boolean }): IWorkflowDataProxyData;
}

interface IWorkflowDataProxyAdditionalKeys {   // supplied by caller (n8n-core getAdditionalKeys)
  $execution?: { id: string; mode: 'test' | 'production'; resumeUrl: string; resumeFormUrl: string; customData?: {...} };
  $vars?: IDataObject;
  $secrets?: IDataObject;
  $executionId?: string;          // deprecated
  $resumeWebhookUrl?: string;     // deprecated
  $tool?: ...;
  [key: string]: any;
}
```

## 2. Input

| Parameter | Meaning | Source LEGO |
|---|---|---|
| `parameterValue` | raw value from `node.parameters` (string / number / boolean / null / object / array / resource-locator) | Node Model |
| `runExecutionData` | `resultData.runData` for `$('X')`, `$node`, `$items`, `.isExecuted`, `$fromAI`; may be `null` | Execution Data |
| `connectionInputData` | items of the main input the node runs on; backs `$json`, `$binary`, `$input`, `$thisItem`, and pairing start | Execution Data |
| `itemIndex`, `runIndex` | current item / run | Engine |
| `activeNodeName` | node whose parameter is resolved (name-keyed) | Node Model |
| `executeData.source.main[i]` | `ISourceData` per input; required for `.item`/`.pairedItem()`, `$prevNode`, `$input.params`, `$input.context` | Execution Data |
| `mode` | `'manual'` enables pin-data fallback; else pin data ignored | Engine |
| `additionalKeys` | spread into the proxy verbatim | n8n-core / cli |
| `workflow` (constructor) | graph queries (`getNode`, `getNodeConnectionIndexes`, `getParentNodes`, `getChildNodes`, `getParentMainInputNode`, `getPinDataOfNode`, `nodes`, `settings`, `nodeTypes`) | Workflow |

## 3. Output

- Non-expression input ⇒ returned **unchanged** (identity), including objects/arrays with no `=` leaves.
- Expression string ⇒ evaluated JS value:
  - exactly one `{{ }}` spanning the whole template ⇒ raw JS type preserved (number, boolean, object, array, null, undefined, `DateTime`)
  - any literal text around/between `{{ }}` ⇒ `string` (objects become `[object Object]`, `undefined`/`null` become `""`)
  - `returnObjectAsString=true` ⇒ objects rendered as `"[Object: {…}]"` / `"[DateTime: …]"`
- Objects/arrays ⇒ new object/array with every leaf resolved; keys and order preserved.
- `=` alone ⇒ `""`; `=text` ⇒ `"text"`.
- Not part of the output: `DateTime`→string conversion, type coercion (`ensureType`), resource-locator extraction, schema validation — those are applied by n8n-core **after** this contract.

## 4. Data-proxy semantics (must hold)

| Access | Reads | Notes |
|---|---|---|
| `$json` / `$data` | `connectionInputData[itemIndex].json` | never touches runData |
| `$binary` | `connectionInputData[itemIndex].binary` **without** `data` prop | `{}` when none |
| `$input.item` | `connectionInputData[itemIndex]` (full item, incl. engine-rewritten `pairedItem {item:itemIndex}`) | |
| `$input.first()/last()/all()` | `connectionInputData` | reject any arguments |
| `$input.params` / `.context` | node named by `executeData.source.main[0].previousNode` | |
| `$('X').first/last/all(branch?, run?)` | `runData[X][run ?? last].data.main[branch ?? graphDefault]` | `graphDefault = getNodeConnectionIndexes(active, X).sourceIndex ?? 0` |
| `$('X').item` / `.pairedItem(i?)` / `.itemMatching(i)` | recursive walk: `connectionInputData[i].pairedItem` → `executeData.source.main[input]` → `runData[prev][run].data.main[out][item]` → its `pairedItem` … until `previousNode === X` | X must be an ancestor of the context node; `itemMatching` requires an index |
| `$('X').isExecuted` | `Object.hasOwn(runData, X)` | never throws for existing nodes |
| `$('X').params` | `X.parameters` resolved | |
| `$node['X'].json/.binary` | `runData[X][last].data.main[graphDefault][**itemIndex**]` | positional, no pairing |
| `$items(X?, out?, run?)`, `$item(i, run?)` | legacy equivalents | |
| `$parameter.<p>` / `$rawParameter` | sibling parameters of active node (resolved / raw) | |
| `$prevNode` | `{ name, outputIndex, runIndex }` from `executeData.source.main[0]` | |
| `$workflow` | `{ id, name, active }` | |
| `$runIndex`, `$itemIndex`, `$position`, `$thisItem`, `$thisItemIndex`, `$thisRunIndex`, `$mode`, `$nodeVersion`, `$nodeId`, `$webhookId` | constructor args / active node | |
| `$now`, `$today` | luxon `DateTime` in `workflow.settings.timezone ?? defaultTimezone` | |
| `$jmespath(obj, path)` | jmespath | |
| `$env.X` | env provider; denied unless allowed | |
| `$execution`, `$vars`, `$secrets`, `$executionId`, `$resumeWebhookUrl`, `$tool` | `additionalKeys` passthrough | `undefined` if not supplied |
| `$fromAI(key, desc?, type?, default?)`, `$agentInfo` | AI tool-call metadata | |
| `$evaluateExpression(expr, i?)`, `$getPairedItem(...)` | re-entrant helpers | |
| pin data | replaces missing `runData[X]` **only when `mode === 'manual'`** | |
| `workflow.settings.binaryMode === 'combined'` | `$input.*`, `$('X').*` return `item.json` instead of the item; `$('X', true)` restores full item | |

## 5. Invariants

| # | Invariant | Evidence |
|---|---|---|
| E1 | Only strings whose first char is `=` are evaluated | `01`, `06` |
| E2 | Evaluation is per `itemIndex`; a fresh proxy is built for every leaf | `01`, `04` |
| E3 | Missing **property** ⇒ `undefined` (or `""` in text); calling a non-function / undefined identifier ⇒ `undefined` (backend) | `05` |
| E4 | Missing **node** ⇒ `ExpressionError` `descriptionKey: nodeNotFound`; existing but **unexecuted** node ⇒ `ExpressionError` `type: no_execution_data` | `03`, `04` |
| E5 | `$json` with `itemIndex ≥ input.length` ⇒ `ExpressionError` `pairedItemInvalidIndex`; with empty input ⇒ `no_execution_data` | `01` |
| E6 | Pairing requires `pairedItem` on the input item (else `paired_item_no_info`), `executeData.source` (else "Can’t get data"), and X upstream in the graph (else `paired_item_no_connection`) | `03`, `04` |
| E7 | Default branch for `$('X')` comes from the graph, not from run data | `04` |
| E8 | Branch/run out of range ⇒ `ExpressionError` `"Node \"X\" has no branch with index n."` / `"Run n of node \"X\" not found"` | `03`, `04` |
| E9 | Sandbox: `/\.\s*constructor/` in the source ⇒ `ExpressionError` before evaluation; AST hooks reject `__proto__`/`prototype`, `with`, class extension, bare `$`; globals limited to `initializeGlobalContext` allow-list; `process.env` is `{}` unless `N8N_BLOCK_ENV_ACCESS_IN_NODE === 'false'` | `05`, `06` |
| E10 | `$env` without provider permission ⇒ `ExpressionError "access to env vars denied"` | `05` |
| E11 | `runExecutionData === null` still allows `$json`/`$input`; `$('X')` throws | `05` |
| E12 | n8n extension methods (`.isEmpty()`, `.toDateTime()`, …) are rewritten by `extendSyntax` and resolved through `extend()`; native methods pass through | `06` |
| E13 | Pin data honoured only in `manual` mode | probe (documented in `docs/isolation/expression.md` §4) |
| E14 | Syntax error ⇒ `ApplicationError('invalid syntax')` (not `ExpressionError`) | `05` |
| E15 | Scripting nodes receive copy-on-write (`augmentObject`) views – expressions cannot mutate stored execution data | source `workflow-data-proxy.ts` L79-88 |

## 6. Errors

| Class | When | `context` fields |
|---|---|---|
| `ExpressionError` | data/node/pairing/sandbox problems | `type` (`no_execution_data`, `paired_item_no_info`, `paired_item_no_connection`, `paired_item_intermediate_nodes`, `paired_item_invalid_info`, `paired_item_multiple_matches`, …), `descriptionKey`, `nodeCause`, `itemIndex`, `runIndex`, `functionality: 'pairedItem'`, `parameter` (added by n8n-core) |
| `ExpressionExtensionError` | bad extension usage | |
| `ExpressionClassExtensionError` / `ExpressionWithStatementError` / `ExpressionDestructuringError` / `ExpressionComputedDestructuringError` / `ExpressionReservedVariableError` | sandbox AST hooks | |
| `ApplicationError` | `'invalid syntax'`, `'this is a function, please add ()'`, `'this is a DateTime, please access its methods'`, `'invalid DateTime'` | |
| (swallowed) | other runtime `TypeError`s on backend ⇒ result `null`/`undefined` | |

Engine behaviour on error: task `executionStatus: 'error'`, `error.context.parameter = <parameterName>`, `error.cause = <raw value>`, run `status: 'error'` (observed).

## 7. Dependencies

- **Execution Data** (Agent 3): all read types; `createEmptyRunExecutionData`
- **Workflow** (Agent 1): graph query API + `pinData` + `settings` — D-01, D-02 in `docs/isolation/dependencies.md` (cyclic: `Workflow` constructs `Expression`)
- **Node Model** (Agent 2): `INode`, `NodeHelpers.getNodeParameters`, `NodeHelpers.getContext`, `SCRIPTING_NODE_TYPES` — D-03
- **n8n-core**: provides `additionalKeys`, performs post-processing (`cleanupParameterData`, `ensureType`, `extractValue`, schema validation) — D-06
- Third-party: `@n8n/tournament`, `esprima-next`, `recast`, `ast-types`, `luxon`, `jmespath`, `@n8n/errors`
- Global: `getGlobalState().defaultTimezone`; side effect `luxon.Settings.defaultZone`

## 8. Ownership

| Owns | Does NOT own |
|---|---|
| `Expression`, `isExpression`, evaluator proxy, sandbox hooks | `getAdditionalKeys` (`$execution`, `$vars`, `$secrets`) |
| `WorkflowDataProxy` incl. `getPairedItem` algorithm, env provider, pin-data helper | parameter lookup, `extractValue`, `ensureType`, schema validation, `cleanupParameterData` |
| extension syntax + extension libraries (`extensions/*`) | `Workflow` graph API, `INode`, `NodeHelpers` |
| `augmentObject`/`augmentArray` | choosing `connectionInputData` (engine `prepareConnectionInputData`) |
| expression error classes and `context` taxonomy | frontend editor/autocomplete, task-runner transport |
| `IWorkflowDataProxyData`, `IWorkflowDataProxyAdditionalKeys`, `ProxyInput` shapes | |
