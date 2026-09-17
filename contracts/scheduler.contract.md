# LEGO Contract: Scheduler

Reference: n8n 2.9.4. Status: **VERIFIED** (Agent 4, Phase 2 — contract backed by reference tests + live 11/11 smoke).
Analysis: `docs/isolation/scheduler.md` (note: corrects `docs/anatomy/10-scheduler.md` — there is **no** central tick loop; every cron is its own `CronJob`).
Golden: `tests/reference/agent-4/golden/trigger-scheduler.golden.json`.

## 1. Purpose
Own cron registrations for active workflows: register `(workflowId, nodeId, expression, timezone, recurrence)` → callback, fire the callback on schedule **only on the leader instance**, and remove all crons of a workflow on deactivation/shutdown. It is a pure timer registry; it knows nothing about executions.

## 2. Inputs
| Input | Type (`n8n-workflow`) | Producer |
|---|---|---|
| `registerCron(ctx: CronContext, onTick: () => void)` | `CronContext { nodeId, workflowId, timezone, expression, recurrence? }` | `ITriggerFunctions.helpers.registerCron` (Schedule Trigger node), `ActiveWorkflows` for poll nodes |
| `deregisterCrons(workflowId)` | string | `ActiveWorkflows.remove` |
| `deregisterAllCrons()` | — | `start`/`worker` shutdown |
| `TriggerTime` (UI model) → `toCronExpression` | `everyMinute \| everyHour \| everyX \| everyDay \| everyWeek \| everyMonth \| custom` | node parameters |
| Leadership | `InstanceSettings.isLeader` | Multi-main (EXTERNAL) |
| Config | `CronLoggingConfig.activeInterval` (debug listing interval, default 0 = off) | config |

## 3. Outputs
| Output | Consumer |
|---|---|
| `onTick()` invocation (no arguments, no return) | Trigger LEGO (which calls `emit` → Execution) |
| `cronsByWorkflow: Map<workflowId, Map<key, CronJob>>` (memory) | INTERNAL |
| Error report `Skipped registration for already registered cron` (tags `cron:'duplicate'`) | ErrorReporter (EXTERNAL, Sentry-like) |
| Debug log of active crons every `activeInterval` | Logger |

## 4. Responsibilities
- Normalize key: `toCronKey(ctx)` = JSON of flattened, key-sorted context → same context twice is a **silent no-op** (reported, not thrown).
- Create `new CronJob(expression, tick, undefined, true /*start*/, timezone)` using the `cron` package; 5- or 6-field expressions.
- `tick`: `if (!instanceSettings.isLeader) return;` then `onTick()`. Followers keep the registration and start firing as soon as they become leader (`leadershipChange` re-activation is done by the Trigger LEGO anyway).
- Honour `recurrence` (`{activated:true, index, intervalSize, typeInterval}`) by counting ticks and firing only every `intervalSize`-th tick (Schedule Trigger `everyX` weeks/months semantics).
- `deregisterCrons(workflowId)`: `stop()` every job, delete the map entry; unknown id → no-op.
- Timezone: workflow `settings.timezone` else `GENERIC_TIMEZONE`/default; passed through unchanged to `CronJob`.

## 5. Non-responsibilities
- Does **not** persist anything — restart re-registers via `ActiveWorkflowManager.init()` (Trigger LEGO).
- Does **not** start executions; the callback belongs to the trigger node.
- Does **not** validate business rules (only the `cron` library's syntax check, which throws synchronously — the *node* converts it to `NodeOperationError('Invalid cron expression')`).
- Does **not** dedupe across instances — leadership check is the only multi-main guard (queue/worker instances never fire).
- Does **not** implement the "polling timer loop" claimed by the anatomy doc.

## 6. Dependencies (verified)
| Module | Class |
|---|---|
| `packages/core/src/execution-engine/scheduled-task-manager.ts` | INTERNAL (owned) |
| `packages/core/src/execution-engine/node-execution-context/utils/scheduling-helper-functions.ts` | INTERNAL (adapter to `helpers.registerCron`) |
| `packages/workflow/src/cron.ts` (`toCronExpression`), `interfaces.ts` types | SHARED |
| `cron` npm package (`CronJob`) | EXTERNAL |
| `InstanceSettings` (`@n8n/backend-common`/core) | EXTERNAL (multi-main) |
| `Logger`, `ErrorReporter`, `CronLoggingConfig` (`@n8n/config`) | EXTERNAL |
| Consumers: `ActiveWorkflows` (Trigger), `ScheduleTrigger.node.ts`, legacy `Cron`/`Interval` nodes | CROSS-BOUNDARY ← Trigger / Node Model |

## 7. Error behavior
| Condition | Behaviour |
|---|---|
| Invalid expression | `cron` throws synchronously from `registerCron` → propagates to `nodeType.trigger()` → `WorkflowActivationError` (activation fails; see trigger contract) |
| Duplicate context | Silent skip + `errorReporter.error(...)`, returns normally |
| `onTick` throws | Not caught by the scheduler (Trigger's `emit` wrapper / node must handle) — recorded here as a **known risk** |
| Deregister unknown workflow | no-op |
| Non-leader | `tick` returns early; nothing logged at info level |

## 8. Lifecycle
```
activation  → trigger() → helpers.registerCron(cron, onTick) → ScheduledTaskManager.registerCron(ctx, onTick) → CronJob started
tick        → isLeader ? onTick() : noop        (onTick → emit → WorkflowRunner.run mode:'trigger')
deactivate  → ActiveWorkflows.remove → deregisterCrons(workflowId) → CronJob.stop()
shutdown    → deregisterAllCrons()
```
Golden: Schedule Trigger every 30 s → activation `200 {active:true,triggerCount:1}`; execution with `mode:'trigger', status:'success'` recorded within one interval; after deactivate no further executions.

## 9. Data ownership
- **Owns:** in-memory `cronsByWorkflow` only.
- **Reads:** leadership flag, config.
- **No DB tables.** (`toCronExpression` seconds field is `randomInt(60)` → not reproducible; do not golden-test the generated expression.)

## 10. External interfaces
- `ScheduledTaskManager.registerCron / deregisterCrons / deregisterAllCrons` (DI singleton).
- `SchedulingFunctions.registerCron(cron: Cron, onTick)` exposed to nodes via `ITriggerFunctions.helpers` / `IPollFunctions` context.
- `toCronExpression(item: TriggerTime): CronExpression`.

## 11. Compatibility requirements
- Same-context registration must be idempotent (no double firing after `update` activation).
- Followers must not fire.
- Deregistration by `workflowId` must stop **all** crons of that workflow (multiple Schedule nodes / multiple rules).
- Timezone must be the workflow's, not the process's.
- Callback is fire-and-forget: scheduler must never await it (a slow execution must not delay the next tick).

## Phase-3 native timer adapter (TASK-419)

`CronTimerAdapter` and `createCronTimerJob` provide the default host-side implementation for the
existing `createJob(context, onTick)` boundary. It parses five- or six-field cron expressions, supports wildcard/step/list/range
syntax and English month/weekday aliases, projects instants through `Intl.DateTimeFormat` using the
workflow timezone, applies standard day-of-month/day-of-week OR semantics, and suppresses duplicate
fires in the same absolute second. Invalid expressions and timezones fail synchronously before a
registration is accepted. Timer functions and the clock are injectable for deterministic tests.
