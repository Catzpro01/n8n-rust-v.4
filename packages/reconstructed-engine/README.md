# `@lego/reconstructed-engine` — EXECUTION ENGINE LEGO

Reconstructed n8n 2.9.4 DAG execution engine (reference: `reference/n8n/packages/core/src/execution-engine/`).
This package is the **single execution engine** of the TypeScript baseline: `apps/n8n-ts` maps HTTP to
this entrypoint and contains no execution loop of its own.

Contract: [`contracts/runtime-api.contract.md`](../../contracts/runtime-api.contract.md) §5.

## Entrypoint (frozen)

```js
import {
  ENGINE_PACKAGE,            // '@lego/reconstructed-engine'
  ENGINE_VERSION,
  NODE_REGISTRY_VERSION,
  createNodeRegistry,        // () => { handlers, list(), has(), get(), info(), register(), takeWarnings() }
  createWorkflowEngine,      // (definition, opts) => engine
  runWorkflowDefinition,     // (definition, opts) => Promise<rowResult>
  validateWorkflowDefinition,// (definition, opts) => { ok, errors, warnings, normalized }
  listNodeTypes,             // (opts) => NodeTypeInfo[]
  WorkflowRunError,          // error.code ∈ EMPTY_WORKFLOW | INVALID_WORKFLOW
} from '@lego/reconstructed-engine';
```

Sub-paths (`./runner`, `./node-registry`, `./validation`, `./node-catalog`, `./localization`) exist for
tests and tooling; application code must import the root entrypoint.

## Run a workflow

```js
const result = await runWorkflowDefinition(
  { nodes: [{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} }], connections: {} },
  { input: [{ json: { seed: 1 } }], locale: 'id' },
);

// {
//   status: 'COMPLETED', finished: true,
//   executionLog: [{ node, type, inputCount, outputCount, durationMs, status, nodeLabel? }],
//   data: { 'Manual Trigger': [{ json: { seed: 1 } }] },
//   warnings: [{ code, message, node? }],
//   statusText: 'Selesai'          // additive human-facing text, machine fields untouched
// }
```

`data` is exactly what the node handlers produced — the locale layer is restricted to response
metadata (`statusText`, `executionLog[].statusText`, `nodeLabel`), so user payloads are never rewritten.

## `opts`

| Option | Type | Default | Meaning |
| :--- | :--- | :--- | :--- |
| `startNode` | `string \| null` | `null` | entry node (trigger auto-detected otherwise) |
| `input` | `[{json}]` \| bare object | `[{}]` | seed items; `{json}` wrappers are unwrapped |
| `locale` | `id\|jv\|ar\|zh\|ru\|en` | `id` | response metadata locale |
| `allowCodeEval` | `boolean` | `false` | enable the restricted `node:vm` sandbox for `code`/`function` nodes |
| `registry` | registry | built-in | inject a custom registry |
| `onWarning` | `(w) => void` | `null` | streaming warning sink |

## Validation → HTTP mapping (applied by the runtime, not here)

| Validation result | HTTP |
| :--- | :--- |
| `EMPTY_WORKFLOW` | `422 EMPTY_WORKFLOW` |
| `INVALID_WORKFLOW` | `422 INVALID_WORKFLOW` (bad shape/duplicates) |
| warning `UNKNOWN_NODE_TYPE` | `200` + warning (or `422 UNKNOWN_NODE` under `N8N_TS_UNKNOWN_NODE_POLICY=error`) |
| warning `UNKNOWN_CONNECTION_TARGET` | `200` + warning (or `422 UNKNOWN_CONNECTION` under the strict policy) |

## Built-in node handlers (baseline)

| Type | Behaviour |
| :--- | :--- |
| `n8n-nodes-base.manualTrigger`, `n8n-nodes-base.start` | seeds the run with the input items (default `[{}]`) |
| `n8n-nodes-base.noOp` | identity |
| `n8n-nodes-base.set` | literal assignments, legacy `values.*` and 2.x `assignments.assignments`, `includeOtherFields`/`keepOnlySet` |
| `n8n-nodes-base.code`, `function`, `functionItem` | restricted sandbox when `allowCodeEval`, otherwise deterministic passthrough + `CODE_EVAL_DISABLED` warning |

**Not implemented (explicit, never silent):** expression evaluation (`= {{ … }}` → value used verbatim +
`EXPRESSION_NOT_EVALUATED`), router nodes (`if`, `switch`, `merge`), HTTP/credential nodes,
webhook/schedule triggers. Those node types fall through the unknown-node policy so an operator sees a warning.

## Warning vocabulary

`UNKNOWN_NODE_TYPE`, `UNKNOWN_CONNECTION_TARGET`, `UNKNOWN_CONNECTION_SOURCE`, `EXPRESSION_NOT_EVALUATED`,
`CODE_EVAL_DISABLED`, `CODE_EVAL_NO_RETURN`, `NODE_EXECUTED_AS_PASSTHROUGH`.

## Guarantees

* **Deterministic** — no clock reads, no randomness, no network in handlers; identical input ⇒ identical `data`.
* **Non-mutating** — validation and normalization never touch the caller's definition.
* **No I/O** — the package never writes files or opens sockets.
* **Single engine** — `runner.mjs` (the reconstructed DAG loop) is the only execution loop in the repository's TS side.

## Tests

```bash
node --test packages/reconstructed-engine/test/*.test.mjs   # 29 unit tests
node packages/reconstructed-engine/test-run.mjs             # legacy smoke run (kept working)
```
