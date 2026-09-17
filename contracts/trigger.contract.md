# LEGO Contract: Trigger

Reference: n8n 2.9.4 (`reference/n8n`). Status: **VERIFIED** (Agent 4, Phase 2 — contract backed by reference tests + live 11/11 smoke).
Analysis: `docs/isolation/trigger.md`. Golden: `tests/reference/agent-4/golden/trigger-scheduler.golden.json`.

## 1. Purpose
Own the lifecycle of *long-lived* trigger and polling nodes of an **active** workflow:
register them when a workflow is activated, hold their handles while it runs, tear
them down when it is deactivated. A trigger converts an external event (cron tick,
poll result, socket message, …) into a request to start an execution — it never
runs the execution itself.

## 2. Inputs
| Input | Type (source) | Producer |
|---|---|---|
| Activation request | `ActiveWorkflowManager.add(workflowId, activationMode, existingWorkflow?)` — `activationMode: 'init' \| 'create' \| 'update' \| 'activate' \| 'manual' \| 'leadershipChange'` | Workflow service / activation controller / leader election |
| Workflow definition | `Workflow` (n8n-workflow) built from `workflow_entity` | Persistence (CROSS-BOUNDARY, read-only) |
| Node implementation | `INodeType.trigger` / `INodeType.poll` (`packages/nodes-base`, `packages/core/.../node-execution-context/trigger-context.ts`, `poll-context.ts`) | Node Model (SHARED, read-only) |
| Poll schedule | `pollTimes` node parameter → cron expressions via `toCronExpression` | Node parameters |
| Deactivation request | `ActiveWorkflowManager.remove(workflowId)` | Workflow service / shutdown |

## 3. Outputs
| Output | Type | Consumer |
|---|---|---|
| Trigger response handle | `ITriggerResponse { closeFunction?, manualTriggerFunction?, manualTriggerResponse? }` stored in `ActiveWorkflows.activeWorkflows[workflowId].triggerResponses[]` | Trigger (INTERNAL) |
| Poll response handle | `IPollResponse { closeFunction }` | Trigger (INTERNAL) |
| Emitted data | `emit(data: INodeExecutionData[][], responsePromise?, donePromise?)` → `WorkflowRunner.run(...)` with `mode: 'trigger'` | Execution (CROSS-BOUNDARY) |
| Emitted error | `emitError(error)` → `executeErrorWorkflow` + `activationErrorsService.register(workflowId, message)` + `remove(workflowId)` | Execution / API |
| Active state | `ActiveWorkflows.isActive(id)`, `allActiveWorkflows()` → `GET /rest/active-workflows` | API |
| Activation error | `ActivationErrorsService` (memory or Redis cache) → `GET /rest/active-workflows/error/:id` | API |
| Trigger count | `WorkflowHelpers.getWorkflowTriggerCount` → `workflow_entity.triggerCount` | Persistence |

## 4. Responsibilities
- Build the list of trigger/poll nodes of the workflow (`workflow.getTriggerNodes()`, `getPollNodes()`), excluding `disabled` nodes.
- Call `nodeType.trigger(ctx)` / register poll crons; keep every returned `closeFunction`.
- On activation failure: roll back nothing that has not been started; throw `WorkflowActivationError` with `node`, `cause`, `level` and let `ActiveWorkflowManager` record it in `ActivationErrorsService`.
- On `remove`: call every `closeFunction`, `deregisterCrons(workflowId)`, delete the record, clear activation error.
- `manualTriggerFunction`: when `activationMode === 'manual'` (used by the editor "listen for event" path), the trigger is executed with `getExecuteTriggerFunctions` in manual mode so first emit finishes the manual execution.
- Re-throw with `WorkflowActivationError` when `add` is called for an already-active workflow (`Workflow is already active`) only inside `ActiveWorkflows.add` — the manager guards with `isActive` first so callers observe idempotent 200.

## 5. Non-responsibilities
- Does **not** register HTTP webhooks (→ Webhook LEGO, `addWebhooks`, called by the same manager in the same activation).
- Does **not** run the execution or persist execution data (→ Execution / Persistence).
- Does **not** decide leadership (→ multi-main `InstanceSettings.isLeader`); in multi-main only the leader activates triggers.
- Does **not** validate the workflow graph (→ Workflow / Validation LEGO). It only checks "has at least one trigger/webhook/poll node" and raises `Workflow cannot be activated because it has no trigger node…`.
- Does **not** implement cron itself (→ Scheduler LEGO, `ScheduledTaskManager`).

