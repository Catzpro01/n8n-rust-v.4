# LEGO 15 — REALTIME (push: SSE + WebSocket) isolation record

| field | value |
| :--- | :--- |
| LEGO | `realtime` |
| Owner | Agent 3 (phase 6, task `POOL-011`) |
| Reference | n8n `2.9.4`, upstream `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Contract | `contracts/realtime.contract.md` |
| Package | `packages/realtime-lego` |
| Engine | `packages/reconstructed-engine/src/realtime-engine.ts` |
| Cycle | `DISCOVERED → ISOLATED → CONTRACTED → IMPLEMENTED → VERIFIED` |
| Rust | not started (rule §1) |

## 1. X-Ray

```text
editor-ui  ── GET /rest/push?pushRef=… (SSE) ──►  Push.handleRequest
           ── WS upgrade same path (websocket) ──►    ├ production: validateOriginHeaders
                                                     ├ missing pushRef → 400
                                                     ├ websocket backend + no ws → 401
                                                     └ backend.add(pushRef, userId, conn)
                                                          └ emit 'editorUiConnected'

service ── push.send(msg, pushRef)
             ├ holder (main, session present) ──► backend.sendToOne → 'data: {json}\n\n'
             └ worker / non-holder ──► publisher.publishCommand('relay-execution-lifecycle-event')
                                        └ holder's @OnPubSubEvent → send()  (drop >5 MiB node data)
```

## 2. Boundary

* **In:** `push/push.config.ts`, `push/types.ts`, `push/abstract.push.ts`, `push/sse.push.ts`,
  `push/websocket.push.ts`, `push/origin-validator.ts`, `push/index.ts`,
  `@n8n/api-types/src/push/**`.
* **Out:** `scaling/**`, `events/**`, `auth/**` (only the middleware seam is consumed), the Vue
  push client (never modified — rules §2), `crates/**`, `apps/**`.
* **Ports:** `P-PUSH-SERVICE`, `P-PUSH-BACKENDS`, `P-PUSH-ORIGIN`.

## 3. Invariants (R1–R13)

Frozen in `contracts/realtime.contract.md` §3. Wire-level strings (SSE handshake/frames/ping,
WS heartbeat/liveness, origin error texts, relay guard) are checked against the reference source
by `01-boundary.test.mjs` and behaviourally by `02-push.test.mjs`.

## 4. Evidence

```bash
cd packages/realtime-lego && node --test test/*.test.mjs  # 14 tests, 14 pass
node tools/phase6-isolation-gate.mjs                       # G01..G07 PASS
```

* `docs/isolation/evidence/phase6-realtime-gate.json`
* `results/POOL-011-realtime-push-lego.md`

## 5. Deliberate deviations (documented, not hidden)

| # | deviation | reason |
| :--- | :--- | :--- |
| D1 | sockets are represented by `PushRequest`/`PushResponse`/`WebSocketLike` twins | the wire bytes and lifecycle rules are what the frontend observes; the network layer is injected by the host process |
| D2 | the 60 s ping loop is exposed as `pingAll()` on demand (plus `PING_INTERVAL_MS` constant) | deterministic tests, identical production timing constant |
| D3 | `AuthService` middleware is a declared consumed port, not re-implemented | credentials/auth is a different LEGO (`contracts/credentials.contract.md`) |
