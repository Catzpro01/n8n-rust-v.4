# LEGO Isolation: Expression

**Status:** `TESTED` (analysis + boundary + reference tests verified against the real 2.9.4 runtime packages; live VPS verification pending)
**Owner:** Agent 3
**Reference:** n8n 2.9.4 (`reference/n8n`, commit `b6dc2787`), runtime `n8n-workflow@2.9.1`

> `docs/anatomy/07-expression.md` lists `$json`, `$node`, `$env`, `$now`, `$today`,
> `$executionId`. The actual surface in 2.9.4 is much larger and several of those
> are provided by *different* layers (`$executionId` comes from n8n-core
> `getAdditionalKeys`, not from the proxy). This document follows the source.

---

## 1. Purpose

Turn a node parameter value (possibly containing `={{ … }}` expressions) into a
concrete value **for one item** of **one node run**, giving the expression
sandboxed JavaScript access to:

- the current input item (`$json`, `$binary`, `$input`, `$itemIndex`, …)
- output data of other executed nodes (`$('Name')`, `$node['Name']`, `$items()`, `$item()`)
- item lineage (`.item`, `.pairedItem()`, `.itemMatching()`)
- node/workflow metadata (`$parameter`, `$workflow`, `$prevNode`, `$runIndex`, `$mode`, `$nodeVersion`, `$nodeId`, `$webhookId`)
- environment & execution context (`$env`, `$vars`, `$secrets`, `$execution`, `$now`, `$today`, `$jmespath`, `$fromAI`, `$tool`, `$agentInfo`)
- n8n extension methods on primitives (`.toUpperCase()` native, `.isEmpty()` extension, `DateTime`, …)

## 2. Source files (actual)

| Layer | File | Role |
|---|---|---|
| Entry point | `packages/workflow/src/expression.ts` (714 L) | `class Expression` – `getParameterValue`, `resolveSimpleParameterValue`, `getSimpleParameterValue`, `getComplexParameterValue`, `initializeGlobalContext` (allow/deny list of globals), `convertObjectValueToString`, `renderExpression` |
| Detection | `packages/workflow/src/expressions/expression-helpers.ts` | `isExpression(v)` ⇔ `typeof v === 'string' && v[0] === '='` |
| Evaluator | `packages/workflow/src/expression-evaluator-proxy.ts` | wraps `@n8n/tournament` (template `{{ }}` compiler + `esprima`/`recast` AST) with AST hooks `ThisSanitizer` (before), `PrototypeSanitizer`, `DollarSignValidator` (after) |
| Sandboxing | `packages/workflow/src/expression-sandboxing.ts` (563 L) | AST rewriting: blocks `with`, destructuring of reserved names, `__proto__`/`constructor`/`prototype` member access via `__sanitize`, class extension, bare `$` usage |
| Extension syntax | `packages/workflow/src/extensions/expression-extension.ts`, `expression-parser.ts`, `extensions.ts`, `*-extensions.ts`, `extended-functions.ts` | `extendSyntax()` rewrites `a.isEmpty()` into `extend(a,'isEmpty',[])`; provides `$if`, `$min`, `$max`, `$ifEmpty`, `$not`, `$average`, DateTime helpers … |
| **Data proxy** | `packages/workflow/src/workflow-data-proxy.ts` (1586 L) | `class WorkflowDataProxy` – builds the `$…` object via ES `Proxy` traps; contains `getPairedItem()` recursive resolver, `nodeDataGetter`, `nodeGetter`, `nodeParameterGetter`, `nodeContextGetter`, `prevNodeGetter`, `workflowGetter`, `agentInfo`, `$fromAI`/`$tool` handling |
| Proxy helpers | `workflow-data-proxy-helpers.ts` (`getPinDataIfManualExecution`), `workflow-data-proxy-env-provider.ts` (`$env` with `N8N_BLOCK_ENV_ACCESS_IN_NODE`) | |
| Augmentation (Code nodes) | `packages/workflow/src/augment-object.ts` | copy-on-write proxies for `runExecutionData` / `connectionInputData` when `contextNodeName` is a scripting node (`SCRIPTING_NODE_TYPES`) |
| Errors | `packages/workflow/src/errors/expression*.error.ts` | `ExpressionError` (with `context.type`, `descriptionKey`, `nodeCause`, `itemIndex`, `runIndex`, `parameter`), `ExpressionExtensionError`, sandbox errors |
| Global state | `packages/workflow/src/global-state.ts` | `defaultTimezone` (used when `workflow.settings.timezone` absent); proxy sets `luxon Settings.defaultZone` **globally** on construction |
| Runtime glue (n8n-core) | `packages/core/src/execution-engine/node-execution-context/node-execution-context.ts` `_getNodeParameter()` L435-526, `evaluateExpression()` L528; `base-execute-context.ts` `getWorkflowDataProxy()` L186; `utils/get-additional-keys.ts`; `utils/cleanup-parameter-data.ts`; `utils/extract-value.ts`; `utils/ensure-type.ts`; `utils/validate-value-against-schema.ts` | Supplies `additionalKeys` (`$execution`, `$vars`, `$secrets`, deprecated `$executionId`, `$resumeWebhookUrl`), post-processes resolved values |
| Other consumers | `cli/src/webhooks/webhook-helpers.ts` (webhook path/params), `cli/src/credentials-helper.ts` (expressions in credentials), `core/src/execution-engine/routing-node.ts` (declarative nodes), `@n8n/task-runner/src/js-task-runner/js-task-runner.ts` (builds `WorkflowDataProxy` remotely for Code node), `frontend/editor-ui` (`useNodeHelpers`, `executions.utils.ts` – preview resolution in the browser) | |

