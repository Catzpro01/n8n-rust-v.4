# LEGO Contract: Execution Data

**Derived from:** n8n 2.9.4 source (`packages/workflow/src/interfaces.ts`, `run-execution-data/*`, `run-execution-data-factory.ts`, `packages/core/src/execution-engine/workflow-execute.ts`, `binary-data/*`) and runtime observation (`tests/reference/execution-data/*`).
**Owner:** Agent 3
**Status:** TESTED

## 1. Data Schema

```typescript
type GenericValue = string | object | number | boolean | undefined | null;
interface IDataObject { [key: string]: GenericValue | IDataObject | GenericValue[] | IDataObject[]; }

interface IBinaryData {
  data: string;               // base64 payload, OR the storage mode name when `id` is set
  mimeType: string;
  fileType?: 'text' | 'json' | 'image' | 'audio' | 'video' | 'pdf' | 'html';
  fileName?: string;
  directory?: string;
  fileExtension?: string;
  fileSize?: string;          // human readable, e.g. "7 B"
  bytes?: number;
  id?: string;                // "<mode>:<fileId>" – present only when stored externally
}
interface IBinaryKeyData { [key: string]: IBinaryData; }

interface ISourceData {
  previousNode: string;       // node NAME
  previousNodeOutput?: number; // default 0
  previousNodeRun?: number;    // default 0
}

interface IPairedItemData {
  item: number;               // index into the input items of the producing node
  input?: number;             // input index, default 0
  sourceOverwrite?: ISourceData; // only for tool executions
}

interface INodeExecutionData {
  json: IDataObject;                                          // REQUIRED
  binary?: IBinaryKeyData;
  error?: NodeApiError | NodeOperationError;
  pairedItem?: IPairedItemData | IPairedItemData[] | number;  // number form is legacy; engine normalises to object
  metadata?: { subExecution: RelatedExecution };
  evaluationData?: Record<string, GenericValue>;
  sendMessage?: ChatNodeMessage;
  index?: number;                                             // deprecated
}

// One node output:  main[outputIndex][itemIndex]
type NodeOutput = INodeExecutionData[][];

interface ITaskDataConnections { [connectionType: string]: Array<INodeExecutionData[] | null>; }

interface ITaskData {
  startTime: number;
  executionIndex: number;
  executionTime: number;
  source: Array<ISourceData | null>;      // one entry per INPUT index; [] for start node
  executionStatus?: 'success' | 'error' | 'canceled' | 'running' | 'waiting' | ...;
  data?: ITaskDataConnections;            // outputs
  inputOverride?: ITaskDataConnections;
  error?: ExecutionError;
  hints?: NodeExecutionHint[];
  metadata?: ITaskMetadata;
}

interface IRunData { [nodeName: string]: ITaskData[]; }      // array index == runIndex

interface IExecuteData {
  node: INode;
  data: ITaskDataConnections;             // inputs
  source: ITaskDataConnectionsSource | null;
  metadata?: ITaskMetadata;
  runIndex?: number;
}

interface IRunExecutionData /* v1, branded */ {
  version: 1;
  startData?: { startNodes?: StartNodeData[]; destinationNode?: IDestinationNode; originalDestinationNode?: IDestinationNode; runNodeFilter?: string[] };
  resultData: { error?: ExecutionError; runData: IRunData; pinData?: IPinData; lastNodeExecuted?: string; metadata?: Record<string,string> };
  executionData?: { contextData: IExecuteContextData; runtimeData?: IExecutionContext; nodeExecutionStack: IExecuteData[]; metadata: Record<string, ITaskMetadata[]>; waitingExecution: IWaitingForExecution; waitingExecutionSource: IWaitingForExecutionSource | null };
  parentExecution?: RelatedExecution; validateSignature?: boolean; waitTill?: Date; pushRef?: string; manualData?: ...;
}
```

Constants: `BINARY_ENCODING = 'base64'`, `BINARY_IN_JSON_PROPERTY = '_files'`, `BINARY_MODE_SEPARATE = 'separate'` (default), `BINARY_MODE_COMBINED = 'combined'`.

## 2. Input

| Input | Producer | Shape |
|---|---|---|
| start item(s) | engine `run()` / trigger / webhook | `ITaskDataConnections` (`{ main: [[{json:{}}]] }` when no trigger data) |
| node output | node `execute()` | `INodeExecutionData[][] \| null` |
| helper input | node code | raw `IDataObject`(s) → `returnJsonArray` / `normalizeItems` |
| binary buffer/stream | node code | `prepareBinaryData(buffer, fileName?, mimeType?)` → `IBinaryData` |
| persisted record | `@n8n/db` | flatted JSON of any `IRunExecutionData` version → `migrateRunExecutionData` |

## 3. Output

- `IRunData` per execution (`resultData.runData`) with one `ITaskData` per node run.
- Per task: `data.main[outputIndex]` arrays whose items satisfy §1.
- `IRunExecutionData` v1 only (older versions are migrated on read).

## 4. Invariants (all observed in 2.9.4 runtime)

