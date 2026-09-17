# LEGO Isolation: Webhook

**Agent:** Agent 4 — Phase 2 LEGO Isolation
**Reference:** n8n 2.9.4 (`reference/n8n`, upstream `b6dc2787`)
**Status:** VERIFIED (ANALYZED → ISOLATED → TESTED → VERIFIED; documentation + contract, no source change required; smoke 11/11 before and after, live verification passed — see `docs/isolation/agent-4-report.md`)

---

## 1. Source inventory

Everything webhook-related in the backend lives in one directory plus the
webhook row in the database:

```
packages/cli/src/webhooks/
├── webhook-server.ts                 WebhookServer extends AbstractServer (used by `n8n webhook` process)
├── webhooks.controller.ts            POST /rest/webhooks/find  (editor helper, not the public webhook endpoint)
├── webhook-request-handler.ts        HTTP edge: method check, CORS, dispatch to IWebhookManager, send response
├── webhook.types.ts                  IWebhookManager, WebhookRequest, IWebhookResponseCallbackData
├── live-webhooks.ts                  IWebhookManager for /webhook/*  (production)
├── test-webhooks.ts                  IWebhookManager for /webhook-test/* (editor "Listen for test event")
├── test-webhook-registrations.service.ts   cache-backed registry of test webhooks
├── waiting-webhooks.ts / waiting-forms.ts  IWebhookManager for /webhook-waiting/:executionId (Wait node resume)
├── webhook.service.ts                DB/cache lookup, node webhook description evaluation, run webhook()/checkExists/create/delete
├── webhook-helpers.ts                executeWebhook(): request → node.webhook() → WorkflowRunner → response
├── webhook-execution-context.ts      expression-evaluation context for response options
├── webhook-form-data.ts / webhook-request-sanitizer.ts / webhook-response*.ts / *-extractor.ts
└── constants.ts                      authAllowlistedNodes (chat trigger keeps cookies)

packages/@n8n/db/src/entities/webhook-entity.ts        webhook_entity table
packages/@n8n/db/src/repositories/webhook.repository.ts
packages/cli/src/abstract-server.ts:224-258            route registration
packages/cli/src/errors/response-errors/webhook-not-found.error.ts
```

Node-side (owned by Agent 2 / Node LEGO, consumed here):

* `INodeType.webhook(this: IWebhookFunctions): Promise<IWebhookResponseData>`
* `INodeType.webhookMethods[name].{checkExists,create,delete}` (`HookContext`)
* `INodeTypeDescription.webhooks[]: IWebhookDescription` (`httpMethod`, `path`,
  `responseMode`, `responseCode`, `responseData`, `isFullPath`, `restartWebhook`, …)

---

## 2. Registration

Registration is performed by the Trigger LEGO's composition root
(`ActiveWorkflowManager.addWebhooks`, cli/src/active-workflow-manager.ts:150-235):

```
WebhookHelpers.getWorkflowWebhooks(workflow, additionalData, undefined, true)
  └─ for each node: WebhookService.getNodeWebhooks(workflow, node, additionalData)
        evaluates IWebhookDescription.path / httpMethod through the expression
        engine, prefixes `${node.webhookId}/` unless isFullPath, yields IWebhookData[]
for each IWebhookData:
  WebhookService.createWebhook({ workflowId, webhookPath, node, method })
  strip leading/trailing '/'
  if path is dynamic (':' segment) and node.webhookId: set webhookId + pathLength
  WebhookService.storeWebhook(webhook)        cache.set(cacheKey) + repository.upsert(['method','webhookPath'])
  WebhookService.createWebhookIfNotExists()   node.webhookMethods.checkExists / create (external registration, e.g. GitHub)
on error:
  - 'init'/'leadershipChange' + QueryFailedError → ignore (row already exists from a previous run)
  - otherwise: clearWebhooks(workflowId); QueryFailedError → WebhookPathTakenError(node); rethrow
finally: workflowStaticDataService.saveStaticData(workflow)
```

`webhook_entity` primary key is `(webhookPath, method)`. A path+method may
belong to only **one** active workflow instance-wide — this is what produces
the "webhook path already taken" activation error.

