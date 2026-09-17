# Isolation Record: Execution-Context Variable Lookup & Scoping — TASK-PIPE-13

**Worker:** Agent 6 (peran sesaat: *Expression & Scoping Specialist*) · **Branch:** `agent-6` / work branch `arena/01a0ace1-n8n-rust-v-4`
**Tasks:** `TASK-PIPE-13` (variable lookup) — companion record: [`expression-syntax-pipeline.md`](expression-syntax-pipeline.md) (`TASK-PIPE-12`)
**Reference:** n8n `2.9.4` (`reference/n8n`, commit `b6dc2787c45677a29a9612cd27eb911302961a83`)
**Runtime observed:** `n8n-workflow@2.9.1`, `n8n-core@2.9.1`, `@n8n/tournament@1.0.6`, `luxon@3.7.2`, Node `v22.22.3`
**Status:** `ISOLATED` (anatomy + boundary + machine-recorded observations against a real `WorkflowExecute` run).
**Contract:** [`contracts/variable-lookup.contract.md`](../../contracts/variable-lookup.contract.md)
**No Rust. `reference/n8n/**` read-only and untouched.**

Scope of this record: **how a name inside `{{ … }}` becomes data.** It dissects
`packages/core/src/execution-engine/node-execution-context/**` (the *scoping providers*) and
`packages/workflow/src/workflow-data-proxy.ts` (the *lookup engine*), as one boundary. The
`{{ }}` text/compile half lives in the PIPE-12 record.

---

## 1. The two halves of one LEGO, and why the split is real

```
   name lookup  =  (scoping tuple)  ×  (resolution rule per key)
   PIPE-12      =  (template text)  →  (JS value)      given `data`
```

The evaluator only ever touches `data` through `has`/`get`; `WorkflowDataProxy` only ever produces
that `data`. PIPE-12's `PIPE-12 §10-C7` shows the seam is observable (`getWorkflowDataProxy()`
returns a proxy **without** the seeded globals), so the split is not editorial — it is the seam
n8n itself uses.

---

## 2. Entry points in `packages/core/…/node-execution-context/` (the scoping surface)

All of them funnel into `NodeExecutionContext`; nothing else in `packages/core` builds a
`WorkflowDataProxy` for parameter resolution. Verified by reading every file in the directory:

| Context (file) | Expression entry points it exposes | Scoping it supplies | Notes |
|---|---|---|---|
| `node-execution-context.ts` (abstract, 15 KB) | `getNodeParameter(name, [fb], [opts])` L425 → `_getNodeParameter(name, itemIndex, …)` L435; `evaluateExpression(expr, itemIndex=0)` L528; `protected get additionalKeys` L420 (`@Memoized`) | `workflow`, `node`, `additionalData`, `mode`, `runExecutionData` (default `null`), `runIndex` (0), `connectionInputData` ([]), `executeData` | The **only** place `getAdditionalKeys()` is called for parameters; `@Memoized` ⇒ one `additionalKeys` object per context instance |
| `base-execute-context.ts` | inherits + `getWorkflowDataProxy(itemIndex)` L186 | passes `siblingParameters = {}` (L191) and **no** `defaultReturnRunIndex`/`selfData`/`contextNodeName` | ⇒ `$parameter['&x']` throws here but works inside a parameter expression (observed, §6.4) |
| `execute-context.ts` (`IExecuteFunctions`) | bound `getNodeParameter(name, itemIndex, fb, opts)` L127-139 | per-item | the common path for multi-item nodes |
| `execute-single-context.ts` (`IExecuteSingleFunctions`) | `getNodeParameter(name, fb, opts)` → `this.itemIndex` L115; `evaluateExpression(expr, itemIndex = this.itemIndex)` L88; `getWorkflowDataProxy()` → own item L123 | item-scoped by construction | the only context whose `evaluateExpression` defaults to the *current* item |
| `supply-data-context.ts` (`ISupplyDataFunctions`, sub-nodes/ai) | bound `getNodeParameter(name, itemIndex, fb, opts)` L114-126 | + `cloneWith({runIndex, inputData})` re-scopes `runIndex` | sub-node executions re-derive scoping from the clone |
| `webhook-context.ts` (`IWebhookFunctions`) | inherits `_getNodeParameter`; `getInputConnectionData()` L146+ **synthesises** `connectionInputData = [{ json: httpRequest.body ?? {} }]`, `runExecutionData ?? createEmptyRunExecutionData()`, `executeData = { data:{main:[items]}, node, source: null }` | mode from caller | ⇒ during webhook `source: null` ⇒ `$prevNode` is `undefined` and `.item` fails with "Can't get data for expression"; `$json` = raw request body |
| `hook-context.ts` (`IHookFunctions`), `trigger-context.ts`, `poll-context.ts` | **no** `getNodeParameter` with item scoping (`getNodeParameter(name, fb, opts)` from the abstract class, `itemIndex = 0`) + `getAdditionalKeys` used for webhook URL resolution (hook L49) | `runExecutionData = null`, `runIndex = 0`, `connectionInputData = []` | ⇒ activation-time expressions can only use `$workflow`, `$parameter`, `$env`, `$vars`, literals; any `$('X')` ⇒ `no_execution_data` |
| `load-options-context.ts` / `local-load-options-context.ts` | `getCurrentNodeParameter(path)` uses `additionalData.currentNodeParameters` and **never evaluates expressions** (only `extractValue`); `&`-relative path is rewritten from `this.path` | editor-time | ⇒ `$parameter` in loadOptions returns the *editor's* current values, not resolved ones |
| `workflow-node-context.ts` (`LoadWorkflowNodeContext`) | `getNodeParameter(name, itemIndex, fb, opts)` on a **single-node** `Workflow` built from a DB record | `mode: 'internal'` | used by `getWorkflowNodeContext()`; pin data off (mode ≠ manual) |
| `credentials-test-context.ts` | none | — | no expression surface at all |

