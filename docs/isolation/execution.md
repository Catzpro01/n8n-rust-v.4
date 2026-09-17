# Execution LEGO — Phase 3 reconstruction record

**Status:** `IMPLEMENTED` · `TESTED` (32/32) · `GATE 8/8`
**Language:** JavaScript (Node.js ESM) — `PROJECT_RULES.md` v2.9.4 rule 1 (ZERO RUST)
**Package:** `packages/execution-engine` (`@lego/execution-engine`, zero dependencies)
**Contract:** [`contracts/execution.contract.md`](../../contracts/execution.contract.md)
**Gate:** `node tools/execution-engine-gate.mjs` → `docs/isolation/evidence/execution-engine-gate.json`
**Reference:** n8n `2.9.4` @ `b6dc2787c45677a29a9612cd27eb911302961a83` (read-only, unmodified)

---

## 1. What was reconstructed

The three open pool tasks of the execution LEGO:

| Pool task | Scope | Module |
| :--- | :--- | :--- |
| `POOL-001-core-workflow-execute-loop` | the execute loop | `src/workflow-execute.mjs`, `src/execution-stack.mjs`, `src/run-execution-data.mjs` |
| `POOL-002-node-execution-context-data-proxy` | node context + data proxy | `src/node-execution-context.mjs`, `src/data-proxy.mjs`, `src/expression.mjs` |
| `POOL-003-error-retry-handling` | retry + error policy | `src/retry.mjs`, `src/error-handling.mjs`, `src/errors.mjs` |

## 2. Source mapping (verified against the reference, not assumed)

| Reconstructed piece | Reference file | Lines |
| :--- | :--- | :--- |
| `run()` — start node, run filter, stack seeding | `packages/core/src/execution-engine/workflow-execute.ts` | 123-180 |
| `incomingConnectionIsEmpty`, `prepareWaitingToExecution`, `addNodeToBeExecuted` | same | 359-830 |
| `handleDisabledNode`, `prepareConnectionInputData`, `rethrowLastNodeError`, `handleExecuteOnce` | same | 911-1003 |
| `executeNode` | same | 1004-1077 |
| `runNode` | same | 1186-1270 |
| `handleWaitingState` | same | 1285-1304 |
| `processRunExecutionData` (main loop, retry, task data, error stop) | same | 1403-2315 |
| `ensureInputData` | same | 2315-2357 |
| `handleNodeErrorOutput` | same | 2463-2570 |
| `assignPairedItems` | same | 2581-2645 |
| `getInputData` / `getInputItems` | `.../node-execution-context/{execute-context,base-execute-context}.ts` | — |
| `returnJsonArray`, `normalizeItems`, `constructExecutionMetaData`, `copyInputItems` | `.../node-execution-context/utils/*.ts` | — |
| `$json/$node/$items/$input/$prevNode/$env/$now` | `packages/workflow/src/workflow-data-proxy.ts` | — |
| retry clamps | `workflow-execute.ts` | 1597-1612 |
| error strategies | `workflow-execute.ts` | 1707, 1843-1865, 1934-1958 |
| error classes | `packages/workflow/src/errors/*.ts` | — |
| `connectionsByDestinationNode`, `getHighestNode`, `getParentNodes` | `packages/workflow/src/workflow.ts` | ~230, ~700 |
| run data factories | `packages/workflow/src/run-execution-data-factory.ts` | — |

## 3. Boundary

* The package imports **only** relative paths and `node:` builtins (gate `E02`), and nothing from
  `reference/n8n` at runtime — the reference is a behavioural specification, not a dependency.
* The Workflow *model* stays owned by the Phase-2 LEGO (`packages/workflow-lego`, `contracts/workflow.contract.md`);
  `src/workflow.mjs` is an injected carrier for the fields the loop reads (`nodes`, `connections`,
  `connectionsByDestinationNode`, `settings`, `nodeTypes`, `getStartNode/getHighestNode/getParentNodes`),
  not a second model implementation.
* Nodes are injected as plain definitions (`{ description, execute, trigger, poll, webhook }`) — the
  Node LEGO owns the catalogue.
* Run data shape follows `contracts/execution-data.contract.md` (invariants I3, I4, I6-I9, I11-I13 are
  asserted by the suites).

## 4. Test evidence

| Suite | Tests | Covers |
| :--- | :--- | :--- |
| `test/01-execution-loop.test.mjs` | 14 | linear chain, item order/pairing, multiple outputs, empty output (I8), `alwaysOutputData` (I9), `null` branch, `executeOnce`, destination filter, 2-input join, pin data, runIndex (I12), endless-loop guard, hooks, disabled node |
| `test/02-node-context-data-proxy.test.mjs` | 7 | input data/source data, parameter resolution (literals, templates, typed expressions, nested, per item, fallback), `$json/$node/$items/$input/$prevNode/$env/$now/$today/$runIndex/$itemIndex/$binary`, helpers, standalone context/proxy, error surfaces |
| `test/03-error-retry.test.mjs` | 11 | retry clamps, retry-on-throw, soft-failure retry, pinned "unrecovered soft failure stays success" quirk, stop-the-workflow, `continueRegularOutput`, legacy `continueOnFail`, `continueErrorOutput` split with paired-item merge, error-item normalisation, `withRetry`, error classes |

```
$ cd packages/execution-engine && node --test test/*.test.mjs
# tests 32   # pass 32   # fail 0
$ node tools/execution-engine-gate.mjs
Execution LEGO gate: 8/8 PASS
```

## 5. Known deltas (must be closed before this LEGO is swapped for anything else)

1. **Expression evaluation is a JS subset without the upstream sandbox** (`expression-sandboxing.ts`
   / JEXL allow-lists). Until the sandbox lands, this engine must not be pointed at untrusted workflows.
2. No cancellation / timeouts, no engine requests (AI pause/resume), no partial execution, no binary
   conversion, no queue mode.
3. Legacy `forceInputNodeExecution` follows direct inputs only (no grandparent walk).
4. Trigger/poll hooks are invoked directly; the polling/webhook services are out of scope.
5. Data proxy omissions: `$vars`, `$secrets`, `$evaluateExpression`, data tables, `$fromAI`, full Luxon surface.
6. Monitoring/telemetry (`ErrorReporter`), `sendChunk` streaming and the `nodeExecuteAfter` variants for
   discarded stack entries are not emitted.

## 6. Rust guard

`crates/` and `apps/` contain legacy Rust sources from an earlier project phase and are **frozen**:
gate `E03` records a digest of every file under both trees in
`packages/execution-engine/manifest/rust-freeze.json` and fails if anything is added or removed.
The execution LEGO itself contributes zero `.rs` / `Cargo.toml` files. Per `PROJECT_RULES.md` v2.9.4,
the reconstruction continues in JavaScript/TypeScript until Phase 3 is formally reopened for Rust.

## 7. Next

* Close caveat C1 of the Phase-2 verdict (re-run the 11/11 live smoke on the VPS + PostgreSQL baseline).
* Sandboxed expression evaluator LEGO (removes delta 1) — required before any untrusted workflow runs.
* Trigger/webhook/poll service LEGO (`triggers-and-pollers.ts`) so `run()` can be driven by real activations.
