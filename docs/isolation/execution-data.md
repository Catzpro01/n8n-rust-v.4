# LEGO Isolation: Execution Data

**Status:** `TESTED` (analysis + boundary + reference tests verified against the real 2.9.4 runtime packages; live VPS verification pending — see §12)
**Owner:** Agent 3
**Reference:** n8n 2.9.4 (`reference/n8n`, commit `b6dc2787`), runtime packages `n8n-workflow@2.9.1` / `n8n-core@2.9.1` (the exact versions `n8n@2.9.4` pins)

> Source code and runtime are the source of truth. Everything below was read from
> `reference/n8n/packages/**` and confirmed by executing the real `WorkflowExecute`
> (see `tests/reference/harness`). Where docs/anatomy differs from source, source wins.

---

## 1. Purpose

Execution Data is the **passive data model** that flows between nodes and is
persisted per execution. It defines:

- the shape of one item (`INodeExecutionData`)
- how items are grouped per output / per input (`INodeExecutionData[][]`, `ITaskDataConnections`)
- how an output item is linked back to its input item(s) (`IPairedItemData`)
- where an item came from (`ISourceData`)
- the containers that hold everything for one execution (`ITaskData`, `IRunData`, `IRunExecutionData`)
- binary payload representation (`IBinaryData`, inline base64 vs. storage id)

It contains **no behaviour of its own**. All behaviour that mutates these
structures lives in the execution engine (`WorkflowExecute`) or in node helpers.
That split is the boundary.

## 2. Source files (actual)

| Concern | File | Notes |
|---|---|---|
| Item envelope, pairing, source, task containers | `packages/workflow/src/interfaces.ts` | `IBinaryData` L63, `IDataObject` L425, `IExecuteData` L449, `IPinData` L1329, `IBinaryKeyData` L1342, `IPairedItemData` L1346, `INodeExecutionData` L1371, `IRunData` L2613, `ITaskMetadata` L2638, `ITaskStartedData` L2675, `ITaskData` L2684, `ISourceData` L2693, `ITaskDataConnections` L2705, `IWaitingForExecution` L2713, `ITaskDataConnectionsSource` L2721 |
| Execution container (versioned) | `packages/workflow/src/run-execution-data/run-execution-data.ts`, `.v0.ts`, `.v1.ts` | `IRunExecutionData` is a **branded** type (v1); `migrateRunExecutionData()` upgrades v0 → v1 (`destinationNode: string` → `{nodeName, mode}`) |
| Factories | `packages/workflow/src/run-execution-data-factory.ts` | `createRunExecutionData`, `createEmptyRunExecutionData`, `createErrorExecutionData` – the only sanctioned way to build the branded type |
| Constants | `packages/workflow/src/constants.ts` | `BINARY_ENCODING='base64'` L6, `BINARY_IN_JSON_PROPERTY='_files'` L137, `BINARY_MODE_SEPARATE/COMBINED` L139-140 |
| Item normalisation helpers | `packages/core/src/execution-engine/node-execution-context/utils/normalize-items.ts`, `return-json-array.ts`, `construct-execution-metadata.ts`, `copy-input-items.ts` | Pure functions over `INodeExecutionData` |
| Paired-item auto-assignment | `packages/core/src/execution-engine/workflow-execute.ts` `assignPairedItems()` L2581 and the input re-indexing block L1513-1553 | **Engine-owned behaviour**, see §6 |
| Binary storage | `packages/core/src/binary-data/binary-data.service.ts`, `types.ts`; `packages/core/src/execution-engine/node-execution-context/utils/binary-helper-functions.ts`; `packages/core/src/utils/convert-binary-data.ts` | `store()` either inlines base64 (`default` mode) or writes to a manager and rewrites `id` + `data=<mode>` |
| Persistence serialisation (dependency only) | `packages/@n8n/db/src/repositories/execution.repository.ts` L24/L406/L1131 | `flatted.stringify/parse` of `IRunExecutionData`, then `migrateRunExecutionData` |

## 3. Data structures (from source, 2.9.4)