`utils/` (all consumed **after** evaluation, i.e. outside the Expression boundary):
`get-additional-keys.ts` (`$execution` incl. `customData`, `$vars`, `$secrets`, deprecated
`$executionId`, `$resumeWebhookUrl`) · `cleanup-parameter-data.ts` (luxon → string, recursive) ·
`ensure-type.ts` · `extract-value.ts` (RLC/filter regex extraction) · `validate-value-against-schema.ts` ·
`get-secrets-proxy.ts` (throws `ExpressionError('Could not load secrets')` on failure) ·
`resolve-source-overwrite.ts` (feeds `pairedItem.sourceOverwrite`).

Boundary rule that follows from this table: **the lookup slice never computes `additionalKeys`,
`connectionInputData` or `executeData` — it consumes them.** (Recorded in `contracts/`, §7.)

---

## 3. The scoping tuple (constructor) and what each field binds

`WorkflowDataProxy` (`workflow-data-proxy.ts` L55-91) takes 14 positional arguments:

```
workflow, runExecutionData, runIndex, itemIndex, activeNodeName, connectionInputData,
siblingParameters, mode, additionalKeys, executeData?, defaultReturnRunIndex = -1,
selfData = {}, contextNodeName = activeNodeName, envProviderState?
```

| Field | Bound keys | Notes / observed |
|---|---|---|
| `activeNodeName` | `$parameter`, `$rawParameter`, `$nodeVersion`, `$nodeId`, `$webhookId`, `$mode`-adjacent errors, `$('X')` default branch, pairing legality, `$fromAI`/`$tool` input lookup | the *node whose parameter is being resolved* |
| `contextNodeName` | **`$json`, `$binary`, `$data`**, `$('X').item` legality (via `getParentMainInputNode`), `$prevNode`? (no — that is `executeData`) | defaults to `activeNodeName`; differs for Code/`$fromAI` sub-contexts. Observed: switching it changes `$json` while `$parameter` follows `activeNodeName` (`13B.contextNodeName_switches_json`) |
| `itemIndex` | `$json[i]`-style indexing inside `nodeDataGetter` (`runData[…][itemIndex]`), `$input.item`, `.item`/`.pairedItem()` default, `$thisItem`, `$itemIndex`, `$position` | out of range ⇒ `ExpressionError '"X" node has N item(s) but you're trying to access item i'` (type `no_execution_data`, `descriptionKey: pairedItemInvalidIndex`) |
| `runIndex` | `$runIndex`, `$thisRunIndex`, error context, `$('X')` when explicit | not used to *pick* a run — see `defaultReturnRunIndex` |
| `defaultReturnRunIndex` | run selection in `getNodeExecutionData`: `-1` ⇒ **last run** | `nodeDataGetter` passes it; observed with `0` ⇒ forces run 0 (`13D_extra.defaultReturnRunIndex`) |
| `connectionInputData` | `$json`, `$binary`, `$data`, `$input.*`, `$items()`, `$thisItem`, pairing entry point | `[]` ⇒ `$json`/`$input` throw `no_execution_data`; `$thisItem` → `undefined` (`13B.empty_input`) |
| `runExecutionData` | `$('X')`, `$node[X]`, `.isExecuted`, `$prevNode`? (no), `$fromAI`, `$('X').context` | `null` ⇒ "The workflow hasn't been executed yet…" for `$node`, but `$json` still resolves (`13B.runExecutionData_null`) |
| `siblingParameters` | `$parameter['&key']` only | throws `ApplicationError('Could not find sibling parameter on node')` when missing |
| `mode` | pin-data gate (`manual` only), `$mode` | observed: pin data ignored in `regular` (`13B.pinned_data`) |
| `additionalKeys` | spread into the base object (see §5 precedence) | `$execution`/`$vars`/`$secrets` are `undefined` when absent (`13A`) |
| `executeData.source.main[i]` | `$prevNode`, `$input.params/.context`, pairing start, `$('X').item` legality | missing ⇒ `Can't get data for expression` (internal, `causeDetailed: Missing sourceData`) |
| `selfData` | `$self.<key>` | only reachable by *direct key read*; `{...$self}` yields `{}` because `ownKeys` reads the empty target (`13D_extra.selfdata`) |
| `envProviderState` | `$env` | defaults to `createEnvProviderState()`; blocked unless `N8N_BLOCK_ENV_ACCESS_IN_NODE === 'false'` |
| `workflow` | graph queries, `settings.timezone`/`binaryMode`, `pinData`, `nodeTypes`, `nodes`, `expression` (re-entry) | side effect on construction: **`Settings.defaultZone = timezone`** (L90) — global, process-wide, observed `America/New_York → Asia/Jakarta` (`13B.timezone_side_effect`) |

