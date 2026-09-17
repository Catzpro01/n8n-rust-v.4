# LEGO Contract: Webhook

Reference: n8n 2.9.4. Status: **VERIFIED** (Agent 4, Phase 2 — contract backed by reference tests + live 11/11 smoke).
Analysis: `docs/isolation/webhook.md`. Golden: `tests/reference/agent-4/golden/webhook.golden.json`, `tests/reference/agent-4/live/baseline-before.json` (step 9).

## 1. Purpose
Map inbound HTTP requests on `/webhook/*`, `/webhook-test/*`, `/webhook-waiting/*`,
`/form/*`, `/form-test/*`, `/form-waiting/*` to a registered webhook of an active
(or test-listening / waiting) workflow, convert the HTTP request into node input,
hand off to Execution, and translate the execution result back into an HTTP response.

## 2. Inputs
| Input | Type | Producer |
|---|---|---|
| Registration | `ActiveWorkflowManager.addWebhooks(workflow, additionalData, mode, activation)` → `WebhookService.storeWebhook(IWebhookData)` | Trigger/Activation orchestration |
| HTTP request | `express.Request` (method, path, headers, query, params, body, raw body, files) | Client |
| Webhook node description | `INodeTypeDescription.webhooks[]` (`httpMethod`, `path`, `responseMode`, `isFullPath`, `restartWebhook`, `ndvHideUrl`) + node parameters `path`, `httpMethod`, `options` | Node Model (SHARED) |
| Test registration | `TestWebhooks.needsWebhook(...)` from `POST /rest/workflows/:id/run` | API |
| Waiting resume | `execution_entity` with `status:'waiting'` + `waitTill` | Persistence |

## 3. Outputs
| Output | Type | Consumer |
|---|---|---|
| `webhook_entity` row | `{ webhookPath, method, node, webhookId?, pathLength?, workflowId }` — PK `(webhookPath, method)` | Persistence (owned table) |
| Workflow input | `INodeExecutionData[]` = `[{ json: { headers, params, query, body, webhookUrl, executionMode }, binary? }]` produced by the node's `webhook()` method | Execution |
| Execution start | `WorkflowRunner.run({ executionMode:'webhook', executionData, workflowData, ... })` | Execution (CROSS-BOUNDARY) |
| HTTP response | status/headers/body per `responseMode` (`onReceived` default, `lastNode`, `responseNode`, `formPage`, `streaming`) | Client |
| Error response | `{ code, message, hint?, stacktrace? }` via `ResponseHelper.sendErrorResponse` | Client |

## 4. Responsibilities
- **Registration:** compute `(method, path)` per webhook description; if `path` contains `:param` → dynamic: store `webhookId` + `pathLength`, `webhookPath = webhookId/…` (see `WebhookService.storeWebhook` / `getWebhookMethods`). Detect conflicts before insert (`HTTP 409 There is a conflict with one of the webhooks.` with `hint` listing triggers). Also insert `webhook_entity` for **every** main instance (multi-main) since request routing is DB based.
- **Route matching:** `WebhookService.findWebhook(method, path)` — exact match, else dynamic candidates by `webhookId` ordered by `pathLength`, longest first. Unknown → 404 `The requested webhook "METHOD path" is not registered.` with activation hint. Known path, wrong method → 404 `This webhook is not registered for GET requests. Did you mean to make a POST request?`.
- **CORS:** `OPTIONS` answered with `Access-Control-Allow-Methods: OPTIONS, <methods>` (plus origin echo, `Access-Control-Max-Age: 300`) without executing.
- **Method guard:** only `DELETE GET HEAD PATCH POST PUT` (+`OPTIONS`) accepted; others → `sendErrorResponse(new Error('The method X is not supported.'))` → 500 `{code:0,message}`.
- **Body handling:** JSON / urlencoded / multipart / raw / binary per node options; `rawBody` retained.
- **Input build:** call `nodeType.webhook(ctx)` → `IWebhookResponseData { workflowData, webhookResponse?, noWebhookResponse? }`.
- **Response:** honour `responseMode`, `responseCode`, `responseData`, `responseHeaders`, `responseContentType`, `responsePropertyName`, binary/streaming; default `onReceived` → `200 {"message":"Workflow was started"}`.
- **Deregistration:** `clearWebhooks(workflowId)` → `webhook_entity` delete for that workflow; production URL then 404.
- **Test webhooks:** in-memory registration keyed by `(method, path, webhookId)` with 120 s timeout, single-shot, push to editor; `POST /webhook-test/x` without registration → 404 `The requested webhook "x" is not registered.` + "Click the 'Execute workflow' button…" hint.

