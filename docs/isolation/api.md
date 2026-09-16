# LEGO Isolation: API

**Agent:** Agent 4 — Phase 2 LEGO Isolation
**Reference:** n8n 2.9.4 (`reference/n8n`, upstream `b6dc2787`)
**Status:** VERIFIED (ANALYZED → ISOLATED → TESTED → VERIFIED; documentation + contract, no source change required; smoke 11/11 before and after, live verification passed — see `docs/isolation/agent-4-report.md`)

---

## 1. Two APIs, one boundary pattern

| API | Mount | Auth | Definition |
| :--- | :--- | :--- | :--- |
| Internal REST (editor) | `/${endpoints.rest}` = `/rest` | cookie JWT `n8n-auth` (+ MFA, browser id) | `@RestController` classes discovered by `ControllerRegistry` |
| Public REST | `/api/v1` | `X-N8N-API-KEY` header | `packages/cli/src/public-api/v1/openapi.yml` + `handlers/*` via `express-openapi-validator` |

Both sit on the same Express app built by `Server extends AbstractServer`
(`packages/cli/src/server.ts`, `abstract-server.ts`). Order of middleware
(`AbstractServer.init/start` + `Server.configure`):

```
health:  GET /healthz → {status:'ok'} ; GET /healthz/readiness → 200 {status:'ok'} | 503 {status:'error'}
"starting up" gate (db not migrated → text 'n8n is starting up. Please wait')
bot blocker (isbot → 204)
webhook handlers (raw body; see webhook.md)                ← BEFORE body parsers
body parsers (json/urlencoded/raw/xml, N8N_PAYLOAD_SIZE_MAX), cookieParser
public API routers (if N8N_PUBLIC_API_DISABLED !== true)
push (SSE/WebSocket) at /rest/push
ControllerRegistry.activate(app)                           ← all @RestController routes
/rest/settings, /rest/options/timezones, /types/*.json, /schemas/*, static editor (SPA history fallback)
```

---

## 2. Internal REST: request → response pipeline

`ControllerRegistry.activateController` (`controller.registry.ts`):

```
for each @Get/@Post/@Put/@Patch/@Delete(path, options) on a @RestController(basePath):
   router[method](path, ...middlewares, finalHandler)

middlewares (in order):
   1. IP rate limit             (production && route.ipRateLimit)
   2a. keyed rate limit (body)  (production)
   3. auth                      unless skipAuth: AuthService.createAuthMiddleware({allowSkipMFA, allowSkipPreviewAuth, allowUnauthenticated})
                                + LastActiveAtService.middleware
   2b. keyed rate limit (user)
   4. license                   route.licenseFeature → 403 {status:'error', message:'Plan lacks license for this feature'}
   5. scope                     route.accessScope (@GlobalScope/@ProjectScope) → 403 {status:'error', message: MISSING_SCOPE}
                                                     NotFoundError from scope lookup → 404 {status:'error', message}
   6. controller-level @Middleware methods
   7. route.middlewares (e.g. listQueryMiddleware, parseRangeQuery)

handler:
   args = [req, res] + for each decorated param:
        @Param('x')          → req.params.x
        @Body / @Query       → paramType.safeParse(req.body|query)     (zod class from @n8n/api-types)
                               fail → res.status(400).json(output.error.errors[0])   ← FIRST zod issue only, raw shape
   result = await controller[handler](...args)

finalHandler = send(handler):                          response-helper.ts:155
   ok  → if !res.headersSent: sendSuccessResponse(res, data, raw=false)  → 200 {"data": <result>}
   err → reportError(error) (ErrorReporter unless ResponseError <= 404)
         unique-constraint DB error → message 'There is already an entry with this name'
         sendErrorResponse(res, error)
```

`sendErrorResponse` (`response-helper.ts:75`):

```
status = 500; body = { code: 0, message: error.message ?? 'Unknown error' }
if ResponseError (or duck-typed {httpStatusCode, errorCode}):
     status = httpStatusCode; body.code = errorCode; body.hint = hint?; body.meta = meta?
     404 on a /form* URL → render 'form-trigger-404' page instead of JSON
if NodeApiError: Object.assign(body, error)
if inDevelopment: body.stacktrace = error.stack
res.status(status).json(body)
```

Auth middleware outcomes (`auth/auth.service.ts:96`): valid cookie → `req.user`;
invalid/expired → cookie cleared and `401 {status:'error', message:'Unauthorized'}`;
MFA enforced but not used → `401 {…, mfaRequired:true}`; `allowUnauthenticated` → next.

Unknown `/rest/*` path: no controller matches → falls through to the SPA
static handler → **200 with `index.html`** (not a JSON 404). Unknown path
under a *known* controller prefix likewise falls through. A JSON 404 only
occurs when a handler throws `NotFoundError`.