Constructor also decides augmentation: if `isScriptingNode(contextNodeName)` (types in
`SCRIPTING_NODE_TYPES`: Code/FunctionItem/Function/AI Transform), `runExecutionData` and
`connectionInputData` are wrapped in copy-on-write proxies (`augmentObject`/`augmentArray`).
Observed: writing through the proxy left the stored run data byte-identical (`13B.code_node_augmentation → mutated:false`).

---

## 4. Layered lookup: how a name resolves (the algorithm, exactly)

```
data = new Proxy(base, { has: () => true, get(target, name, receiver) { … } })   [L1560]

get trap, in order:
  name === 'isProxy'                    → true                      (proxy fingerprint)
  name ∈ {'$data','$json'} (+ '$item' when settings.binaryMode === 'combined')
                                        → nodeDataGetter(contextNodeName, shortSyntax=true,
                                                          throwOnMissingExecutionData).json
  name === '$binary'                    → nodeDataGetter(…).binary
  name === '$tool'                      → handleTool(throwOnMissingExecutionData)
  otherwise                             → Reflect.get(base, name)
base = { $, $input, $binary:{}, $data:{}, $env, $evaluateExpression, $item, $fromAI/$fromai/$fromAi,
         $items, $tool:{}, $json:{}, $node, $self, $parameter, $rawParameter, $prevNode, $runIndex,
         $mode, $workflow, $itemIndex, $now, $today, $jmesPath, DateTime, Interval, Duration,
         ...additionalKeys,                                   ← L1544 the only injection point
         $getPairedItem, $jmespath, $position, $thisItem, $thisItemIndex, $thisRunIndex,
         $nodeVersion, $nodeId, $agentInfo, $webhookId }
```

`base.$json` / `.$binary` / `.$data` / `.$tool` are **placeholders** (`{}`) — the get trap
intercepts them, which is why they cannot be shadowed (§5). Because the trap is bypassed for
`$('…')`-style chains that start at `$` (`base.$` is a function), everything else is plain
property lookup.

`opts.throwOnMissingExecutionData` has exactly **four** consumers, all of them the outer get trap:
`nodeDataGetter(contextNodeName, /*shortSyntax*/ true, flag)?.json` for `$json`/`$data`
(+`$item` in combined mode), `?.binary` for `$binary`, and `handleTool(flag)` for `$tool`
(L1558-1579). It is a **short-syntax-only** softening: it turns "this node produced no items" into
`undefined` for those keys, and it never applies to `$('X')`, `$node['X'].json`, `$input.*`,
`$items(X)`, or lineage. Two consequences pinned by probes:
with an empty `connectionInputData` and a non-existent `contextNodeName`, `$json` still throws
(`Referenced node does not exist`, `type: paired_item_no_connection`) because that check sits *before*
the flag test — `13B.throwOnMissingExecutionData_false`; and `$node['Solo'].json` for a node that
exists but never ran throws `Node 'Solo' hasn't been executed` **even with `flag:false`**
(`13D_extra.non_ancestor_reference`), because the long-syntax path calls `nodeDataGetter` with its
default `true`. The `?.json` after the call is also why an *empty* `.binary` yields `{}` (the proxy
returns a fresh object) rather than `undefined`.

Node data resolution (`getNodeExecutionData`, L400):

```
shortSyntax=true  (only for $json/$binary/$data)      → executionData = connectionInputData
shortSyntax=false ($('X'), $node[X], $items(X,…))     → runExecutionData null      → throw "workflow hasn't been executed yet"
                                                        !workflow.getNode(X)       → throw "Referenced node doesn't exist" (nodeNotFound)
                                                        no runData[X] && no pinData→ throw "Node 'X' hasn't been executed" (no_execution_data)
                                                        run = defaultReturnRunIndex ?? -1 → last run; out of range → 'Run N of node "X" not found'
                                                        data.main empty/null[0]     → throw 'No data found from `main` input'
                                                        branch unspecified → workflow.getNodeConnectionIndexes(contextNodeName, X).sourceIndex
                                                        … if none → throw 'connect "<ctx>" to "<X>"'
                                                        branch >= main.length       → throw 'Node "X" has no branch with index N.'
                     on throw, caller getNodeExecutionOrPinnedData retries with pinData (manual only)
```

Then `nodeDataGetter`'s proxy maps the *final* access: `json`/`data` → `executionData[itemIndex].json`
(note: `data` is an **alias of `json`**, both return `.json`), `binary` → metadata with `data`
stripped (observed: `$binary` = `{mimeType, fileName, fileSize}` while `$input.item.binary` keeps
`data` base64 — `13D_extra.binary_metadata_only`), `context` → `nodeContextGetter`, `parameter` →
`nodeParameterGetter`, `runIndex` → `runData[X].length-1` or `-1`.

---

## 5. `$parameter`, resource locators, and the discovery that changes the boundary

`nodeParameterGetter(nodeName, resolveValue=true)` (L287) is a Proxy over
`workflow.nodes[nodeName].parameters` with:

* `has: () => true`, `ownKeys` = real keys, `getOwnPropertyDescriptor` faked enumerable
  (so `for…in`/spread behave), `isProxy` → `true`, `toJSON` → `deepCopy(target)`;
* `name[0] === '&'` ⇒ read from **`siblingParameters`** (throws `ApplicationError` if absent);
* `returnValue === '={{ $parameter.<name> }}'` ⇒ `undefined` — the self-recursion guard;
* `isResourceLocatorValue(v)` ⇒ if `v.__regex` and `typeof v.value === 'string'`, return
  `regex.exec(v.value)[1]` (or `v.value` when the regex fails); else return `v.value`;