## 5. Non-responsibilities
- Does not execute nodes or persist executions (→ Execution, Persistence). It *calls* `WorkflowRunner.run` and awaits the response promise.
- Does not authenticate users (webhooks are unauthenticated by design; node-level auth `basicAuth`/`headerAuth`/`jwtAuth` is evaluated *inside* the Webhook node, using Credentials LEGO).
- Does not own workflow activation (→ Trigger/ActiveWorkflowManager).
- Does not serve the editor SPA or `/rest/*` (→ API).
- Does not manage cron (→ Scheduler).

## 6. Dependencies (verified)
| Module | Class | Note |
|---|---|---|
| `cli/src/webhooks/*` (`webhook-server.ts`, `webhook-request-handler.ts`, `live-webhooks.ts`, `test-webhooks.ts`, `waiting-webhooks.ts`, `waiting-forms.ts`, `webhook-helpers.ts`, `webhook.service.ts`, `webhook-helpers`) | INTERNAL | owned |
| `@n8n/db` `WebhookEntity`, `WebhookRepository` | INTERNAL (table) / Persistence (infra) | table owned by Webhook, storage engine by Persistence |
| `cli/src/workflow-runner.ts`, `WorkflowExecuteAdditionalData` | CROSS-BOUNDARY → Execution | start + await execution |
| `cli/src/active-workflow-manager.ts` (`addWebhooks`, `clearWebhooks`) | CROSS-BOUNDARY ↔ Trigger | same activation transaction |
| `@n8n/db` `WorkflowRepository`, `ExecutionRepository` (waiting webhooks) | CROSS-BOUNDARY → Persistence | load workflow / waiting execution |
| `n8n-workflow` `Workflow`, `IWebhookData`, `IWebhookResponseData`, `NodeHelpers.getNodeWebhooks` | SHARED | |
| `NodeTypes`, node implementations (`Webhook`, `Form`, `Wait`, `Chat`, OAuth callbacks) | SHARED | |
| `express`, `body-parser`, `formidable`, `cors` behaviour | EXTERNAL | |
| `Push`, `TestWebhookRegistrationsService` (cache/Redis) | INTERNAL | test webhooks |
| `WorkflowStaticDataService` | CROSS-BOUNDARY → Persistence | webhook nodes may save staticData |
| `Cipher`/Credentials (only via node `webhook()` auth options) | CROSS-BOUNDARY → Credentials | |

## 7. Error behavior
| Case | HTTP | Body |
|---|---|---|
| Unknown path (production) | 404 | `{code:404,message:'The requested webhook "POST no-such-path" is not registered.',hint:'The workflow must be active for a production URL…'}` |
| Known path, wrong method | 404 | `{code:404,message:'This webhook is not registered for GET requests. Did you mean to make a POST request?'}` |
| Unsupported method (e.g. PROPFIND) | 500 | `{code:0,message:'The method PROPFIND is not supported.'}` |
| Test URL not listening | 404 | `{code:404,message:'The requested webhook "x" is not registered.',hint:"Click the 'Execute workflow' button…"}` |
| Path conflict on activation | 409 | `{code:409,message:'There is a conflict with one of the webhooks.',hint:JSON[...]}` |
| Node `webhook()` throws (auth failed etc.) | node-defined (401/403/…) via `WebhookAuthorizationError`, else 500 | `{code,message}` |
| Execution fails, `responseMode:lastNode` | 500 | `{code:0,message:'Error in workflow'}` (unless `Respond to Webhook` already answered) |
| Waiting webhook for finished execution | 409 | `The execution "id" has finished already.` |
| Waiting webhook unknown execution | 404 | `The execution "id" does not exist.` |
| Stack traces | included only when `NODE_ENV !== 'production'`/dev flag; consumers must not depend on `stacktrace` |

