# Execution Engine LEGO — standalone orchestration seam

**Component:** `packages/reconstructed-engine/runner.mjs`
**Phase:** Node.js reconstruction
**Reference:** n8n 2.9.4 `WorkflowExecute` execution anatomy

## Boundary

The execution LEGO consumes a workflow definition and a registry of node
handlers. It owns only the in-memory execution loop: selecting a start node,
waiting for all main inputs, routing output branches, recording task data,
retrying transient failures and applying `onError` policy.

It does not modify `reference/n8n/**`, load node packages, evaluate arbitrary
JavaScript expressions, persist executions or run a webhook/queue service.
Those dependencies remain behind the contracts listed in
[`contracts/execution.contract.md`](../../contracts/execution.contract.md).

## Ports

| port | provider | use |
|---|---|---|
| `P-NODE-HANDLER` | host/node catalog | registered function or `{ execute(context) }` adapter |
| `P-WORKFLOW-DEFINITION` | workflow LEGO | nodes and n8n-shaped `connections` |
| `P-EXECUTION-DATA` | execution-data contract | item, pairing and run-data wire shape |
| `P-EXPRESSION-RUNTIME` | expression LEGO | intentionally not imported; only the safe adapter subset is present |

## Verification evidence

The standalone test suite covers:

- output-index routing and fan-in synchronization;
- empty-output short-circuiting and `alwaysOutputData`;
- retry bounds and node execution context/data proxy access;
- `continueErrorOutput` and fatal `stopWorkflow` behavior;
- cycle protection and workflow validation.

Run it with:

```bash
npm run engine:test
npm run engine:run
```

The full reference isolation gate remains independent and continues to use the
pinned `reference/n8n` tree as its oracle.