```ts
// packages/workflow/src/interfaces.ts
interface INodeExecutionData {
  json: IDataObject;                                   // REQUIRED
  binary?: IBinaryKeyData;                             // Record<key, IBinaryData>
  error?: NodeApiError | NodeOperationError;           // continueOnFail items
  pairedItem?: IPairedItemData | IPairedItemData[] | number;
  metadata?: { subExecution: RelatedExecution };
  evaluationData?: Record<string, GenericValue>;
  sendMessage?: ChatNodeMessage;
  index?: number;                                      // @deprecated
  [key: string]: ...                                   // open index signature (!)
}

interface IPairedItemData { item: number; input?: number /* default 0 */; sourceOverwrite?: ISourceData; }

interface ISourceData { previousNode: string; previousNodeOutput?: number /* 0 */; previousNodeRun?: number /* 0 */; }

interface IBinaryData {
  data: string;            // base64 payload  OR  storage mode string when `id` is set
  mimeType: string;
  fileType?: 'text'|'json'|'image'|'audio'|'video'|'pdf'|'html';
  fileName?: string; directory?: string; fileExtension?: string;
  fileSize?: string;       // pretty "7 B"
  bytes?: number;
  id?: string;             // "<mode>:<fileId>"  e.g. "filesystem-v2:workflows/w/executions/42/binary_data/<uuid>"
}

// per output-type, per output-index, list of items (null = not yet available)
interface ITaskDataConnections { [type: string]: Array<INodeExecutionData[] | null>; }

interface ITaskStartedData { startTime: number; executionIndex: number; source: Array<ISourceData|null>; hints?: NodeExecutionHint[]; }
interface ITaskData extends ITaskStartedData {
  executionTime: number; executionStatus?: ExecutionStatus;
  data?: ITaskDataConnections; inputOverride?: ITaskDataConnections;
  error?: ExecutionError; metadata?: ITaskMetadata;
}
interface IRunData { [nodeName: string]: ITaskData[]; }   // index = runIndex

interface IExecuteData { data: ITaskDataConnections; node: INode; source: ITaskDataConnectionsSource|null; metadata?: ITaskMetadata; runIndex?: number; }

// run-execution-data.v1.ts  (branded; build via factory)
interface IRunExecutionDataV1 {
  version: 1;
  startData?: { startNodes?, destinationNode?: IDestinationNode, originalDestinationNode?, runNodeFilter? };
  resultData: { error?, runData: IRunData, pinData?: IPinData, lastNodeExecuted?, metadata? };
  executionData?: { contextData, runtimeData?, nodeExecutionStack: IExecuteData[], metadata, waitingExecution, waitingExecutionSource };
  parentExecution?; validateSignature?; waitTill?; pushRef?; manualData?;
}
```

Shape of one node output as returned by `execute()` and stored in `ITaskData.data.main`:

```text
INodeExecutionData[][]
  └─ [outputIndex]      one array per declared output (IF → 2, Switch → n)
       └─ [itemIndex]   items on that output
```

## 4. Inputs (what produces Execution Data)

| Producer | Path |
|---|---|
| Trigger / webhook / manual start | `WorkflowExecute.run()` seeds `nodeExecutionStack[0].data = triggerToStartFrom.data.data ?? { main: [[{ json: {} }]] }` |
| Node `execute()` return value | `INodeExecutionData[][] | null` (`IRunNodeResponse.data`) |
| Node helpers | `returnJsonArray`, `normalizeItems`, `constructExecutionMetaData`, `prepareBinaryData`, `setBinaryDataBuffer` |
| Pin data (manual mode only) | `workflow.pinData[nodeName]` used as task output via `getPinDataIfManualExecution` |
| Persistence (resume / partial run) | `flatted.parse` → `migrateRunExecutionData` → `IRunExecutionData` |

## 5. Outputs (who consumes Execution Data)

| Consumer | What it reads |
|---|---|
| Execution engine (`WorkflowExecute`) | everything; routes `main[outputIndex]` to child inputs, writes `IRunData` |
| Node execution contexts (`n8n-core` `*-context.ts`) | `getInputData(inputIndex, type)`, `getBinaryDataBuffer`, `assertBinaryData` |
| **Expression LEGO** (`WorkflowDataProxy`) | `connectionInputData`, `runExecutionData.resultData.runData`, `executeData.source`, `pairedItem` chain, `pinData` |
| Persistence (`@n8n/db` ExecutionRepository) | serialises `IRunExecutionData` with `flatted` |
| Frontend (`editor-ui`) | renders `ITaskData` / `INodeExecutionData` in NDV, follows `pairedItem` for item highlighting |
| Task runner (`@n8n/task-runner`) | receives `INodeExecutionData[]` + `IRunExecutionData` over RPC for Code node |