### Error class → HTTP mapping (`errors/response-errors/`)

| Class | Status |
| :--- | :--- |
| `BadRequestError`, `WorkflowValidationError` | 400 |
| `AuthError`, `UnauthenticatedError`, `InvalidMfaCodeError` | 401 |
| `ForbidddenError`, `LicenseEulaRequiredError` | 403 |
| `NotFoundError`, `WebhookNotFoundError` | 404 |
| `ConflictError` | 409 |
| `ContentTooLargeError` | 413 |
| `UnprocessableRequestError` | 422 |
| `TooManyRequestsError` | 429 |
| `InternalServerError` | 500 |
| `NotImplementedError` | 501 |
| `ServiceUnavailableError` | 503 |
| anything else (`Error`, `UnexpectedError`, `OperationalError`, …) | 500, `code: 0` |

---

## 3. Endpoint groups and their internal dependencies

Discovered by `grep -rn "@RestController("` (66 controllers). Grouped by the
LEGO they front:

| Group | Base path(s) | Controller file | Talks to |
| :--- | :--- | :--- | :--- |
| **Workflows** | `/workflows` | `workflows/workflows.controller.ts` | `WorkflowRepository`, `WorkflowService`, `WorkflowFinderService`, `WorkflowHistoryService`, `EnterpriseWorkflowService`, `ActiveWorkflowManager` (activate/deactivate → Trigger LEGO), `WorkflowExecutionService.executeManually` (`POST /:id/run` → Execution LEGO), `TestWebhooks` |
| **Active workflows** | `/active-workflows` | `controllers/active-workflows.controller.ts` | `ActiveWorkflowsService` (ids + activation errors) |
| **Workflow history / stats** | `/workflow-history`, `/workflow-stats` | — | `WorkflowHistoryRepository`, `WorkflowStatisticsRepository` |
| **Executions** | `/executions` | `executions/executions.controller.ts` | `ExecutionService` (`findRangeWithCount`, `findOne`, `stop`, `retry`, `delete`, `annotate`) → `ExecutionRepository`; `WorkflowSharingService` for scoping; `ActiveExecutions` (stop) → Execution LEGO |
| **Credentials** | `/credentials`, `/oauth1-credential`, `/oauth2-credential` | `credentials/credentials.controller.ts`, `controllers/oauth/*` | `CredentialsService` → Credentials LEGO (redact/unredact), `CredentialsRepository`, `CredentialsTester` |
| **Node types / schemas** | `/node-types`, `/dynamic-node-parameters`, `/community-node-types`, `/community-packages`, `/types/*.json` | `controllers/node-types.controller.ts`, … | `NodeTypes`, `LoadNodesAndCredentials` (Node LEGO — read only) |
| **Auth / users** | `/login`, `/logout`, `/owner/setup`, `/me`, `/users`, `/invitations`, `/password-reset`, `/mfa`, `/api-keys`, `/roles`, `/sso/*`, `/ldap` | `controllers/*` | `AuthService`, `UserRepository`, `SettingsRepository` (`userManagement.isInstanceOwnerSetUp`), `JwtService`, `MfaService` |
| **Projects / folders / tags** | `/projects`, `/projects/:id/folders`, `/tags`, `/annotation-tags` | — | `ProjectService`, `FolderService`, `TagService` (Persistence) |
| **Webhooks helper** | `/webhooks/find` | `webhooks/webhooks.controller.ts` | `WebhookService` |
| **Settings / telemetry / misc** | `/settings`, `/module-settings`, `/settings/security`, `/telemetry`, `/ph`, `/cta`, `/debug`, `/orchestration`, `/e2e`, `/ai`, `/chat`, `/mcp`, `/insights`, `/variables`, `/external-secrets`, `/source-control`, `/license`, `/binary-data`, `/eventbus`, `/events`, `/breaking-changes`, … | — | various services |

Editor bootstrap: `GET /rest/settings` (unauthenticated, `frontendService.getSettings()`),
`GET /rest/login` (returns current user or 401), `POST /rest/owner/setup`
(`skipAuth`, first-run owner creation; `BadRequestError('Instance owner already setup')` when repeated).

---

## 4. Validation

* Body/query DTOs are zod classes in `packages/@n8n/api-types/src/dto/**`
  (e.g. `CreateWorkflowDto`, `UpdateWorkflowDto`, `ActivateWorkflowDto`,
  `CreateCredentialDto`, `LoginRequestDto`). Failure → `400` with the first
  zod issue `{code, message, path, …}` — **not** the `{code:0,message}` envelope.
* Entities carry `class-validator` decorators (`@Length(1,128)` on workflow
  name); `validateEntity()` → `BadRequestError` with the constraint message.
* Business validation (`WorkflowValidationService._validateNodes`, credential
  permission checks, webhook conflicts) → `BadRequestError`/`ConflictError`.