* `resolveValue && typeof v === 'string' && v[0] === '='` ⇒ **re-enter**
  `workflow.expression.getParameterValue(v, …, contextNodeName)` with `selfData = {}`
  (i.e. `$parameter.*` inside `$('X')` re-resolution loses `selfData`);
* unknown key ⇒ `undefined` (never throws).

Observed (`13A`, node type declaring the parameters):

```
$parameter.msg            → "hello"
$parameter.expr           → 42                  (expression resolved through the full pipeline)
$parameter.rl            → "https://x/42"       (RLC: value resolved, NOT regex-extracted)
$rawParameter.expr        → "={{ 21 * 2 }}"
$rawParameter.rl           → "={{ \"https://x/42\" }}"   (RLC unwrapped to .value, unresolved)
$parameter['&msg']         → value from siblingParameters
$parameter['&nope']         → throws ApplicationError('Could not find sibling parameter on node')
$parameter.absent          → undefined
$parameter.toJSON()        → deep copy of the effective parameters
```

**Boundary-changing discovery (§5.1):** `Workflow`'s constructor (workflow.ts L94-121) replaces
every `node.parameters` with `NodeHelpers.getNodeParameters(nodeType.description.properties,
node.parameters, /*returnDefaults*/ true, /*returnNoneDisplayed*/ false, node, description)`.
Consequences, all observed:

1. a parameter **not declared** by the node type disappears before `$parameter` can read it
   (with a stand-in type declaring `properties: []` we measured `getNode('End').parameters === {}`
   and every `$parameter.*` → `undefined`);
2. declared parameters not present in the workflow JSON return their **default** (so
   `$parameter.x` is `default`, not `undefined`);
3. parameters hidden by `displayOptions` are dropped (`$parameter.hidden` → `undefined`
   even though the property has a default);
4. for a node whose type is **unknown** (`nodeTypes.getByNameAndVersion` → `undefined`) the loop
   `continue`s and the **raw** JSON parameters survive.

⇒ `$parameter`/`$rawParameter` are **not** a workflow-JSON view; they are the *effective,
defaulted, description-filtered* view produced by the Workflow + Node-model LEGOs. This must be an
explicit dependency of the lookup slice (Agent 1 `Workflow` ctor + Agent 2
`NodeHelpers.getNodeParameters`), and a Rust implementation that reads `workflow.json` directly
will silently differ. Recorded in `contracts/variable-lookup.contract.md` §4/§8.

---

## 6. Per-key contract table (lookup slice)

Every row is machine-observed; `E12`-style references point at
[`agent-6-probes/observations.json`](agent-6-probes/observations.json).

