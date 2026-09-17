# LEGO Isolation: Scheduler

**Agent:** Agent 4 — Phase 2 LEGO Isolation
**Reference:** n8n 2.9.4 (`reference/n8n`, upstream `b6dc2787`)
**Status:** VERIFIED (ANALYZED → ISOLATED → TESTED → VERIFIED; documentation + contract, no source change required; smoke 11/11 before and after, live verification passed — see `docs/isolation/agent-4-report.md`)

---

## 1. Correction to the anatomy

`docs/anatomy/10-scheduler.md` describes a "polling timer tick loop (every 1 or
10 seconds)". **That is not what the source does.** n8n 2.9.4 has no central
tick loop. Each registered cron is an independent `CronJob` instance from the
`cron` npm package, running on the Node.js timer queue. The only periodic
timer owned by the scheduler is an optional debug log of active crons
(`CronLoggingConfig.activeInterval`, default off = `0`).

The Scheduler LEGO is therefore small and already well-isolated:

```
packages/core/src/execution-engine/scheduled-task-manager.ts     ScheduledTaskManager  (162 lines)
packages/core/src/execution-engine/node-execution-context/utils/scheduling-helper-functions.ts
packages/workflow/src/cron.ts                                     TriggerTime → toCronExpression
packages/workflow/src/interfaces.ts                               CronContext, Cron, CronRecurrenceRule, SchedulingFunctions
```

Consumers:

```
packages/core/src/execution-engine/active-workflows.ts            poll nodes  → registerCron / deregisterCrons
packages/core/src/execution-engine/node-execution-context/trigger-context.ts
                                                                  ITriggerFunctions.helpers.registerCron
packages/nodes-base/nodes/Schedule/ScheduleTrigger.node.ts        Schedule Trigger node
packages/nodes-base/nodes/Cron/Cron.node.ts, Interval/Interval.node.ts   (legacy, hidden)
packages/cli/src/commands/start.ts / worker.ts                     deregisterAllCrons on shutdown
```

---

## 2. Data model

```ts
// n8n-workflow
type CronExpression = string;                       // 5 or 6 fields (seconds optional)
type CronContext = {
  nodeId: string;
  workflowId: string;
  timezone: string;                                  // workflow.timezone (settings.timezone || default)
  expression: CronExpression;
  recurrence?: CronRecurrenceRule;                    // { activated:false } | { activated:true, index, intervalSize, typeInterval }
};
type Cron = { expression: CronExpression; recurrence?: CronRecurrenceRule };
interface SchedulingFunctions { registerCron(cron: Cron, onTick: () => void): void }
```

`toCronExpression(item: TriggerTime)` (workflow/src/cron.ts) converts the UI
model (`everyMinute | everyHour | everyX | everyDay | everyWeek | everyMonth | custom`)
into a 6-field expression. The seconds field is `randomInt(60)` — expressions
are **not deterministic** across activations. `custom` returns
`item.cronExpression.trim()` untouched.

---

## 3. Registration

`ScheduledTaskManager.registerCron(ctx, onTick)` (core:49-105):

1. `summary` = expression, or `"<expr> (every N <unit>)"` when recurrence is active.
2. `key = toCronKey(ctx)` — JSON of the sorted, flattened context
   (`{expression, nodeId, timezone, workflowId, recurrenceActivated, recurrenceIndex, …}`).
3. **Duplicate check**: if `cronsByWorkflow.get(workflowId).has(key)`
   → `errorReporter.error('Skipped registration for already registered cron', {tags:{cron:'duplicate'}})`
   and **return without registering**. No throw.
4. `new CronJob(expression, tick, undefined, /*start*/ true, timezone)`.
   Invalid expressions throw synchronously from the `cron` library
   (the Schedule Trigger node converts this to
   `NodeOperationError('Invalid cron expression')` when the field was `cronExpression`).
5. `tick` = `if (!instanceSettings.isLeader) return; log; onTick()`.
   **Followers register but never fire.** Leadership is checked at tick time,
   not at registration time.
6. Stored under `cronsByWorkflow: Map<workflowId, Map<key, {job, summary, ctx}>>`.

Called from:

* **Poll nodes** — `ActiveWorkflows.activatePolling()` builds `ctx` from the
  node's `pollTimes` parameter and registers `createPollExecuteFn()` which runs
  `nodeType.poll()` and calls `pollFunctions.__emit(result)` when non-null.
