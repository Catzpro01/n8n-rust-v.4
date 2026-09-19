# CONTRACT — `queue` LEGO (scaling / queue mode)

| field | value |
| :--- | :--- |
| LEGO | `queue` |
| Owner | Agent 3 (phase 6) |
| Reference | n8n `2.9.4` — `reference/n8n/packages/cli/src/scaling/**` |
| Upstream commit | `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Implemented in | `packages/queue-lego` + `packages/reconstructed-engine/src/queue-engine.ts` |
| Rust | **FORBIDDEN** (`PROJECT_RULES.md` §1) |
| Status | `INTEGRATED` — 17/17 package tests + 4/4 integration tests, per-LEGO gate + `tools/phase6-isolation-gate.mjs` 8/8 PASS |

---

## 1. Boundary

**Owns** (read-only mirror, `manifest/ownership.json`):

```text
reference/n8n/packages/cli/src/scaling/constants.ts
reference/n8n/packages/cli/src/scaling/scaling.types.ts
reference/n8n/packages/cli/src/scaling/scaling.service.ts
reference/n8n/packages/cli/src/scaling/job-processor.ts
reference/n8n/packages/cli/src/scaling/worker-server.ts
reference/n8n/packages/cli/src/scaling/worker-status.service.ee.ts
reference/n8n/packages/cli/src/scaling/redis/**
reference/n8n/packages/cli/src/scaling/pubsub/**
```

**Never touches:** `packages/cli/src/executions/**`, `packages/cli/src/push/**`,
`packages/cli/src/events/**`, the Vue `editor-ui` bundle (rules §2), `crates/**`, `apps/**`.

**Consumed ports** (no hidden dependency):

| port | symbols | kind |
| :--- | :--- | :--- |
| `@lego/events` | `EventService` (`job-dequeued`, `job-failed`, `job-counts-updated`) | value |
| `@lego/persistence` | `ExecutionRepository`, `WorkflowRepository` | value |
| `@lego/realtime` | `Push.sendToUsers` (worker status response) | value |
| `@lego/execution` | `WorkflowExecute`, `ManualExecutionService` | value |

**Provided ports:** `P-QUEUE-SCALING` (`ScalingService`, `JobProcessor`, `MemoryJobQueue`),
`P-QUEUE-PUBSUB` (`Publisher`, `Subscriber`, `MemoryPubSubBroker`),
`P-QUEUE-STATUS` (worker server endpoints + status payload).

## 2. Frozen surface (byte-exact strings)

```text
QUEUE_NAME                     = 'jobs'
JOB_TYPE_NAME                  = 'job'
COMMAND_PUBSUB_CHANNEL         = 'n8n.commands'
WORKER_RESPONSE_PUBSUB_CHANNEL = 'n8n.worker-response'
MCP_RELAY_PUBSUB_CHANNEL       = 'n8n.mcp-relay'
QUEUE_SETTINGS.maxStalledCount = 0
PAYLOAD DECORATION             = { ...msg, senderId, selfSend, debounce }
REDIS CHANNELS                 = `${redisPrefix}:${CHANNEL}`
```

Command classification:

| set | members |
| :--- | :--- |
| `SELF_SEND_COMMANDS` | `add-webhooks-triggers-and-pollers`, `remove-triggers-and-pollers` |
| `IMMEDIATE_COMMANDS` | `SELF_SEND_COMMANDS` ∪ {`relay-execution-lifecycle-event`, `relay-chat-stream-event`} |

Job messages (`scaling.types.ts`): `respond-to-webhook`, `job-finished` (v1 legacy **and**
`version: 2` with `JobFinishedProps`), `job-failed`, `abort-job`, `send-chunk`, `mcp-response`.

## 3. Invariants

| id | invariant | enforced by |
| :--- | :--- | :--- |
| Q1 | queue/channel names are byte-exact | `01-boundary.test.mjs`, gate `G02` |
| Q2 | `SELF_SEND_COMMANDS` set is exact | `01-boundary`, `02-scaling` |
| Q3 | `IMMEDIATE_COMMANDS` set is exact and a superset of Q2 | `01-boundary` |
| Q4 | job message kinds + v2 `job-finished` shape | `02-scaling` |
| Q5 | publisher decorates `{senderId, selfSend, debounce}`, inert outside queue mode | `02-scaling` |
| Q6 | channels carry the redis prefix | `02-scaling` |
| Q7 | subscriber drops self-messages unless `selfSend`, honours `targets`, debounces non-immediate commands | `02-scaling` |
| Q8 | queue settings force `maxStalledCount: 0` | `01-boundary`, `02-scaling` |
| Q9 | invalid job data → `UnexpectedError('Worker received invalid job')` reported on the bus | `02-scaling` |
| Q10 | `crashed` execution → `{ success: false }`, workflow never starts | `02-scaling` |
| Q11 | missing execution → `Worker failed to find data for execution <id> (job <id>)`; missing static data → `Worker failed to find workflow <wf> to run execution <ex> (job <id>)` | `02-scaling` |
| Q12 | recovery marks dangling `new`/`running` executions `crashed`; a full batch halves the next wait | `02-scaling` |
| Q13 | `get-worker-status` → `response-to-get-worker-status` → push `sendWorkerStatusMessage` to the requester only | `02-scaling` |
| Q14 | queue metrics emit `job-counts-updated` then reset `completed`/`failed` counters | `02-scaling` |

## 4. Failure semantics

* Worker never throws at Bull: the processor catches, calls `job.progress(job-failed)` and the
  job settles `completed` — the failure is observable on the bus, not by a rejection (1:1
  with `scaling.service.ts#setupWorker`).
* `get-worker-status` is **debounced** (it is not in `IMMEDIATE_COMMANDS`), so callers must
  flush the debounce window before asserting the response.
* Queue metrics require `endpoints.metrics.queueMetricsInterval` seconds between ticks.

## 5. Verification

```bash
cd packages/queue-lego && node --test test/*.test.mjs     # 17/17
node tools/queue-isolation-gate.mjs                        # boundary + provenance + tests
```

Integration: `tests/integration/phase6-integration.test.mjs` (gate `G08`, 4/4).

Evidence: `docs/isolation/evidence/phase6-queue-gate.json`, result record `results/POOL-009-queue-scaling-lego.md`.