| Key | Resolves to | Requires | Failure when missing |
|---|---|---|---|
| `$json`, `$data` | `connectionInputData[itemIndex].json` (in `binaryMode:'combined'`, `$('X')` results collapse to `.json`) | input data | `ExpressionError` `no_execution_data` |
| `$binary` | same item's `binary` minus `data` per key; `{}` when none | input data | as above |
| `$input.item` | **full** item (`{json, binary?, pairedItem}`) | input data | `No execution data available` (`no_execution_data`) |
| `$input.first()`/`last()` | first/last item; **any argument throws** `'$input.first() should have no arguments'` | input data | — |
| `$input.all()` | all items (never throws on empty ⇒ `[]`) | input data | — |
| `$input.params` | `workflow.getNode(source.previousNode).parameters` (unresolved) | `executeData.source` | internal `Can't get data for expression` |
| `$input.context` | `NodeHelpers.getContext(runExecutionData,'node',prevNode)` proxy | run data + source | same |
| `$('X')` | proxy with `isExecuted`, `first/last/all(branch?,run?)`, `item`, `pairedItem(i?)`, `itemMatching(i)`, `params`, `context` | graph + run data | table of §4 |
| `$('X').isExecuted` | `Object.prototype.hasOwnProperty.call(runData, X)` — never throws for existing nodes | run data | `false` if `runExecutionData` is null |
| `$('X').params` | `workflow.getNode(X)?.parameters` — raw, unresolved | graph | `undefined` for unknown node |
| `$('X').first/last/all` | items of `runData[X][run].main[branch]`; empty branch ⇒ `first()/last()` → `undefined`, `all()` → `[]` | run data | see §4 |
| `$('X').item` etc. | §7 walk | pairedItem + source + ancestry | see §7 |
| `$node[X].json/.data/.binary/.context/.parameter/.runIndex` | same as `$('X').first()` but **indexed by the current `itemIndex`** — no pairing | run data | `Node 'X' hasn't been executed` etc. |
| `$node[X]` unknown | — | — | `ExpressionError` `nodeNotFound` (also `'json' in $node.X` → `true`: the `has` trap is unconditional) |
| `$parameter`, `$rawParameter` | §5 | graph + node-type description | `undefined` |
| `$prevNode` | `{name, outputIndex, runIndex}` from `executeData.source.main[0]` (`previousNodeOutput \|\| 0`, `previousNodeRun \|\| 0`) | `executeData.source` | `undefined` when source absent (never throws) |
| `$workflow` | `{active, id, name}`; `id` when the workflow is unsaved ⇒ `ExpressionError('save workflow to view')` | graph | — |
| `$now`, `$today` | luxon `DateTime.now()` / midnight, zone `workflow.settings.timezone ?? globalState.defaultTimezone`; **sets `luxon.Settings.defaultZone` globally** as a side effect of construction | workflow settings | — |
| `$runIndex`, `$itemIndex`, `$position`, `$thisItem(Index)`, `$thisRunIndex`, `$mode`, `$nodeVersion`, `$nodeId`, `$webhookId` | constructor / active node snapshot taken **at proxy build** | — | `undefined` for missing `webhookId`/unknown node |
| `$env` | `createEnvProvider(runIndex,itemIndex,state)` proxy | allow flag | `ExpressionError('access to env vars denied')` (or `'not accessible via UI, please run node'` when `process` is absent) |
| `$vars`, `$secrets`, `$execution`, `$executionId`, `$resumeWebhookUrl`, `$tool`(fallback), `$agentInfo`(if not agent), `…` | `additionalKeys` passthrough | n8n-core | `undefined` when not supplied (observed) |
| `$jmespath` / `$jmesPath` | `jmespath.search(data, q)`; non-object/array or non-string query ⇒ `ExpressionError('expected two arguments (Object, string) for this function')` | — | — |
| `$evaluateExpression(expr, itemIndex?)` | `workflow.expression.getParameterValue('=' + expr, …, contextNodeName)` | — | see the prefix trap below |
| `$item(i, run?)` | a **fresh** `WorkflowDataProxy` with that `itemIndex` (and `defaultReturnRunIndex = run ?? -1`) | — | out-of-range item throws |
| `$items(X?, out?, run?)` | legacy: no node ⇒ `connectionInputData` (sliced to 1 item if `node.executeOnce`); with node ⇒ `getNodeExecutionData(X,false,out,run)` | run data | out-of-range **branch** ⇒ `'Node "X" has no branch with index N.'` (checked before the run index) |
| `$fromAI(key, desc?, type?, default?)` / `$fromai` / `$fromAi` | reads `runData[activeNode][run].inputOverride.ai_tool[0][itemIndex].json.query[key] ?? .json[key] ?? default` | AI tool input | `No execution data available` / `"Add a key, e.g. $fromAI('placeholder_name')"` / key-pattern `^[a-zA-Z0-9_-]{0,64}$` violation |
| `$tool` | `handleTool()`: `$fromAI('tool')` + `('toolParameters')`, falling back to `additionalKeys.$tool` and swallowing only `no_execution_data` | run data or additionalKeys | `undefined` fallback path observed |
| `$self.<k>` | `selfData[k]` | selfData | `undefined` |
| `$agentInfo` | agent-node tool inventory (`memoryConnectedToAgent`, `tools[]` w/ `connected,name,type,resource,operation,hasCredentials,hasValidCalendar,aiDefinedFields`) | active node is the LangChain agent | `undefined` otherwise |
| `$getPairedItem(dest, source, pairedItem, method?)` | the raw pairing function (used by Code-node augmentation/tool flows) | — | — |
| unknown name (`$foo`, plain `foo`) | `Reflect.get(base, name)` → `undefined`; **never** a `ReferenceError` because `has` is unconditional | — | — |

### 6.4 Two entry points, two behaviours (observed, must not be merged)

| | parameter path (`getNodeParameter`) | `getWorkflowDataProxy(itemIndex)` (Code node / task runner) |
|---|---|---|
| `siblingParameters` | `node.parameters` of the *parent object* being walked ⇒ `$parameter['&x']` works | `{}` ⇒ **throws** `ApplicationError('Could not find sibling parameter on node')` |
| global seeding (`initializeGlobalContext`, `data.process`, `extend`, `__sanitize`) | applied (steps 3-8 of PIPE-12 §2) | **not applied** — `$proxy.process/.JSON/.Object` are `undefined` |
| `contextNodeName` | `options.contextNode?.name` when supplied | defaults to the node itself |
| `returnObjectAsString`, `selfData` | caller-provided (`evaluateExpression` ⇒ defaults) | never |
| post-processing (`cleanupParameterData`, `ensureType`, `extractValue`, schema validation) | yes | no |

`evaluateExpression(expr, itemIndex=0)` prefixes `'='` itself, so a caller that passes
`'={{…}}'` double-prefixes. Observed (`13D_extra.evaluate_expression_forms`):

```
$evaluateExpression('1 + 1')        → "1 + 1"      (no braces ⇒ pure TEXT chunk, never evaluated!)
$evaluateExpression('{{1 + 1}}')    → 2            (number)
$evaluateExpression('={{ 1 + 1 }}') → "=2"         (string, because the leftover '=' is text)
$evaluateExpression('hello')        → "hello"
NodeExecutionContext.evaluateExpression('{{$json.n}}')  → 5 for every item (itemIndex defaults to 0)
ExecuteSingleContext  (same call)   → 5 / 6 (itemIndex defaults to this.itemIndex)
```

The `{{1+1}}`-vs-`1+1` asymmetry and the default `itemIndex` difference are port traps, not
theoretical: they are the reason a "simplification" would break existing workflows.

---

## 7. Item lineage (`pairedItem`) — the recursive resolver

`getPairedItem(destinationNodeName, incomingSourceData, initialPairedItem, usedMethodName, nodeBeforeLast)`
(`workflow-data-proxy.ts` L960) — the only recursive part of the lookup slice:

