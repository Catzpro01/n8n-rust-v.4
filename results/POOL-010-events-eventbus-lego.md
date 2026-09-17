# TASK RESULT: POOL-010-events-eventbus-lego

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-3 (branch arena/01a0b16c-n8n-rust-v-4)`
- **LEGO COMPONENT**: `events — n8n 2.9.4 event service, message event bus and relays`
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-17 22:4x UTC`

---

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | :--- |
| `read_messages` | ✓ SUCCESS | `0` |
| `write_file` | ✓ SUCCESS | `0` |
| `run_gates` | ✓ SUCCESS | `0` |
| `git_commit` | ✓ SUCCESS | `0` |
| `git_push` | ✓ SUCCESS | `0` |

### Detailed Logs

#### Operation: `read_messages`

```text
Follow-up to POOL-009 (same intake evidence: dynamic_task_pool unreachable, github-only egress).
The events subsystem existed in the anatomy (docs/anatomy/14-events.md) and in the reference
(packages/cli/src/events/**, packages/cli/src/eventbus/**) but had no contract, no isolation doc,
no package and no engine on ANY branch.
```

#### Operation: `write_file`

```text
contracts/events.contract.md                     boundary + frozen surface + E1..E12
docs/isolation/events.md                         X-Ray, boundary, evidence, deviations D1-D3
packages/events-lego/src/model-surface.ts        provenance, ports, invariants E1..E12
packages/events-lego/src/index.ts                re-exports the events engine
packages/events-lego/package.json                @lego/events
packages/events-lego/manifest/ownership.json     owns events/** + eventbus/** (minus telemetry lane)
packages/reconstructed-engine/src/events-engine.ts  EventService, EventMessage* classes,
                                                 MessageEventBus (destinations, retry queue,
                                                 log writer seam), relays, classification
packages/events-lego/test/01-boundary.test.mjs   catalogue + provenance drift (7 tests)
packages/events-lego/test/02-eventbus.test.mjs   envelope/fan-out/retry/relay behaviour (7 tests)

Source-verified catalogue (extracted from the pinned reference, not copied by hand):
  relay.event-map.ts         93 top-level event names  (e.g. workflow-saved, node-post-execute,
                             execution-cancelled, job-dequeued, user-logged-in, runner-task-requested)
  queue-metrics.event-map.ts exactly one: job-counts-updated { active, completed, failed, waiting }
  ai.event-map.ts            AiEventPayload + 14 'ai-*' names
  envelope                   { __type, eventName, payload, id, ts } with payload.__type === eventName
  subscriptions              LogStreamingEventRelay = 93 + 1 + 14 = 108 listeners
  helpers                    sendAuditEvent | sendWorkflowEvent | sendNodeEvent | sendAiNodeEvent |
                             sendExecutionEvent | sendRunnerEvent | sendQueueEvent + confirmSent
```

#### Operation: `run_gates`

```text
cd packages/events-lego && node --test test/*.test.mjs     → 14/14 PASS
node tools/phase6-isolation-gate.mjs                        → G03 catalogue key-for-key PASS
node tests/compatibility/contract_conformance.mjs           → 21/21 PASS
python3 tests/integration/boundary_audit.py                 → PASS
```

### Next task (non-blocking)

`POOL-011-realtime-push-lego` — the push subsystem (SSE + WebSocket) that consumes the
`relay-execution-lifecycle-event` command of the queue LEGO and delivers
`sendWorkerStatusMessage` for the worker-status round trip.
