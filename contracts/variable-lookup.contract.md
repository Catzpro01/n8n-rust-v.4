# LEGO Contract: Execution-Context Variable Lookup (`$json`, `$binary`, `$node`, `$parameter`, …)

**Task:** `TASK-PIPE-13` · **Worker:** Agent 6 (peran sesaat *Expression & Scoping Specialist*) · **Branch:** `agent-6`
**Derived from:** n8n `2.9.4` — `packages/workflow/src/workflow-data-proxy.ts` (1586 L) +
`workflow-data-proxy-{env-provider,helpers}.ts`, `augment-object.ts`,
`packages/core/src/execution-engine/node-execution-context/**` (11 contexts + `utils/*`),
and 503 runtime observations (418 outcome records: 353 values, 65 typed throws) taken from a real `WorkflowExecute` run
([`docs/isolation/agent-6-probes/observations.json`](../docs/isolation/agent-6-probes/observations.json)).
**Anatomy:** [`docs/isolation/variable-lookup-scoping.md`](../docs/isolation/variable-lookup-scoping.md)
**Relationship:** the lookup half of the Expression LEGO; refines [`expression.contract.md`](expression.contract.md) §4. Sibling: [`expression-syntax.contract.md`](expression-syntax.contract.md).
**Status:** `CONTRACTED`

---

## 1. Interface

```typescript
interface ScopingTuple {                    // 14 values, assembled by the engine, never by this slice
  workflow: Workflow;                       // graph + settings + pinData + nodeTypes + expression
  runExecutionData: IRunExecutionData | null;
  runIndex: number;  itemIndex: number;
  activeNodeName: string;                   // node whose parameter is being resolved
  connectionInputData: INodeExecutionData[];// items of the main input for THIS run
  siblingParameters: INodeParameters;       // parent object of the parameter being walked (or {})
  mode: WorkflowExecuteMode;
  additionalKeys: IWorkflowDataProxyAdditionalKeys;
  executeData?: IExecuteData;               // .source.main[i] : ISourceData[]
  defaultReturnRunIndex?: number;           // -1 ⇒ last run
  selfData?: IDataObject;                   // $self
  contextNodeName?: string;                 // defaults to activeNodeName
  envProviderState?: EnvProviderState;
}

createDataProxy(t: ScopingTuple, opts?: { throwOnMissingExecutionData: boolean }): DataProxy

interface DataProxy {   // read-only; every `$`-key below; unknown key ⇒ undefined; `isProxy` ⇒ true
  has(k): true                                   // UNCONDITIONAL — see I9
  ownKeys(): string[]                            // base keys, not the $-keys resolved by the trap
}
```

Producers of a `ScopingTuple` (the only three that exist in n8n):
`NodeExecutionContext._getNodeParameter` (per parameter leaf, `siblingParameters` = enclosing object),
`NodeExecutionContext.evaluateExpression` (`siblingParameters = {}`),
`BaseExecuteContext.getWorkflowDataProxy(itemIndex)` (`siblingParameters = {}`, no `selfData`,
no `contextNodeName`, **no** global seeding).

## 2. Resolution table (normative)

