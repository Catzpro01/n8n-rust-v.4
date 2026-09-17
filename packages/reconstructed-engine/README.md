# @lego/reconstructed-engine

The **Workflow Execution Engine** of n8n 2.9.4, reconstructed in JavaScript.

`PROJECT_RULES.md` rule 1 (ZERO RUST) requires the reconstruction to be JavaScript / TypeScript,
1:1 from the n8n 2.9.4 source — so this package exists instead of the Rust prototype that used to
live in `crates/` (removed 2026-09-17, see `docs/isolation/RUST-PURGE-RECORD.md`).

* **Contract:** [`contracts/execution-engine.contract.md`](../../contracts/execution-engine.contract.md)
  — machine-checked by `test/contract-conformance.test.mjs`.
* **Provenance:** every behaviour in the source cites the reference line it came from, e.g.
  `workflow-execute.ts:405-560`. The contract test verifies each citation still points inside the
  referenced file in `reference/n8n/`, so a reference upgrade breaks the build instead of silently
  invalidating the citations.

## Layout

```text
runner.mjs                        the engine (WorkflowExecutionEngine) + mapConnectionsByDestination
graph.mjs                         getConnectedNodes / getParentNodes — 1:1 ports
test/engine.test.mjs              45 behaviour cases
test/graph-equivalence.test.mjs    3 cases comparing the graph ports to the real n8n-workflow
test/reference-equivalence.test.mjs  7 cases running the same JSON through the real n8n-core
test/contract-conformance.test.mjs  7 cases holding the contract against the implementation
test-run.mjs                      console demo (not a test — no assertions; kept for history)
```

## Use

```js
import { WorkflowExecutionEngine } from '@lego/reconstructed-engine';

const engine = new WorkflowExecutionEngine(workflowJson); // { nodes, connections, settings?, pinData? }
engine.registerNodeType('n8n-nodes-base.set', (node, items, ctx) => items.map(/* … */), {
  requiredInputs: 1,          // optional; number or index list, like interfaces.ts:2355
  inputs: ['main'],
});

const result = await engine.runWorkflow(startNodeName, initialItems, {
  executionTimeoutTimestamp,  // optional
  pinData,                    // optional; overrides workflowJson.pinData
});

result.status;                      // 'success' | 'error' | 'canceled'
result.resultData.runData;          // nodeName -> ITaskData[]
result.resultData.error;            // set when the run stopped on a node error
```

## Verify

```bash
npm run engine:test                       # 56 cases (from the repository root)
bash tests/integration/run_gate.sh --offline-only   # the suite is stage 3 of the integration gate
```

The three equivalence files compare against the pinned reference runtime; they skip themselves when
it is not installed:

```bash
scripts/setup-reference-runtime.sh        # n8n-workflow / n8n-core / n8n-nodes-base 2.9.1
```

## What this is NOT

Node implementations, expressions (`{{ … }}`), credentials, persistence, `waitTill` resume,
sub-workflows and AI/routing nodes are **not** here — each belongs to another LEGO
(`contracts/expression.contract.md`, `credentials.contract.md`, `execution-data.contract.md`,
`persistence.contract.md`, `node.contract.md`). The full list is §7 of the contract and is asserted
by `test/contract-conformance.test.mjs`, so a non-goal cannot creep in unnoticed.
