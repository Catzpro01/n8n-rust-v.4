# @reconstructed/engine — n8n 2.9.4 Execution Loop (native JS 1:1)

Native Node.js reconstruction of **`WorkflowExecute`**
(`reference/n8n/packages/core/src/execution-engine/workflow-execute.ts`, n8n 2.9.4) —
the node execution loop: **stack pop, run, output routing**.

- Behavioral spec (line-referenced deconstruction): `docs/isolation/execution-loop-spec.md`
- Module contract: `contracts/execution-engine.contract.md`
- Task records: `tasks/POOL-001-core-workflow-execute-loop.yaml`, `tasks/TASK-PIPE-02.yaml`
- Rules: `PROJECT_RULES.md` — **ZERO RUST**, JS/TS 1:1 from n8n v2.9.4 source.

## Layout

| File | Role |
| :--- | :--- |
| `src/workflow-execute.mjs` | **The loop** — 1:1 port of `processRunExecutionData` + `runNode` dispatch + `addNodeToBeExecuted` + waiting-nodes drain + finalization. Every block cites reference lines (`WEX:<lines>`). |
| `src/run-execution-data.mjs` | 1:1 port of `createRunExecutionData` (`n8n-workflow/run-execution-data-factory.ts`). |
| `src/workflow-scaffold.mjs` | Minimal `Workflow` surface for running the loop (1:1 ports of `mapConnectionsByDestination`, `getConnectedNodes`, `getHighestNode`, `getStartNode`). **Temporary** until TASK-PIPE-01 lands. |
| `src/hooks.mjs` | Lifecycle hook runner (same call order/await semantics the loop relies on). |
| `test/execution-loop.test.mjs` | 30 conformance tests encoding the 15 spec invariants + v0/v1 ordering + join/drain + engine requests. |
| `runner.mjs`, `test-run.mjs` | Pre-existing naive DAG runner from the earlier session (kept runnable; superseded by `src/`). |

## Usage

```javascript
import { WorkflowExecute } from '@reconstructed/engine';
import { createWorkflow } from '@reconstructed/engine/workflow-scaffold';
import { createLifecycleHooks } from '@reconstructed/engine/hooks';

const workflow = createWorkflow({
  nodes: [{ id: '1', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {}, disabled: false }],
  connections: { Start: { main: [[{ node: 'Next', type: 'main', index: 0 }]] } },
  nodeTypes: new Map(),
  settings: { executionOrder: 'v1' },
});

const executor = new WorkflowExecute(
  { hooks: createLifecycleHooks({}), currentNodeExecutionIndex: 0, executionId: 'run-1' },
  'manual',
);
const fullRunData = await executor.run({ workflow }); // IRun
// executor.cancel() mirrors PCancelable onCancel
```

## Test

```bash
node --test test/execution-loop.test.mjs   # 30/30 PASS
node test-run.mjs                          # legacy naive runner still green
```

## Status & documented deviations

1:1: stack discipline, dispatch order, retry policy, pinData, error/waiting/destination
semantics, output routing with the v0/v1 fork, multi-input join (`waitingExecution`), drain with
`requiredInputs`, runData recording, pairedItem handling, hook order, cancellation.

Deviations (each owned by a later pipeline task):

| Deviation | Reason | Follow-up |
| :--- | :--- | :--- |
| `PCancelable` → Promise + `.cancel()` | no p-cancelable dependency in native reconstruction | — (behavior preserved, incl. `workflowExecuteAfter` on cancel) |
| `establishExecutionContext`, Sentry, DI Container, Logger | infrastructure outside the loop | host-injected no-op logger |
| `convertBinaryData` passthrough | binary streaming not in PIPE-02 scope | binary support task |
| minimal `ExecuteContext` (`getInputData`/`getAllInputData`/`getNodeParameter`) | full data-proxy surface is expression territory | TASK-PIPE-13 |
| `checkReadyForExecution` checks node-type existence only | parameter-issue checks need NodeHelpers + full descriptions | node registry task (PIPE-06) |
| `requiredInputs` expressions resolve literal JSON only | no expression engine yet | TASK-PIPE-13 |
| declarative (`requestDefaults`) nodes throw "no execute function" | `RoutingNode` not reconstructed | PIPE-07/09 node work |