## 3. Evaluation lifecycle (actual call chain)

```text
node.execute()
  └─ this.getNodeParameter(name, itemIndex, fallback, options)           [n8n-core ExecuteContext]
       └─ NodeExecutionContext._getNodeParameter()
            ├─ value = lodash.get(node.parameters, name, fallback)   (raw)
            ├─ options.rawExpressions → return raw
            ├─ additionalKeys = getAdditionalKeys(additionalData, mode, runExecutionData)
            ├─ workflow.expression.getParameterValue(value, runExecutionData, runIndex, itemIndex,
            │        node.name, connectionInputData, mode, additionalKeys, executeData,
            │        returnObjectAsString=false, selfData={}, contextNodeName?)
            │     └─ recursive walk of arrays/objects; every leaf →
            │        resolveSimpleParameterValue(leaf, siblingParameters, …)
            │          ├─ !isExpression(leaf) → return leaf unchanged
            │          ├─ strip leading '='
            │          ├─ new WorkflowDataProxy(workflow, runExecutionData, runIndex, itemIndex,
            │          │        activeNodeName, connectionInputData, siblingParameters, mode,
            │          │        additionalKeys, executeData, -1, selfData, contextNodeName).getDataProxy()
            │          ├─ data.process = {…}  (env blocked unless N8N_BLOCK_ENV_ACCESS_IN_NODE='false')
            │          ├─ Expression.initializeGlobalContext(data)   (deny/allow list)
            │          ├─ data.extend / extendOptional / __sanitize / extendedFunctions
            │          ├─ reject /\.\s*constructor/  → ExpressionError
            │          ├─ extendSyntax(expr)          (extension-method rewrite)
            │          └─ renderExpression → tournament.execute(expr, data)
            │                 - ExpressionError re-thrown
            │                 - SyntaxError → ApplicationError('invalid syntax')
            │                 - other errors (TypeError…) → **null / undefined** on backend
            ├─ cleanupParameterData(result)          (luxon DateTime → ISO string)
            ├─ catch ExpressionError → e.context.parameter = name ; rethrow
            ├─ options.extractValue → extractValue()  (resource locator)
            ├─ options.ensureType   → ensureType()
            └─ validateValueAgainstSchema()
```

Every `resolveSimpleParameterValue` call builds a **fresh** `WorkflowDataProxy`
(no caching). `getSimpleParameterValue` / `getComplexParameterValue` use
`createEmptyRunExecutionData()` and empty input – "no workflow data" mode.

## 4. Data proxy: what each `$` key reads

