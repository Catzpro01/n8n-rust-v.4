# Execution LEGO — Phase 3 reconstruction record

**Status:** `IMPLEMENTED` · `TESTED` (122/122) · `GATE 14/14`
**Language:** JavaScript (Node.js ESM) — `PROJECT_RULES.md` v2.9.4 rule 1 (ZERO RUST, the JavaScript reconstruction track).
The Phase-3 opening record (`docs/isolation/PHASE-3-OPENING-RECORD.md`, 2026-09-17) permits Rust **only** under
`crates/**` + `apps/**` for the separate port track; this LEGO contributes no Rust and stays JavaScript either way.
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
| `TASK-EXPRESSION-SANDBOX-01` | bounded expression security boundary | `src/expression.mjs`, `src/expression-sandbox.mjs` |
| `TASK-428-phase3-wait-tracker` | waiting execution scheduling & resumption | `src/wait-tracker.mjs`, `src/workflow-helpers.mjs` |
| `TASK-430-phase3-active-executions` | active execution registry & lifecycle | `src/active-executions.mjs` |

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
| expression sandbox deny rules | `packages/workflow/src/expression-sandboxing.ts`, `expression-evaluator-proxy.ts` | — |
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
| `test/04-expression-sandbox.test.mjs` | 7 | typed/template evaluation, JS interpolation coercion, Node global denial, prototype escape denial, read-only data, timeout, DateTime methods |
| `test/05-activation.test.mjs` | 20 | activation lifecycle: TriggersAndPollers, ActiveWorkflows, TriggerContext, ScheduledTaskManager |
| `test/06-error-surface.test.mjs` | 7 | NodeOperationError/NodeApiError error surface, reflection, context |
| `test/07-wait-tracker.test.mjs` | 23 | WaitTracker DB polling, timer scheduling, startExecution guards, parent execution resumption, duplicate resume suppression, lifecycle, ISSUE-028 reference parity |
| `test/08-active-executions.test.mjs` | 10 | ActiveExecutions registry, persistence creation, concurrency reservations, waiting resumption lock, streaming chunks, stopExecution, shutdown |
| `test/09-workflow-runner.test.mjs` | 10 | WorkflowRunner execution lifecycle, run/runMainProcess, processError, timeout handling, streaming sendChunk callbacks, queue-mode enqueueExecution |
| `test/10-subworkflow-execution.test.mjs` | 12 | subworkflow start node discovery, input mapping (getRunData), context assembly (getBase), executeWorkflow execution & waiting return, error persistence |

```
$ cd packages/execution-engine && node --test test/*.test.mjs
# tests 122   # pass 122   # fail 0
$ node tools/execution-engine-gate.mjs
Execution LEGO gate: 14/14 PASS
```

## 5. Known deltas (must be closed before this LEGO is swapped for anything else)

1. **Expression syntax remains a subset of upstream**: dependency-free `node:vm` isolation adds
   code-generation denial, a read-only membrane, and a timeout, but Node.js explicitly does not
   treat `node:vm` as a hard security boundary. Keep workflows trusted until process/worker isolation
   lands. Multi-statement expressions and n8n extension-method rewriting remain unsupported.
2. No cancellation / timeouts, no engine requests (AI pause/resume), no partial execution, no binary
   conversion, no queue mode.
3. Legacy `forceInputNodeExecution` follows direct inputs only (no grandparent walk).
4. Trigger/poll hooks are invoked directly; the polling/webhook services are out of scope.
5. Data proxy omissions: `$vars`, `$secrets`, `$evaluateExpression`, data tables, `$fromAI`, full Luxon surface.
6. Monitoring/telemetry (`ErrorReporter`), `sendChunk` streaming and the `nodeExecuteAfter` variants for
   discarded stack entries are not emitted.

## 6. Rust confinement

Gate `E03` enforces the Phase-3 rule of `docs/isolation/PHASE-3-OPENING-RECORD.md` §2 — Rust is allowed
only inside `crates/**` and `apps/**` (plus the root workspace manifest) — and additionally proves the
JavaScript package contributes zero `.rs` / `Cargo.toml` files. `packages/execution-engine/manifest/rust-freeze.json`
records the workspace digest observed by this LEGO as *evidence* (not a freeze: the Rust port track may grow it).
`PROJECT_RULES.md` §1 ("ZERO RUST") still governs the reconstruction track; the Phase-3 amendment proposed in
that record is pending orchestrator ratification.

## 6b. Relationship to `packages/reconstructed-engine/`

The branch carries two engines and they are deliberately kept apart:

| | `packages/reconstructed-engine/` | `packages/execution-engine/` (this LEGO) |
| :--- | :--- | :--- |
| Origin | earlier prototype (`runner.mjs`, naive BFS queue) + `execution-context.mjs` added by the `reconstructed-engine:test` track | Phase-3 reconstruction of `workflow-execute.ts` |
| Fidelity | queue drains children as soon as one parent produced data; no waiting/join, no retry policy, no run-data shape, no pairing rules | line-mapped to the reference (see §2), run-data shape per `contracts/execution-data.contract.md` |
| Tests | `runner.test.mjs` 5/5 (smoke) | `test/*.test.mjs` 60/60 |
| Role | smoke harness only | the reference implementation of the JavaScript track |

They are **not** merged: the prototype's API (`WorkflowExecutionEngine#runWorkflow`) is used by no other
package, while the reconstructed surface follows n8n's own classes so later LEGOs can adopt it without a
translation layer. Removing or rewiring the prototype is a separate task (see `CROSS-AGENT-ISSUES.md` ISSUE-021).

## 7. Next

* Close caveat C1 of the Phase-2 verdict (re-run the 11/11 live smoke on the VPS + PostgreSQL baseline).
* Decide the fate of `packages/reconstructed-engine/` (ISSUE-021) so Phase 3 has a single engine track per language.
  Behaviour is no longer a tie-breaker: the differential harness reports `24 agree / 0 diverge` after
  `TASK-ENGINE-DIFF-02` closed S3/S6/S7 on both sides, so the choice is now about coverage
  (join/waiting/pin, 40 tests) versus keeping the prototype as a smoke harness.
* Add process/worker isolation before accepting untrusted expressions; extend syntax rewriting and proxy variables.
* Trigger/webhook/poll service LEGO (`triggers-and-pollers.ts`) so `run()` can be driven by real activations.
  **Done (TASK-ENGINE-ACTIVATION-01)**: `ActiveWorkflows`, `TriggersAndPollers`, `TriggerContext`,
  `ExecutionLifecycleHooks`, `toCronExpression` and the cron-free `ScheduledTaskManager` are reconstructed
  (gate `E10`, suite 20/20); what remains for a fully live instance is the runtime around them — the
  `cron` timer adapter, the webhook HTTP servers (`packages/cli/src/webhooks/**`) and instance leadership.
