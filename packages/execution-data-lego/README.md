# @lego/execution-data — Execution Data LEGO

Passive data model that flows between nodes and is persisted per execution.

**Status:** ISOLATED → VERIFIED (Phase 3)
**Owner:** Agent 3
**Reference:** n8n 2.9.4 `packages/workflow/src/interfaces.ts`, `run-execution-data/*`, `run-execution-data-factory.ts`

## Owns

- `INodeExecutionData` (json REQUIRED, binary, error, pairedItem, metadata)
- `IBinaryData` (base64 vs storage id modes)
- `IPairedItemData` (item, input, sourceOverwrite)
- `ISourceData` (previousNode, previousNodeOutput, previousNodeRun)
- `ITaskDataConnections`, `ITaskData`, `IRunData`, `IExecuteData`, `IRunExecutionData` v1
- Factories `createRunExecutionData`, `createEmptyRunExecutionData`, `createErrorExecutionData`
- Helpers `normalizeItems`, `returnJsonArray`, `constructExecutionMetaData`, `copyInputItems`
- Constants `BINARY_ENCODING`, `BINARY_IN_JSON_PROPERTY`, `BINARY_MODE_SEPARATE/COMBINED`
- Invariants I1-I14 (observed runtime)

## Does NOT own

- `WorkflowExecute` loop/scheduling (engine)
- `assignPairedItems` code (engine-owned, only rule documented)
- Binary storage managers, pruning, persistence, queue, webhook, expression evaluation

## Invariants (tested)

I1 json always present via helpers, but engine does not validate arbitrary output
I3 Input pairedItem re-indexed before execution to {item:inputIndex}
I4 Output pairedItem auto-assignment: 1 input→{0}, single branch out==in→{index}, 1 item + >1 inputs→{0}, else undefined
I6 source per input records previousNode/output/run
I8 Empty output [[]] valid success, downstream not run
I9 alwaysOutputData true converts empty to {json:{}, pairedItem: [...]}
I10 Binary default mode base64, filesystem/s3 id = "<mode>:<fileId>", data = "<mode>"
I11 IRunExecutionData only via factories, version 1
I13 Item order preserved end-to-end
I14 Node references by name
