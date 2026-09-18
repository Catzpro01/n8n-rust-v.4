# Rust port: Trigger lifecycle (`trigger.lifecycle`, agent-01)

**Sub-LEGO:** `trigger.lifecycle` — parent LEGO `trigger`, owner `agent-01`
**Contract:** `contracts/trigger.contract.md` (status **VERIFIED**, Phase 2)
**Isolation analysis:** `docs/isolation/trigger.md`
**Reference:** n8n 2.9.4 (`reference/n8n`, upstream `b6dc2787`) — read, never modified
**Implementation:** `crates/n8n-workflow/src/trigger.rs`
**Acceptance:** `crates/n8n-workflow/tests/trigger_lifecycle.rs` (replays
`tests/reference/agent-4/golden/trigger-scheduler.golden.json`) + 26 unit tests

The port follows the isolation analysis instead of re-deriving the subsystem: the trigger
slice of `ActiveWorkflowManager.add/remove` and `ActiveWorkflows.add/remove` lives here, the
webhook slice stays with the Webhook LEGO, cron stays with the Scheduler LEGO, and
`nodeType.trigger()` / `nodeType.poll()` stay with the Node LEGO.

## 1. Symbol map

| Reference (n8n 2.9.4) | File | Port |
| :--- | :--- | :--- |
| `ActiveWorkflows` (registry, `add`, `remove`, `isActive`, `allActiveWorkflows`) | `packages/core/src/execution-engine/active-workflows.ts` | `ActiveWorkflows`, `ActiveWorkflow` |
| `ActiveWorkflows.activatePolling` | same | `ActiveWorkflows::add` poll branch + `PollScheduler` |
| `TriggersAndPollers.runTrigger` / `runPoll` | `packages/core/src/execution-engine/triggers-and-pollers.ts` | `TriggerRunner` / `PollRunner` traits (implemented by the Node LEGO) |
| `ActiveWorkflowManager.add` (trigger slice) | `packages/cli/src/active-workflow-manager.ts` | `TriggerActivationManager::add` |
| `ActiveWorkflowManager.remove` | same | `TriggerActivationManager::remove` / `remove_all` |
| `countTriggers` | same | `Workflow::count_triggers` → `TriggerCount` |
| `shouldAddTriggersAndPollers` | same | `ActivationPolicy::should_add_triggers_and_pollers` |
| `getExecuteTriggerFunctions().emit` / `emitError` | same | `ActiveWorkflows::emit` → `ExecutionRequest`, `TriggerActivationManager::emit_error` → `TriggerErrorEvent` |
| `Workflow.getTriggerNodes` / `getPollNodes` / `queryNodes` | `packages/workflow/src/workflow.ts` | `Workflow::get_trigger_nodes` / `get_poll_nodes` / `query_nodes` |
| `validateWorkflowHasTriggerLikeNode` | `packages/workflow/src/workflow-validation.ts` | `Workflow::has_trigger_like_node` |
| `ActivationErrorsService` | `packages/cli/src/activation-errors.service.ts` | `ActivationErrorsService` |
| `ScheduledTaskManager.registerCron` / `deregisterCrons` | `packages/core/src/execution-engine/scheduled-task-manager.ts` | `PollScheduler` (+ `InMemoryPollScheduler`) |
| `STARTING_NODES`, `TRIGGER_COUNT_EXCLUDED_NODES` | `packages/cli/src/constants.ts` | `STARTING_NODES`, `TRIGGER_COUNT_EXCLUDED_NODES` |
| `WorkflowActivationError`, `WorkflowDeactivationError`, `UserError` | `packages/workflow/src/errors/*` | `WorkflowActivationError`, `WorkflowDeactivationError`, `TriggerError` |

Frozen strings (contract §11 — the editor and the integration tests match on them):
`NO_TRIGGER_NODE_ERROR`, `POLLING_INTERVAL_TOO_SHORT_ERROR`, `ALREADY_ACTIVE_ERROR`,
`ACTIVATION_FAILURE_PREFIX`.

## 2. Behaviour carried over verbatim

* Node queries walk `Object.keys(nodes)` order, skip `disabled === true`, and skip unknown
  node types instead of failing (`queryNodes`, `validateWorkflowHasTriggerLikeNode`).
* Activation order: every trigger node first, *then* the entry is stored, *then* every poll
  node (crons → immediate `runPoll` → `registerCron` per expression).