* **Trigger nodes** — via `this.helpers.registerCron(cron, onTick)` from
  `getSchedulingFunctions(workflowId, timezone, nodeId)`; the node owns
  `onTick` (Schedule Trigger builds the timestamp item and calls `this.emit`).

---

## 4. Execution (tick → workflow)

```
CronJob timer fires
  └─ ScheduledTaskManager tick wrapper
       ├─ not leader → return
       └─ onTick()
            ├─ Poll node:  runPoll → nodeType.poll.call(pollFunctions) → __emit(data)
            │                                        └─ ActiveWorkflowManager.getExecutePollFunctions.__emit
            │                                             → WorkflowExecutionService.runWorkflow → WorkflowRunner   CROSS-BOUNDARY
            └─ Schedule Trigger: recurrenceCheck(...) → this.emit([...]) → TriggerContext.emit
                                                                             → runWorkflow → WorkflowRunner       CROSS-BOUNDARY
```

Poll error semantics: errors on the *first* run (`testingTrigger = true`,
during activation) propagate and fail activation; errors on later ticks go
to `pollFunctions.__emitError(error)` → `ExecutionService.createErrorExecution`
→ error workflow.

Schedule Trigger recurrence: `recurrenceCheck(recurrence, staticData.recurrenceRules, timezone)`
uses **workflow static data** (persisted by the Trigger LEGO's `saveStaticData`)
to implement "every N weeks/months". This is a hidden Scheduler → Persistence
dependency worth calling out.

---

## 5. Cancellation

* `deregisterCrons(workflowId)` — `job.stop()` for every cron of that
  workflow, delete the map entry, `logger.info('Deregistered all crons for workflow')`.
  No-op when the workflow has no crons.
* `deregisterAllCrons()` — for every workflow; also `clearInterval(logInterval)`.
* Called from `ActiveWorkflows.remove()` (deactivation) and on shutdown.
* There is **no per-node** or per-key deregistration. Granularity is the
  workflow.

---

## 6. Dependency map

```
ScheduledTaskManager
   ├── cron (npm)                       EXTERNAL (timer engine)
   ├── InstanceSettings.isLeader / instanceRole   core INTERNAL (leadership)
   ├── CronLoggingConfig (@n8n/config)  config
   ├── Logger, ErrorReporter            observability
   └── n8n-workflow CronContext types   SHARED

Consumers
   ActiveWorkflows (Trigger LEGO)          INTERNAL to Agent 4
   TriggerContext.helpers (Node LEGO API)  SHARED (Agent 2 owns the context; Agent 4 owns the function it forwards to)
   ScheduleTrigger node                    SHARED (Agent 2) — reads static data (Persistence)
   commands/start.ts, worker.ts            lifecycle
```

There is **no** Scheduler → Execution edge. The scheduler only invokes an
opaque `onTick` closure; whoever created the closure (Trigger LEGO) owns the
edge into execution. This is the cleanest boundary in Agent 4's scope.

Queue/worker: the scheduler is never run on workers (`shouldAddTriggersAndPollers`
is leader-only), so no change to queue mode is required or made.

---

## 7. Boundary decision

The LEGO boundary is exactly the public surface of `ScheduledTaskManager`:

```ts
registerCron(ctx: CronContext, onTick: () => void): void
deregisterCrons(workflowId: string): void
deregisterAllCrons(): void
readonly cronsByWorkflow                          // inspectable for tests/logging
```

**No source change is made.** The class is already DI-injected and has an
exhaustive upstream unit test
(`core/src/execution-engine/__tests__/scheduled-task-manager.test.ts`)
covering registration, duplicate skip, leader gating, deregistration,
timezone use, and logging.

---

## 8. Reference tests

* Upstream: `scheduled-task-manager.test.ts`, `scheduling-helper-functions.test.ts`,
  `workflow/test/cron.test.ts`, `nodes-base/nodes/Schedule/test/*`.
* Agent 4 golden: `tests/reference/agent-4/scheduler/scheduler.test.ts`
  — registration, execution (tick fires onTick only on leader), cancellation,
  duplicate handling, `toCronExpression` shape, invalid-expression error.

---

## 9. Risks

* Random seconds field means two activations of the same workflow produce
  different cron keys; duplicate detection only works within one activation.
* Leadership is evaluated per tick; a follower promoted to leader will start
  firing crons it registered earlier **only if** it registered them at all —
  in practice `addTriggersAndPollers` is leader-gated, so followers hold no crons.
* `cron` library semantics (6-field with seconds, `L`/`W` unsupported,
  timezone via `luxon`) must be replicated exactly by any Rust replacement.
