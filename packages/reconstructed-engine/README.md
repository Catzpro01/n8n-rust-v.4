# @lego/reconstructed-engine

The n8n 2.9.4 **Workflow Execution Engine**, reconstructed in native JavaScript.

`PROJECT_RULES.md` rule 1 (ZERO RUST) requires a JavaScript/TypeScript/Node.js reconstruction,
1:1 from the n8n 2.9.4 source. This package replaces the former Rust prototype removed on
2026-09-17; see `docs/isolation/RUST-PURGE-RECORD.md`.

- **Contract:** [`contracts/execution-engine.contract.md`](../../contracts/execution-engine.contract.md),
  machine-checked by `test/contract-conformance.test.mjs`.
- **Provenance:** implemented behavior cites the corresponding n8n source lines. The contract suite
  verifies every citation against the pinned `reference/n8n/` tree.
- **Runtime parity:** 34 differential cases call the pinned real `n8n-core` / `n8n-workflow` 2.9.1
  runtime used by n8n 2.9.4.

## Reconstructed boundary

The package owns execution orchestration: exact automatic start selection, v0/v1 traversal order,
fan-in readiness, disabled and pinned nodes, retries and error routing, `alwaysOutputData`,
`executeOnce`, paired-item metadata, timeouts, wait-state parking/resume, run-data recording, and
graph traversal. Its `./partial` subpath also owns the in-memory graph/run-data planning primitives
already ported from `partial-execution-utils`.

It does not own node implementations, credentials, expression evaluation, persistence,
sub-workflows, AI/tool execution, or the scheduler that decides when to resume a parked execution.
The full partial-run orchestrator is not complete yet: `findStartNodes`, source-data grouping,
execution-stack recreation, graph rewiring, `DirectedGraph#toWorkflow`, and
`WorkflowExecute#runPartialWorkflow2` remain explicit follow-up work. See contract §7 and G28-G29.

## Layout

```text
runner.mjs                          execution engine + mapConnectionsByDestination
graph.mjs                           getConnectedNodes / getParentNodes / getHighestNode
partial.mjs                         partial-run graph and planning helpers
test/engine.test.mjs                70 behavior cases
test/graph-equivalence.test.mjs      4 graph-port parity cases
test/reference-equivalence.test.mjs 17 execution parity cases
test/partial-equivalence.test.mjs    8 partial-graph parity cases
test/partial-steps.test.mjs          7 partial-step unit/parity cases
test/contract-conformance.test.mjs   8 machine-checked contract cases
test-run.mjs                        console demo (not an assertion suite)
```

## Use the execution engine

```js
import { WorkflowExecutionEngine } from '@lego/reconstructed-engine';

const engine = new WorkflowExecutionEngine(workflowJson);
engine.registerNodeType('n8n-nodes-base.set', (node, items, ctx) => items, {
  inputs: ['main'],
  outputs: ['main'],
  requiredInputs: 1,
});

const result = await engine.runWorkflow(startNodeName, initialItems, {
  executionTimeoutTimestamp,
  pinData,
});

result.status;                 // 'success' | 'error' | 'canceled' | 'waiting'
result.resultData.runData;     // nodeName -> ITaskData[]
result.resultData.error;       // present when execution stopped on a node error
result.runExecutionData;       // persistence-ready snapshot, including parked state
```

A handler can park execution by calling `ctx.putExecutionToWait(date)`. Construct a new engine with
that saved `runExecutionData`, then call `processRunExecutionData()` to resume it.

## Use partial-run planning helpers

```js
import {
  DirectedGraph,
  filterDisabledNodes,
  findSubgraph,
  cleanRunData,
  handleCycles,
} from '@lego/reconstructed-engine/partial';

const graph = DirectedGraph.fromNodesAndConnections(workflowJson.nodes, workflowJson.connections);
const enabledGraph = filterDisabledNodes(graph);
```

The partial subpath performs no execution or external I/O. Full API and behavior guarantees are
specified in contract §§2 and 4.

## Verify

```bash
npm run engine:test
# 114 cases; the 34 parity cases may skip if the reference runtime is absent

npm run engine:test:strict
# 114/114 required; missing reference runtime is a hard failure

bash tests/integration/run_gate.sh --offline-only
# stage 3 invokes the strict suite
```

Install the pinned parity runtime before running the strict suite or integration gate:

```bash
scripts/setup-reference-runtime.sh
# n8n-workflow 2.9.1 + n8n-core 2.9.1 + n8n-nodes-base 2.9.1
```

The engine uses a declared local execution bound as a termination fail-safe. It is not a substitute
for n8n's complete loop-node/reset-data behavior, which remains a documented reconstruction gap.
