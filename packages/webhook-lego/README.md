# Webhook LEGO — Phase 3

Dependency-free JavaScript reconstruction of n8n 2.9.4 webhook registration and HTTP routing.

## Boundary

- `WebhookService` owns route registration, lookup, dynamic matching, conflicts, and deregistration.
- Repository and cache are replaceable persistence ports; an in-memory implementation is included.
- `LiveWebhookManager` maps a matched route to an injected Execution callback.
- `WebhookRequestHandler` handles method guards, CORS preflight, default responses, and error envelopes without depending on Express.
- `TestWebhookRegistry` provides 120-second, one-shot editor listeners.

Covered behavior includes static and dynamic routes, longest static match, path parameters, wrong-method suggestions, production/test 404 hints, unsupported-method 500 behavior, CORS, conflicts, and test-listener expiry.

```bash
npm --prefix packages/webhook-lego test
node tools/webhook-lego-gate.mjs
```

Body parsing, multipart/binary storage, waiting-execution resume, and streaming response transport remain host adapters outside this increment.

## Native HTTP transport (TASK-420)

`WebhookHttpServer` makes the existing handler runnable on Node's built-in HTTP server without
Express or another dependency. It supports configurable host/port/base path and body limits,
JSON/text/binary request adaptation, query parsing, CORS through the existing handler, custom
status/headers, binary/stream responses, and deterministic shutdown. Workflow execution remains an
injected callback on `LiveWebhookManager`.

## Waiting execution resume (TASK-421)

`WaitingWebhookManager` reconstructs `/webhook-waiting/:executionId/:suffix?` behind explicit
persistence, webhook-resolution, and execution-resume ports. It includes state guards, signed
send-and-wait URLs, wait-state mutation, HITL output rewiring, input override preservation, and
concurrent-resume suppression. It adds no database or execution-engine import.