```
1  pairedItem = normalise(number → {item}) ; source = pairedItem.sourceOverwrite ?? incomingSourceData
2  if (!source)                       throw createPairedItemNotFound(dest)          [paired_item_no_info]
3  taskData = runData[source.previousNode][source.previousNodeRun ?? 0]
             ?? pinDataToTask(getPinDataIfManualExecution(workflow, source.previousNode, mode))
4  output   = taskData.data.main[source.previousNodeOutput ?? 0]
             if none                  throw 'Can't get data for expression'          [type: internal]
5  item     = output[pairedItem.item]
6  if (source.previousNode === dest):
        if (pairedItem.item >= output.length) throw createMissingPairedItemError()   [paired_item_no_info]
        return item
7  nextPaired = normalisePairedItem(item.pairedItem)   (number | obj | array → IPairedItemData[])
     if empty  throw createMissingPairedItemError(source.previousNode)
8  for each nextPaired: input = nextPaired.input ?? 0
     if (input >= taskData.source.length) → skipped (no candidate)
     nextSource = nextPaired.sourceOverwrite ?? taskData.source[input]
     recurse, collecting Result.ok / Result.error
9  all failed        → rethrow the FIRST error
     no matches      → sourceArray empty ? createNoConnectionError(dest) : createBranchNotFoundError(prev, item)
     >1 distinct hit → createPairedItemMultipleItemsFound(dest, itemIndex)
     else             → first match (identity compared, not deep-equal!)
```

Legality is checked **before** the walk, in the `$('X')` proxy (L1178-1199), and its rule is
graph-derived with a twist that must be preserved:

```
children = workflow.getChildNodes(activeNodeName, 'ALL_NON_MAIN')
if (children.length === 0)  ok = getParentNodes(contextNodeName).includes(X)
else                        ok = children.flatMap(c => getParentNodes(c, 'ALL')).includes(X)
else                        throw createNoConnectionError(X)   [paired_item_no_connection]
```

Observed (`13B.pairedItem_per_item`, `13D_extra.non_ancestor_reference`):

```
item 0 → {n:0}            item 1 → {n:2}            (paired across ref.split2's 1:2 explode)
item 2,3 → ExpressionError 'Can’t get data for expression'  [paired_item_intermediate_nodes]
$('End').item (self) → 'Invalid expression'  [paired_item_no_connection]
$('Solo').item (disconnected) → 'Invalid expression' [paired_item_no_connection]
$('Solo').all() (exists, unexecuted) → "Node 'Solo' hasn't been executed" [no_execution_data]
```

Contrast with `$node['Start'].json`, which for itemIndex 0..3 returned `n = 0,1,2,3` (positional,
no lineage) while `.item` returned `0,2` — the single most common workflow-corruption source when a
port "unifies" the two.

---

## 8. Error taxonomy (all observed; class · message · `context`)

| Situation | class | `context` |
|---|---|---|
| unknown node via `$node`/`$('X')` | `ExpressionError` `"Referenced node doesn't exist"` | `nodeCause`, `descriptionKey: 'nodeNotFound'`, `runIndex`, `itemIndex` |
| node exists, not executed | `ExpressionError` `"Node 'X' hasn't been executed"` | `type: 'no_execution_data'`, `nodeCause`, `descriptionKey: 'pairedItemNoConnection'|'pairedItemNoConnectionCodeNode'`, `messageTemplate` (with the embedded `$if(…isExecuted…)` hint) |
| `runExecutionData === null` | `ExpressionError` `"The workflow hasn't been executed yet, so you can't reference any output data"` | `runIndex`, `itemIndex` |
| no input at all, `$json` | `ExpressionError` `"Node '<ctx>' hasn't been executed"` | `type:'no_execution_data'`, `descriptionKey:'pairedItemNoConnection'` |
| no input, `$input.*` | `ExpressionError` `'No execution data available'` | `type:'no_execution_data'` |
| `itemIndex ≥ length` | `ExpressionError` `'"X" node has N item(s) but you're trying to access item i'` | `type:'no_execution_data'`, `descriptionKey:'pairedItemInvalidIndex'`, `messageTemplate:'Adjust your expression to access an existing item index (0-{{maxIndex}})'` |
| run index out of range | `ExpressionError` `'Run N of node "X" not found'` | `runIndex`,`itemIndex` |
| branch out of range | `ExpressionError` `'Node "X" has no branch with index N.'` | — |
| branch unresolvable from graph | `ExpressionError` `'connect "<ctx>" to "<X>"'` | — |
| pairing: no `pairedItem` | `ExpressionError` `'Paired item data for <m> from node …'` / `'Using the <m> method doesn't work with pinned data…'` | `type:'paired_item_no_info'`, `functionality:'pairedItem'`, `causeDetailed` |
| pairing: no ancestry path | `ExpressionError` `'Invalid expression'` | `type:'paired_item_no_connection'`, `messageTemplate:'No path back to referenced node'`, `moreInfoLink` appended to `description` |
| pairing: intermediate nodes unexecuted | `ExpressionError` `'Can’t get data for expression'` | `type:'paired_item_intermediate_nodes'` |
| pairing: multiple distinct matches | `ExpressionError` `'Multiple matches found'` | `type:'paired_item_multiple_matches'` |
| pairing: bad branch reference | `ExpressionError` `'Branch not found'` | `type:'paired_item_invalid_info'` |
| `source` missing (internal) | `ExpressionError` `'Can’t get data for expression'` | `causeDetailed:'Missing sourceData (probably an internal error)'` |
| unsaved workflow, `$workflow.id` | `ExpressionError` `'save workflow to view'` | `description:'Please save the workflow first to use $workflow'` |
| `$env` blocked | `ExpressionError` `'access to env vars denied'` | `causeDetailed` mentions `N8N_BLOCK_ENV_ACCESS_IN_NODE` |
| `$fromAI` misuse | `ExpressionError` ×3 variants | `runIndex`,`itemIndex` |
| missing execution data for `$json` in Code-ish flows | `ExpressionError` `'Can’t get data for expression under ‘%%PARAMETER%%’ field'` | `messageTemplate` — `%%PARAMETER%%` is substituted **by the UI**, not by n8n-workflow |
| `&sibling` not found | `ApplicationError` `'Could not find sibling parameter on node'` | `extra:{nodeName, parameter}` |

