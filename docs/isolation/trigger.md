# LEGO Isolation: Trigger

**Agent:** Agent 4 — Phase 2 LEGO Isolation
**Reference:** n8n 2.9.4 (`reference/n8n`, upstream `b6dc2787`)
**Status:** VERIFIED (ANALYZED → ISOLATED → TESTED → VERIFIED; documentation + contract, no source change required; smoke 11/11 before and after, live verification passed — see `docs/isolation/agent-4-report.md`)

---

## 1. What "Trigger" actually is in n8n 2.9.4

n8n has no single "Trigger module". The trigger subsystem is the sum of three
layers, split across two packages. This document maps them exactly as found in
source — not as an idealised diagram.

| Layer | File | Package | Role |
| :--- | :--- | :--- | :--- |
| Node contract | `packages/workflow/src/interfaces.ts` (`INodeType.trigger`, `INodeType.poll`, `ITriggerFunctions`, `IPollFunctions`, `ITriggerResponse`) | `n8n-workflow` | Shape of a trigger node. **Owned by Agent 2 (Node).** |
| Trigger runtime (in-memory registry) | `packages/core/src/execution-engine/active-workflows.ts` (`ActiveWorkflows`)<br>`packages/core/src/execution-engine/triggers-and-pollers.ts` (`TriggersAndPollers`) | `n8n-core` | Calls `nodeType.trigger()` / `nodeType.poll()`, keeps `triggerResponses` per workflow id, closes them on removal. |
| Trigger orchestration (DB + emit → execution) | `packages/cli/src/active-workflow-manager.ts` (`ActiveWorkflowManager`) | `n8n` (cli) | Loads workflow from DB, decides *what* to activate (webhooks vs triggers/pollers), builds `TriggerContext`/`PollContext` whose `emit` starts an execution, handles retry queue and activation errors. |

Trigger *types* (from `docs/anatomy/08-trigger.md`) map onto this as:

* **Poll trigger** → `INodeType.poll` + `ActiveWorkflows.activatePolling()` → cron via Scheduler LEGO.
* **Webhook trigger** → `INodeType.webhook` → handled by the Webhook LEGO (`docs/isolation/webhook.md`), *not* by `ActiveWorkflows`.
* **Event trigger** (`ITriggerFunctions.emit` from a long-lived connection, e.g. MQTT/RabbitMQ/Schedule) → `INodeType.trigger` + `TriggersAndPollers.runTrigger()`.

---

## 2. Trigger lifecycle (verified from source)

### 2.1 Registration / activation

```
POST /rest/workflows/:id/activate  (API LEGO)
  └─ WorkflowService.activateWorkflow
       └─ ActiveWorkflowManager.add(workflowId, 'activate')      cli/src/active-workflow-manager.ts:588
            ├─ WorkflowRepository.findById                       (Persistence LEGO)
            ├─ new Workflow({nodes, connections} of activeVersion) (Workflow LEGO — Agent 1)
            ├─ validateWorkflowHasTriggerLikeNode(...)           (n8n-workflow)
            ├─ WorkflowExecuteAdditionalData.getBase(...)
            ├─ if shouldAddWebhooks(mode)   → addWebhooks(...)   (Webhook LEGO)
            ├─ if shouldAddTriggersAndPollers() (leader only)
            │     └─ addTriggersAndPollers(dbWorkflow, workflow, …)  :963
            │           └─ ActiveWorkflows.add(id, workflow, additionalData, 'trigger', mode,
            │                                  getTriggerFunctions, getPollFunctions)   core/…/active-workflows.ts:71
            │                 ├─ for each workflow.getTriggerNodes():
            │                 │     TriggersAndPollers.runTrigger(...)  → nodeType.trigger.call(TriggerContext)
            │                 │     push ITriggerResponse into activeWorkflows[id].triggerResponses
            │                 └─ for each workflow.getPollNodes():
            │                       activatePolling(): pollTimes → toCronExpression → executeTrigger(true)
            │                       → ScheduledTaskManager.registerCron(ctx, executeTrigger)   (Scheduler LEGO)
            ├─ removeQueuedWorkflowActivation / activationErrorsService.deregister
            └─ WorkflowRepository.updateWorkflowTriggerCount
```

