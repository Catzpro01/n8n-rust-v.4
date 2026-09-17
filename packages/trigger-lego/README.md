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

## Instance leadership (TASK-422)

`ActiveWorkflowCoordinator` closes distributed activation coordination behind explicit ports. It
batches active workflow startup, prevents concurrent sweeps, populates webhook rows during init and
leadership changes on every main, restricts in-memory triggers/pollers to the leader, reports
activation errors using active-version data, controls retries, and tears down on stepdown/shutdown.

## Distributed activation transport (TASK-423)

The dependency-free `PubSubPublisher` and `PubSubSubscriber` reproduce deployment-prefixed command
envelopes, sender/target filtering, self-send activation commands, immediate delivery, trailing
debounce, malformed-message rejection, and client shutdown through injected Redis-like ports.
`PubSubRegistry` applies static instance-type filtering and dynamic leader/follower role filtering.
`ActiveWorkflowPubSubRouter` wires the activation and deactivation command choreography: only the
leader mutates trigger/poller state, while activation, deactivation, and activation-error display
commands reach every main instance.
