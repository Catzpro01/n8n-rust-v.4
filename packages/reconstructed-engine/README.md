# @lego/reconstructed-engine

The n8n 2.9.4 **Workflow Execution Engine**, reconstructed in native JavaScript.

`PROJECT_RULES.md` rule 1 (ZERO RUST) requires a JavaScript/TypeScript/Node.js reconstruction,
1:1 from the n8n 2.9.4 source. This package replaces the former Rust prototype removed on
2026-09-17; see `docs/isolation/RUST-PURGE-RECORD.md`.

- **Contract:** [`contracts/execution-engine.contract.md`](../../contracts/execution-engine.contract.md),
  machine-checked by `test/contract-conformance.test.mjs`.
- **Provenance:** implemented behavior cites the corresponding n8n source lines. The contract suite
  verifies every citation against the pinned `reference/n8n/` tree.
- **Runtime parity:** 17 cases execute the same workflows against the reconstructed engine and the
  pinned real `n8n-core` / `n8n-workflow` 2.9.1 runtime used by n8n 2.9.4.

## Reconstructed boundary

The package owns execution orchestration: exact automatic start selection, v0/v1 traversal order,
fan-in readiness, disabled and pinned nodes, retries and error routing, `alwaysOutputData`,
`executeOnce`, paired-item metadata, timeouts, wait-state parking/resume, run-data recording, and
graph traversal helpers. It does not own node implementations, credentials, expression evaluation,
persistence, sub-workflows, AI/tool routing, or the scheduler that decides when to resume a parked
execution. See contract §7 for the complete enforced non-goal list.

## Layout

```text
runner.mjs                          engine + mapConnectionsByDestination
graph.mjs                           getConnectedNodes / getParentNodes / getHighestNode
test/engine.test.mjs                70 behavior cases
test/graph-equivalence.test.mjs      4 graph-port parity cases
test/reference-equivalence.test.mjs 17 real-engine parity cases
test/contract-conformance.test.mjs   7 machine-checked contract cases
test-run.mjs                        console demo (not an assertion suite)
```

## Use

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
that saved `runExecutionData`, then call `processRunExecutionData()` to resume it. Full usage and
state-shape guarantees are specified in contract §§2–4.

## Verify

```bash
npm run engine:test
# 98 cases; the 21 parity cases may skip if the reference runtime is absent

npm run engine:test:strict
# 98/98 required; missing reference runtime is a hard failure

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