## 6. Dependencies (verified from imports)
| Dependency | Class | Direction |
|---|---|---|
| `@n8n/core` `ActiveWorkflows`, `TriggersAndPollers`, `ScheduledTaskManager`, `PollContext`, `TriggerContext` | INTERNAL | owned here (`ActiveWorkflows`) / Scheduler (`ScheduledTaskManager`) |
| `n8n-workflow` `Workflow`, `INodeType`, `ITriggerResponse`, `IPollResponse`, `WorkflowActivationError` | SHARED | read-only types |
| `cli/src/active-workflow-manager.ts` | INTERNAL | orchestrator of Trigger + Webhook |
| `cli/src/workflow-runner.ts` (`WorkflowRunner.run`) | CROSS-BOUNDARY → Execution | Trigger emits, Execution runs |
| `@n8n/db` `WorkflowRepository`, `WorkflowStaticDataService` | CROSS-BOUNDARY → Persistence | read workflow, write `staticData` (poll cursors) |
| `ActivationErrorsService`, `Push` | INTERNAL / API | error surfacing |
| `NodeTypes`, `LoadNodesAndCredentials` | SHARED | resolve node implementations |
| `ExternalHooks`, `EventService` | EXTERNAL | side notifications (`workflow.activated`) |

## 7. Error behavior
| Condition | Behaviour (source) |
|---|---|
| Workflow has no trigger/webhook/poll node | `ActiveWorkflowManager.add` → `WorkflowActivationError('Workflow cannot be activated because it has no trigger node. At least one trigger, webhook, or polling node is required.')` → HTTP 400 `{code:400,message,meta:{validationError:true}}` |
| Node `trigger()` throws during `add` | `WorkflowActivationError` with `node` and `cause`; `activationErrorsService.register`; workflow stays `active` in DB but is not running ("activation error" shown by editor); other triggers already started for that workflow are closed via `remove` |
| Trigger emits error at runtime | `emitError` → `executeErrorWorkflow(error, workflowData, 'trigger')`, `activationErrorsService.register`, `remove(workflowId)` |
| `remove` for unknown id | `ActiveWorkflows.remove` returns `false` silently; manager logs a warning; HTTP 200 |
| `closeFunction` throws on remove | error logged (`Failed to close trigger`) but removal proceeds |

## 8. Lifecycle
```
POST /rest/workflows/:id/activate
  → WorkflowService.update(active:true) → ActiveWorkflowManager.add(id,'activate')
      → checkIfWorkflowCanBeActivated()  (no trigger → 400)
      → addWebhooks()                    (Webhook LEGO)
      → addTriggersAndPollers()          (this LEGO) → ActiveWorkflows.add()
          → for each trigger node:  nodeType.trigger(ctx) → store ITriggerResponse
          → for each poll node:     scheduledTaskManager.registerCron(...) → store IPollResponse
      → activationErrorsService.deregister(id); workflow_publish_history row
Runtime: emit() → WorkflowRunner.run(mode:'trigger') → execution_entity
POST /rest/workflows/:id/deactivate
  → ActiveWorkflowManager.remove(id) → clearWebhooks() → ActiveWorkflows.remove()
      → closeFunction() for every handle → scheduledTaskManager.deregisterCrons(id)
Shutdown: removeAll() → same path per id.
```
Golden: activate → `{active:true, triggerCount:1}`, `GET /rest/active-workflows` contains id, one execution `mode:'trigger'` recorded per tick; deactivate → `{active:false, activeVersionId:null}`, id disappears from active list, `GET /rest/active-workflows/error/:id` → `{data:null}`.

## 9. Data ownership
- **Owns (memory only):** `ActiveWorkflows.activeWorkflows: { [workflowId]: { triggerResponses, pollResponses } }`, `ActivationErrorsService` entries.
- **Writes (cross-boundary):** `workflow_entity.triggerCount`, `workflow_entity.staticData` (via `WorkflowStaticDataService` for poll nodes), `workflow_publish_history` (via `WorkflowService`).
- **Reads:** `workflow_entity` (active rows on boot: `getAllActiveIds`), node definitions.
- Never owns execution rows.

## 10. External interfaces
- Internal REST (via API LEGO): `POST /rest/workflows/:id/activate|deactivate`, `GET /rest/active-workflows`, `GET /rest/active-workflows/error/:id`.
- Public API: `POST /api/v1/workflows/:id/activate|deactivate`.
- Node contract (SHARED): `INodeType.trigger(this: ITriggerFunctions): Promise<ITriggerResponse | undefined>`, `INodeType.poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null>`.
- Push: `workflowActivated` / `workflowDeactivated` / `workflowFailedToActivate` events.

## 11. Compatibility requirements
- Exact error strings above (tests and editor match on them).
- Activation must be idempotent from the HTTP surface (second activate → 200 `active:true`).
- Poll nodes must run under `mode:'trigger'` with `staticData` persisted after each poll (`WorkflowStaticDataService.saveStaticDataById`).
- Multi-main: triggers/pollers only on leader; webhooks on all mains (see webhook contract).
- Disabled nodes are never registered.
- `emit` must be safe after `remove` (guarded: emit after close is dropped).