## 6. Invariants (observed at runtime, 2.9.4)

All of these are captured as snapshots in `tests/reference/execution-data/*/expected.json`.

1. **`json` is always present** on stored items. Raw objects returned by helpers get wrapped (`normalizeItems`, `returnJsonArray`). *However* the engine does **not** validate arbitrary node output: an item `{ notjson: 1 }` is stored as-is with a `pairedItem` added (observed). Validation is the node's/type-system's job, not the data model's.
2. **Input pairedItem is re-indexed before execution.** For every input item the engine replaces `pairedItem` with `{ item: <inputItemIndex>, input: <inputIndex||undefined> }` (`workflow-execute.ts` L1513-1553). A node therefore always sees `$input.item.pairedItem == { item: itemIndex }` regardless of what upstream wrote. `sourceOverwrite` survives only for tool executions (`preserveSourceOverwrite`).
3. **Output pairedItem auto-assignment** (`assignPairedItems`, L2581) applies only when the item has **no** `pairedItem`, in this order:
   - 1 input item → every output item gets `{ item: 0 }`
   - single output branch and `out.length === in.length` → `{ item: index }`
   - single output branch with exactly 1 item and >1 input items → `{ item: 0 }`
   - otherwise → left `undefined` (observed: 3 in → 6 out ⇒ `[null×6]`), and later `$('X').item` on it throws `paired_item_no_info`.
   - explicit `pairedItem` from the node is never overwritten.
4. **Source is recorded per input** in `ITaskData.source[inputIndex] = { previousNode, previousNodeOutput, previousNodeRun }`; the start node has `source: []`.
5. **Output branch index is preserved**: `taskData.data.main[i]` is the i-th declared output; downstream `source.previousNodeOutput` equals that `i` (observed with a 2-output node).
6. **Empty output** (`[[]]`) is a valid success: task is stored with `main: [[]]`, `lastNodeExecuted` becomes that node, downstream nodes are **not** executed, run status `success`.
7. **`alwaysOutputData: true`** turns empty output into exactly one item `{ json: {}, pairedItem: [ {item, input} for every input item ] }` – the only place where `pairedItem` is produced as an **array** by the engine itself.
8. **Binary payload representation depends on binary-data mode, not on the item**:
   - `default` (in-memory) → `IBinaryData.data` is base64, `fileSize` pretty-printed, `bytes` set, **no `id`**
   - `filesystem` / `s3` → `id = "<mode>:<fileId>"`, `data = "<mode>"` (e.g. `"filesystem-v2"`), bytes are on disk under `workflows/<wf>/executions/<exec>/binary_data/<uuid>`; requires `executionId`.
   - readers must always go through `BinaryDataService.getAsBuffer(binaryData)` which branches on `id`.
9. **`binaryMode: 'combined'`** (workflow setting) moves binary references into `json._files` after execution (`convertBinaryData`) and makes the expression proxy return `item.json` instead of the full item. Default is `separate`.
10. **`IRunExecutionData` must be constructed via the factory** – it is a branded type; persisted v0 records are migrated on read.
11. `runIndex` for a node = `runData[node].length` at the time the node starts (0 for first run).

## 7. Dependencies

| Direction | Target | Why | Owner |
|---|---|---|---|
| Execution Data → Node Model | `INode` inside `IExecuteData.node`, `IPinData` keyed by node **name**, `ITaskData` keyed by node name | items are addressed by node name, not id | Agent 2 |
| Execution Data → Workflow | `IRunExecutionData.resultData.pinData` mirrors `workflow.pinData`; `IDestinationNode` in `startData` | Workflow carries pin data | Agent 1 |
| Execution Data → `@n8n/errors` / `ExecutionError` union | `ITaskData.error`, `INodeExecutionData.error` | error objects are embedded in data | shared |
| Execution Data → `luxon` | none in the structures; but `cleanupParameterData` turns `DateTime` into string before values land in items | – |
| Execution Data → `flatted` | persistence only (circular-safe JSON) | Agent 4 (persistence) |
| Execution Data → `BinaryDataService` (`@n8n/di` container) | resolving `IBinaryData.id` | n8n-core |