Deregistration = `ActiveWorkflowManager.clearWebhooks(workflowId)`:
`deleteWebhook()` per node (runs `webhookMethods.delete`) then
`deleteWorkflowWebhooks(workflowId)` (DB + cache).

---

## 3. Route matching

Express (`abstract-server.ts`) registers, *before* body-parser:

| Route | Manager | Enabled in |
| :--- | :--- | :--- |
| `ALL /webhook/*path` | `LiveWebhooks` | main, webhook process |
| `ALL /form/*path` | `LiveWebhooks` | main, webhook process |
| `ALL /mcp/*path` | `LiveWebhooks` | main, webhook process |
| `ALL /webhook-waiting/:path{/:suffix}` | `WaitingWebhooks` | main, webhook process |
| `ALL /form-waiting/:path{/:suffix}` | `WaitingForms` | main, webhook process |
| `ALL /webhook-test/*path`, `/form-test/*path`, `/mcp-test/*path` | `TestWebhooks` | main only |
| `DELETE /rest/test-webhook/:id` | `TestWebhooks.cancelWebhook` | main only |

Endpoint names come from `GlobalConfig.endpoints.{webhook,webhookTest,webhookWaiting,form,…}`
(env `N8N_ENDPOINT_WEBHOOK` etc.).

`WebhookRequestHandler.handleRequest` (webhook-request-handler.ts:32-90):

1. `method ∉ {OPTIONS, DELETE, GET, HEAD, PATCH, POST, PUT}` →
   `sendErrorResponse(res, Error("The method X is not supported."))` → **500**
   `{code:0,message:"The method X is not supported."}` (yes, 500 — it is a plain Error).
2. If request has an `origin` header → CORS headers from
   `getWebhookMethods(path)` and `findAccessControlOptions(path, method)`
   (`allowedOrigins` node option).
3. `OPTIONS` → `204` with empty body.
4. `webhookManager.executeWebhook(req, res)` → response (see §5).
5. Errors → `ResponseHelper.sendErrorResponse`:
   `WebhookNotFoundError` (404) or any other error (`httpStatusCode` if
   `ResponseError`, else 500).

`LiveWebhooks.executeWebhook` (live-webhooks.ts:70-176) does the lookup:

```
path = req.params.path (joined), trailing '/' stripped
webhook = WebhookService.findWebhook(method, path)
   ├─ cache `webhook:${method}-${path}`
   ├─ static: repository.findOneBy({ webhookPath: path, method })
   └─ dynamic: first segment = webhookId, pathLength = remaining segment count;
              choose the row whose static segments all match, most matches wins;
              a row with zero static segments (`:var`) is the fallback
null → WebhookNotFoundError({path, httpMethod, webhookMethods}, {hint:'production'})
dynamic → fill req.params from ':name' segments
workflowData = WorkflowRepository.findOne({ id, relations: {activeVersion, shared} })
null / no activeVersion → NotFoundError (404)
workflow = new Workflow(activeVersion.nodes/connections)
webhookData = getNodeWebhooks(workflow, node).find(method && path)
if node.type ∉ authAllowlistedNodes → sanitizeWebhookRequest(req)  (strip n8n-auth / n8n-browserId cookies)
→ WebhookHelpers.executeWebhook(workflow, webhookData, activeWorkflowData, startNode, 'webhook', …, req, res, callback)
```

404 message shapes (`webhook-not-found.error.ts`):

* No webhook on path at all:
  `The requested webhook "POST <path>" is not registered.` + production hint
  `"The workflow must be active for a production URL to run successfully. …"`
* Path exists for other methods:
  `This webhook is not registered for GET requests. Did you mean to make a POST request?`
  (no hint).

---

## 4. Request → workflow input

`WebhookHelpers.executeWebhook` (webhook-helpers.ts:412-925):

1. Build `WebhookExecutionContext`, resolve project via `OwnershipService`
   (missing → `NotFoundError('Cannot find workflow')`).
2. `additionalData.httpRequest = req; additionalData.httpResponse = res;`
   `additionalData.validateCookieAuth = AuthService.validateCookieToken`.
3. `evaluateResponseOptions()` → `responseMode` (default `onReceived`),
   `responseCode` (default 200), `responseData`, `checkAllMainOutputs`.
   Invalid `responseMode` → callback error *"The response mode 'x' is not valid!"* (500).