Error **handling at the consumer** (`_getNodeParameter` L477-495, observed end-to-end in
`13C_core_glue.errorContext`): `ExpressionError` ⇒ `e.context.parameter = <parameterName>`,
`e.cause = <raw value>`, rethrow; task `executionStatus:'error'`, `resultData.error` carries the
same `context` object. The `Set`-node special case (`node.continueOnFail && type === 'n8n-nodes-base.set'`)
swallows the error and returns `[{ name: undefined, value: undefined }]` — an upstream quirk
(PAY-684) the port must know about even if it is engine-side.

---

## 9. Invariants (normative)

```
L1  `$json/$data/$binary` are resolved from `connectionInputData[**itemIndex**]` scoped by
    `contextNodeName`, never from runExecutionData.
L2  `$('X')`/`$node[X]` never read `connectionInputData`, except `.item/.pairedItem()/.itemMatching()`,
    which read exactly `connectionInputData[itemIndex].pairedItem` and `executeData.source`.
L3  `$node[X].*` is positional (current itemIndex); `$('X').item` is lineage-based. They are not
    interchangeable and produce different values whenever item counts differ along the path.
L4  Unknown *property* ⇒ `undefined`; unknown/unexecuted *node* ⇒ typed `ExpressionError`.
L5  `$parameter` exposes the effective parameters produced by `Workflow`'s constructor
    (defaults injected, undeclared and non-displayed keys dropped), not the stored JSON.
L6  `$rawParameter` = same view, expressions unresolved; both unwrap resource locators to `.value`
    and honour `__regex` extraction.
L7  `$parameter['&k']` requires the caller to pass `siblingParameters`; `getWorkflowDataProxy()`
    passes `{}` and therefore throws for `&`-lookups.
L8  Default branch of `$('X')` comes from the graph (`getNodeConnectionIndexes`), not from run data;
    `itemIndex` (not `runIndex`) selects the item, `defaultReturnRunIndex = -1` selects the last run.
L9  Pin data is a fallback for referenced-node data and node-execution data **only when `mode === 'manual'`**;
    it never affects `$json`/`$input`.
L10 `$input.first/last/all` reject arguments; `$('X').first/last/all` accept `(branchIndex, runIndex)`.
L11 `.item` legality is a graph question evaluated before data access, using the
    children-of-active-node rule of §7; a node without `pairedItem` input ⇒ typed error, never `undefined`.
L12 `additionalKeys` are spread into `base`; keys declared after the spread (`$position`, `$thisItem`,
    `$thisItemIndex`, `$thisRunIndex`, `$nodeVersion`, `$nodeId`, `$agentInfo`, `$webhookId`) win over
    caller values; keys before it (`$now`, `$today`, `$itemIndex`, `$runIndex`, `$mode`, `$workflow`,
    `$parameter`, `$node`, `$env`, …) can be shadowed; `$json`, `$binary`, `$data`, `$tool`
    (and `$item` under `binaryMode:'combined'`) can never be shadowed because the get trap intercepts them.
L13 The proxy is read-only: `set`/`deleteProperty` traps are not defined on `base`, so writes land on
    the `base` object of that one proxy instance and never on run data — except inside scripting nodes,
    where copy-on-write augmentation makes even mutation harmless (observed `mutated:false`).
L14 `$('X').isExecuted` and `$prevNode` never throw; `$prevNode` is `undefined` when `executeData.source` is absent.
L15 Constructing the proxy mutates the process-wide luxon default zone (side effect, not scoped to the evaluation).
L16 Every leaf evaluation constructs a new proxy ⇒ `$now`/`$today` are per-leaf, so multiple parameters in
    one node can observe different `$now` values.
```

---

## 10. What the lookup slice must receive (interface requirements on sibling LEGOs)