* A failing trigger node aborts activation with
  `There was a problem activating the workflow: "<cause>"` and `node` attached; a failing
  poll removes the in-memory entry **only when no trigger response was stored**.
* The activation-time poll run (`executeTrigger(true)`) emits when it returns data, so a
  broken poller fails activation instead of failing silently later.
* Reference quirk reproduced on purpose (`activatePolling` order): the poll runs **before**
  the cron expressions are validated, so a node whose interval is rejected can still have
  emitted an execution. The runner's `UserError` (`*` in the seconds field) travels the same
  path as a poll failure — it leaves `ActiveWorkflows.add` wrapped as
  `There was a problem activating the workflow: "The polling interval is too short. It has to
  be at least a minute."` with `node` and `cause` attached.
* A workflow whose only nodes are `STARTING_NODES` (`manualTrigger`,
  `langchain.manualChatTrigger`) or disabled nodes cannot be activated; webhook nodes count
  as trigger-like for the check but are counted by the Webhook LEGO.
* `countTriggers` = trigger nodes (excluding `manualTrigger` by name and
  `TRIGGER_COUNT_EXCLUDED_NODES` by suffix) + poll nodes + unique webhooks.
* Second `activate` on an active workflow is idempotent (status `AlreadyActive`, no double
  registration); `ActiveWorkflows::add` itself still errors with `Workflow is already active`.
* Multi-main: only the leader registers triggers/pollers (`ActivationStatus::SkippedNotLeader`).
* `emit` after `remove` is dropped (contract §11); `emitError` deactivates, then records the
  error (reference order — `remove` clears a previous activation error).
* Manual mode: the first emission resolves the manual trigger response, later ones use
  `internal`.
* `remove` of an unknown id is silent: `removed: false` plus the reference's warning text,
  no error.
* Close failures use the reference wording (`There was a problem calling "closeFunction" on
  "<node>" in workflow "<id>"` for `TriggerCloseError`, `Failed to close trigger of workflow
  "<id>" node "<node>"` otherwise).

## 3. Deliberate divergences (contract-level, not accidents)

| # | Divergence | Rationale |
| :--- | :--- | :--- |
| D-01 | Non-`TriggerCloseError` close failures are collected in `RemovalReport::warnings` instead of being rethrown as `WorkflowDeactivationError` | `contracts/trigger.contract.md` §7 pins "error logged (`Failed to close trigger`) but removal proceeds"; the reference's rethrow leaves `activeWorkflows[id]` deleted while propagating, which no caller in the CLI observes |
| D-02 | `nodeType.trigger()` / `nodeType.poll()` are injected as `TriggerRunner` / `PollRunner` instead of resolved through a DI container | the kernel has no container; ownership (Node LEGO) and call order are unchanged |
| D-03 | `emit` produces an `ExecutionRequest` that the Execution LEGO drains, instead of calling `WorkflowRunner.run` inline | contract §5: the trigger LEGO "never runs the execution itself"; keeps the hand-off testable without an async runtime |

`activatePolling`'s poll-before-validate order, `emitError`'s remove-before-register order and
the "delete the entry only when no trigger response was stored" rule are *not* divergences:
they are reproduced as written, with a test each
(`the_activation_run_happens_before_the_interval_is_validated`,
`emit_error_deactivates_the_workflow_and_records_the_error`,
`a_failing_poll_run_without_triggers_removes_the_entry`).

`WebhookHelpers.getWorkflowWebhooks` is not re-implemented: `TriggerActivationManager`
accepts the unique-webhook count from the Webhook LEGO (`set_webhook_nodes`) and falls back
to counting webhook-like nodes for standalone use.

## 4. Verification

```
tools/rust-offline-rig/run.sh test
  n8n-workflow (unit)                    53 passed   (27 new in trigger.rs)
  n8n-workflow (trigger_lifecycle.rs)     3 passed   (golden replay)
  workspace total                        80 passed, 0 failed
```

The golden replay asserts the case inventory of
`tests/reference/agent-4/golden/trigger-scheduler.golden.json` before asserting behaviour,
so a changed golden fails the test instead of being silently skipped.

Not covered by this port (out of `trigger.lifecycle` scope, per `docs/isolation/trigger.md`
§4): cron evaluation (Scheduler LEGO), webhook registration (Webhook LEGO),
`workflow_entity`/`workflow_publish_history` writes (Persistence), retry/back-off of
`addQueuedWorkflowActivation`, and `WorkflowRunner` itself (Execution LEGO).