| # | Invariant | Evidence |
|---|---|---|
| I1 | Every item produced by helpers has a `json` object; `returnJsonArray`/`normalizeItems` never double-wrap an object that already has `json` | `07-item-helpers` |
| I2 | The engine does **not** validate arbitrary node output shape; a non-conforming item is stored as returned (plus `pairedItem`) | harness probe (documented) |
| I3 | Before a node executes, each input item's `pairedItem` is replaced by `{ item: <inputItemIndex>, input: <inputIndex \|\| undefined> }` (plus `sourceOverwrite` only for tool executions) | `03-item-pairing` (Echo) |
| I4 | Output `pairedItem` auto-assignment applies only to items **without** `pairedItem`: (a) 1 input item ⇒ `{item:0}`; (b) single branch, `out.length === in.length` ⇒ `{item:index}`; (c) single branch with 1 item and >1 inputs ⇒ `{item:0}`; (d) otherwise left `undefined` | `03-item-pairing` |
| I5 | Explicit `pairedItem` set by a node is never overwritten | `03-item-pairing` (ExplodePaired) |
| I6 | `ITaskData.source[i]` records `{previousNode, previousNodeOutput, previousNodeRun}` for input `i`; start node ⇒ `[]` | `01`, `04` |
| I7 | `data.main[k]` is the k-th declared output; consumers on that output record `previousNodeOutput = k` | `04-multiple-output` |
| I8 | Empty output `[[]]` is a successful task; downstream nodes do not run; `lastNodeExecuted` = that node; run status `success` | `05-empty-data` |
| I9 | `node.alwaysOutputData === true` converts empty output into one item `{ json: {}, pairedItem: [{item, input} for every input item] }` | `05-empty-data` |
| I10 | Binary in `default` mode: `data` = base64, `bytes`, `fileSize`, `fileType`, `fileExtension` set, no `id`. In `filesystem`/`s3`: `id = "<mode>:<fileId>"`, `data = "<mode>"`; original bytes retrievable via `getBinaryDataBuffer` / `BinaryDataService.getAsBuffer` | `06-binary-reference`, manual filesystem probe |
| I11 | `IRunExecutionData` is only created through `createRunExecutionData` / `createEmptyRunExecutionData` / `createErrorExecutionData` (branded type); `version` is `1` | factory source |
| I12 | `runIndex` of a new run = current `runData[node].length` | `workflow-execute.ts` L1556-1562 |
| I13 | Item order within a branch is preserved end-to-end | `02-multiple-items` |
| I14 | Node references inside execution data are by node **name** (`IRunData` keys, `ISourceData.previousNode`, `IPinData` keys) | interfaces |

## 5. Errors

| Situation | Behaviour |
|---|---|
| node throws / expression error during parameter resolution | task stored with `executionStatus: 'error'`, `error: ExecutionError`; `resultData.error` set; run `status: 'error'` |
| `continueOnFail` | error item `{ json: { error }, pairedItem }` on output 0 (engine) — not exercised in reference set |
| `IRunExecutionData` with unsupported version | `migrateRunExecutionData` throws `Unsupported IRunExecutionData version: <n>` |
| `normalizeItems` receives mixed json/non-json items | `ApplicationError('Inconsistent item format')` |
| binary `id` points to unknown mode | `BinaryDataService` throws (manager missing) |

## 6. Dependencies

- Node Model (Agent 2): `INode` in `IExecuteData`; node **name** as key (D-03/D-04 in `docs/isolation/dependencies.md`)
- Workflow (Agent 1): `pinData`, `settings.executionOrder`, `settings.binaryMode`, `IDestinationNode` (D-05)
- n8n-core: `BinaryDataService` for `id` resolution; `WorkflowExecute` enforces I3/I4/I8/I9 (D-06)
- `@n8n/db`: `flatted` serialisation + migration (D-07)
- `@n8n/errors`: `ExecutionError` union embedded in tasks/items

## 7. Ownership

| Owns | Does NOT own |
|---|---|
| all types in §1 and their wire shape | `WorkflowExecute` loop / scheduling |
| `IRunExecutionData` versioning + factories | `assignPairedItems` **code** (engine file) – only the rule |
| pure helpers `normalizeItems`, `returnJsonArray`, `constructExecutionMetaData`, `copyInputItems` | binary storage managers, pruning |
| `BINARY_*` constants and representation rules | persistence, queue, webhook, expression evaluation |

## 8. Registered consumers

| Consumer (owner) | Interface | Access | Seam |
|---|---|---|---|
| persistence-lego (agent-8, POOL-004) | `run-execution-data::migrateRunExecutionData` | read-only | pinned `n8n-workflow@2.9.1` (`src/consumed.mjs` deep import, identity machine-asserted); swaps to this LEGO port on merge (one import line) |

Registered per MSG-PERSIST-05 (acknowledged C3-MSG-08, TASK-409). No signature
change was requested. Stability commitment: the `migrateRunExecutionData`
signature and the §1 wire shapes it migrates are frozen; any future change
requires a contract revision plus advance notice to registered consumers.