4. `parseRequestBody(req, …)` — JSON / urlencoded / multipart / raw, honoring
   `rawBody` and `binaryPropertyName` node options and `N8N_PAYLOAD_SIZE_MAX`.
5. `WebhookService.runWebhook(workflow, webhookData, startNode, additionalData, mode, runExecutionData)`
   → `nodeType.webhook.call(new WebhookContext(...))` → `IWebhookResponseData`.
   This is where the Webhook node builds the item:
   `{ headers, params, query, body, webhookUrl, executionMode }`
   (see `tests/reference/baseline/SMOKE_TEST_RESULTS.md` golden payload) and
   where **authentication** (`none | basicAuth | headerAuth | jwtAuth`) is
   enforced by `validateWebhookAuthentication` inside the node
   (`nodes-base/nodes/Webhook/utils.ts`). Auth failures are returned by the
   node as `{ noWebhookResponse: true }` after it writes 401/403 itself.
6. If `runWebhook` throws → callback `UnexpectedError("Workflow Webhook Error: Workflow could not be started!")`
   (500) and the execution is still created with the error recorded.
7. `webhookResultData.workflowData === undefined` → do **not** run the workflow;
   respond with `webhookResponse` or default `{message: "Webhook call received"}`.
8. Otherwise `prepareExecutionData()` builds `IRunExecutionData` with the
   webhook node's output as the first `nodeExecutionStack` entry, and
   `WorkflowRunner.run(runData, true, !didSendResponse && !deferOnReceived, executionId, responsePromise)`
   starts the execution. **CROSS-BOUNDARY → Execution (Agent 3).**
9. `ActiveExecutions.setResponseMode(executionId, responseMode)`,
   `EventService.emit('workflow-executed', {source:'webhook'})`.

---

## 5. Response handling

| `responseMode` | When the HTTP response is written | Body |
| :--- | :--- | :--- |
| `onReceived` (default) | Immediately after the execution row is created (deferred so `$execution.id` resolves) | `responseData` expression, else `webhookResultData.webhookResponse`, else `{"message":"Workflow was started"}` |
| `lastNode` | After execution finishes (`ActiveExecutions.getPostExecutePromise`) | Last node's output per `responseData` (`firstEntryJson` default, `firstEntryBinary`, `allEntries`, `noData`) |
| `responseNode` | When a *Respond to Webhook* node runs (`responsePromise`, `sendResponse` hook) | Whatever that node returns |
| `streaming` | Chunks written during execution | NDJSON stream |
| `formPage` / `hostedChat` | Immediately | `{formWaitingUrl}` / chat bootstrap |

Failure responses after execution start:

* Execution error → `{"message":"Error in workflow"}` with **500**.
* Finished without data → `{"message":"Workflow executed successfully but no data was returned"}`.
* Last node returned nothing → `{"message":"Workflow executed successfully but the last node did not return any data"}`.
* Promise rejected → `OperationalError('There was a problem executing the workflow')` → 500.

Response headers from node option `responseHeaders` are applied; unless
`N8N_DISABLE_WEBHOOK_HTML_SANDBOXING`, a `Content-Security-Policy` sandbox header
is added (`webhook-request-handler.ts:setResponseHeaders`).

Response transport is expressed as the `WebhookResponse` union
(`webhook-response.ts`: `noResponse | static{body,code,headers} | stream`).
Legacy `IWebhookResponseCallbackData` (`{data, responseCode, headers, noWebhookResponse}`)
is still supported by `sendLegacyResponse`.

---

## 6. Test webhooks (editor)

`TestWebhooks` implements the same `IWebhookManager` but:

* Registration comes from `POST /rest/workflows/:id/run` when the workflow
  starts with a webhook node (`needsWebhook()`), stored in
  `TestWebhookRegistrationsService` (cache, TTL, keyed `${method}|${path}`),
  with a 2-minute timeout that calls `cancelWebhook`.
* One-shot: after the first matching request the registration is removed.
* `executeWebhook` uses `executionMode: 'manual'` and pushes results to the
  editor session (`pushRef`).
* 404 hint is `"Click the 'Execute workflow' button on the canvas, then try again…"`.

