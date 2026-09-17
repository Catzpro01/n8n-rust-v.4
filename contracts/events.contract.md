# CONTRACT — `events` LEGO (event service, message event bus, relays)

| field | value |
| :--- | :--- |
| LEGO | `events` |
| Owner | Agent 3 (phase 6) |
| Reference | n8n `2.9.4` — `packages/cli/src/events/**`, `packages/cli/src/eventbus/**` |
| Upstream commit | `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Implemented in | `packages/events-lego` + `packages/reconstructed-engine/src/events-engine.ts` |
| Rust | **FORBIDDEN** (`PROJECT_RULES.md` §1) |
| Status | `VERIFIED` — 14/14 package tests, `tools/phase6-isolation-gate.mjs` PASS |

---

## 1. Boundary

**Owns:** `events/event.service.ts`, `events/events.controller.ts`, `events/maps/**`,
`events/relays/event-relay.ts`, `events/relays/log-streaming.event-relay.ts`,
`events/relays/workflow-failure-notification.event-relay.ts`, `eventbus/**`.

**Never touches:** `events/relays/telemetry.event-relay.ts` (Sentry/PostHog lane),
`modules/log-streaming.ee/**` (destinations), `scaling/**`, `push/**`, the Vue bundle,
`crates/**`, `apps/**`.

**Consumed ports:** `@lego/queue` (`job-counts-updated` payload), `@lego/realtime`
(`Push.sendToUsers`), `@lego/persistence` (`ExecutionRepository`).

**Provided ports:** `P-EVENTS-SERVICE` (`EventService`, `RELAY_EVENT_NAMES`),
`P-EVENTS-BUS` (`MessageEventBus`, `EventMessage*`, `EventDestination`),
`P-EVENTS-RELAYS` (`EventRelay`, `LogStreamingEventRelay`, `WorkflowFailureNotificationEventRelay`).

## 2. Frozen surface

```text
EventService        = TypedEmitter<RelayEventMap & QueueMetricsEventMap & AiEventMap>
relay.event-map.ts  = 93 event names   (extracted key-for-key, gate G03)
queue-metrics map   = ['job-counts-updated']  payload { active, completed, failed, waiting }
ai.event-map.ts     = 14 'ai-*' event names, payload AiEventPayload
message envelope    = { __type, eventName, payload, id, ts }   payload.__type === eventName
message classes     = audit | confirm | execution | generic | node | queue | runner | workflow | ai-node
sender helpers      = sendAuditEvent, sendWorkflowEvent, sendNodeEvent, sendAiNodeEvent,
                      sendExecutionEvent, sendRunnerEvent, sendQueueEvent, confirmSent
event naming        = '<domain>-<past-tense-action>' (workflow-saved, node-post-execute, job-dequeued, ...)
```

## 3. Invariants

| id | invariant | enforced by |
| :--- | :--- | :--- |
| E1 | relay catalogue matches `relay.event-map.ts` key-for-key (93) | `01-boundary`, gate `G03` |
| E2 | `EventService` is a `TypedEmitter`; `emit` is synchronous | `01-boundary`, `02-eventbus` |
| E3 | message envelope + `payload.__type === eventName` | `02-eventbus` |
| E4 | fan-out hits enabled destinations only | `02-eventbus` |
| E5 | unconfirmed messages stay queued until `confirmSent` | `02-eventbus` |
| E6 | retry ticks re-deliver and grow `waitMs` by `retryWaitMs` | `02-eventbus` |
| E7 | log-streaming relay subscribes to the whole catalogue (93 + 1 + 14 = 108) | `02-eventbus` |
| E8 | event → message class mapping by domain prefix | `02-eventbus` |
| E9 | `workflow-post-execute` with `error`/`crashed` raises one failure notification | `02-eventbus` |
| E10 | `session-started` is emitted with `{ pushRef }` | `01-boundary`, `02-eventbus` |
| E11 | the log writer is used only when streaming is managed by the instance | `02-eventbus` |
| E12 | one sender helper exists per message class | `01-boundary` |

## 4. Failure semantics

* Relays never throw into the emitter: `LogStreamingEventRelay` schedules the bus send and the
  caller observes it through `eventBus.sentMessages` after the microtask queue drains.
* When `logs.streamingManagedBy` is not the instance, the bus still fans out to destinations
  but never writes through the log writer (no duplicate persistence in multi-main mode).

## 5. Verification

```bash
cd packages/events-lego && node --test test/*.test.mjs    # 14/14
node tools/events-isolation-gate.mjs                       # boundary + provenance + tests
```

Evidence: `docs/isolation/evidence/phase6-events-gate.json`, result record `results/POOL-010-events-eventbus-lego.md`.
