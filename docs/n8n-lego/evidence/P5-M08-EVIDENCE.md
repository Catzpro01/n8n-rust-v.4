# P5-M08 — Public /api/v1 second surface: tags, variables, executions, openapi.yml (evidence)

This is Slice `P5-M08`: program P5, maintenance, issue #85. Its debt source is `P5.8-CERTIFICATION-EVIDENCE.md` §7.

It ships as one delivery PR (DEC-0014). Under DEC-0019 the Manager executes all tasks directly, and this Slice records that attribution explicitly (DEC-0016). It builds on the P5-M03 boundary delivered in PR #291.

Inside the delivery PR the register keeps P5-M08 `in-progress`. It becomes `implemented` only after three things: the merge, fresh-main verification, and runner verification (§6).

## 1. Scope decided for this Slice (Manager re-plan)

The original P5-M08 bundled nine resources plus `openapi.yml` and `/docs`. The Manager split the *Slice*, as P5-M03 did, rather than splitting one Slice across several PRs. No milestone number was invented.

Before implementation, the Manager told the owner in chat that P5-M08 would cover tags, variables, executions, credentials, users and `openapi.yml`/`/docs`, with the model-less resources moving to a new slice.

During implementation the Manager narrowed P5-M08 further. Credentials, users and `/docs` moved to P5-M09, and the model-less resources became P5-M10. This is a reduction of the Slice, not an expansion, and it is reported to the owner with this delivery.

| Part | Disposition | Basis |
|---|---|---|
| tags (5 operations) | **delivered here** | The store already has a tag table that the editor and the P5-M03 workflow-tags operations use. |
| variables (4 operations) | **delivered here**, with the community-edition semantics | Upstream gates every operation behind `isLicensed('feat:variables')`. This build is the community edition (`/rest/license` reports plan "n8n lego (community)"), so upstream itself answers 403. |
| executions list / get / delete (3 operations) | **delivered here** | The engine already persists execution records. |
| `GET /api/v1/openapi.yml` | **delivered here**, covering exactly the mounted operations | The spec is derived from the pinned upstream spec; see §2.4. |
| credentials (5 operations), users (5 operations) | **P5-M09** (planned; P5-F-DEBT-011) | Credentials need JSON-schema validation of the credential data against the credential type (upstream `toJsonSchema`, with `displayOptions`), plus integration with the sealed vault. Users need the role/invite semantics and the `validLicenseWithUserQuota` licence gate. Each is a reviewable unit in its own right. |
| `/api/v1/docs` | **P5-M09** | Upstream serves Swagger UI through the `swagger-ui-express` npm package. This app has no runtime dependencies, so serving it needs a decision first (a dependency or vendored assets). |
| projects, audit, source-control, data-tables, workflow/credential transfer, workflow versions, execution retry, execution tags | **P5-M10** (planned, blocked; P5-F-DEBT-012) | Each needs a backing model this product does not have. There is no project/sharing model, no audit generator, no source-control integration and no data-table store. There is also no retry execution path. Execution tags are upstream `AnnotationTag` entities, which do not exist here. Faking them would break the rule against invented completion. |

## 2. Behaviour

All of it lives in `apps/n8n-lego/src/auth/public-api-routes.mjs`, on the P5-M03 pipeline. The pipeline order is extended to match upstream more exactly:

`route → security (X-N8N-API-KEY) → body parse → schema validation (validate) → licence gate (licensed) → key scope → handler`

- **Schema validation runs before the licence and scope gates.** Upstream's express-openapi-validator runs before the handler middleware chain `[isLicensed, apiKeyHasScope…, handler]`. So an invalid body is 400 even for a key without the scope, or when the feature is unlicensed.
  - The existing P5-M03 workflow operations validate inside their handlers, after the scope check. That is left unchanged here, because changing it is outside this Slice. The only effect is that a key lacking the scope gets 403 rather than 400 for an invalid workflow body.
- **resourceType:** the `authorize()` resourceType is now derived from the scope's resource (`tag`, `variable`, `execution`). `workflow*` scopes keep `workflow`.

### 2.1 Tags

Source: `handlers/tags/tags.handler.ts`, `spec/schemas/tag.yml`.

| Operation | Scope | Result |
|---|---|---|
| `GET /tags` | `tag:list` | `{data, nextCursor}`, with the offset cursor and `limit` ≤ 250. |
| `POST /tags` | `tag:create` | 201 with the tag; the name is trimmed. |
| `GET /tags/{id}` | `tag:read` | 404 `Not Found` if the tag is unknown. |
| `PUT /tags/{id}` | `tag:update` | 404 if unknown; otherwise 200 with the renamed tag. |
| `DELETE /tags/{id}` | `tag:delete` | 404 if unknown; otherwise 200 with the deleted tag. |

