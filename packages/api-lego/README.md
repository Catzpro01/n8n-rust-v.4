# API LEGO (`@lego/api`)

Phase-3 JavaScript ESM reconstruction of the n8n 2.9.4 HTTP API boundary.

## Responsibilities
- **Response Envelopes**:
  - Success envelope: `200 { data: <result> }` for objects, booleans, and nulls.
  - Known response error format: `HTTP <statusCode> { code, message, hint?, meta? }`.
  - Unknown error format: `500 { code: 0, message }`.
  - Unauthenticated format: `401 { status: 'error', message: 'Unauthorized' }`.
  - Public API error format: `{ message }`.
  - Zod validation formatting: raw first issue object on `400` without `{ code, message }` envelope.
- **Resource-Specific Fallbacks**:
  - Workflow not found: `404 { code: 404, message: 'Could not load the workflow - you can only access workflows owned by you' }`.
  - Execution not found: `200 {}`.
  - Non-numeric execution ID: `400 { code: 400, message: 'Execution ID is not a number' }`.
  - Unmatched GET routes: `404` HTML SPA fallback.
- **Health Endpoints**:
  - `GET /healthz`: `200 { status: 'ok' }`.
  - `GET /healthz/readiness`: `200 { status: 'ok' }`.
- **Zero Runtime Dependencies**: Pure Node.js ESM.