---

## 7. Dependency map (actual)

```
Webhook LEGO
   ├── HTTP (express)                                     EXTERNAL
   ├── @n8n/db WebhookRepository, WorkflowRepository      PERSISTENCE (Agent 4)
   ├── CacheService                                       PERSISTENCE-ish (cache)
   ├── Workflow (new Workflow, getNode)                   SHARED (Agent 1)
   ├── NodeTypes, nodeType.webhook / webhookMethods       SHARED (Agent 2)
   ├── workflow.expression.* (response options)           SHARED (Agent 3 – Expression)
   ├── WorkflowRunner.run, ActiveExecutions               CROSS-BOUNDARY → Execution (Agent 3)
   ├── ExecutionRepository (parent-execution restart)     PERSISTENCE
   ├── AuthService.validateCookieToken                    API/auth (Agent 4)
   ├── OwnershipService / Project                          API/domain
   ├── EventService, WorkflowStatisticsService, Push       EVENTS/REALTIME  EXTERNAL
   ├── BinaryDataService (multipart files)                 core storage
   └── WaitTracker (resume parent on child completion)     EXECUTION  CROSS-BOUNDARY
```

Trigger LEGO → Webhook LEGO (`addWebhooks`/`clearWebhooks`) is intra-Agent-4.

---

## 8. Boundary decision

The Webhook LEGO's *outer* boundary is `IWebhookManager`:

```ts
interface IWebhookManager {
  getWebhookMethods?(path): Promise<IHttpRequestMethods[]>;
  findAccessControlOptions(path, method): Promise<{allowedOrigins?} | undefined>;
  executeWebhook(req: WebhookRequest, res: Response): Promise<IWebhookResponseCallbackData>;
}
```

`WebhookRequestHandler` is a pure adapter from Express to that interface and is
independently unit-tested (`__tests__/webhook-request-handler.test.ts`). Its
*inner* boundary toward execution is the single call
`WorkflowRunner.run(IWorkflowExecutionDataProcess, …)` plus
`ActiveExecutions.getPostExecutePromise(executionId)`.

`WebhookHelpers.executeWebhook` is a 500-line function that straddles the
webhook and execution concerns (it prepares `IRunExecutionData`). Splitting it
would mean moving `prepareExecutionData` into the Execution LEGO — that is
Agent 3's call. Per §14 we **document** this as CROSS-BOUNDARY and do not touch it.

**No source change is made.** Boundary is contracted in
`contracts/webhook.contract.md`.

---

## 9. Reference tests

Upstream unit tests (in repo): `packages/cli/src/webhooks/__tests__/*.test.ts`
(request handler, live webhooks, test webhooks, service, helpers, sanitizer, extractors).

Agent 4 golden tests: `tests/reference/agent-4/webhook/`

* `webhook-routing.test.ts` — GET/POST dispatch, invalid method, 404 messages,
  dynamic path matching, CORS/OPTIONS, legacy vs. modern response send.
* `webhook.golden.json` — recorded live behaviour (see §10 of the task):
  `INPUT / EXPECTED OUTPUT / ERROR / SIDE EFFECT` for the smoke-test workflow.

---

## 10. Risks

* `webhook_entity` rows are **not** removed on shutdown (by design, see
  comment in `addWebhooks`); a Rust replacement must tolerate pre-existing rows.
* The response for an unsupported HTTP method is a **500**, not 405. Preserve it.
* `findAccessControlOptions` reads `workflow.nodes` (draft), not
  `activeVersion.nodes` — pre-existing upstream quirk, documented not fixed.

---

## 8. Phase 5 — the webhook layer as a verified port

The Phase 4 engine (`packages/reconstructed-engine/src/webhook-engine.ts`, 105 lines) plus an inline
`InternalWebhookEngine` in the facade guessed the webhook behaviour: it keyed rows by
`${method}:${webhookPath}`, threw a made-up `'There is a conflict with one of the webhooks.'`, matched
dynamic paths by `path.includes(webhookId)`, and never composed a path the way the CLI does. Nothing
compared any of it against n8n.

### 8.1 The port