- **Body validation** follows `tag.yml`: `additionalProperties:false`, `name` required and a string, and `id`/`createdAt`/`updatedAt` read-only.
- **Upstream quirk, mirrored verbatim:** `TagService.save` rejects both a duplicate name (unique index) and an invalid length (`@Length(1, 24)`, which covers an empty or whitespace-only name). The handler's catch answers *every* save failure with 409 `Tag already exists`.
- **Workflows embed tag copies in this store.** A rename therefore updates the copies, and a delete detaches them. This matches upstream's relational join, where a workflow always shows the tag's current name and loses a deleted tag. The DTO is `{id, name, createdAt, updatedAt}`.

### 2.2 Variables (community edition)

Source: `handlers/variables/variables.handler.ts`, `shared/middlewares/global.middleware.ts` (`isLicensed`), `errors/feature-not-licensed.error.ts`.

- All four operations are mounted: `GET|POST /variables` and `PUT|DELETE /variables/{id}`, with the scopes `variable:list|create|update|delete`.
- `PUBLIC_API_LICENSED_FEATURES` is empty in this build. Every operation therefore answers upstream's licence response, **before** the key scope:
  - status 403;
  - body `{message: "Your license does not allow for feat:variables. To enable feat:variables, please upgrade to a license that supports this feature."}`.
- Schema validation still runs first:
  - `variable.create.yml`: `key`/`value` required strings, `id`/`type` read-only, `additionalProperties:false`, and `projectId` a string or null;
  - the list query: `state` enum `[empty]` and `limit`.
- This is consistent with `/rest/variables`, which answers `[]` in the community edition.
- The handler behind the gate is fail-closed: it also answers the licence 403. A future licence flag therefore cannot expose an unimplemented store.

### 2.3 Executions

Sources: `handlers/executions/executions.handler.ts`, `spec/schemas/execution.yml`, `spec/paths/executions.yml`, and `@n8n/db` `ExecutionRepository.getExecutionsForPublicApi`, `getExecutionInWorkflowsForPublicApi` and `findSingleExecution`.

**Visibility.** The executions a key owner can see are those whose `workflowId` belongs to an existing workflow. This mirrors upstream's `getSharedWorkflowIds` combined with `workflowId IN (…)`; this product has one workspace, so every stored workflow counts as shared. An ad-hoc execution with no saved workflow, or one whose workflow was deleted, is not visible.

**`GET /executions`** (`execution:list`)
- Filters:
  - `status`, one of `canceled|error|running|success|waiting`; `error` matches both `error` and `crashed`;
  - `workflowId`;
  - `includeData`, a boolean;
  - `limit` ≤ 250;
  - `cursor`.
- Order is id DESC.
- `running` executions are excluded unless `status=running` is requested.
- An inaccessible `workflowId` returns 200 `{data:[], nextCursor:null}`.
- Fields: `id, finished, mode, retryOf, retrySuccessId, status, startedAt, stoppedAt, workflowId, waitTill`. With `includeData`, `data`, `workflowData` and `customData` are added.
- **lastId cursor:** base64 `{lastId, limit}`. `nextCursor` is set only if at least one record exists below the new lastId. An offset-flavour cursor carries no lastId, so it restarts from the first page, as upstream does.

**`GET /executions/{id}`** (`execution:read`)
- Returns every ExecutionEntity column: `id, finished, mode, retryOf, retrySuccessId, status, createdAt, startedAt, stoppedAt, deletedAt, workflowId, waitTill, storedAt`, plus data with `includeData`.
- A non-numeric id is 400 `request/params/id must be number` (`executionId.yml`: `type: number`).
- An unknown or inaccessible id is 404 `Not Found`.

**`DELETE /executions/{id}`** (`execution:delete`)
- 404 if unknown or inaccessible.
- 400 `Cannot delete a running execution`.
- Otherwise it removes the record and returns the entity without data.

**Not served:**
- `projectId` is accepted and not applied, the same as P5-M03 workflows, because there is no project model.
- `retry` and `tags` are 404 (P5-M10).

### 2.4 `GET /api/v1/openapi.yml`

- **Route:** upstream registers this route before the validator and authentication. Here it is likewise public: no key is needed, it is GET only, and the content type is `text/yaml; charset=UTF-8`.
- **Content:** `apps/n8n-lego/data/public-api-openapi.json` is generated by `apps/n8n-lego/scripts/extract-public-api-spec.py`.
  - The script reads the pinned `reference/n8n/packages/cli/src/public-api/v1/openapi.yml`.
  - It reads the mounted operations from `PUBLIC_API_OPERATIONS` through node, so there is a single source of truth.
  - It keeps only those operations and drops the `x-eov-*` keys.
  - It moves shared schema files to `components.schemas` and inlines the other relative `$ref`s.
  - The file records its provenance under `x-n8n-lego`.