Activation modes (`WorkflowActivateMode`): `'init' | 'create' | 'update' | 'activate' | 'manual' | 'leadershipChange'`.

Key behaviours:

* In `ActiveWorkflows.add`, **any** trigger node failure aborts activation with
  `WorkflowActivationError("There was a problem activating the workflow: "<msg>"")`
  and the workflow is **not** stored as active. (core/active-workflows.ts:88-100)
* Poll nodes are activated *after* trigger nodes. If a poll node fails and
  there were no trigger responses, the in-memory entry is deleted again. (:120-130)
* Poll nodes are executed once immediately (`executeTrigger(true)`) so a
  broken poller fails activation instead of silently failing later. (:159)
* Poll cron with a `*` in the seconds field is rejected:
  `UserError('The polling interval is too short. It has to be at least a minute.')` (:162-164)
* Only the **leader** instance owns in-memory triggers/pollers
  (`shouldAddTriggersAndPollers()` → `instanceSettings.isLeader`). Webhooks are
  added by any instance on `init`/`leadershipChange`, otherwise leader only.

### 2.2 Trigger → Execution boundary (the `emit` closure)

The trigger node never talks to the execution engine. It receives a
`TriggerContext` whose `emit` closure was built by
`ActiveWorkflowManager.getExecuteTriggerFunctions()` (cli:342-437):

```
emit(data, responsePromise?, donePromise?)
  ├─ workflowStaticDataService.saveStaticData(workflow)         (Persistence)
  ├─ workflowExecutionService.runWorkflow(workflowData, node, data, additionalData, mode, responsePromise)
  │        → WorkflowRunner.run(...)                            (Execution LEGO — Agent 3)  CROSS-BOUNDARY
  ├─ eventService.emit('workflow-executed', {source:'trigger'})
  └─ donePromise ← activeExecutions.getPostExecutePromise(executionId)
```

```
emitError(error)
  ├─ activeWorkflows.remove(workflowId)             (deactivate in memory)
  ├─ activationErrorsService.register(id, message)  (Persistence: cache)
  ├─ executeErrorWorkflow(WorkflowActivationError)  (Execution LEGO)
  └─ addQueuedWorkflowActivation(mode, workflowData)  (retry with back-off:
        WORKFLOW_REACTIVATE_INITIAL_TIMEOUT … WORKFLOW_REACTIVATE_MAX_TIMEOUT)
```

```
saveFailedExecution(error)
  └─ executionService.createErrorExecution(...) → executeErrorWorkflow(...)
```

For pollers the same shape exists as `__emit` / `__emitError`
(`getExecutePollFunctions`, cli:291-340), but `__emitError` goes straight to
`createErrorExecution` instead of deactivating the workflow.

**Manual mode special case** (`TriggersAndPollers.runTrigger`, mode === 'manual'):
`emit` is replaced with a one-shot resolver that fulfils
`triggerResponse.manualTriggerResponse` with the first emitted data; the
`responsePromise`/`donePromise` are wired into `additionalData.hooks`
(`sendResponse`, `workflowExecuteAfter`). This is how "Execute workflow"
in the editor waits for the first trigger event.

### 2.3 Trigger output

The trigger's output to the outside world is exactly:

```ts
INodeExecutionData[][]         // emit(data)   — one array per output index
Error                          // emitError(error)
ExecutionError                 // saveFailedExecution(error)
```

Nothing else crosses the boundary. Response handling for webhooks is a
Webhook-LEGO concern.

### 2.4 Deactivation

```
POST /rest/workflows/:id/deactivate
  └─ ActiveWorkflowManager.remove(workflowId)              cli:890
       ├─ clearWebhooks(workflowId)                        (Webhook LEGO; errors are logged, not thrown)
       ├─ activationErrorsService.deregister(workflowId)
       ├─ removeQueuedWorkflowActivation(workflowId)
       └─ removeWorkflowTriggersAndPollers(workflowId)
            └─ ActiveWorkflows.remove(workflowId)          core:186
                 ├─ scheduledTaskManager.deregisterCrons(workflowId)   (Scheduler LEGO)
                 ├─ for each triggerResponse: closeTrigger(r)
                 │     closeFunction() ; TriggerCloseError → log+report, swallow
                 │                       other error → WorkflowDeactivationError (thrown)
                 └─ delete activeWorkflows[workflowId]
```

