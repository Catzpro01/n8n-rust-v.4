# Scheduler LEGO — Phase 3

Dependency-free reconstruction of the n8n 2.9.4 cron registry boundary.

- `toCronExpression` reproduces every TriggerTime mode and permits deterministic random injection in tests.
- `toCronKey` flattens recurrence metadata and sorts keys for idempotent registration.
- `ScheduledTaskManager` owns registrations, leader-gated fire-and-forget ticks, duplicate reporting, and workflow teardown.
- `getSchedulingFunctions` binds workflow, node, and timezone identity for trigger contexts.
- Actual timer/cron parsing is an injected host adapter (`createJob`), preserving the Scheduler LEGO boundary.

```bash
npm --prefix packages/scheduler-lego test
node tools/scheduler-lego-gate.mjs
```

## Native timer adapter (TASK-419)

`CronTimerAdapter` closes the previously injected-only timer boundary without adding a runtime
dependency. `createCronTimerJob(adapter)` plugs directly into `ScheduledTaskManager.createJob`.
The parser supports the five/six-field forms emitted by n8n plus wildcard, steps, lists, ranges,
month/day aliases, workflow timezones, and cron day-field OR semantics. Clock and timer functions
are injectable; registration errors remain synchronous.