- **Scope of the spec:** 21 operations on 11 paths; 47,698 bytes.
- **Serialisation:** the server serialises the file with a dependency-free YAML emitter. Every key and string is a JSON double-quoted scalar, which is valid YAML 1.2. Parsing the served text with PyYAML gives exactly the JSON file (checked during development).
- **Advertised = mounted:** a test asserts that the spec's operations equal the mounted table and that no file `$ref` or dangling `$ref` survives. An unmounted operation can therefore never be advertised.

## 3. Tests

**New file:** `apps/n8n-lego/test/public-api-v1-resources.test.mjs`, with 20 tests. They run end to end through `startServer`, with keys minted through the editor flow.
- **openapi.yml:**
  - public, served as YAML, GET only;
  - spec operations equal the mounted operations, with no unmounted path and no file or dangling `$ref`;
  - emitter unit cases.
- **tags:**
  - 400 before 403 (read-only, additional, required, type);
  - 201 with trimming;
  - 409 for a duplicate, a whitespace-only name and a 25-character name; 24 characters is accepted;
  - get / 404;
  - a full offset-cursor walk; invalid cursor 400; `limit=251` gives 400;
  - a rename propagates to workflow tags; renaming a tag to its own name is accepted; duplicate 409; 404;
  - delete detaches the tag from workflows, and a repeated delete gives 404.
- **variables:**
  - no licensed features;
  - all four operations give the exact licence 403 for both a fully scoped and an unscoped key;
  - schema 400s come first; security 401 comes before everything.
- **executions:**
  - one **real engine execution** (`/rest/workflows/:id/run`) and seeded records in every status, one without a workflow and one with a deleted workflow;
  - scopes: read ≠ list, and read ≠ delete;
  - DESC order, running excluded, orphans invisible, exact field set;
  - status filters (`error` ⊇ `crashed`), the `running` opt-in, `workflowId`, inaccessible workflow gives the empty page;
  - bad enum and bad boolean give 400;
  - a full lastId-cursor walk; garbage cursor 400;
  - `includeData`;
  - get with all entity columns and the real run's data; non-numeric id 400; orphan / deleted-workflow / unknown ids 404;
  - delete: running 400, success returns the entity without data and removes the record, then 404; retry not mounted.
- **cursor helpers:** both flavours decode, and garbage is rejected with the exact message.

**Existing file:** `test/public-api-v1.test.mjs`. The operation-count pin moved from 9 to 21. The surface grew; the pin was not relaxed, and it still asserts the exact count. Every scope of the new operations is in the pinned API-key vocabulary, as that test asserts for all operations.

**Local results at the branch head:**
- backend 2442/2442; the baseline was 2422, and this Slice adds 20;
- `lego:arch`, `lego:capabilities` and `lego:scaleout` pass;
- the new spec memo is marked `@scale-out-safe`, with the same justification as `src/lego/registry.mjs`: an immutable memo of a shipped static file;
- the contract count is unchanged, because the module is not a pinned contract.

## 4. Security notes

- **Authentication and authorization are unchanged from P5-M03.** The key is read from the header only and never logged. Authentication happens before the body is read. The scope check goes through the P5.3 `authorize()` kernel, where an unknown permission fails closed and the effective scopes are the key ∩ the owner's current grant.
- **No secrets reach the API:** execution data is served only with `includeData` and only to `execution:list|read` keys. Execution records carry run data, never credentials; the credential vault is untouched by this Slice.
- **The licence gate fails closed:** an unlicensed feature is never reachable, even with every scope.
- **`openapi.yml` is public, as upstream's is.** It contains only the static spec: no instance data and no secrets.

## 5. Rollback

`git revert -m 1 <merge>`. There is no store-format change. Tags created through the API gain `createdAt`/`updatedAt`, which the editor ignores. Deleted executions and tags are ordinary deletions.

## 6. Delivery record