Workflow create validation chain, in order:
`CreateWorkflowDto.safeParse` (nodes array? connections object? name 1..128) →
`id` uniqueness (`BadRequestError('Workflow with id X exists already.')`) →
`validateEntity` → external hook → credential permission → project scope →
DB unique index on `name`.

---

## 5. Public API (`/api/v1`)

* `public-api/index.ts` loads `v1/openapi.yml`, attaches
  `express-openapi-validator` (request validation → 400 with OpenAPI error
  body `{message, …}`), and API-key auth handler (`X-N8N-API-KEY` →
  `ApiKeyService.getUserForApiKey`; missing/invalid → 401 `{message:'X-N8N-API-KEY header required'}` / `'Provided API key is invalid'`).
* Handlers: `v1/handlers/{workflows,executions,credentials,users,tags,variables,projects,audit,source-control}/*.handler.ts`
  call the same services as the internal API (e.g.
  `WorkflowService.activateWorkflow(user, id, {}, publicApi=true)`).
* Response shapes follow the OpenAPI spec (`{data:[…], nextCursor}` for lists,
  entity object for single) — different envelope from the internal `{data}`.
* Disabled with `N8N_PUBLIC_API_DISABLED=true`; swagger UI at `/api/v1/docs`.

---

## 6. Dependency map

```
API LEGO (controllers + registry + response helper + DTOs + auth middleware)
   ├── express, zod, class-validator, jsonwebtoken, express-openapi-validator   EXTERNAL
   ├── @n8n/decorators (@RestController, @Get, @Body, @GlobalScope, …)          infra
   ├── @n8n/api-types DTOs                                                     API-owned schemas (shared with frontend)
   ├── AuthService, License, RateLimitService, userHasScopes                   API INTERNAL
   ├── Persistence repositories/services                                       INTERNAL to Agent 4
   ├── Credentials LEGO (CredentialsService)                                   INTERNAL to Agent 4
   ├── Trigger LEGO (ActiveWorkflowManager via WorkflowService.activate…)      INTERNAL to Agent 4
   ├── Webhook LEGO (TestWebhooks for manual runs)                             INTERNAL to Agent 4
   ├── WorkflowExecutionService.executeManually / ActiveExecutions             CROSS-BOUNDARY → Execution (Agent 3)
   ├── NodeTypes / LoadNodesAndCredentials                                     SHARED (Agent 2, read-only)
   ├── Workflow model (validation of nodes/connections)                        SHARED (Agent 1)
   └── Push (SSE/WS), EventService, Telemetry                                  REALTIME/EVENTS  EXTERNAL
```

`API → Workflow` (the case named in task §14): controllers *validate* and
*store* workflow JSON; they never traverse the graph. The only graph use is
`WorkflowValidationService` (node/connection integrity) which delegates to
`n8n-workflow` helpers. No Agent 1 internals are modified.

---

## 7. Boundary decision

The API LEGO boundary is:

* **Inbound:** `ControllerRegistry` — the only place that binds HTTP to
  controller methods; the middleware chain and argument parsing are
  centralised there.
* **Outbound envelope:** `ResponseHelper.send / sendSuccessResponse / sendErrorResponse`
  + the `ResponseError` hierarchy.
* **Schemas:** `@n8n/api-types` DTOs.

Everything below a controller is a service call; controllers do not touch
TypeORM directly except a handful of `repository.existsBy/findOne` reads
(workflows, credentials) — noted, not refactored (would be churn without
boundary value).

**No source change is made.** Contract in `contracts/api.contract.md`.

---

## 8. Reference tests

* Upstream: `packages/cli/test/integration/*.api.test.ts`,
  `controllers/__tests__/*`, `response-helper` tests,
  `@n8n/api-types/src/dto/**/__tests__`.
* Agent 4 golden: `tests/reference/agent-4/api/`
  * `api-envelope.test.ts` — success envelope, `ResponseError` → status/code/hint,
    plain `Error` → 500 code 0, zod 400 first-issue shape, unauthenticated 401 shape,
    `CreateWorkflowDto` validation table.
  * `api.golden.json` — recorded live responses from n8n 2.9.4
    (`/healthz`, `/rest/settings` keys, `/rest/login` 401, `/rest/owner/setup`,
    `/rest/workflows` create/get/not-found/validation error).

---

## 9. Risks

* Zod 400 responses leak the raw zod issue shape; a Rust port must emit the
  identical first-issue object, not a wrapped envelope.
* Unknown `/rest/*` routes return the SPA (200) — clients cannot rely on 404
  for typos; the editor depends on this fallback for deep links.
* `code` in error bodies is numeric and equals the HTTP status for
  `ResponseError`, but `0` for generic errors; some frontend logic keys on it.