| Key | Source (inside `WorkflowDataProxy`) | Needs |
|---|---|---|
| `$json`, `$data` | `nodeDataGetter(contextNodeName, shortSyntax=true).json` → `connectionInputData[itemIndex].json` | `connectionInputData` |
| `$binary` | same, `.binary`, **`data` property stripped** (metadata only) | `connectionInputData` |
| `$input.item / first() / last() / all()` | `connectionInputData` directly (full items) | `connectionInputData` |
| `$input.params / context` | `executeData.source.main[0].previousNode` → `workflow.getNode(...).parameters` / `NodeHelpers.getContext` | `executeData.source` |
| `$('X').first/last/all(branch?, run?)` | `runExecutionData.resultData.runData[X][run].data.main[branch]`; default branch = `workflow.getNodeConnectionIndexes(active, X).sourceIndex`, default run = last | `runExecutionData`, `workflow` graph |
| `$('X').item / pairedItem(i) / itemMatching(i)` | `getPairedItem(X, executeData.source.main[input], connectionInputData[i].pairedItem)` – recursive walk through `runData[*].source` and `item.pairedItem` until `previousNode === X` | `connectionInputData[i].pairedItem`, `executeData.source`, `runData`, graph (`getParentNodes` for connection check) |
| `$('X').isExecuted` | `runData.hasOwnProperty(X)` | `runExecutionData` |
| `$('X').params / context` | `workflow.getNode(X).parameters` (resolved), `NodeHelpers.getContext(runExecutionData,'node',node)` | |
| `$node['X'].json/binary` | `nodeDataGetter(X)` → `runData[X][last].data.main[branch][**itemIndex**]` (no pairing!) | `runExecutionData` |
| `$node['X'].parameter / context / runIndex` | | |
| `$items(X?, out?, run?)`, `$item(i, run?)` | legacy; `$item` re-instantiates the proxy with another `itemIndex` | |
| `$parameter`, `$rawParameter` | `nodeParameterGetter(activeNodeName)` – other parameters of the same node, resolved lazily via `workflow.expression.getParameterValue` | recursion |
| `$prevNode` | `executeData.source.main[0]` → `{name, outputIndex, runIndex}` | `executeData.source` |
| `$workflow` | `{ id, name, active }` | `workflow` |
| `$runIndex`, `$itemIndex`, `$position`, `$thisItem`, `$thisRunIndex`, `$thisItemIndex`, `$mode`, `$nodeVersion`, `$nodeId`, `$webhookId` | constructor args / `workflow.getNode(active)` | |
| `$now`, `$today` | `luxon DateTime.now()` in `workflow.settings.timezone ?? defaultTimezone` | global state |
| `$jmespath`, `$jmesPath` | `jmespath.search` | |
| `$env` | `createEnvProvider` – denies unless allowed; throws `access to env vars denied` | process env |
| `$execution`, `$vars`, `$secrets`, `$executionId`, `$resumeWebhookUrl`, `$tool` | **spread from `additionalKeys`** (supplied by n8n-core `getAdditionalKeys`) — *not* computed by the proxy | n8n-core |
| `$fromAI()`, `$agentInfo` | AI tool-call data from `runData` / `connectionInputData` | |
| `$evaluateExpression(expr, i?)` | re-enters `workflow.expression.getParameterValue` | recursion |
| `$getPairedItem` | exposes the resolver (used by Code node / task-runner) | |

Pin data (`workflow.pinData`) substitutes `runData` **only when `mode === 'manual'`**
(`getPinDataIfManualExecution`) — observed: same expression succeeds in manual and
throws `hasn't been executed` in production mode.

## 5. Observed behaviour matrix (2.9.4)

Snapshots in `tests/reference/expression/*/expected.json`. Highlights:

| Expression | Result |
|---|---|
| `hello` (no `=`) | `"hello"` untouched |
| `={{ $json.a }}` | `10` – single expression keeps JS type |
| `=Value: {{ $json.a }}!` | `"Value: 10!"` – any surrounding text ⇒ string |
| `=x {{ $json }}` | `"x [object Object]"` |
| `={{ $json.missing }}` | `undefined`; inside text ⇒ `""` |
| `={{ $json.a.notAFunction() }}` | `undefined` (backend swallows TypeError → `null`) |
| `={{ notDefined }}` | `undefined` |
| `={{ $json. }}` | `ApplicationError: invalid syntax` |
| `={{ ''.constructor }}` / `$now.constructor` | `ExpressionError: Expression contains invalid constructor function call` |
| `$json` at `itemIndex ≥ input.length` | `ExpressionError` type `no_execution_data`, key `pairedItemInvalidIndex` |
| `$json` with empty input | `ExpressionError "Node 'End' hasn't been executed"`, `no_execution_data` |
| `$input.item` with empty input | `ExpressionError "No execution data available"` |
| `$input.first(1)` | `ExpressionError "$input.first() should have no arguments"` |
| `$('Nope')` / `$node['Nope']` | `ExpressionError "Referenced node doesn't exist"`, `descriptionKey: nodeNotFound` |
| `$('End').first()` (exists, not run) | `"Node 'End' hasn't been executed"`, `no_execution_data`, `pairedItemNoConnection` |
| `$('Start').item` when input item lacks `pairedItem` | `type: paired_item_no_info` |
| `$('Start').item` without `executeData.source` | `"Can’t get data for expression"` (internal error path) |
| `$('FalseBranch').item` (not an ancestor) | `"Invalid expression"`, `type: paired_item_no_connection` |
| `$('IF').all()` from a node under output 0 | items of branch 0 (graph-derived default) |
| `$('IF').all(1)` | branch 1 |
| `$('IF').all(2)` | `"Node \"IF\" has no branch with index 2."` |
| `$('Start').first(0, 5)` | `"Run 5 of node \"Start\" not found"` |
| `$node['X'].binary` | metadata only (`data` removed) ; `$('X').item.binary` returns full `IBinaryData` |
| `$env.HOME` (no provider) | `ExpressionError "access to env vars denied"` |
| `$vars.x` (no additionalKeys) | `undefined` |
| runExecutionData `null` | `$json` still works (input-only); `$('X')` throws |
| nested object/array parameter | walked recursively; non-string leaves untouched |
| `=` alone | `""` ; `=just text` → `"just text"` |