Observed after merge `600a21456213602ebdc6193229bab8432e6d1024` (PR #304, head `c102cff9d2744831828310b9353407f0811cd3d8`). This section does not mark the slice implemented.

GitHub-hosted checks on the merge commit passed (architecture gate, unit/integration, clean-clone smoke, Windows portability). Self-hosted Windows Level 2 also passed (`laptop-build-worker-2`).

Attempt 1 of the self-hosted Linux jobs never started a step: the runner lost communication. Attempt 2 (2026-09-25T14:59:54Z–15:10:59Z) ran and then failed the same way:

| Job | Run | Runner | Result |
| --- | --- | --- | --- |
| Level 2 Conformance LEGO & Node Catalog | 36136621102 | MDMTEST-n8n-wsl-5 | SUCCESS |
| Level 2 Workspace Tests (windows) | 36136621102 | laptop-build-worker-2 | SUCCESS (attempt 1) |
| Level 0 (Check & Format) | 36136621119 | MDMTEST-n8n-wsl-3 | environmental failure: runner lost communication |
| Level 1 (Affected Tests) | 36136621119 | MDMTEST-n8n-wsl-2 | environmental failure: runner lost communication |
| Level 2 Workspace Tests (linux) | 36136621102 | MDMTEST-n8n-wsl-4 | environmental failure: runner lost communication |
| Post-Merge Verification & Branch Cleanup | 36137555071 | MDMTEST-n8n-wsl | environmental failure: runner lost communication |

Classification is environmental, not an implementation regression. DEC-0015: this is not PASS. The slice stays `in-progress` / verifying and contributes 0% to the completion KPI. Runner settings and workflow files were not changed. One environmental retry remains; it was not spent because all five WSL runners were offline when this evidence was recorded.

### 6.1 The environmental retry (spent, 2026-09-26)

`validation.yml` (Level 0 + Level 1) and `integration.yml` (Level 2 linux + windows + conformance) have no `workflow_dispatch` and trigger only on `pull_request` with `paths-ignore: **.md, docs/**`. PR #304's head `c102cff9` never ran the suite at all — 0 workflow runs — so the retry was run through PR #310 (head `d520a7401c792bda9e49f5b4503cdc2b414d5887`, merged as `b528a19d06c6866787da934993e5cf17e9d75418`), a governance/tooling branch cut from `main` `674546f`. That head carries the P5-M08 implementation byte-identical to delivery merge `600a2145`:

```
git diff 600a2145 d520a740 -- apps/n8n-lego/src apps/n8n-lego/data apps/n8n-lego/scripts \
    apps/n8n-lego/test/public-api-v1.test.mjs apps/n8n-lego/test/public-api-v1-resources.test.mjs \
    crates contracts packages
→ empty
```

The retry verified every required check on the real self-hosted runners:

| Job | Run | Runner | Result |
| --- | --- | --- | --- |
| Level 0 (Check & Format) | 36166949165 | MDMTEST-n8n-wsl-2 | SUCCESS |
| Level 1 (Affected Tests) | 36166949165 | MDMTEST-n8n-wsl | SUCCESS |
| Level 2 Workspace Tests (linux) | 36166949086 | MDMTEST-n8n-wsl-3 | SUCCESS |
| Level 2 Workspace Tests (windows) | 36166949086 | laptop-build-worker-3 | SUCCESS |
| Level 2 Conformance LEGO & Node Catalog | 36166949086 | MDMTEST-n8n-wsl-4 | SUCCESS |
| Post-Merge Verification & Branch Cleanup | 36167178324 | MDMTEST-n8n-wsl-3 | SUCCESS (6/6 steps) |

DEC-0015 verdict: **ALL_GREEN** — GitHub-hosted 3 pass, self-hosted 7 pass / 0 fail / 0 waiting. Runner availability was read from the API at the same time (9 of 10 online and idle). The earlier failure is not relabelled: it is recorded above as an environmental runner-communication loss, and the retry is the documented environmental retry, not a third attempt.

Checkpoint CP-05 was derived, not typed: `node tools/lego/progress-event.mjs resolve --slice P5-M08 --checkpoint CP-05 --head d520a740 --fetch` read the jobs and the runners from the GitHub API, applied the DEC-0015 classifier against the required set declared on CP-05, and derived `completed` with the runner identities and run IDs above. No percentage was entered by hand.

With CP-01..CP-05 completed, the three conditions in the header are met: the merge (`600a2145`), fresh-main verification, and runner verification. The slice is recorded `implemented` by the governance PR that reconciles this section, not by the telemetry commits that carried CP-05.

The reconciliation PR is [#311](https://github.com/Catzpro01/n8n-rust-v.4/pull/311) (`ebfee266`, merged as `76324ab8d0362988778924ce3713db974452f814` on 2026-09-26). It set `P5-M08.status` to `implemented`, wrote `mergeSha` `600a21456213602ebdc6193229bab8432e6d1024`, moved `executionPointer.latestCompletedSlice` from P5-M03 to P5-M08, emptied `executionPointer.verifyingSlices`, and advanced `lastVerifiedMain` to `9d49aa67e0f6ea9e0a4b0e0f6b6f4d5a1c8e3b72`. Its own nine checks ran green (`mergeable_state: clean`) — Level 0 `36169464853` on `MDMTEST-n8n-wsl`, Level 1 `36169464853` on `MDMTEST-n8n-wsl-5`, Level 2 linux `36169464879` on `MDMTEST-n8n-wsl-4`, Level 2 windows `36169464879` on `laptop-build-worker-3`, Level 2 conformance `36169464879` on `MDMTEST-n8n-wsl-2` — and its post-merge gate completed success, 4 of 4. This PR touched no workflow, Cargo, runner-config or product file.