| Provider | Symbol required | Used by | Status |
|---|---|---|---|
| Workflow (Agent 1) | `getNode(name) → INode \| null`, `nodes`, `getNodeConnectionIndexes(ctx, X, type) → {sourceIndex, destinationIndex} \| undefined`, `getParentNodes`, `getChildNodes(type)`, `getParentMainInputNode`, `getPinDataOfNode`, `settings.timezone/binaryMode`, `id/name/active`, `nodeTypes.getByNameAndVersion`, `expression` (re-entry) | §4, §5, §7 | consumed read-only; `Workflow`↔`Expression` cycle already recorded in `dependencies.md` |
| Workflow (Agent 1) | **the constructor's parameter-rewrite side effect** (§5.1) | `$parameter` | **not documented in `contracts/workflow.contract.md` yet** → coordination item |
| Node model (Agent 2) | `NodeHelpers.getNodeParameters`, `NodeHelpers.getContext`, `SCRIPTING_NODE_TYPES`, `AGENT_LANGCHAIN_NODE_TYPE`, `BINARY_MODE_COMBINED`, `isResourceLocatorValue` | §5, §3 | consumed read-only |
| Execution data (Agent 3) | `INodeExecutionData`, `IPairedItemData`, `ISourceData`, `ITaskData`, `IRunExecutionData`, `IExecuteData`, `createEmptyRunExecutionData`, engine's `pairedItem` rewriting + `resolveSourceOverwrite` | §7 | engine writes `pairedItem` **before** execution (`workflow-execute.js` L785-800) — already I3/I4 in `contracts/execution-data.contract.md` |
| n8n-core (engine) | the 14-value scoping tuple, `getAdditionalKeys`, `getNonWorkflowAdditionalKeys`, post-processing utils | §2, §6.4 | provider, not owned |

Hidden couplings found (must stay visible in the port): the luxon global,
`process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE` read at two different layers (proxy `data.process.env`
*and* the env provider state), the module-global extension cache (PIPE-12 C4), and
`getPinDataIfManualExecution`'s `mode` gate.

---

## 11. Ownership decision

```
┌──────────────────────────────────────────────────────────────────────────┐
│ LOOKUP SLICE (PIPE-13)                                                   │
│ WorkflowDataProxy + getDataProxy traps + getPairedItem + env provider +  │
│ pin-data helper + augmentObject/augmentArray + ExpressionError factory    │
└──────────────────────────────────────────────────────────────────────────┘
   MUST NOT own: template parsing/coercion (PIPE-12) · building the scoping tuple (core contexts)
                 · getAdditionalKeys/$vars/$secrets · cleanup/ensureType/extractValue/schema
                 · runData production & pairedItem assignment (engine) · graph APIs (Workflow)
                 · node-type descriptions (Node model) · task-runner transport
```

`node-execution-context/**` was **not** modified: the isolation is expressed as a contract that the
contexts already satisfy (they only *assemble* scoping), so the Rust port can keep the engine glue
in TypeScript/JS longer, or reimplement it later, without invalidating this slice.

---

## 12. Verification

| Check | Result |
|---|---|
| Real execution used for data (`WorkflowExecute` manual run over `Start → ref.split2 → ref.passthrough`, 4 start items, `executionOrder: v1`) | run `status: success`, `runData` keys `Start, Split, End`; End's input = 2 items (branch 0) with `pairedItem {item:0}/{item:1}` |
| Lookup matrix (87 keys × real proxy) | produced, 0 `UNKNOWN` entries |
| Scoping dimensions (18 groups) + extras (9 groups) | produced |
| n8n-core glue live probes (2 engine runs: full-surface node + failing-expression node) | `13C_core_glue`: parameter/raw/ensureType(`string\|number\|boolean\|json`)/`evaluateExpression` defaults/`getWorkflowDataProxy` (`$parameter` keys, `&sibling` throw, `$execution`, `$vars`, `$env` denial)/`$now`; `errorContext`: `ExpressionError` with `context.parameter:'value'` on the task and on `resultData.error` |
| Totals | **461 entries**, of which this task's slice is **172** (`13A` 90 · `13B` 36 · `13C` 12 · `13D` 34) plus the 23-entry fixture, in `agent-6-probes/observations.json` (sha256 `6a5878218b9620e42fc450b82405ec61628fc338ca1c90464e2366889467f452`) |
| Replay determinism | `determinism-check.cjs observations.json <rerun>` → `MATCH (only environment-dependent fields differ)` | verified 2026-09-17 |
| `reference/n8n/**` integrity | unmodified (`git status --porcelain` shows no `reference/` entries) |
| Golden set of Agent 3 (`tests/reference/expression/*`) | **not modified**; my records refine wording only (PIPE-12 §10-D1) — no expected.json touched, so the 11/11 baseline and the 6/6 expression suite are unaffected |
| Live VPS | not reachable from the sandbox; recorded as `ISOLATED`, not `VERIFIED` |

## 13. Open items for review

1. **`$parameter` semantics** (§5.1) — needs an explicit line in `contracts/workflow.contract.md`
   (Agent 1) and `contracts/node.contract.md` (Agent 2), otherwise the Rust port will read raw JSON.
2. **`additionalKeys` precedence** (L12) — a port that spreads caller keys last silently changes
   `$position`/`$nodeVersion`; the fix is to keep n8n's literal order, which is what the contract says.
3. **`$fromAI`/`$tool` input override** — verified only for the "no execution data" and validation
   errors (the happy path needs `inputOverride.ai_tool`, which the stand-in engine run does not
   produce). Marked in the contract as `PARTIAL` rather than pretending coverage.
4. **`throwOnMissingExecutionData:false`** softens empty data for the four outer-trap keys only, never
   long-syntax accessors nor unknown nodes (§4) — the contract records it so the Rust port does not
   "improve" it into a blanket suppressor. Proven by the two added probe rows
   (`$node["Solo"].json` with the flag `false` still throws; `$node["Solo"].runIndex` → `-1`).