| Key | = | Extra rules |
|---|---|---|
| `$json` · `$data` | `connectionInputData[itemIndex].json` | resolved by the **outer get trap**; cannot be shadowed by `additionalKeys`; scoped by `contextNodeName`; in `binaryMode:'combined'` only for `$item` |
| `$binary` | `connectionInputData[itemIndex].binary` **minus** `data` per key | `{}` when the item has no binary; the stripping is *not* applied to `$input.item.binary` |
| `$input.item` | `connectionInputData[itemIndex]` (full item, includes `binary.data`) | |
| `$input.first()` / `.last()` / `.all()` | `connectionInputData[0]` / `[len-1]` / whole array | passing **any** argument to `first/last` throws; `.all()` on empty input ⇒ `[]` |
| `$input.params` | `workflow.getNode(executeData.source.main[0].previousNode).parameters` | unresolved, no defaults |
| `$input.context` | `NodeHelpers.getContext(runExecutionData,'node', prevNode)` proxy | |
| `$('X')` | proxy: `isExecuted`, `first(b?,r?)`, `last(b?,r?)`, `all(b?,r?)`, `item`, `pairedItem(i?)`, `itemMatching(i)`, `params`, `context` | `params` = raw parameters; `context` = context data; the three lineage accessors are methods (except `.item`, evaluated eagerly). An existing-but-unexecuted node ⇒ `ensureNodeExecutionData` throws `Node 'X' hasn't been executed`, **unless** manual-mode pin data covers it |
| `$node['X']` / `$node.X` | proxy: `json`, `data` (**alias of json**), `binary`, `context`, `parameter`, `runIndex` | item chosen by the **current** `itemIndex` (positional — no lineage). Name lookup throws first (`getNode(X) === null` ⇒ `Referenced node doesn't exist`/`nodeNotFound`, *before* any accessor); node exists but never ran ⇒ `.json/.data/.binary` throw `Node 'X' hasn't been executed`, `.runIndex` ⇒ **-1**, unknown property ⇒ `undefined` |
| `$parameter` | `nodeParameterGetter(activeNodeName, resolveValue=true)` over the **effective** `node.parameters` | see §3 |
| `$rawParameter` | same, `resolveValue=false` | resource-locator unwrap still applied |
| `$prevNode` | `{ name, outputIndex, runIndex }` from `executeData.source.main[0]` (`previousNodeOutput \|\| 0`, `previousNodeRun \|\| 0`) | `undefined` when `executeData.source` absent; only those 3 keys enumerable |
| `$workflow` | `{ active, id, name }` | `id` on an unsaved workflow ⇒ `ExpressionError('save workflow to view')` |
| `$runIndex` `$itemIndex` `$position` `$thisItem` `$thisItemIndex` `$thisRunIndex` `$mode` `$nodeVersion` `$nodeId` `$webhookId` | values snapshotted at proxy construction | these keys are declared **after** `...additionalKeys` ⇒ immune to shadowing |
| `$now` `$today` | luxon `DateTime.now()` / same day at 00:00 in `workflow.settings.timezone ?? globalState.defaultTimezone` | constructing the proxy **also assigns `luxon.Settings.defaultZone` process-wide** (I12) |
| `$env` | `createEnvProvider(runIndex, itemIndex, state)` | throws `'access to env vars denied'` unless `N8N_BLOCK_ENV_ACCESS_IN_NODE === 'false'`; `'not accessible via UI, please run node'` when `process` is unavailable |
| `$vars` `$secrets` `$execution` `$executionId` `$resumeWebhookUrl` `$tool`(fallback) | `additionalKeys` pass-through | `undefined` when not supplied — this slice never computes them. `$secrets` (built by core's `getSecretsProxy`) is readable **only** by direct property access: `Object.keys` ⇒ `[]` and `in` ⇒ `false` while `getOwnPropertyNames` ⇒ the provider list; `k.$secrets.p = v` ⇒ `TypeError` (set trap returns `false`); unknown provider ⇒ `Could not load secrets` / "not reachable", unknown secret ⇒ same class / "could not be found"; nested secret objects return further proxies. `$execution.customData` is `undefined` when no run data was supplied, `set/get/getAll` write into `runExecutionData.resultData.metadata`, a non-string value raises `InvalidExecutionMetadataError: Custom data values must be a string (key "k")` in `manual` mode and is swallowed (logged) in every other mode |
| `$execution.customData.set/get/getAll/setAll` | mutates `runExecutionData` metadata; in `mode:'manual'` errors propagate, otherwise they are logged and swallowed | provider-side rule (core) |
| `$jmespath` / `$jmesPath` | `jmespath.search(objOrArray, query)` | arity/type violation ⇒ `ExpressionError('expected two arguments (Object, string) for this function')` |
| `$evaluateExpression(expr, itemIndex?)` | `workflow.expression.getParameterValue('=' + expr, …, contextNodeName)` | caller must **not** prefix `=`: `expr='{{1+1}}' → 2`, `expr='1 + 1' → "1 + 1"` (text!), `expr='={{1+1}}' → "=2"` |
| `$item(i, run?)` | new proxy with `itemIndex=i`, `defaultReturnRunIndex = run ?? -1` | legacy |
| `$items(X?, out?, run?)` | `X` absent ⇒ `connectionInputData` (sliced to 1 when `node.executeOnce === true`); else `getNodeExecutionData(X,false,out,run ?? -1)` | legacy |
| `$self.<k>` | `selfData[k]` | spreading `$self` yields `{}` (ownKeys reads the empty target) — only direct key reads work |
| `$fromAI(key, desc?, type?, default?)` (+`$fromai`,`$fromAi` — aliases reach identical validation) | source is chosen by **task existence**: `runData[activeNode][runIndex]` present ⇒ read **only** `inputOverride.ai_tool[0][itemIndex].json`, value order `.query[key] ?? json[key] ?? default`; that task absent ⇒ `connectionInputData[**runIndex**].json` (upstream indexing quirk: `itemIndex` is not used here) | empty key ⇒ `Add a key, e.g. $fromAI('placeholder_name')`; key failing `/^[a-zA-Z0-9_-]{0,64}$/` ⇒ `Invalid parameter key, must be between 1 and 64 characters long and only contain lowercase letters, uppercase letters, numbers, underscores, and hyphens` (**the code's regex allows 0 chars while the message says 1-64** — reproduce both, do not "fix" the regex; `a`×64 accepted, `a`×65 rejected, `a.b` rejected); task exists but has no `inputOverride` ⇒ `No execution data available` (no fallback to connection data); `itemIndex` beyond the override array ⇒ raw **`TypeError`** (the optional chain stops before `.json`) |
| `$tool` | `{ name: $fromAI('tool') ?? fallback?.name, parameters: $fromAI('toolParameters') ?? fallback?.parameters }` with `fallback = additionalKeys.$tool` | the `try` swallows **only** `no_execution_data` (then returns `fallback`, so no-data-and-no-fallback ⇒ `undefined`); any other error — including the `TypeError` of L19 — propagates whenever `throwOnMissingExecutionData` is `true`; a partially supplied override yields the key present with `parameters: undefined`, which must NOT be dropped by serialisation |
| `$agentInfo` | `{ memoryConnectedToAgent, tools[] }` | **eager**: computed by `agentInfo()` when `getDataProxy()` builds `base`, so a later graph mutation is invisible to an existing proxy. `undefined` unless the active node's `type === '@n8n/n8n-nodes-langchain.agent'`. `tools[]` = every non-disabled node whose **type description name** contains `tool` (`workflow.queryNodes`), ordered connected-first (`ai_tool` edge into the agent) then unconnected, each `{ connected, name, type: description.displayName, resource, operation, hasCredentials, hasValidCalendar, aiDefinedFields }` where `resource`/`operation` are the matching **option display names** (`null` when absent or when the operation's `displayOptions.show.resource` excludes the chosen resource), `hasValidCalendar` is `undefined` for every type except one whose description name contains `googleCalendar`, and `aiDefinedFields` lists the *display names* of parameters whose raw value mentions `$fromAI` |
| `$getPairedItem(dest, source, pairedItem, method?)` | the raw lineage resolver (exposed for Code-node/tool reuse) | |
| unknown identifier | `undefined` | never `ReferenceError` (see I9) |

## 3. `$parameter` — the effective-parameter rule (highest regression risk)

```
P1  the object is workflow.nodes[activeNodeName].parameters AFTER
    Workflow's constructor ran NodeHelpers.getNodeParameters(props, params, returnDefaults=true,
    returnNoneDisplayed=false, node, description)
    ⇒ undeclared keys are absent, declared-but-absent keys return their default,
      displayOptions-hidden keys are dropped,
      and for a node whose type cannot be resolved the RAW stored JSON survives.
P2  '&' prefix reads siblingParameters (not node.parameters) and throws
    ApplicationError('Could not find sibling parameter on node') when the key is absent.
P3  self-recursion guard: value === `={{ $parameter.<key> }}` ⇒ undefined (no infinite loop).
P4  resource locators: __rl values collapse to .value; a `__regex` on the locator extracts
    exec(value)[1] and returns .value when the regex does not match (no error).
    extractValue for the *parameter itself* is NOT applied here (that is core's job).
P5  if the resulting string starts with '=' and resolveValue is true, it is re-entered through
    Expression.getParameterValue with selfData={} and the current contextNodeName.
P6  the proxy exposes isProxy ⇒ true and toJSON ⇒ deepCopy(target).
```

## 4. Item lineage (`.item` / `.pairedItem(i)` / `.itemMatching(i)`)

```
A1 legality check happens BEFORE any data read, on the graph:
     children = workflow.getChildNodes(activeNodeName, 'ALL_NON_MAIN')
     children.empty  ⇒ require getParentNodes(contextNodeName).includes(X)
     children.nonEmpty ⇒ require ⋃_{c ∈ children} getParentNodes(c, 'ALL').includes(X)
   violation ⇒ createNoConnectionError(X)  [type paired_item_no_connection]
A2 the walk starts at connectionInputData[itemIndex].pairedItem and the FIRST hop's source is
   `executeData.source.main[pairedItem.input || 0] ?? executeData.source.main[0]` (L1275-1276: only the
   first hop has that `?? main[0]` safety net).
A3 each hop: taskData = runData[source.previousNode][previousNodeRun ?? 0], else manual-mode pinData
   materialised as a synthetic task; output = taskData.data.main[previousNodeOutput ?? 0]
   (missing ⇒ ExpressionError 'Can’t get data for expression', type internal).
A4 when source.previousNode === X: return output[pairedItem.item]; out of range ⇒ no_info error.
A5 multiple candidate parents are explored (flatMap over item.pairedItem[]); a candidate whose
   `nextPairedItem.input` is >= that task's `source.length` is dropped *silently* (`return []`, L997-999);
   if every candidate failed the FIRST error is rethrown — but when the candidate list is **empty** the
   guard `results.every(r => !r.ok)` passes vacuously and `results[0].error` dereferences `undefined`,
   raising `TypeError: Cannot read properties of undefined (reading 'error')`. That crash is n8n 2.9.4
   behaviour (`13E.lineage_sourceOverwrite.input_index_beyond_sourceArray`); reproducing a friendly error
   instead is a deviation that needs approval.
A6 two distinct matched objects ⇒ 'Multiple matches found' (identity comparison, not deep equal).
A7 `.itemMatching(i)` requires an explicit index; `.item` is eager (no call needed); both respect
   workflow.settings.binaryMode via returnExecutionData(data, fullItem).
A8 `$('X').item` on the active node itself is legal only if A1 passes (it usually does not).
A9 at every hop the next source is `nextPairedItem.sourceOverwrite ?? sourceArray[inputIndex]`: a
   `pairedItem.sourceOverwrite` (ISourceData) **redirects** the walk, and that is how tool/sub-node
   executions keep lineage pointing at their real input. The core-side helper
   `resolveSourceOverwrite(item, executionData)` returns `null` unless
   `executionData.metadata.preserveSourceOverwrite`, then prefers `metadata.preservedSourceOverwrite`,
   then `item.pairedItem.sourceOverwrite` when `typeof item.pairedItem === 'object'`; a numeric
   `pairedItem` never redirects (6/6 cases observed in `13E`).
```

## 5. Pin data, missing data, and the `throwOnMissingExecutionData` flag

| Situation | Behaviour |
|---|---|
| `mode === 'manual'` and referenced node is pinned | pinned items replace `runData` (fallback on success *and* on error); `$('X').item`-style access to pinned nodes uses the synthetic-task path |
| any other mode | pin data is ignored everywhere |
| `runExecutionData === null` | `$json`/`$input`/`$thisItem`/`$parameter`/`$now` work; `$('X')`/`$node[X]`/`$('X').isExecuted` throw `no_execution_data` / return `false` respectively |
| `connectionInputData === []` | `$json`/`$binary` → `"Node '<ctx>' hasn't been executed"`; `$input.*` → `'No execution data available'`; `$thisItem` → `undefined`; `$items()` → `[]` |
| `opts.throwOnMissingExecutionData === false` | **short-syntax only**: forwarded to `nodeDataGetter(contextNodeName, true, flag)` for `$json`/`$data`/`$binary` (+`$item` when combined) and to `handleTool`. Empty data ⇒ `undefined`. Everything else keeps the default `true`: `$('X')`, `$node['X'].json`, `$input.*`, `$items(X)`, lineage, and the unknown-node checks **still throw** (verified: `$node['Solo'].json` with `flag:false` → `Node 'Solo' hasn't been executed`) |
| `binaryMode: 'combined'` | `$input.*`, `$('X').first/last/all/item` return `item.json` instead of the item; `$item` joins the JSON-access set of the outer trap |

## 6. Global / ambient effects (must be declared, not hidden)

1. `luxon.Settings.defaultZone = timezone` on **every** proxy construction.
2. `EXTENDED_SYNTAX_CACHE` and the tournament compile cache are process-global (owned by the syntax slice).
3. `process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE` is read twice (env provider state, and `data.process.env` in the syntax slice).
4. `getGlobalState().defaultTimezone` fallback.
5. In scripting nodes (`SCRIPTING_NODE_TYPES`) `runExecutionData`/`connectionInputData` are replaced by copy-on-write proxies, so reads return *augmented* proxies and writes never reach stored data.

## 7. Explicit non-ownership

`additionalKeys` content (`getAdditionalKeys`), `connectionInputData`/`executeData` construction
(engine + `prepareConnectionData`), runData production and `pairedItem` assignment, `$json`
serialisation for the task runner, parameter `ensureType`/`extractValue`/schema validation/
`cleanupParameterData`, template parsing & coercion (sibling contract), the `Workflow` graph
implementation, node-type descriptions, frontend preview evaluation.

## 8. Required interfaces from sibling LEGOs (dependency contract)

| From | Must provide (exact behaviour matters) |
|---|---|
| Workflow (Agent 1) | `getNode`, `nodes`, `getNodeConnectionIndexes(ctx, X, type)`, `getParentNodes(n, type?, depth?)`, `getChildNodes(n, type, depth?)`, `getParentMainInputNode`, `getPinDataOfNode`, `queryNodes`, `settings.{timezone,binaryMode}`, `id/name/active`, `nodeTypes.getByNameAndVersion`, **and the documented parameter-rewrite side effect of its constructor (P1)** |
| Node model (Agent 2) | `NodeHelpers.getNodeParameters`, `NodeHelpers.getContext`, `isResourceLocatorValue`, `SCRIPTING_NODE_TYPES`, `AGENT_LANGCHAIN_NODE_TYPE`, `BINARY_MODE_COMBINED` |
| Execution data (Agent 3) | `INodeExecutionData`/`IPairedItemData`/`ISourceData`/`ITaskData`/`IExecuteData` shapes, `createEmptyRunExecutionData`, the engine's `pairedItem` rewriting rules (I3/I4 of `execution-data.contract.md`) |
| Engine / core | assembles the 14-tuple; supplies `additionalKeys`; applies post-processing |

## 9. Invariants

```
I1  $json/$binary/$data come from connectionInputData[**itemIndex**] of the contextNode, never from runData.
I2  $node['X'] is positional; $('X').item is lineage-based; they differ whenever item counts differ.
I3  $('X') default output branch = graph-derived sourceIndex, else error 'connect "<ctx>" to "<X>"'.
I4  run selection: explicit arg > defaultReturnRunIndex(-1 ⇒ last run) ; out of range ⇒ 'Run N … not found'.
I5  three distinct outcomes, never interchangeable: name absent from `workflow.nodes` ⇒ typed
    ExpressionError at lookup (`nodeNotFound` for `$('X')`/`$node[X]`, `paired_item_no_connection` for
    `$('X').item`); node present but unexecuted ⇒ `Node 'X' hasn't been executed` for data accessors,
    `runIndex` ⇒ -1, `isExecuted` ⇒ false; property unknown on a returned proxy ⇒ `undefined`.
I6  $parameter follows P1..P6; $rawParameter differs only by resolveValue.
I7  pin data is a manual-mode-only fallback and never affects $json/$input.
I8  additionalKeys precedence is positional (§1 table, last row group), and $json/$binary/$data/$tool
    are unshadowable because the outer trap intercepts them before Reflect.get.
I9  the data proxy reports `has(k) === true` for every key; consequently free identifiers in a
    template resolve to `data[k]` (undefined) instead of the host global — unknown names never throw.
I10 the proxy exposes no write trap semantics; combined with I-augmentation (scripting nodes) no
    expression can mutate stored execution data (verified: runData byte-identical after a write).
I11 $prevNode and $('X').isExecuted never throw.
I12 timezone leakage via luxon global state is accepted behaviour for this phase, flagged for the port.
I13 every resolved leaf gets a NEW proxy ⇒ $now/$today can differ between two parameters of one item.
I14 errors carry runIndex/itemIndex from this slice and `parameter` from the consumer.
I15 $agentInfo is an eager snapshot; tools come from queryNodes over type names, not from the agent's
    ai_tool edges alone (unconnected tools are listed too, with connected:false).
I16 $secrets exposes no enumerable surface (Object.keys [] / `in` false) — only direct reads; writes throw.
I17 $fromAI's data source is selected by whether a task exists at [activeNode][runIndex]; the
    connectionInputData fallback is indexed by runIndex (quirk preserved), and out-of-range itemIndex
    raises TypeError rather than degrading to undefined.
I18 an empty lineage candidate list crashes with TypeError (A5); pairedItem.sourceOverwrite redirects
    each hop (A9).
```

## 10. Acceptance criteria

1. The 90-entry lookup matrix (`PIPE-13["13A_lookup_matrix"]`) replays identically, including which
   accesses `throw` vs return `undefined` vs return `{}`.
2. The scoping matrix (`13B`: item shift, out-of-range, `runExecutionData:null`, empty input,
   `returnObjectAsString`, `additionalKeys` precedence, pin data manual/regular, `binaryMode`,
   augmentation, timezone side effect) replays identically.
3. Lineage: `13B.pairedItem_per_item` (item0→`{n:0}`, item1→`{n:2}`, item2/3→typed error) and
   `13D_extra.non_ancestor_reference` reproduce, and the `$node['Start'].json` positional contrast holds.
4. Core glue: `13C_core_glue` — `rawExpressions`, `ensureType` results, `evaluateExpression`
   default-item behaviour, `getWorkflowDataProxy` sibling-parameter throw, `$execution`/`$vars`/`$env`,
   and the failing-expression `context.parameter` attachment.
5. Error taxonomy: every row of anatomy §8 returns the same class, message and `context` keys.
6. No hidden dependency: the slice must compile against stub implementations of `Workflow`,
   `INode`, `INodeExecutionData` only (no core imports), which is exactly what §8 demands.
7. **Gap closure — done.** `13E_gap_closure` (42 records) now pins the four previously-`PARTIAL` areas:
   the `$fromAI` source/fallback/default/indexing rules, `$tool`'s full fallback chain, `$agentInfo` on a
   real agent+`ai_tool`+`ai_memory` graph (eager snapshot, connected/unconnected ordering, display-name
   resolution, `hasValidCalendar`, `aiDefinedFields`), and `resolveSourceOverwrite` + the
   `pairedItem.sourceOverwrite` redirect (including the empty-candidate `TypeError`). Remaining known
   limit, unchanged and explicit: the **request-shaped half** of the webhook/hook/load-options contexts
   (`body`/`query`/`headers`/`response`, `parseRequestObject`) is owned by the webhook LEGO — this slice
   only forwards what `getAdditionalKeys`/`getNonWorkflowAdditionalKeys` supply, and `13E` now pins that
   supply surface exactly (key sets, `mode` mapping, `__UNKNOWN__` placeholder id, customData errors).
   `VERIFIED` additionally requires the live-VPS re-run of `13C`/`13E` (the sandbox cannot reach it).
