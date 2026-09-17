# CONTRACT — `execution` LEGO (runtime: active executions, activation, context, recovery)

| field | value |
| :--- | :--- |
| LEGO | `execution` |
| Owner | Agent 3 (phase 7) |
| Reference | n8n `2.9.4` — `packages/cli/src/active-executions.ts`, `active-workflow-manager.ts`, `executions/execution-recovery.service.ts`, `packages/core/src/execution-engine/active-workflows.ts`, `execution-context*.ts`, `packages/workflow/src/errors/execution-cancelled.error.ts`, `trigger-close.error.ts`, `workflow-activation.error.ts` |
| Upstream commit | `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Implemented in | `packages/execution-lego` + `packages/reconstructed-engine/src/execution-engine.ts` |
| Status | `IMPLEMENTED` — 32/32 package tests, `tools/phase7-isolation-gate.mjs` 8/8 PASS |
| Rust | **NOT STARTED** — PROJECT_RULES.md §1 (ZERO RUST) |
| Frontend | untouched — no Vue/editor-ui file is read, written or referenced |

This contract freezes the **execution runtime**. The run loop itself (`workflow-execute.ts`) belongs
to the `workflow`/`node`/`execution-data` LEGOs; what is frozen here is what surrounds it: which
executions are alive in this process, how workflows become active, how the execution context is
built from the trigger item, and how a crashed deployment is repaired.

---

## 1. Boundary

### Owns

```text
packages/cli/src/active-executions.ts                        ActiveExecutions
packages/cli/src/active-workflow-manager.ts                  (activation orchestration seam)
packages/cli/src/executions/execution-recovery.service.ts     ExecutionRecoveryService
packages/core/src/execution-engine/active-workflows.ts        ActiveWorkflows
packages/core/src/execution-engine/execution-context.service.ts
packages/core/src/execution-engine/execution-context-hook-registry.service.ts
packages/cli/src/errors/{execution-not-found,execution-already-resuming,node-crashed,workflow-crashed}*
packages/workflow/src/errors/{execution-cancelled,trigger-close,workflow-activation}*
packages/cli/src/constants.ts                                ARTIFICIAL_TASK_DATA
packages/@n8n/config/src/configs/executions.config.ts          recovery defaults
```

### Does not own

```text
packages/cli/src/scaling/**                    → @lego/queue (POOL-009)
packages/core/src/execution-engine/workflow-execute.ts       → @lego/workflow + @lego/execution-data
packages/core/src/execution-engine/partial-execution-utils/** → @lego/workflow
packages/cli/src/push/**                       → @lego/realtime (POOL-011)
packages/cli/src/eventbus/**                   → @lego/events (POOL-010)
vue / editor-ui / design-system                → frozen by PROJECT_RULES.md §2
```

### Provided ports

| Port | Symbols |
| :--- | :--- |
| `P-EXECUTION-REGISTRY` | `ActiveExecutions`, `MemoryExecutionRepository` |
| `P-EXECUTION-ACTIVATION` | `ActiveWorkflows` |
| `P-EXECUTION-CONTEXT` | `ExecutionContextService`, `ExecutionContextHookRegistry` |
| `P-EXECUTION-RECOVERY` | `ExecutionRecoveryService` |

### Consumed ports

| Port | Symbols | Kind |
| :--- | :--- | :--- |
| `@lego/persistence` | `ExecutionRepository`, `ExecutionPersistence`, `WorkflowRepository` | value |
| `@lego/queue` | `JobProcessor.runExecution` | seam (a worker calls into the registry) |
| `@lego/events` | `EventService` (`execution-cancelled`) | value |
| `@lego/realtime` | `Push.broadcast`, `Push.once('editorUiConnected')` | value |

## 2. Invariants (machine-checked)

`packages/execution-lego/test/01-boundary.test.mjs` re-reads the reference on every run;
`02-runtime.test.mjs` and `03-context-recovery.test.mjs` assert the behaviour below.

### Active executions

| # | Invariant | Test |
| :--- | :--- | :--- |
| X1 | `add()` without an id persists a new execution (`status: 'new'`), reserves capacity and — in `regular` mode — marks it `running`; the returned id is the persistence id | `02` X1, X1b |
| X2 | `add(_, id)` resumes only a `waiting` execution (`requireStatus: 'waiting'`); otherwise `ExecutionAlreadyResumingError` and the reservation is released | `02` X2 |
| X3 | `getActiveExecutions()` returns `{id, retryOf, startedAt, mode, workflowId, status}`; `getExecutionOrFail` throws `ExecutionNotFoundError('No active execution found', {extra:{executionId}})` | `02` X3 |
| X4 | an execution removes itself when `postExecutePromise` settles; a `waiting` execution stays registered and only drops its `workflowExecution` reference | `02` X4 |
| X5 | `stopExecution` emits `execution-cancelled` `{executionId, workflowId, workflowName, reason}`, rejects the response promise, then either deletes a `waiting` entry or cancels + rejects the running one; unknown ids are a no-op | `02` X5, X5b |
| X6 | `finalizeExecution` resolves the run, closes a streaming response and logs `Error closing streaming response` when `end()` throws; `resolveExecutionResponsePromise` resolves only outside the `waiting` state | `02` X6, X6b |
| X7 | `shutdown(cancelAll)` disables capacity in regular mode, cancels every execution with `SystemShutdownExecutionCancelledError` (`reason: 'shutdown'`) and drops `new`/`waiting` entries before waiting for the rest | `02` X7 |
| X8 | `isWorkflowIdValid` accepts strings of 1..21 characters | `02` X8 |

### Activation

| # | Invariant | Test |
| :--- | :--- | :--- |
| X9 | trigger failures are wrapped: `WorkflowActivationError('There was a problem activating the workflow: "<msg>"', {cause, node})`; responses (if any) are stored | `02` X9, X9b |
| X10 | polling runs the poll function once at activation, registers one cron per `pollTimes.item` entry and rejects an interval whose first cron field contains `*` with `UserError('The polling interval is too short. It has to be at least a minute.')` | `02` X10, X10b |
| X11 | a failed poll activation keeps the workflow inactive **unless** a trigger already responded | `02` X11 |
| X12 | `remove()`: unknown id → warn `Cannot deactivate already inactive workflow ID "<id>"` + `false`; otherwise deregister crons and close every trigger response — `TriggerCloseError` is logged + reported and tolerated, any other error becomes `WorkflowDeactivationError('Failed to deactivate trigger of workflow ID "<id>": "<msg>"')`; `removeAllTriggerAndPollerBasedWorkflows` removes everything and logs | `02` X12 |

### Execution context

| # | Invariant | Test |
| :--- | :--- | :--- |
| X13 | `ExecutionContextHookRegistry.init()` clears, instantiates and initialises hooks; duplicate names keep the first, failing `init()` instances are skipped with an error line | `03` X13 |
| X14 | `decryptExecutionContext`/`encryptExecutionContext` are symmetrical and keep the `credentials` member; `mergeExecutionContexts` deep-merges (arrays replace) | `03` X14 |
| X15 | `augmentExecutionContextWithHooks` overlays start-node parameters over the workflow node parameters, skips unknown hooks, merges `contextUpdate`, may replace `triggerItems`, rethrows unless `isAllowedToFail`, and returns a re-encrypted context | `03` X15, X15b |

### Recovery

| # | Invariant | Test |
| :--- | :--- | :--- |
| X16 | auto-deactivation when the last `maxLastExecutions` (default 3) executions of a workflow all `crashed`: deactivate, warn, notify, `workflowAutoDeactivated` broadcast 1 s after `editorUiConnected`, then flip `running`/`new` rows to `crashed` with `stoppedAt` — a missing workflow row warns and skips | `03` X16, X16b |
| X17 | `recoverFromLogs`: followers return `null`; an empty log stream marks the execution `crashed`; a stream without node messages amends nothing; finished executions (`success`/`error`/`canceled` **with** data) are ignored; per node, `n8n.node.started` + `n8n.node.finished` → `success` with `ARTIFICIAL_TASK_DATA` and the measured `executionTime`, `started` only → `crashed` + `NodeCrashedError` + `resultData.error = WorkflowCrashedError`; nodes that already have `runData` are skipped; `stoppedAt` is the last node timestamp, else the last workflow end event, else `n8n.workflow.started`; push `executionRecovered` 1 s after `editorUiConnected` | `03` X17, X17b |

## 3. Deviation register (transport only)

| # | Reference | Reconstruction | Why |
| :--- | :--- | :--- | :--- |
| D1 | `@Service()` DI container + `Container.get` | explicit constructor injection; `createExecutionRuntime()` wires the defaults | zero-dependency JS/TS; keeps the port surface testable |
| D2 | TypeORM repositories | `MemoryExecutionRepository`, `MemoryExecutionPersistence`, `MemoryWorkflowRepository` | the DB is a consumed port, not this LEGO's concern |
| D3 | `Logger`, `InstanceSettings`, error reporter | optional `Logger` port (`createRecordingLogger()` for evidence) | deterministic tests, no global singletons |
| D4 | `setTimeout`/`sleep(500)`/`sleep(1000)` | injected `sleep` (defaults to the real timer) | the gate and the tests must not sleep in wall-clock time |
| D5 | `PCancelable<IRun>` handles | `{ cancel: () => void }` seam | the run loop is owned by `@lego/workflow` |
| D6 | `p-cancelable` rejection surfaces as an unhandled rejection | the post-execute promise keeps a no-op catch **in addition to** the observable `getPostExecutePromise()` rejection | a Node test process must not crash on a cancelled execution; the rejection is still delivered to every consumer |
| D7 | `ConcurrencyControlService` (Redis) | `MemoryConcurrencyControl` behind the same reserve/release/disable/removeAll surface | transport |

## 4. Failure semantics

* Activation never leaves a half-active workflow: the entry is written only after every trigger
  responded, and it is deleted again when a poller fails and no trigger responded (X11).
* Deactivation is fail-fast for real errors and tolerant for `TriggerCloseError` (X12) — a broken
  trigger must be visible in the error reporter, not silently swallowed.
* An execution is removed from memory exactly once, by the settling `postExecutePromise` (X4) or by
  the `waiting` shortcut in `stopExecution` (X5) — never by both.
* Recovery is idempotent: re-running it over an amended execution is a no-op because finished
  executions with data are filtered (X17) and `markAsCrashed` does not overwrite `success`/`error`.

## 5. Gates

```bash
node tools/execution-isolation-gate.mjs                    # H01..H08 (this LEGO)
node --test packages/execution-lego/test/*.test.mjs        # 32 assertions suites
node tools/phase7-isolation-gate.mjs --json                # machine-readable evidence
npm run execution:test                                     # package script
```

Evidence: `docs/isolation/evidence/phase7-gate.json`, result record
`results/POOL-012-execution-runtime-lego.md`.

H08 is the back-filled drift audit for POOL-009: `QUEUE_RECOVERY_DEFAULTS` must equal the
`@n8n/config` `executions.queueRecovery` defaults (`interval: 180`, `batchSize: 100`) — the
initial Phase-6 pin used the reference **test fixture** (`interval: 10`, `batchSize: 5`).
