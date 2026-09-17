# LEGO 14 — EVENTS (event service, message event bus, relays) isolation record

| field | value |
| :--- | :--- |
| LEGO | `events` |
| Owner | Agent 3 (phase 6, task `POOL-010`) |
| Reference | n8n `2.9.4`, upstream `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Contract | `contracts/events.contract.md` |
| Package | `packages/events-lego` |
| Engine | `packages/reconstructed-engine/src/events-engine.ts` |
| Cycle | `DISCOVERED → ISOLATED → CONTRACTED → IMPLEMENTED → VERIFIED → INTEGRATED` |
| Rust | not started (rule §1) |

## 1. X-Ray

```text
publisher (services)                EventService  (TypedEmitter<Relay & QueueMetrics & Ai>)
  emit('workflow-saved', payload) ──►  ├ LogStreamingEventRelay  (93+1+14 subscriptions)
                                       │    └ EventMessageGeneric/… → MessageEventBus.send()
                                       ├ WorkflowFailureNotificationEventRelay (workflow-post-execute)
                                       ├ QueueMetrics (job-counts-updated ← ScalingService)
                                       └ EventsController GET /events/session-started { pushRef }

MessageEventBus ──► log writer (only when streaming is managed by the instance)
                ──► destinations (webhook | syslog | sentry | … , enabled only)
                ──► unconfirmed queue ── confirmSent ──► removed
```

## 2. Boundary

* **In:** `events/event.service.ts`, `events/events.controller.ts`, `events/maps/**`,
  the three contracted relays, `eventbus/**` (classes, bus, log writer seam).
* **Out:** the telemetry relay (Sentry/PostHog lane), `modules/log-streaming.ee/**`
  destinations, `scaling/**`, `push/**`, Vue bundle, `crates/**`, `apps/**`.
* **Ports:** `P-EVENTS-SERVICE`, `P-EVENTS-BUS`, `P-EVENTS-RELAYS`.

## 3. Invariants (E1–E12)

Frozen in `contracts/events.contract.md` §3. The catalogue is verified **key-for-key against
the reference file** by `packages/events-lego/test/01-boundary.test.mjs` (93 relay names,
1 queue-metrics name, 14 `ai-*` names); behaviour is asserted by `02-eventbus.test.mjs`
(envelope, fan-out, retry queue, relay subscriptions, classification, failure notifications).

## 4. Evidence

```bash
cd packages/events-lego && node --test test/*.test.mjs  # 14 tests, 14 pass
node tools/phase6-isolation-gate.mjs                     # G01..G07 PASS
```

* `docs/isolation/evidence/phase6-events-gate.json`
* `results/POOL-010-events-eventbus-lego.md`

## 5. Deliberate deviations (documented, not hidden)

| # | deviation | reason |
| :--- | :--- | :--- |
| D1 | no DI container (`@n8n/di`) — plain classes | the LEGO must be importable without a container; wiring is done by `createEventRuntime()` |
| D2 | the retry loop is exposed as `processRetryQueue()` (plus an optional timer) | makes the unconfirmed-message state machine deterministic for tests |
| D3 | destination adapters (syslog/sentry/webhook) stay outside the LEGO | they belong to `modules/log-streaming.ee/**`, which this LEGO does not own |

## 6. Integration (VERIFIED → INTEGRATED)

`tests/integration/phase6-integration.test.mjs` drives the shared `EventService` from the queue
LEGO (`job-counts-updated`, `job-dequeued`) and asserts the log-streaming relay forwarded the
business events (`workflow-executed`) to the message event bus in the same run.
