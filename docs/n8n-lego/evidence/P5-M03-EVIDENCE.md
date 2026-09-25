# P5-M03 — Public /api/v1 first surface: API-key boundary + workflows (evidence)

Slice `P5-M03` (program P5, maintenance; issue #85; debt source: `P5.8-CERTIFICATION-EVIDENCE.md` §7).
One delivery PR (DEC-0014). The Manager executed the task because no worker session was attached
(DEC-0016). The register keeps P5-M03 `in-progress` inside the delivery PR. It becomes `implemented`
only after the merge, fresh-main verification and runner verification (§6).

## 1. Scope decided for this Slice (Manager re-plan)

The original P5-M03 bundled three unrelated deliveries: the public API, email recovery and
service-principal REST/UI. Together with every `/api/v1` resource that is far more than one
reviewable Slice PR. One PR per Slice (DEC-0014) forbids splitting a Slice across PRs, so the
Manager split the *Slice* instead. No milestone number was invented; new work is `P5-Mnn`.

| Feature | Disposition | Basis |
|---|---|---|
| P5-F-DEBT-007: public `/api/v1` compatibility surface | **delivered here**, narrowed to the boundary plus the workflows resource | The boundary (auth, errors, validation, scopes, pagination) is what every later resource reuses. Workflows is the resource upstream clients use first. |
| P5-F-DEBT-010 (new): remaining `/api/v1` resources, `openapi.yml`, `/docs` | **P5-M08** (planned), depends on DEBT-007 | Executions, credentials, tags, users, variables, projects, audit, source-control and data-tables are each a resource in their own right. |
| P5-F-DEBT-008: email-based password recovery | **P5-M06** (planned) | Needs a mail-transport decision first. Node has no built-in SMTP, so this means either a dependency or an injected transport contract. It is independent of the public API. |
| P5-F-DEBT-009: service-principal REST + UI | **P5-M07** (planned) | Independent of the public API. It builds on the P5.7 programmatic lifecycle. |

## 2. Behaviour

Module: `apps/n8n-lego/src/auth/public-api-routes.mjs`, in the auth domain, which already owns API-key authentication.
It is wired into `src/server.mjs` **before** the editor SPA fallback. Before this Slice, `/api/v1/*`
fell through to `ui.serve`, so an API client got the editor's HTML instead of a JSON 401.

The pipeline runs in the upstream order: express + express-openapi-validator in pinned n8n 2.9.4
`packages/cli/src/public-api`.

| Step | Result | Upstream source |
|---|---|---|
| route match | unknown path 404 `{message:'not found'}`; known path, wrong method 405 `{message:'<METHOD> method not allowed'}` | express-openapi-validator |
| security | missing key 401 `{message:"'X-N8N-API-KEY' header required"}`; malformed, unknown, tampered, revoked or expired key 401 `{message:'unauthorized'}` | **recorded goldens** `publicApiNoKey`, `publicApiBadKey` (`tests/reference/agent-4/golden/api.golden.json`) |
| body | invalid JSON 400 `{message:'Invalid JSON in request body'}` | `public-api/index.ts` |
| validation | 400 with ajv-style `request/...` messages: required, `additionalProperties:false`, readOnly, types, `limit <= 250`, `jsonString` | workflow / node / settings / limit specs. The messages are ajv-style and were **not** recorded live. Upstream tests only pin the status and, for readOnly, "active" plus "read-only". |
| key scope | 403 `{message:'Forbidden'}` | `apiKeyHasScope` → P5.3 `authorize()` (unknown permission fails closed) |
| handler | 404 `{message:'Not Found'}`, 404 `{message:'Some tags not found'}` | `workflows.handler.ts` |

**Operations:** `GET|POST /workflows`; `GET|PUT|DELETE /workflows/{id}`; `POST /workflows/{id}/activate|deactivate`;
`GET|PUT /workflows/{id}/tags`. Each is guarded by the same scope as upstream (`workflow:list|create|read|update|delete|activate|deactivate`,
`workflowTags:list|update`), and every scope is in the pinned API-key vocabulary.

**Semantics carried over from upstream:**
- create: always inactive, a new `versionId`, node ids assigned.
- update: full replacement and a new `versionId`. `publishIfActive` means an active workflow's `activeVersionId` follows the update.
- activate: publishes the current version. deactivate: clears `activeVersionId`.
- delete: returns the deleted entity.
- list filters: `name` (case-insensitive substring), `active`, and `tags`. The tags filter is the intersection of the workflows of every tag that exists; unknown names are ignored, and if no tag is found the result is empty.
- `excludePinnedData` on list and get.
- offset cursor: base64 JSON `{limit, offset}`. `nextCursor` is set only when more records exist. An invalid cursor gives 400.
- The data lives in the same store the editor reads. A workflow created through the API opens in the editor.

**Deliberate differences (fail-closed):**
- Key scopes are **always** enforced. Upstream skips `apiKeyHasScope` unless the enterprise `apiKeyScopes` licence is on.
- Effective scopes are the key's scopes ∩ the owner's **current** grant, so a demotion shrinks the key on the next request.
- A session cookie is never an `/api/v1` credential, and an API key is never a `/rest` credential.

**Not served, stated rather than faked:**
- the resources listed under P5-M08;
- `/workflows/{id}/transfer` and `projectId` filtering, which need a project/sharing model;
- the `shared` and `activeVersion` relations;
- a trigger-node check on activation (there is no trigger-registration service to consult; this matches `/rest/.../activate`);
- `N8N_PUBLIC_API_DISABLED`.

`publicApi.swaggerUi.enabled` in the frontend settings is now `false`, because `/api/v1/docs` is not served and the editor would otherwise link to a dead page.

## 3. Tests

`apps/n8n-lego/test/public-api-v1.test.mjs`: 22 tests. They run end to end through `startServer`, with keys minted through the editor flow (`/rest/api-keys`, CSRF enforced):
- the two goldens, compared byte-for-byte against the recorded file; three flavours of bad key;
- no HTML; 404 vs 405; transfer not mounted;
- cookie not accepted; key not accepted on `/rest`;
- 403 with no side effect; `workflow:read` ≠ `workflow:list`; invalid JSON;
- revoked key; owner demotion leading to 403;
- create validation (required, additional, readOnly, settings), staticData string→object, node ids, public DTO ≠ editor DTO;
- get / excludePinnedData / bad boolean / 404; editor sees an API-created workflow;
- update and version bump, readOnly rejection;
- activate → publishIfActive → deactivate;
- tags get / replace / unknown 404 / wrong body 400;
- list filters and full cursor walk (the pages concatenate to the full list, with no gaps or repeats); `limit=251` gives 400; invalid cursor gives 400;
- delete and repeated-delete 404;
- pure pieces: every operation's scope is in the vocabulary; cursor codec parity; matcher; node schema.

No existing assertion was relaxed. Gates: architecture, architecture selftest, foundation, foundation selftest, capabilities, scale-out and `.ai` check all pass. The contract count is unchanged at 100: the new module is not a pinned contract.

## 4. Security notes

- The API key is read from the header only and is never logged. On failure, `authenticateMachineCredential` emits the existing `api-key.denied` audit event with a reference and a reason only.
- Authentication runs before the body is read, so an unauthenticated request never reaches the parser.
- Authorization goes through the P5.3 kernel: it checks principal expiry, the canonical permission, and that the permission is known.

## 5. Rollback

`git revert -m 1 <merge>`. This Slice made no store-format change. Workflows created through the API are ordinary store records.

## 6. Delivery record

| Gate | Result |
|---|---|
| Delivery PR | #291 (the only PR for P5-M03), head `6a3c505e21bfa0399499c255e6d7a7d74d7e7580` |
| Exact-head CI at merge time | ALL_GREEN: GitHub-hosted PASS 3/3; self-hosted PASS 7/7, including the Windows worker probe and the clean-clone browser smoke. No check was deferred, so DEC-0015 runner verification is not needed |
| Store merge-queue gate | MQ-0002, lane MANAGER, authorized at the exact head **before** the merge (ship.sh store gate) |
| Merge | `cf52701c91e5447f19c32377c38f6ae5eea7f3a7` (SHA-pinned; tree identical to the PR head) |
| Fresh-main verification | workforce 104/104, gates 7/7, certification OK, backend 2422/2422, frontend 451/0 (1 skipped), 0 dirty files; main push CI ALL_GREEN |
| Register | P5-M03 and P5-F-DEBT-007 marked `implemented` in the governance follow-up (TASK-0021). Inside the delivery PR the register carried the re-plan with P5-M03 `in-progress` |
