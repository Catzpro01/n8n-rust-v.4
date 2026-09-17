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
