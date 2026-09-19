# LEGO 16 — EXECUTION (runtime) isolation record

| field | value |
| :--- | :--- |
| LEGO | `execution` |
| Owner | Agent 3 (phase 7, task `POOL-012`) |
| Reference | n8n `2.9.4`, upstream `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Contract | `contracts/execution.contract.md` |
| Package | `packages/execution-lego` |
| Engine | `packages/reconstructed-engine/src/execution-engine.ts` |
| Cycle | `DISCOVERED → ISOLATED → CONTRACTED → IMPLEMENTED → VERIFIED` |
| Rust | not started (rule §1) |

## 1. X-Ray

```text
anatomy/05-execution.md  (DISCOVERED, never contracted on any branch)

trigger / queue worker / webhook
        │
        ▼
ActiveExecutions.add(executionData[, id])
        ├ no id  → ExecutionPersistence.create → status 'new' → regular mode: setRunning
        ├ id     → updateExistingExecution(requireStatus 'waiting')  ──► ExecutionAlreadyResumingError
        └ entry  → {startedAt, postExecutePromise, status, responsePromise, httpResponse}
                      │
                      ├ WorkflowExecute (owned by @lego/workflow) drives the run
                      ├ push chunks: sendChunk → httpResponse.write(json + '\n')
                      └ finalize/stop → postExecutePromise settles → entry removed (waiting survives)

ActiveWorkflows.add(workflowId)
        ├ per trigger node   → TriggersAndPollers.runTrigger → {closeFunction}
        ├ per poll node      → run once (validate) → cron registered (first field * → UserError)
        └ failure            → WorkflowActivationError('There was a problem activating the workflow: "<msg>"')
              remove()       → deregister crons → close responses → TriggerCloseError tolerated,
                               anything else → WorkflowDeactivationError

ExecutionContextService.augmentExecutionContextWithHooks(workflow, startItem, context)
        ├ parameters = workflow node params ← overlayed with startItem.node params
        ├ hook registry (duplicate name → first wins)
        └ per hook: unknown → skip · throws → rethrow unless isAllowedToFail · contextUpdate → deepMerge

ExecutionRecoveryService
        ├ autoDeactivateWorkflowsIfNeeded → last N all crashed → deactivate + notify +
        │     push 'workflowAutoDeactivated' (UI + 1 s) + running|new → crashed(stoppedAt)
        └ recoverFromLogs → amend status/stoppedAt/data from n8n.node.* + n8n.workflow.* →
              push 'executionRecovered' (UI + 1 s) · followers no-op
```

## 2. Boundary

* **In:** `active-executions.ts`, `execution-recovery.service.ts`, `active-workflows.ts`,
  `execution-context.service.ts`, `execution-context-hook-registry.service.ts`, the execution/trigger
  error classes, `ARTIFICIAL_TASK_DATA`, the `executions.recovery` config defaults.
* **Out:** `scaling/**` (@lego/queue), `workflow-execute.ts` + `partial-execution-utils/**`
  (@lego/workflow, @lego/execution-data), `push/**` (@lego/realtime), `eventbus/**` (@lego/events),
  the Vue editor (never read or modified — rules §2), `crates/**`, `apps/**`.
* **Ports:** `P-EXECUTION-REGISTRY`, `P-EXECUTION-ACTIVATION`, `P-EXECUTION-CONTEXT`,
  `P-EXECUTION-RECOVERY`; consumed: `@lego/persistence`, `@lego/queue` (run seam), `@lego/events`,
  `@lego/realtime`.

## 3. Invariants (X1–X17)

Frozen in `contracts/execution.contract.md` §2. Every invariant is asserted by a test that also
re-reads the reference literal (`01-boundary.test.mjs`) or drives the reconstructed class
(`02-runtime.test.mjs`, `03-context-recovery.test.mjs`).

## 4. Evidence

```bash
cd packages/execution-lego && node --test test/*.test.mjs   # 32 tests, 32 pass
node tools/phase7-isolation-gate.mjs                        # H01..H08 PASS
```

* `docs/isolation/evidence/phase7-gate.json`
* `docs/isolation/PHASE-7-GATE.md`
* `results/POOL-012-execution-runtime-lego.md`

## 5. Deliberate deviations (documented, not hidden)

| # | deviation | reason |
| :--- | :--- | :--- |
| D1 | DI container replaced by constructor injection + `createExecutionRuntime()` | zero-dependency JS/TS; the port surface stays explicit |
| D2 | TypeORM repositories replaced by memory twins behind the same methods | the DB is a consumed port of this LEGO |
| D3 | `sleep`/timers are injected ports (defaults keep production timing) | the gate must not sleep in wall-clock time |
| D4 | `PCancelable` replaced by a `{ cancel }` seam | the run loop belongs to `@lego/workflow` |
| D5 | the post-execute promise keeps a no-op catch | a cancelled execution must not crash a Node test process; consumers still observe the rejection |
| D6 | `active-workflow-manager.ts` is represented by its activation seam (`add/remove` + error surface), not re-implemented | its licence/telemetry/ownership branches depend on subsystems that are not part of the runtime LEGO |

## 6. Drift back-fill (POOL-012)

`H08` audits a Phase-6 defect found while building this LEGO: `QUEUE_RECOVERY_DEFAULTS` had been
pinned to the **reference test fixture** (`interval: 10`, `batchSize: 5`) instead of the
`@n8n/config` defaults (`interval: 180`, `batchSize: 100`). The engine, the queue package test and
the new gate now all read the reference config, so the wrong pin cannot come back.
