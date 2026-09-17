# CONTRACT — `realtime` LEGO (push: SSE + WebSocket)

| field | value |
| :--- | :--- |
| LEGO | `realtime` |
| Owner | Agent 3 (phase 6) |
| Reference | n8n `2.9.4` — `packages/cli/src/push/**`, `packages/@n8n/api-types/src/push/**` |
| Upstream commit | `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Implemented in | `packages/realtime-lego` + `packages/reconstructed-engine/src/realtime-engine.ts` |
| Rust | **FORBIDDEN** (`PROJECT_RULES.md` §1) |
| Status | `VERIFIED` — 14/14 package tests, `tools/phase6-isolation-gate.mjs` PASS |

---

## 1. Boundary

**Owns:** `push/push.config.ts`, `push/types.ts`, `push/abstract.push.ts`, `push/sse.push.ts`,
`push/websocket.push.ts`, `push/origin-validator.ts`, `push/index.ts`,
`@n8n/api-types/src/push/**`.

**Never touches:** `scaling/**`, `events/**`, `auth/**`, the Vue `editor-ui` push client
(rules §2 — the client is *consumed*, never modified), `crates/**`, `apps/**`.

**Consumed ports:** `@lego/queue` (`Publisher.publishCommand`), `@lego/events`
(`EventService`), `@lego/credentials` (`AuthService.createAuthMiddleware`).

**Provided ports:** `P-PUSH-SERVICE` (`PushService`, `PushMessage`, `MAX_PAYLOAD_SIZE_BYTES`),
`P-PUSH-BACKENDS` (`AbstractPush`, `SSEPush`, `WebSocketPush`),
`P-PUSH-ORIGIN` (`validateOriginHeaders`).

## 2. Frozen surface

```text
N8N_PUSH_BACKEND           = 'sse' | 'websocket',        default 'websocket'
MAX_PAYLOAD_SIZE_BYTES     = 5 * 1024 * 1024
PING_INTERVAL              = 60 * 1000
route                      = '/<restEndpoint>/push?pushRef=<ref>'
SSE headers                = Content-Type: text/event-stream; charset=UTF-8
                             Cache-Control: no-cache      Connection: keep-alive
SSE handshake              = writeHead(200) + ':ok\n\n' + flush
SSE frame                  = 'data: ' + <json> + '\n\n'   (flush after every frame)
SSE ping                   = ':ping\n\n'
WS liveness                = isAlive:true on add; ping → isAlive=false + ws.ping();
                             next tick without a pong → terminate()
WS client heartbeat        = { type: 'heartbeat' } (exactly one key) — swallowed
WS parse failure           = UnexpectedError('Error parsing push message') + report, never throw
session registry           = connections[pushRef] + userIdByPushRef[pushRef]
wire payload               = jsonStringify({ type, data }, { replaceCircularRefs: true })
origin precedence          = Forwarded → X-Forwarded-Host/X-Forwarded-Proto → Host
errors                     = 'The query parameter "pushRef" is missing!',
                             'Invalid origin!', 401 'Unauthorized'
relay command              = 'relay-execution-lifecycle-event' via n8n.commands
```

## 3. Invariants

| id | invariant | enforced by |
| :--- | :--- | :--- |
| R1 | backend default, 5 MiB ceiling and 60 s ping are byte-exact | `01-boundary` |
| R2 | `PushMessage` catalogue groups execution/workflow/webhook/worker/hotReload/collaboration | `01-boundary`, `02-push` |
| R3 | sessions are keyed by `pushRef` → `userId` | `02-push` |
| R4 | `{type,data}` is serialized with circular refs replaced | `02-push` |
| R5 | re-registering a `pushRef` closes the previous connection first | `02-push` |
| R6 | SSE handshake headers/status/first frame are byte-exact | `01-boundary`, `02-push` |
| R7 | SSE frames and pings are byte-exact and flushed | `02-push` |
| R8 | SSE sessions are removed on `req end`/`close`/`res finish` | `02-push` |
| R9 | WebSocket ping/pong liveness terminates stale sockets | `01-boundary`, `02-push` |
| R10 | heartbeat frames are swallowed; malformed frames are reported, never thrown | `01-boundary`, `02-push` |
| R11 | origin precedence + default-port/IPv6 normalization | `01-boundary`, `02-push` |
| R12 | production guards: missing `pushRef`, bad origin, backend negotiation 401 | `01-boundary`, `02-push` |
| R13 | worker/non-holding main relays via pubsub; >5 MiB `nodeExecuteAfterData` is dropped | `01-boundary`, `02-push` |

## 4. Failure semantics

* A worker (or a main that does not hold the session) never pushes directly: the message is
  relayed with `relay-execution-lifecycle-event` and only the holder delivers it to the client.
* Oversized `nodeExecuteAfterData` is **omitted entirely** (the frontend re-fetches run data at
  the end of the execution); the warning text is frozen in R13.

## 5. Verification

```bash
cd packages/realtime-lego && node --test test/*.test.mjs  # 14/14
node tools/realtime-isolation-gate.mjs                     # boundary + provenance + tests
```

Evidence: `docs/isolation/evidence/phase6-realtime-gate.json`, result record `results/POOL-011-realtime-push-lego.md`.
