# LEGO Contract: API

Reference: n8n 2.9.4. Status: **VERIFIED** (Agent 4, Phase 2 — contract backed by reference tests + live 11/11 smoke).
Analysis: `docs/isolation/api.md`. Golden: `tests/reference/agent-4/golden/api.golden.json`, `tests/reference/agent-4/live/baseline-before.json`.

## 1. Purpose
Expose the platform over HTTP: the internal REST API (`/rest/*`, used by the editor), the public REST API (`/api/v1/*`, API-key based, OpenAPI driven), health endpoints, push (SSE/WebSocket) and static editor assets. Translate HTTP ↔ service calls, apply auth/permission/validation middleware and a **uniform response envelope**.

## 2. Inputs
| Input | Type | Producer |
|---|---|---|
| HTTP request | express `Request` on `N8N_PORT` (default 5678), `N8N_PATH` prefix, `N8N_ENDPOINT_REST` (default `rest`) | Browser / client |
| Auth | cookie `n8n-auth` (JWT, `AuthService`), `X-N8N-API-KEY` header (public API), MFA state, `browserId` | Client |
| DTOs | `@n8n/api-types` zod classes (`LoginRequestDto`, `CreateWorkflowDto`, `ImportWorkflowFromUrlDto`, …) validated by `@Body`/`@Query`/`@Param` decorators | `controller.registry.ts` |
| Route table | `@RestController(basePath)` + `@Get/@Post/@Patch/@Put/@Delete(path, { skipAuth?, rateLimit?, usesTemplates? })`, `@GlobalScope`, `@ProjectScope`, `@Licensed` | controllers |
| Public API | `packages/cli/src/public-api/v1/openapi.yml` + `handlers/*` via `express-openapi-validator` | |

## 3. Outputs
| Output | Shape (verified) |
|---|---|
| Success | `200 { data: <result> }` (`ResponseHelper.sendSuccessResponse`; controller return value wrapped) — also for boolean results (`{data:true}`), `null` (`{data:null}`), or raw when handler wrote the response itself (`@Get(..., {rawBody})`/`res.send`) |
| Known error (`ResponseError` subclasses) | `HTTP <httpStatusCode> { code: <errorCode \|\| httpStatusCode>, message, hint?, meta?, stacktrace? (non-production) }` |
| Unknown error | `500 { code: 0, message }` |
| Unauthenticated | `401 { status: 'error', message: 'Unauthorized' }` (`AuthService.authMiddleware`, **not** the envelope) |
| Zod validation failure | `400` with the **first zod issue object** as body, e.g. `{code:'invalid_type',expected:'string',received:'undefined',path:['emailOrLdapLoginId'],message:'Required'}` or `{code:'too_small',minimum:1,type:'string',inclusive:true,exact:false,message:'Workflow name is required',path:['name']}` |
| Public API errors | `401 {message:"'X-N8N-API-KEY' header required"}`, `401 {message:'unauthorized'}`, `404 {message:'Not Found'}`, `400 {message, …}` (openapi validator) |
| Health | `GET /healthz` → `200 {"status":"ok"}`; `GET /healthz/readiness` → `200 {"status":"ok"}` / `503 {"status":"error"}` when DB not connected/migrated |
| SPA fallback | any unmatched `GET` (incl. `/rest/unknown`) → **404** with `text/html` editor index (history-API fallback) |
| Push | SSE `/rest/push` or WebSocket; events `executionStarted`, `nodeExecuteAfter`, `executionFinished`, `workflowActivated`, `testWebhookReceived`, … |

## 4. Responsibilities
- Boot (`abstract-server.ts` → `server.ts`): express app, body parsers (JSON limit `N8N_PAYLOAD_SIZE_MAX`, raw body kept), CORS for dev, `rawBodyReader`, request logging, `helmet`-like headers, `sameSite` cookie policy.
- Controller registration (`controller.registry.ts`): for every method — rate limit → `skipAuth ? none : authMiddleware` → license gate → global/project scope check → DTO validation → handler → `sendSuccessResponse` or `sendErrorResponse`.
- Owner setup guard: `POST /rest/owner/setup` allowed only when `userManagement.isInstanceOwnerSetUp` is false; repeat → `400 Instance owner already setup`.
- Settings: `GET /rest/settings` public mode (no cookie) returns limited frontend settings without `versionCli`; authenticated returns full (`versionCli: '2.9.4'`).
- Workflows controller specifics: `POST /rest/workflows` client-supplied `id` honoured; existing `id` → `400 Workflow with id X exists already.`; unknown id → `404 Could not load the workflow - you can only access workflows owned by you`; `POST /:id/run` → `{data:{executionId, waitingForWebhook?}}` (test webhooks → `waitingForWebhook:true`); `POST /:id/activate` body `{versionId}`; list `GET /rest/workflows` → `{data:{count,data:[…]}}` for paginated, raw `{count,data}` inside `data` when `filter` is used (see live harness note); delete requires archived.
- Executions controller: `GET /rest/executions?filter=&limit=` → `{data:{count,results,estimated}}`; `GET /rest/executions/:id` → `{data: IExecutionResponse}` with `data` flatted string; non-numeric id → 400; unknown → `200 {}`.
- Public API mounted at `/api/v1` with its own auth, validation and JSON error format; disabled by `N8N_PUBLIC_API_DISABLED`.
- Static: editor at `/`, `index.html` with `N8N_PATH`/rest endpoint injected; `/assets/*` immutable cache; `/favicon.ico`, `/static/*`.