| Reference source | Ported symbols |
|---|---|
| `n8n-workflow` `node-helpers.ts` | `getNodeWebhookPath`, `getNodeWebhookUrl` |
| `n8n-workflow` `errors/webhook-path-taken.error.ts` | `WebhookPathTakenError` (level `warning`) |
| `cli/src/webhooks/webhook.service.ts` | `WebhookRegistry` (`findStaticWebhook`, `findDynamicWebhook`, `findWebhook` = `findCached`, `getWebhookMethods`, `storeWebhook`, `deleteWorkflowWebhooks`), `isDynamicPath`, `getWebhookPath`, `collectNodeWebhooks` (= `getNodeWebhooks`) |
| `@n8n/db` `webhook-entity.ts` | `staticSegmentsOf`, `isDynamicWebhookPath`, cache keys `webhook:${method}-${uniquePath}` |
| `cli/src/webhooks/webhook-request-sanitizer.ts` | `sanitizeWebhookRequest` |
| `cli/src/webhooks/webhook-on-received-response-extractor.ts` | `extractWebhookOnReceivedResponse` |
| `cli/src/webhooks/webhook-response-headers.ts` | `WebhookResponseHeaders` |
| `cli/src/errors/response-errors/webhook-not-found.error.ts` | `webhookNotFoundErrorMessage`, `webhookNotFoundPayload` |

The facade now uses `WebhookRegistry` (the inline copy is gone) and composes webhook paths with
`getNodeWebhookPath`, so an activated webhook node registers under exactly the path the CLI would
compute.

### 8.2 Two evidence classes (and why)

`n8n-workflow@2.9.1` ships `getNodeWebhookPath` / `getNodeWebhookUrl` / `WebhookPathTakenError`, so
those are compared against the **executing** build (W02/W03/W04 — 1,728 path and URL calls plus the
error shape). The registry, sanitizer and response helpers live in the CLI module, which needs DI,
TypeORM and Redis and cannot be imported offline; for those the gate carries a **transcription of the
reference source** and requires both implementations to agree over the corpus (W05/W06). The evidence
file records which check belongs to which class — no check claims an executed oracle it does not have.

### 8.3 Surprising reference semantics now pinned

- `WebhookService.storeWebhook` **upserts** on (method, webhookPath) — it never throws. The "path
  taken" error belongs to the activation conflict check (`WebhookPathTakenError`, level `warning`).
- Dynamic matching requires the request segment count to equal the stored `pathLength`
  (`otherSegments.length`), then compares the stored **static segments as a set** (not positionally),
  preferring the row with the most static segments; a `:var`-only row matches anything as a fallback.
- `findCached` caches **static hits only**, under `webhook:${method}-${requestPath}`.
- `getNodeWebhookUrl` overrides a requested `isFullPath` for `:param` paths when the node has a
  `webhookId`; a leading `/` is trimmed first.
- `webhookNotFoundErrorMessage` **mutates the caller's method array** (`pop()`), and the
  "did you mean" message only appears when an http method was supplied.
- `getNodeWebhooks` skips a webhook only when the *description* field is the literal `true`
  (`ignoreRestartWebhooks`), and a disabled node registers nothing; `httpMethod` defaults to `GET`
  and an unsaved workflow uses `__UNSAVED__`.
- `WebhookResponseHeaders` lower-cases keys, silently drops `content-security-policy` and any value
  `node:http` rejects — `set()` stores values untouched while `addFromObject` stringifies.

### 8.4 Verification

```bash
npm run webhook:check      # W01..W07 → docs/isolation/evidence/webhook-lego-gate.json
node --test packages/webhook-lego/test/*.test.mjs
```

Negative controls (injected, caught, reverted):

| Injected defect | Caught by |
|---|---|
| `getNodeWebhookUrl` loses the `:var` → `isFullPath = false` rule | `W03` — 54/864 URL calls |
| `getNodeWebhookPath` stops lower-casing + URL-encoding the node name | `W02` — 288/864 path calls |
| `WebhookPathTakenError` level becomes `error` | `W04` — `level ("warning" vs "error")` |
| dynamic matching becomes positional instead of set-based | `W05` — `findWebhook(GET, uuid-c/user/123/posts)` |
| sanitizer keeps the `n8n-auth` cookie | `W06` — `sanitizeWebhookRequest #0` |
