# LEGO 13 — QUEUE (scaling / queue mode) isolation record

| field | value |
| :--- | :--- |
| LEGO | `queue` |
| Owner | Agent 3 (phase 6, task `POOL-009`) |
| Reference | n8n `2.9.4`, upstream `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Contract | `contracts/queue.contract.md` |
| Package | `packages/queue-lego` |
| Engine | `packages/reconstructed-engine/src/queue-engine.ts` |
| Cycle | `DISCOVERED → ISOLATED → CONTRACTED → IMPLEMENTED → VERIFIED → INTEGRATED` |
| Rust | not started (rule §1) |

## 1. X-Ray — what the subsystem does in the reference

```text
main (leader)                                   worker(s)
  │ ScalingService.setupQueue()                   │ ScalingService.setupWorker(concurrency)
  │  ├ Bull queue 'jobs' (prefix, maxStalledCount=0)  ├ queue.process('job', N, cb)
  │  ├ scheduleQueueRecovery(0)  ──► recoverFromQueue() │  ├ event 'job-dequeued'
  │  └ scheduleQueueMetrics()    ──► job-counts-updated│  ├ hasValidJobData() guard
  │                                                    │  └ JobProcessor.processJob()
  │ Publisher  ── n8n.commands ──────────────────────► │      ├ setRunning / static data
  │ Subscriber ◄── n8n.worker-response ─────────────── │      ├ job.progress(respond-to-webhook | send-chunk | mcp-response)
  │ Subscriber ◄── n8n.mcp-relay ────────────────────► │      └ job.progress(job-finished v2)
  ▼                                                    ▼
WorkerStatusService.requestWorkerStatus(user) ──► get-worker-status ──► response-to-get-worker-status
                                              ──► push.sendToUsers(sendWorkerStatusMessage, [user])
```

## 2. Boundary

* **In:** `scaling/constants.ts`, `scaling/scaling.types.ts`, `scaling/scaling.service.ts`,
  `scaling/job-processor.ts`, `scaling/worker-server.ts`, `scaling/worker-status.service.ee.ts`,
  `scaling/redis/**`, `scaling/pubsub/**` (mirror only — `reference/**` is read-only).
* **Out:** executions REST layer, `push/**`, `events/**`, Vue bundle, `crates/**`, `apps/**`.
* **Ports:** see §2 of the contract (`P-QUEUE-SCALING`, `P-QUEUE-PUBSUB`, `P-QUEUE-STATUS`).

## 3. Invariants (Q1–Q14)

Frozen in `contracts/queue.contract.md` §3 and asserted by
`packages/queue-lego/test/01-boundary.test.mjs` (reference drift + provenance) and
`packages/queue-lego/test/02-scaling.test.mjs` (behaviour).

## 4. Evidence

```bash
cd packages/queue-lego && node --test test/*.test.mjs   # 17 tests, 17 pass
node tools/phase6-isolation-gate.mjs                     # G01..G07 PASS
```

* `docs/isolation/evidence/phase6-queue-gate.json`
* `results/POOL-009-queue-scaling-lego.md`

## 5. Deliberate deviations (documented, not hidden)

| # | deviation | reason |
| :--- | :--- | :--- |
| D1 | Bull/Redis replaced by `MemoryJobQueue` + `MemoryPubSubBroker` | ZERO RUST/zero-dependency reconstruction: the observable semantics (settings, statuses, message kinds) are preserved and testable; a real deployment injects a backed queue through the same seam (`queueFactory`, `broker`) |
| D2 | Worker status payload fields that are OS-specific (`os.*`, memory) are produced by an injected `statusFactory` | keeps the engine deterministic; the reference getter is preserved in the contract (§2 Q13) |
| D3 | Timers are `unref()`-ed | the engine must never keep a process alive on its own |

## 6. Integration (VERIFIED → INTEGRATED)

Wired with the other two Phase-6 LEGOs in `tests/integration/phase6-integration.test.mjs`:
worker dequeues `job` → `JobProcessor` → `job-finished` v2 on the per-job channel, while the
leader runs `recoverFromQueue()` and one `collectQueueMetrics()` cycle whose
`job-counts-updated` payload reaches the events relay. The worker-status round trip published
through `Publisher` is delivered over a real SSE session by the realtime LEGO.