## 5. Non-responsibilities
- No business logic: controllers delegate to services (`WorkflowService`, `ExecutionService`, `CredentialsService`, `ActiveWorkflowManager`, …).
- Does not serve webhooks in the main express app path ordering sense — the `WebhookServer` subclass mounts them; in `main` mode `Server` extends the same `AbstractServer` and mounts both, but the routes are owned by the Webhook LEGO.
- Does not run executions (→ Execution via `WorkflowExecutionService.executeManually`).
- Does not own the DTO semantics of other LEGOs (validation lives in `@n8n/api-types`, shared).
- Does not implement user management/RBAC semantics (→ Auth/Users; the API only applies `@GlobalScope`/`@ProjectScope` decorators).

## 6. Dependencies (verified)
| Module | Class |
|---|---|
| `cli/src/abstract-server.ts`, `server.ts`, `controller.registry.ts`, `response-helper.ts`, `requests.ts`, `middlewares/*`, `push/*`, `controllers/*`, `*/**.controller.ts`, `public-api/**` | INTERNAL |
| `@n8n/api-types` (DTOs, `FrontendSettings`, push payloads) | SHARED |
| `@n8n/decorators` (`RestController`, `Get`, `Body`, `GlobalScope`, `Licensed`) | SHARED |
| `express`, `express-openapi-validator`, `express-rate-limit`, `cookie-parser`, `ws`, `zod` | EXTERNAL |
| `AuthService`, `JwtService`, `License`, `UrlService`, `FrontendService` | INTERNAL (auth/config) |
| Services of other LEGOs: `WorkflowService`, `WorkflowFinderService`, `ExecutionService`, `ActiveWorkflowManager`, `TestWebhooks`, `CredentialsService`, `WorkflowExecutionService` | CROSS-BOUNDARY (outbound calls) |
| `@n8n/db` repositories used directly by some controllers (`SettingsRepository`, `WorkflowRepository`, `SharedWorkflowRepository`) | CROSS-BOUNDARY → Persistence (documented coupling; not refactored) |

## 7. Error behavior
| Class (`cli/src/errors/response-errors/*`) | HTTP | `code` |
|---|---|---|
| `BadRequestError` | 400 | 400 (or custom `errorCode`) |
| `UnauthenticatedError` | 401 | 401 |
| `UnauthorizedError`/`ForbiddenError` | 403 | 403 |
| `NotFoundError` | 404 | 404 |
| `ConflictError` (webhook path taken) | 409 | 409 |
| `UnprocessableRequestError` | 422 | 422 |
| `ServiceUnavailableError` | 503 | 503 |
| `InternalServerError` / any non-`ResponseError` | 500 | 0 |
| `WorkflowActivationError` in activate | 400 | 400 + `meta:{validationError:true}` |
| Wrong login | 401 `Wrong username or password. Do you have caps lock on?` | 401 |
Stack traces (`stacktrace`) appear only outside production (`NODE_ENV !== 'production'` / `inDevelopment`); consumers must ignore them.

## 8. Lifecycle
```
boot → AbstractServer.init() (express, parsers, /healthz) → Server.configure() (controllers via registry, public API, push, static SPA) → listen 0.0.0.0:5678 → "Editor is now accessible via: …"
request → rate limit → auth (cookie / API key) → license → scopes → DTO validation → controller → service → {data} | {code,message}
shutdown → ShutdownService → close server (in-flight requests drained), push connections closed
```
Golden (live 2.9.4): `/healthz` 200 `{"status":"ok"}`; owner setup `role:'global:owner'`; `/rest/workflows` unauthenticated → 401 `{status:'error',message:'Unauthorized'}`; create workflow envelope keys as recorded; `/rest/unknown` → 404 html; public API no key → 401 `'X-N8N-API-KEY' header required`.

## 9. Data ownership
- **Owns:** no domain tables. Session/auth state: JWT cookie (stateless, `auth_identity`/`user` tables belong to Users), `api_key`/`user_api_keys` semantics shared with Public API auth; in-memory push connection registry; rate-limit counters.
- **Reads/writes via services only** (except documented direct repository uses).

## 10. External interfaces
- Internal REST: `/rest/login`, `/rest/logout`, `/rest/owner/setup`, `/rest/settings`, `/rest/workflows[...]`, `/rest/executions[...]`, `/rest/credentials[...]`, `/rest/active-workflows[...]`, `/rest/push`, `/rest/node-types`, `/rest/credential-types`, `/rest/users`, `/rest/projects`, `/rest/tags`, `/rest/variables`, …
- Public API v1: `/api/v1/{workflows,executions,credentials,users,tags,variables,projects,audit,source-control}`, `/api/v1/docs` (Swagger UI when enabled).
- Health: `/healthz`, `/healthz/readiness`, `/metrics` (Prometheus when `N8N_METRICS`).
- Static: `/`, `/assets/*`, `/static/*`, `/types/nodes.json`, `/types/credentials.json`, `/icons/*`.

## 11. Compatibility requirements
- Envelopes exactly as in §3; editor 2.9.4 depends on `{data}` and on `code/message/hint/meta`.
- Zod validation body is the raw first issue (no envelope) — keep.
- 401 for unauthenticated uses `{status:'error',message:'Unauthorized'}` — keep.
- Unknown `/rest/*` routes fall through to the SPA with 404 html — keep (editor deep links rely on the fallback for non-`/rest` paths; `/rest` unknown 404 is a side effect, not a JSON error).
- `GET /rest/executions/:id` for missing id returns `200 {}`, not 404 — keep (editor handles it).
- Cookie name `n8n-auth`, `sameSite` per `N8N_SAMESITE_COOKIE`, `secure` per protocol.
- Public API must keep OpenAPI-validated JSON errors with `message` only.
