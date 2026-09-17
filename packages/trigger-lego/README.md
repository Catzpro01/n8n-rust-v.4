# Trigger LEGO — Phase 3

Dependency-free JavaScript reconstruction of the n8n 2.9.4 long-lived trigger and polling lifecycle.

## Boundary

- `TriggersAndPollers` invokes injected node implementations (`trigger` / `poll`).
- `ActiveWorkflows` owns in-memory activation handles and teardown.
- `ScheduledTaskManager` stores schedule registrations while an injected host scheduler owns timers.
- Emitted items cross into Execution only through injected context callbacks.
- Webhook registration, persistence, and workflow execution remain outside this package.

## Compatibility covered

- trigger registration, emit, close, and inactive removal;
- exact activation/deactivation error messages;
- manual-mode first-emission promise and lifecycle hook wiring;
- immediate poll validation, cron registration, sub-minute rejection, and runtime error emission;
- leader-only scheduled ticks and duplicate suppression;
- soft `TriggerCloseError` versus hard close failure;
- disabled trigger and poll nodes.

```bash
npm --prefix packages/trigger-lego test
node tools/trigger-lego-gate.mjs
```

The scheduler adapter intentionally does not parse or execute cron itself; that belongs to the Scheduler LEGO.
