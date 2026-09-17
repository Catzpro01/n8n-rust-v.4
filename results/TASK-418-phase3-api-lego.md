# TASK RESULT: TASK-418-phase3-api-lego

**LEGO:** API  
**Task ID:** TASK-418-phase3-api-lego  
**Contract:** `contracts/api.contract.md`  
**Isolation blueprint:** `docs/isolation/api.md`  
**Package:** `packages/api-lego`  
**Status:** **VERIFIED**

---

## 1. Summary of Deliverables

Reconstructed pure JavaScript (Node.js ESM, zero dependencies) implementation of the API LEGO 1:1 against n8n 2.9.4:

1. **Response Envelopes (`src/envelope.mjs`)**:
   - `formatSuccessResponse`: `{ data: <result> }` for objects, booleans, and nulls.
   - `formatErrorResponse`: maps `ResponseError` subclasses to `HTTP <statusCode> { code, message, hint?, meta? }`, and unknown errors to `500 { code: 0, message }`.
   - `formatUnauthenticatedResponse`: `401 { status: 'error', message: 'Unauthorized' }` (AuthService middleware format).
   - `formatPublicApiError`: `{ message }` for public API v1 endpoints.

2. **Error Hierarchy (`src/errors.mjs`)**:
   - `ResponseError` (base class)
   - `BadRequestError` (400), `UnauthenticatedError` (401), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409), `UnprocessableRequestError` (422), `ServiceUnavailableError` (503), `InternalServerError` (500).
   - `WorkflowValidationError`: `BadRequestError` with `meta: { validationError: true }`.

3. **Validation Formatting (`src/validation.mjs`)**:
   - `formatZodIssue`: extracts and formats raw first issue object on `400` without wrapping into `{ code, message }` envelope, matching reference zod validation middleware.
   - `validateDto`: validates inputs and formats the first failure issue.

4. **Dispatcher & Route Pipeline (`src/dispatcher.mjs`)**:
   - `ApiDispatcher`: handles route registration (`GET`, `POST`, `PATCH`, `PUT`, `DELETE`).
   - Pipeline handles health endpoints (`/healthz`, `/healthz/readiness`), public API key authentication (`X-N8N-API-KEY`), internal auth validation (`skipAuth`), DTO validation, and resource-specific quirks:
     - Workflow not found: `404 { code: 404, message: 'Could not load the workflow - you can only access workflows owned by you' }`.
     - Execution not found: `200 {}`.
     - Non-numeric execution ID: `400 { code: 400, message: 'Execution ID is not a number' }`.
     - Unmatched GET routes: `404` HTML SPA fallback.

---

## 2. Verification Evidence

- `npm --prefix packages/api-lego test`: **12/12 PASS**
  - All golden cases from `tests/reference/agent-4/golden/api.golden.json` verified.
  - 2 negative controls (unhandled error has code 0, never 500; unauthenticated does not use `{code,message}`).
- `node tools/api-lego-gate.mjs`: **6/6 PASS**
  - A01: zero runtime dependencies (0 dependencies)
  - A02: source boundary import-closed (5 source files, relative and node: builtins only)
  - A03: api conformance suite (12 pass / 0 fail)
  - A04: reference tree pinned (15050 files, f8da35180669d798…)
  - A05: formal api contract present (8/8 core symbols contracted)
  - A06: reference golden parity check (golden constants & cases verified)
- `npm run verify:all`: **14/14 PASS** across all monorepo suites and gates.