Engine-level (from `execution-data/03`, `06`, and an error case run in the harness):
an `ExpressionError` thrown while resolving a parameter is attached to the task
(`runData[node][run].error`, `error.context.parameter = <paramName>`), the run
ends with `status: 'error'` and `resultData.error` set.

## 6. Inputs

```text
parameterValue        NodeParameterValueType | INodeParameterResourceLocator   (raw, from node.parameters)
runExecutionData      IRunExecutionData | null                                  ← Execution Data LEGO
runIndex, itemIndex   number
activeNodeName        string                                                    ← Node Model (name = key)
connectionInputData   INodeExecutionData[]                                      ← Execution Data LEGO
mode                  WorkflowExecuteMode  ('manual' enables pinData)
additionalKeys        IWorkflowDataProxyAdditionalKeys                          ← n8n-core / cli
executeData?          IExecuteData  (source needed for pairing, $prevNode, $input.params)
returnObjectAsString? boolean
selfData?, contextNodeName?   (Code node / tool contexts)
workflow              Workflow (graph queries + settings + pinData + nodeTypes)  ← Workflow LEGO
```

## 7. Outputs

- Resolved `NodeParameterValueType` (string | number | boolean | object | array | null | undefined). Luxon `DateTime` objects may be returned and are converted to strings by n8n-core `cleanupParameterData`.
- Errors: `ExpressionError` (rich context), `ExpressionExtensionError`, `ApplicationError('invalid syntax' | 'this is a function, please add ()' | 'this is a DateTime, please access its methods' | 'invalid DateTime')`.
- Side effect: `luxon.Settings.defaultZone` is set globally when a proxy is constructed.

## 8. Invariants

1. Only strings starting with `=` are evaluated; everything else is identity.
2. A parameter is resolved **per item**; the proxy is rebuilt for every leaf.
3. `$json`/`$input` never touch `runExecutionData`; `$('X')`/`$node` never touch `connectionInputData` except for pairing (`.item`).
4. Pairing (`.item`) requires: `connectionInputData[itemIndex].pairedItem`, `executeData.source`, `runData[...].source` chain, and `X` being an upstream node in the graph — otherwise a typed `ExpressionError`.
5. Default output branch for `$('X')` is derived from the **graph** (`getNodeConnectionIndexes(contextNode, X)`), not from run data.
6. Pin data is honoured only in `manual` mode.
7. Missing **property** ⇒ `undefined`; missing **node/data** ⇒ throw.
8. Sandbox: `constructor` text is rejected before evaluation; `__proto__`, `prototype`, `with`, class extension, bare `$` are rejected by AST hooks; `process.env` empty unless explicitly allowed; globals reduced to the allow-list in `initializeGlobalContext`.
9. Scripting nodes (`Code`, `Function`, `FunctionItem`, `AI Transform`) get copy-on-write **augmented** views so expressions/code cannot mutate stored execution data.

## 9. Dependencies

| Direction | Target | What | Owner |
|---|---|---|---|
| Expression → **Execution Data** | `INodeExecutionData`, `IPairedItemData`, `ISourceData`, `ITaskData`, `IRunExecutionData`, `IExecuteData`, `createEmptyRunExecutionData` | all reads | Agent 3 (this task) |
| Expression → **Workflow** | `Workflow.getNode`, `.nodes`, `.getNodeConnectionIndexes`, `.getParentNodes`, `.getChildNodes`, `.getParentMainInputNode`, `.queryNodes`, `.getPinDataOfNode`, `.settings` (`timezone`, `binaryMode`), `.nodeTypes`, `.expression` (self-reference) | graph queries, pin data, settings | **Agent 1** – see `dependencies.md` |
| Expression → **Node Model** | `INode` (`name`, `type`, `typeVersion`, `id`, `parameters`, `webhookId`), `NodeHelpers.getNodeParameters`, `NodeHelpers.getContext`, `SCRIPTING_NODE_TYPES`, `AGENT_LANGCHAIN_NODE_TYPE` | `$parameter`, `$nodeVersion`, scripting detection | **Agent 2** – see `dependencies.md` |
| Expression → n8n-core (inverse: core → expression) | `getAdditionalKeys` provides `$execution/$vars/$secrets`; `cleanupParameterData`, `extractValue`, `ensureType`, `validateValueAgainstSchema` post-process | | engine |
| Expression → third-party | `@n8n/tournament`, `esprima-next`, `recast`, `ast-types`, `luxon`, `jmespath`, `@n8n/errors` | | |
| Expression → global state | `getGlobalState().defaultTimezone`, `luxon Settings.defaultZone`, `process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE` | | |

