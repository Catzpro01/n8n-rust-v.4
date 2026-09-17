# LEGO Contract: Execution Engine Loop

| Field | Value |
| :--- | :--- |
| Owner | Execution pipeline — TASK-PIPE-02 (worker `arena/01a0adc8-n8n-rust-v-4`) |
| LEGO | `execution-engine` — node dispatch loop (stack pop, run, output routing) |
| Status | Phase 3 — `IMPLEMENTED (NODE.JS)` · 30/30 conformance tests PASS · consensus pending |
| Reference | n8n `2.9.4` — `reference/n8n`, upstream `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Reference source | `packages/core/src/execution-engine/workflow-execute.ts` (2,655 lines) |
| Behavioral spec | `docs/isolation/execution-loop-spec.md` (POOL-001, line-referenced) |
| Native reconstruction | `packages/reconstructed-engine/src/workflow-execute.mjs` |
| Rust | **FORBIDDEN** — `PROJECT_RULES.md` rule 1 (ZERO RUST, v2.9.4 native) |

## 1. Purpose

Own the serial node-dispatch loop of n8n: pop a node execution off the stack, run exactly one
node at a time, record run data, and push downstream partners back onto the stack (directly for
single-input destinations, via the waiting queue for multi-input joins). This LEGO is the
scheduler; it never contains node business logic.

## 2. Provided interface

```javascript
new WorkflowExecute(additionalData, mode, runExecutionData?, storedAt?)
  .run({ workflow, startNode?, destinationNode?, pinData?, triggerToStartFrom?, additionalRunFilterNodes? }) // -> Promise<IRun> with .cancel()
  .processRunExecutionData(workflow) // -> Promise<IRun> with .cancel() (resume entry point)
```

`workflow` must expose the `n8n-workflow` surface consumed by the loop: `nodes` (name map),
`nodeTypes.getByNameAndVersion`, `connectionsBySourceNode`, `connectionsByDestinationNode`,
`getNode`, `getStartNode`, `getHighestNode`, `getParentNodes`, `getChildNodes`, `settings`,
`staticData`. Until TASK-PIPE-01 lands, `packages/reconstructed-engine/src/workflow-scaffold.mjs`
supplies a scaffold with 1:1-ported helpers (`mapConnectionsByDestination`, `getConnectedNodes`,
`getHighestNode`, `getStartNode`).

## 3. Responsibilities

- Stack discipline: pop `shift()` (front); defer → `push` (back); error-resume & wait-resume →
  `unshift` (front); v1 enqueue → `unshift` (LIFO/depth-first), v0 → `push` (FIFO/breadth-first).
- `runNode` dispatch order: disabled → execute → poll → trigger → webhook → declarative.
- Retry policy: `retryOnFail` (maxTries clamp 2–5, default 3; waitBetweenTries clamp 0–5000 ms,
  default 1000) plus the soft-failure `json.error` re-run loop.
- Output routing: only non-empty `main` outputs enqueue downstream (v0 forces second inputs);
  v1 sorts siblings top-left-first; multi-input destinations join through
  `waitingExecution`/`waitingExecutionSource` and the waiting-nodes drain with `requiredInputs`.
- Error semantics: `continueOnFail`/`onError` passthrough vs hard fail (record error, re-queue
  node at stack front, stop).
- `waitTill` pause/resume, `destinationNode` partial execution, `runNodeFilter` pruning.
- Run-data recording (`ITaskData` per node per runIndex) and `pairedItem` pre-assignment +
  `assignPairedItems` auto-fix.
- Hook order: `workflowExecuteBefore|Resume` → per node `nodeExecuteBefore` → `nodeExecuteAfter`
  → `workflowExecuteAfter`; `sendChunk` on node error.

## 4. Non-responsibilities

- Node implementations (Agent 2 / nodes-base), expression evaluation (PIPE-13 `WorkflowDataProxy`),
- persistence of executions (Agent 5; hooks only), trigger/webhook registration (trigger/webhook LEGOs),
- transport, queueing, UI.

## 5. Dependencies

| Direction | Consumer → Provider | Interface |
| :--- | :--- | :--- |
| in | execution-engine → workflow model | `Workflow` surface (§2), TASK-PIPE-01 |
| in | execution-engine → node registry | `nodeTypes.getByNameAndVersion(type, typeVersion)` — returns `{description, execute?}` |
| in | execution-engine → node implementations | `nodeType.execute(context)` — minimal context: `getInputData`, `getAllInputData`, `getNodeParameter`, `runExecutionData`, `abortSignal`, `hints` |
| out | execution-engine → hooks (host) | lifecycle hook calls (§3) |
| shared | IRunExecutionData / IExecuteData / ITaskData shapes | `n8n-workflow` interfaces (spec §2) |

## 6. Error behavior

| Case | Behavior (reference lines) |
| :--- | :--- |
| No start node | throw `No node to start the workflow from could be found` (WEX:133-137) |
| Workflow issues (unknown node type) | throw `WorkflowHasIssuesError` synchronously before the loop (WEX:1405) |
| Destination node of a connection missing | `ApplicationError('Destination node not found')` (WEX:1990-2001) |
| Same node:runIndex deferred twice | `Stopped execution because it seems to be in an endless loops` (WEX:1562-1568) |
| Node throws, no continue flags | error recorded, node re-queued front, status `error` (WEX:1858-1877) |
| Node throws with continue flags | input passthrough, run recorded `error`, execution continues (WEX:1843-1856) |
| Timeout timestamp reached | status `canceled`, `timedOut=true` (WEX:1489-1494) |

## 7. Compatibility requirements

1. The 15 behavioral invariants of `docs/isolation/execution-loop-spec.md` §7 must keep passing
   (`node --test packages/reconstructed-engine/test/`).
2. Any behavior change must cite the n8n 2.9.4 source line that justifies it.
3. Known deviations are listed in `packages/reconstructed-engine/src/workflow-execute.mjs`
   (header) and must each carry a follow-up owner (e.g. expression resolution → PIPE-13,
   binary streaming, declarative RoutingNode).

## 8. Lifecycle

`DISCOVERED` (POOL-001 spec) → `CONTRACTED` (this document) → `IMPLEMENTED (NODE.JS)`
(PIPE-02, 30/30) → `VERIFIED` (consensus 2 votes + differential A/B against live n8n 2.9.4)
→ `INTEGRATED`.