None of these are hidden: they are all visible in `interfaces.ts` imports.

## 8. Consumers of the boundary (external API surface that must stay stable)

```text
n8n-workflow exports  : INodeExecutionData, IPairedItemData, ISourceData, IBinaryData, IBinaryKeyData,
                        ITaskData, ITaskDataConnections, IRunData, IExecuteData, IRunExecutionData,
                        createRunExecutionData, createEmptyRunExecutionData, createErrorExecutionData,
                        migrateRunExecutionData, BINARY_ENCODING, BINARY_IN_JSON_PROPERTY, BINARY_MODE_*
n8n-core exports      : normalizeItems, returnJsonArray, constructExecutionMetaData, copyInputItems,
                        BinaryDataService, prepareBinaryData/setBinaryDataBuffer/getBinaryDataBuffer/assertBinaryData
```

## 9. Owns

- Type definitions listed in §3 and their JSON wire shape
- Version migration of `IRunExecutionData` (v0 → v1)
- Factories for `IRunExecutionData`
- Pure item helpers: `normalizeItems`, `returnJsonArray`, `constructExecutionMetaData`, `copyInputItems`
- Binary representation rules (inline base64 vs `id` reference) and `BINARY_*` constants
- The invariants in §6 as **contract** (even though rules 2, 3, 6, 7 are *enforced* by the engine)

## 10. Does NOT own

- ❌ The execution loop that decides *when* items are produced/consumed (`WorkflowExecute.processRunExecutionData`)
- ❌ `assignPairedItems` / input re-indexing **implementation** (lives in `workflow-execute.ts`; Execution Data owns the *rule*, engine owns the *code*). Moving it would be an engine change → out of scope.
- ❌ Node execution contexts / `getInputData()` plumbing
- ❌ Binary storage managers (filesystem, S3), pruning, lifecycle
- ❌ Persistence (`ExecutionRepository`, `flatted`)
- ❌ Expression evaluation (reads this data; see `expression.md`)
- ❌ Partial-execution graph utilities (`partial-execution-utils`)

## 11. Boundary decision

```text
┌────────────────────────────────────────────────────────────────┐
│ EXECUTION DATA LEGO  (n8n-workflow: interfaces + factories)    │
│  INodeExecutionData / IPairedItemData / ISourceData / IBinary… │
│  ITaskData / IRunData / IRunExecutionData(v1, branded)         │
│  + pure helpers in n8n-core/utils (normalizeItems, …)          │
└──────────────┬──────────────────────────────┬──────────────────┘
               │ read-only                    │ read+write
               ▼                              ▼
   EXPRESSION LEGO (WorkflowDataProxy)   EXECUTION ENGINE (WorkflowExecute)
                                          - re-indexes input pairedItem
                                          - assignPairedItems on output
                                          - records ISourceData
                                          - convertBinaryData (combined mode)
```

**Must stay together (documented, not forced apart):**

- `assignPairedItems` + input re-indexing are engine code but define the observable pairing contract. They are documented in the contract and covered by `03-item-pairing`; they were **not** extracted because that would modify `WorkflowExecute` (forbidden by task §5).
- `IRunExecutionData` is consumed by Expression (`$('X')`, `$node`), Engine and Persistence simultaneously. It is the shared contract object; no separate "expression view" was invented.
- `IBinaryData.id` resolution requires `BinaryDataService` (DI). The *shape* is Execution Data; the *resolution* is n8n-core. Kept as is.

**No source files in `reference/n8n` were modified.** The isolation is a boundary declaration (this doc + contract + tests), which is the maximum allowed without touching engine code.

## 12. Verification

| Check | Result |
|---|---|
| `tests/reference/harness` → `node run.js execution-data` | 7/7 PASS (real `n8n-core@2.9.1` engine) |
| filesystem binary mode probe (`id` reference) | observed manually, documented in §6.8 (not snapshotted – needs DI-initialised `BinaryDataService`) |
| Reference baseline 11/11 | **Unchanged** – `reference/n8n` sources untouched (`git diff --stat reference/` empty) |
| Live VPS (`157.10.160.95`) | **NOT REACHABLE from this sandbox** (connection refused/timeout). Live checklist left for the VPS pipeline; status therefore capped at `TESTED`, not `VERIFIED`. |
