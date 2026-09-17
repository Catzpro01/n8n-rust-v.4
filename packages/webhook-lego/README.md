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

Workflow execution and binary persistence remain injected ports.

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

## Waiting form rendering (TASK-424)

`WaitingFormManager` reconstructs `/form-waiting/:executionId/:suffix?` through persistence,
parent-traversal, and form-execution ports. It serves the execution-status polling endpoint,
classifies waiting Form/Wait nodes, sanitizes authentication cookies, finds the nearest executed
completion Form, disables stack nodes only on POST, and renders sandboxed default completion HTML.
The native HTTP adapter preserves empty `noWebhookResponse` results and serves both completion HTML
and status text directly.

## Native request body parsing (TASK-425)

The native HTTP transport now parses JSON, repeated URL-encoded values, text/XML, opaque binary, and
binary-safe multipart bodies while retaining `rawBody`. Multipart output matches the reference
`{ data, files }` shape, normalizes single values, preserves repeated fields/files, applies a
per-file size limit, and crosses binary persistence only through an injected `storeFile` callback.
Aggregate payload limits still fail before manager execution.

## Response and streaming transport (TASK-426)

Symbol-tagged no-response, static, and stream variants make response ownership explicit. The request
handler preserves empty responses and translates custom status/headers, while the native server
pipes stream and NDJSON bodies without buffering. Respond-to-Webhook binary IDs cross an injected
`getBinaryStream` port; JSON and in-memory Buffers remain static responses.

## Response extraction (TASK-427)

The `onReceived` and `lastNode` extractors now preserve response-data precedence, first-output
backward compatibility, optional all-output scanning, nested JSON property selection, all-entry
JSON, `noData`, exact binary-property errors, in-memory base64 decoding, MIME precedence, and
persisted binary streaming through the existing storage port.