* `remove()` on a workflow not active in memory logs a warning and returns
  `false`. It does **not** throw. (core:187-190)
* Multi-main: `remove()` clears webhooks locally then publishes
  `remove-triggers-and-pollers` over pub/sub; the leader handles it.

### 2.5 Startup / shutdown

* `ActiveWorkflowManager.init()` → `addActiveWorkflows('init')` loads all
  workflows with `activeVersion` from DB in chunks and activates them
  (`activateWorkflow`, cli:501). Activation errors are recorded per workflow
  in `ActivationErrorsService` (cache-backed) and do not stop startup.
* `@OnShutdown` / `removeAllTriggerAndPollerBasedWorkflows()` closes all triggers.
* `@OnLeaderTakeover` / `@OnLeaderStepdown` add/remove triggers and pollers.

---

## 3. Dependency map (actual imports)

```
ActiveWorkflowManager (cli)
   ├── @n8n/db          WorkflowRepository, WorkflowEntity          PERSISTENCE   (Agent 4)
   ├── n8n-core         ActiveWorkflows, TriggerContext, PollContext, InstanceSettings, ErrorReporter
   ├── n8n-workflow     Workflow, WorkflowActivationError, validateWorkflowHasTriggerLikeNode   SHARED (Agent 1/2)
   ├── @/webhooks/*     WebhookHelpers.getWorkflowWebhooks, WebhookService        WEBHOOK       (Agent 4)
   ├── @/workflows/workflow-execution.service   runWorkflow → WorkflowRunner     EXECUTION     CROSS-BOUNDARY (Agent 3)
   ├── @/executions/execution.service           createErrorExecution              EXECUTION     CROSS-BOUNDARY
   ├── @/active-executions                      getPostExecutePromise             EXECUTION     CROSS-BOUNDARY
   ├── @/execution-lifecycle/execute-error-workflow                               EXECUTION     CROSS-BOUNDARY
   ├── @/activation-errors.service              (CacheService)                    PERSISTENCE-ish (cache)
   ├── @/workflows/workflow-static-data.service saveStaticData                    PERSISTENCE
   ├── @/events/event.service                   'workflow-executed'               EVENTS        SHARED
   ├── @/push, @/scaling/pubsub/*               multi-main coordination           REALTIME/QUEUE EXTERNAL
   └── @/node-types                             NodeTypes                         NODE          SHARED (Agent 2)

ActiveWorkflows (core)
   ├── ./scheduled-task-manager   registerCron / deregisterCrons     SCHEDULER (Agent 4)
   ├── ./triggers-and-pollers     runTrigger / runPoll               INTERNAL
   ├── n8n-workflow               toCronExpression, Workflow, errors SHARED
   └── @/observability Tracing, @/errors ErrorReporter               INTERNAL
```

Classification:

| Edge | Type |
| :--- | :--- |
| Trigger → Node type (`nodeType.trigger/poll`) | SHARED (Node LEGO defines it; Trigger LEGO calls it) |
| Trigger → Workflow (`getTriggerNodes`, `getPollNodes`, `getNode`) | SHARED (read-only use of Agent 1's model) |
| Trigger → Scheduler (`registerCron/deregisterCrons`) | INTERNAL to Agent 4 (separate LEGO, same owner) |
| Trigger → Webhook (`addWebhooks/clearWebhooks`) | INTERNAL to Agent 4 |
| Trigger → Persistence (`WorkflowRepository`, static data, `updateWorkflowTriggerCount`) | INTERNAL to Agent 4 |
| Trigger → Execution (`runWorkflow`, `createErrorExecution`, `getPostExecutePromise`, `executeErrorWorkflow`) | **CROSS-BOUNDARY** — owner Agent 3. Agent 4 defines the interface (the `emit` callbacks) only. |
| Trigger → Events / Push / PubSub | EXTERNAL |

---

## 4. Boundary decision

The **true** boundary is the pair of callbacks handed to the node:

```
TriggerContext(workflow, node, additionalData, mode, activation, emit, emitError, saveFailedExecution)
PollContext   (workflow, node, additionalData, mode, activation, __emit, __emitError)
```

Everything *inside* (`ActiveWorkflows`, `TriggersAndPollers`, the queue of
retried activations) is Trigger-LEGO internals. Everything *behind* `emit`
(WorkflowRunner, ActiveExecutions, error-workflow) is Execution-LEGO.

`ActiveWorkflows` (core) is already a clean, DI-injected, independently
unit-tested class (`core/src/execution-engine/__tests__/active-workflows.test.ts`).
`ActiveWorkflowManager` (cli) is the composition root that connects the
Trigger LEGO to Persistence, Webhook, Scheduler and Execution.

**No source change is made.** Forcing `ActiveWorkflowManager` apart from
`WorkflowExecutionService`/`ExecutionService` would require rewriting the
execution entry-point (Agent 3 territory) or introducing a hidden indirection,
which §8 of the task explicitly forbids. The boundary is documented and
contracted in `contracts/trigger.contract.md` instead.

---

## 5. Reference tests that pin this behaviour

Upstream (already in repo, run by `pnpm --filter n8n-core test`):

* `packages/core/src/execution-engine/__tests__/active-workflows.test.ts`
  — registration, activation errors, poll activation, deactivation, close errors.
* `packages/core/src/execution-engine/__tests__/triggers-and-pollers.test.ts`
  — manual-mode emit wiring, missing trigger/poll function errors.
* `packages/cli/src/__tests__/active-workflow-manager.test.ts`
  and `packages/cli/test/integration/active-workflow-manager.test.ts`
  — add/remove, leader/follower, `shouldAddWebhooks`.

Agent 4 golden tests (added in this phase, executable without a database):

* `tests/reference/agent-4/trigger/trigger-lifecycle.test.ts`
  — registration, activation, execution (emit → runWorkflow call shape),
  deactivation, activation failure semantics. See `tests/reference/agent-4/README.md`.

---

## 6. Risks / open points

* `ActiveWorkflowManager` mutates `node.name` and `dbWorkflow.nodes` in place
  during `addWebhooks`/`add` — any Rust port must preserve that the
  *active version* nodes are what gets activated, not the draft.
* `toCronExpression` uses `randomInt(60)` for the seconds field; cron
  expressions are therefore non-deterministic. Golden tests must not assert
  the seconds field.
* Manual-mode trigger execution depends on `additionalData.hooks` being set
  (assert in `TriggersAndPollers.runTrigger`).

---

## 7. Phase 5 — the runtime registry is now a port, not a copy

Phase 4 shipped `packages/reconstructed-engine/src/trigger-engine.ts` as a 30-line `TriggerEngine`
that invented its own semantics: it threw `'Workflow is already active'` on a second activation, it
refused workflows without trigger nodes (`Workflow cannot be activated because it has no trigger
node…` — that message belongs to the **API layer**, `validateWorkflowHasTriggerLikeNode`, not to the
registry), and `allActive()` returned insertion order. The facade carried a second, slightly
different copy (`InternalTriggerEngine`). Nothing compared either against n8n.

### 7.1 The port (`packages/reconstructed-engine/src/trigger-engine.ts`)

| Reference source | Ported symbols |
|---|---|
| `n8n-core` `execution-engine/active-workflows.ts` | `TriggerEngine`: `isActive`, `allActiveWorkflows`, `get`, `add`, `remove`, `removeAllTriggerAndPollerBasedWorkflows`, `closeTrigger` |
| `n8n-workflow` `errors/workflow-activation.error.ts` (+ deactivation/trigger-close) | `WorkflowActivationError` (incl. the level heuristic), `WorkflowDeactivationError`, `TriggerCloseError` |
| `n8n-workflow` `workflow-validation.ts` | `validateWorkflowHasTriggerLikeNode` + the `STARTING_NODES` list the CLI passes |
| `n8n-workflow` `cron.ts` + `utils.randomInt` | `toCronExpression` / `randomInt` (crypto based, exactly like the reference) |

Declared deviations (also in the LEGO manifest): the polling branch of `add()` is delegated through
the `polling` hook because cron scheduling is owned by the Scheduler LEGO; there is no tracing span;
the error classes are local (this module stays dependency-free), so `instanceof n8n-workflow` does
not hold — `name`, `message`, `node`, `workflowId`, `level` and `cause` visibility do.

### 7.2 Surprising reference semantics now pinned by tests

- Re-adding an active workflow is **legal**: the triggers start again and the entry is replaced.
  There is no `'Workflow is already active'` error anywhere in `ActiveWorkflows`.
- A workflow **without** trigger nodes is stored with `triggerResponses: []`; only the CLI/API
  validation rejects activation.
- `allActiveWorkflows()` is `Object.keys(activeWorkflows)` — integer-like workflow ids sort first
  (`['2','10','wf-2','wf-1']`), which a `Map`-based port would get wrong.
- `remove()` calls `deregisterCrons(workflowId)` **before** closing the trigger responses, logs a
  warning for unknown ids and returns `false` for them.
- `WorkflowActivationError` does **not** expose `cause` (its `ApplicationError` base swallows it),
  and `TriggerCloseError` keeps `name === 'Error'`; a `TriggerCloseError` during close is only
  reported (never wrapped), every other close failure becomes a `WorkflowDeactivationError`.
- `toCronExpression` draws its random fields from `crypto.getRandomValues` (not `Math.random`), and
  `everyX`/hours randomises the **minute** field as well.

### 7.3 Verification

```bash
npm run trigger:check      # T01..T06 → docs/isolation/evidence/trigger-lego-gate.json
node --test packages/trigger-lego/test/*.test.mjs
```

`T02` alone replays six scenarios through the real `ActiveWorkflows` and the port side by side over
the *same* `Workflow` objects, comparing return values, thrown-error shape and the ordered call log
(trigger starts, cron deregistration, close calls, logger lines).

Negative controls (injected, caught, reverted):

| Injected defect | Caught by |
|---|---|
| `allActiveWorkflows()` returns insertion order instead of `Object.keys` order | `T02` — `T02-d-ordering-of-ids` |
| `add()` rethrows the raw trigger error instead of wrapping it | `T03` — `T03-a-trigger-throws` |
| validator stops skipping `disabled` nodes | `T04` — `nodes=Disabled trigger` |
| `everyX`/hours loses its randomised minute field | `T05` — `everyX {unit: hours}` |

### 7.4 Concurrent spec track

The Phase 4-13 spec track (invariants T1-T10, `packages/trigger-lego/src/model-surface.ts`) wrote its
own `ActiveWorkflows` into the same file. After the rebase both live in
`packages/reconstructed-engine/src/trigger-engine.ts`: `TriggerEngine` is the reference-exact port the
facade uses (verified by T01-T06), while the spec track's surface — its `ActiveWorkflows`,
`createManualTrigger`, `shouldAddTriggersAndPollers`, `activationError`, `POLL_INTERVAL_TOO_SHORT`
and its types — is preserved below it (aligned to the reference in Phase 5-07, see below) so
`packages/trigger-lego/test/01-boundary.test.mjs` keeps passing (suite: 18/18).

Two documented disagreements, never hidden — both ADJUDICATED in Phase 5-07 by direct
reference read (`core/src/execution-engine/active-workflows.ts`), and the spec side was aligned:

- D1 duplicate activation: the reference `add` (lines 70-110) has NO duplicate guard — a second
  call re-runs the triggers and OVERWRITES `activeWorkflows[id]`. The string `Workflow is already
  active` exists NOWHERE in `n8n-core`/`n8n-workflow` (grep-verified 2026-09-18). The spec
  registry's throw was removed; `contracts/trigger.contract.md` §4 was corrected.
- D2 `TriggerCloseError`: the reference `closeTrigger` (lines 220-226) REPORTS via
  `logger.error` + `errorReporter.error(e, { extra: { workflowId } })` and removal proceeds; only
  other close errors become `WorkflowDeactivationError`. The spec registry now exposes the report
  via `reportedCloseErrors`; the envelope was fixed to the byte-exact
  `Failed to deactivate trigger of workflow ID "X": "…"` (lines 231-234).

The spec suite gained one test for the adjudicated behavior
(`01-boundary.test.mjs`: 6 → 7 tests); combined trigger suite is 18/18. Both registries now agree
with the reference; `TriggerEngine` remains what the facade uses.