## 10. Owns

- `Expression` class, `isExpression`, evaluator proxy, sandboxing hooks, extension syntax & extension libraries
- `WorkflowDataProxy` incl. `getPairedItem` resolution algorithm, env provider, pin-data lookup helper
- `augmentObject` / `augmentArray`
- Expression error classes and their `context` taxonomy (`type`, `descriptionKey`)
- `IWorkflowDataProxyData`, `IWorkflowDataProxyAdditionalKeys`, `ProxyInput` interface shapes

## 11. Does NOT own

- ❌ `getAdditionalKeys` (`$execution`, `$vars`, `$secrets`, resume URLs) – n8n-core
- ❌ Parameter lookup (`lodash.get(node.parameters…)`), `extractValue`, `ensureType`, schema validation, `cleanupParameterData` – n8n-core `NodeExecutionContext`
- ❌ Deciding `connectionInputData` (which main input is used: `prepareConnectionInputData`, `executionOrder` v0/v1) – engine
- ❌ The `Workflow` graph API it relies on – Agent 1
- ❌ `INode` and `NodeHelpers` – Agent 2
- ❌ Frontend expression editor / autocomplete – editor-ui
- ❌ Remote proxy construction for the Code node – `@n8n/task-runner`

## 12. Boundary decision

```text
┌──────────────────────────────┐
│  EXECUTION DATA LEGO         │  items, pairedItem, source, runData, binary refs
└───────────────┬──────────────┘
                │ contracts/execution-data.contract.md  (read-only from here)
┌───────────────▼──────────────┐
│  EXPRESSION LEGO             │  Expression + WorkflowDataProxy + sandbox + extensions
│   needs in addition:         │  Workflow graph API (Agent 1), INode/NodeHelpers (Agent 2),
│                              │  additionalKeys (n8n-core)
└───────────────┬──────────────┘
                │ contracts/expression.contract.md
┌───────────────▼──────────────┐
│  EXECUTION ENGINE            │  n8n-core NodeExecutionContext._getNodeParameter → post-processing
└──────────────────────────────┘
```

**Findings that contradict the naive boundary (documented, not forced):**

1. **Expression is not purely "on top of" Execution Data — it also depends on the Workflow graph.** Default-branch selection, pairing legality (`getParentNodes`), pin data and timezone all come from `Workflow`. An expression LEGO without a graph query contract cannot resolve `$('X')`. → recorded in `dependencies.md` as the required API from Agent 1.
2. **`Expression` is instantiated by `Workflow` (`this.expression = new Expression(this)`, `workflow.ts` L134)** and the proxy calls back into `workflow.expression` for `$parameter` and `$evaluateExpression`. This is a cycle Workflow ↔ Expression. Breaking it means changing `workflow.ts` (Agent 1's file) — **not done**; documented as coordination item.
3. **`additionalKeys` split**: `$execution`, `$vars`, `$secrets` are computed in n8n-core and merely spread into the proxy. They must remain an *input* of the Expression LEGO, not a part of it.
4. **Post-processing lives outside**: `cleanupParameterData`, `ensureType`, `extractValue`, schema validation happen in n8n-core after evaluation; a consumer that calls `Expression` directly (webhooks, credentials, frontend) does **not** get those. The contract therefore specifies the raw output.
5. **Global side effect** (`Settings.defaultZone`) leaks across evaluations; kept as-is and flagged.

**No source files in `reference/n8n` were modified.**

## 13. Verification

| Check | Result |
|---|---|
| `node tests/reference/harness/run.js expression` | 6/6 PASS against real `n8n-workflow@2.9.1` |
| Engine integration (`ref.exprEcho` node resolving parameters per item inside real `WorkflowExecute`) | covered by `execution-data/03`, `06` |
| Reference baseline 11/11 | unchanged (no source modification) |
| Live VPS | not reachable from sandbox → status `TESTED` |
