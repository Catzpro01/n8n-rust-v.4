# W4 — LEGO Integration (`data-plane/ts1-lego-integration`)

Contract: [`contracts/runtime-api.contract.md`](../../contracts/runtime-api.contract.md) §5.
Goal: the runtime consumes the **existing** LEGOs; **no second execution engine** is created anywhere.

## ALLOWED

```
packages/reconstructed-engine/**
docs/lego-integration.md
```

## FORBIDDEN

```
apps/**  tests/**  scripts/**  deploy/**  contracts/**  crates/**  apps/n8n-rust/**
reference/n8n/**  packages/workflow-lego/src/**  packages/execution-lego/src/**
packages/workflow-lego/test/**  packages/execution-lego/test/**
packages/*-lego/manifest/**  .github/**  .arena/**  tools/**
```

Read-only (audit targets, must not be modified): `packages/workflow-lego/**`, `packages/execution-lego/**`, `packages/{events,queue,realtime}-lego/**`, `tools/workflow-isolation-extract.mjs`.

## Deliverables

| Path | Purpose |
| :--- | :--- |
| `packages/reconstructed-engine/index.mjs` | the **only** entrypoint the runtime imports; re-exports the §5 surface (`ENGINE_PACKAGE`, `ENGINE_VERSION`, `NODE_REGISTRY_VERSION`, `createNodeRegistry`, `createWorkflowEngine`, `runWorkflowDefinition`, `validateWorkflowDefinition`, `listNodeTypes`, `WorkflowRunError`) |
| `packages/reconstructed-engine/node-registry.mjs` | built-in node handler registry: `manualTrigger`, `start`, `noOp`, `set` (restricted `values` subset), `code`/`function` (deterministic passthrough when `allowCodeEval=false`, restricted `node:vm` eval when explicitly enabled), each with group/label/description metadata; deterministic output only (no `Date.now()`/random inside handlers unless parameterised) |
| `packages/reconstructed-engine/validation.mjs` | `validateWorkflowDefinition` + `WorkflowRunError` per contract §5; empty nodes → `EMPTY_WORKFLOW`, duplicate names / bad shapes → `INVALID_WORKFLOW`, unknown node types and dangling connections become **warnings** (policy is applied by the runtime layer) |
| `packages/reconstructed-engine/package.json` | package metadata (`@lego/reconstructed-engine`, version, `type: module`, `exports` map, no dependencies) |
| `packages/reconstructed-engine/test/*.test.mjs` | unit coverage for registry, validation, run wrapper (including determinism and the `allowCodeEval` gate) |
| `packages/reconstructed-engine/README.md` | entrypoint documentation: signatures, examples, guarantees |
| `docs/lego-integration.md` | audit report: which LEGO owns what, how the runtime consumes it, why `workflow-lego`/`execution-lego` are boundary/type LEGOs today, the single-engine proof, and the migration path to Rust |

## Hard requirements

1. `runner.mjs`, `node-catalog.mjs`, `localization.mjs` stay behaviour-compatible — extend, never fork. `test-run.mjs` must keep working.
2. No new runtime dependencies; no HTTP, no filesystem side effects inside the engine package.
3. Handlers are deterministic (tests must be able to assert exact outputs) and never call the network.
4. `validateWorkflowDefinition` must never mutate the input definition.
5. Audit findings that require other workers' files must be reported, not patched (`docs/workers/CONTRACT-REQUESTS.md` equivalent note in the PR).