## 8. Lifecycle
```
activate → addWebhooks → storeWebhook (webhook_entity insert) [+ node.webhookMethods.default.create() for external registration nodes]
request → WebhookServer (express) → WebhookRequestHandler.handleRequest
        → OPTIONS? → CORS 204
        → method allowed? → 500 unsupported
        → LiveWebhooks.executeWebhook → findWebhook → load workflow (WorkflowRepository) → getWorkflowWebhooks
        → WebhookHelpers.executeWebhook → nodeType.webhook() → WorkflowRunner.run
        → response per responseMode (may resolve before execution end)
deactivate → clearWebhooks → webhook_entity delete [+ webhookMethods.default.delete()]
```

## 9. Data ownership
- **Owns:** `webhook_entity` rows; in-memory/cached test webhook registrations; `waiting-webhooks` routing (reads `execution_entity`, no writes).
- **Never writes:** `workflow_entity`, `execution_entity` (Execution does), credentials.

## 10. External interfaces
- HTTP: `ALL /webhook/*`, `ALL /webhook-test/*`, `ALL /webhook-waiting/:executionId/:suffix?`, `ALL /form/*`, `ALL /form-test/*`, `ALL /form-waiting/*`; endpoints configurable via `N8N_ENDPOINT_WEBHOOK*`.
- Internal service API: `WebhookService.{storeWebhook, findWebhook, deleteWorkflowWebhooks, getWebhookMethods, createWebhookIfNotExists, findCached}`.
- `IWebhookData`, `IWebhookResponseData`, `WebhookResponseMode` types (n8n-workflow).

## 11. Compatibility requirements
- `(webhookPath, method)` uniqueness; longest-`pathLength` wins for dynamic paths.
- `json` payload shape `{headers, params, query, body, webhookUrl, executionMode:'production'|'test'}` — exactly as recorded in the golden (`received.executionMode === 'production'`).
- `lastNode` response body = `json` of the first item of the last node (as observed: `{smoke_test:'PASS',received:{…},verified:true}`), content-type `application/json; charset=utf-8`.
- Default response `200 {"message":"Workflow was started"}` for `onReceived` without `responseData`.
- Webhook listeners must be present on **every** main instance, unlike triggers.
- `webhookId` on the node is stable across saves; changing `path`/`httpMethod` requires re-activation (`update` mode does remove+add).

## Phase-3 native HTTP transport (TASK-420)

`WebhookHttpServer` adapts Node's `http` request/response objects to the framework-independent
`WebhookRequestHandler`. It owns listen/close lifecycle, configurable base-path isolation, URL and
query parsing, JSON/text/binary request bodies, a configurable body-size limit, and JSON/text/binary
or stream responses. Route lookup and execution remain delegated to `IWebhookManager`; persistence
and workflow execution do not cross into the transport. Invalid JSON and oversized payloads fail
before execution with deterministic 400/413 envelopes.

## Phase-3 waiting execution resume (TASK-421)

`WaitingWebhookManager` consumes an execution-repository port, a waiting-webhook resolver, and a
resume-execution callback. It reproduces missing/running/failed/finished guards, send-and-wait URL
HMAC validation, wait-node disabling, `waitTill` clearing, prior run-data removal, HITL `ai_tool`
rewiring, `inputOverride` preservation, request-parameter reset, and a local concurrent-resume guard.
Persistence and engine continuation remain owned by their injected ports.

## Phase-3 waiting form rendering (TASK-424)

`WaitingFormManager` consumes execution persistence, parent traversal, and form-webhook execution as
explicit ports. `/form-waiting/:executionId/n8n-execution-status` returns the raw execution status,
classifying waiting Form nodes and Wait nodes with `resume:'form'` as `form-waiting`, with wildcard
CORS. Auth and browser-identity cookies are stripped before any delegated node execution.

Finished executions render the default `Form Submitted` completion HTML under the exact webhook
sandbox CSP unless the current node, or nearest already-executed parent in reverse traversal order,
is an enabled Form completion node. Such completion nodes are delegated through the execution port.
POST disables the current stack node before delegation; GET does not. Running executions produce no
response body, missing/failed executions preserve 404/409 behavior, and the native HTTP adapter must
serve HTML/status text without replacing `noWebhookResponse` with the default webhook JSON body.
