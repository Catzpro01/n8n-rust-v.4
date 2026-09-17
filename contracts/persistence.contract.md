# LEGO Contract: Persistence

Reference: n8n 2.9.4. Status: **VERIFIED** (Agent 4, Phase 2 — contract backed by reference tests + live 11/11 smoke).
Analysis: `docs/isolation/persistence.md`. Golden: `tests/reference/agent-4/golden/execution-status.golden.json`, `tests/reference/agent-4/live/baseline-before.json` (steps 6–11).

## 1. Purpose
Own durable storage for the platform: workflow definitions (with version history and publish history), execution records and their serialized run data, static data, and instance settings — through TypeORM repositories in `@n8n/db` against SQLite / PostgreSQL / MySQL/MariaDB. Present typed save/load/status operations; hide the SQL dialect and serialization format from every other LEGO.

## 2. Inputs
| Operation | Input | Producer |
|---|---|---|
| Workflow save | `WorkflowEntity` (`id?`, `name`, `nodes`, `connections`, `settings`, `staticData`, `pinData`, `meta`, `versionId`, `active`, `activeVersionId`, `isArchived`, `triggerCount`, `parentFolder`) + `project` for `shared_workflow` | Workflow service (API) |
| Workflow update | `Partial<WorkflowEntity>` + `versionId` optimistic check | Workflow service |
| Execution create | `ExecutionPayload { mode, finished:false, status:'new', workflowId, workflowData, data: IRunExecutionData, retryOf?, storedAt }` | `ActiveExecutions.add` (Execution) |
| Execution update | `UpdateExecutionPayload { status, finished, startedAt?, stoppedAt, waitTill, data, workflowData }` + optional guard conditions (`requireNotFinished`, `requireNotCanceled`) | lifecycle hooks (Execution) |
| Status transitions | `setRunning(id)`, `markAsCrashed(ids)`, `stopBeforeRun/stopDuringRun/cancelMany`, `softDelete/hardDelete` | Execution / recovery / pruning |
| Static data | `saveStaticDataById(id, data)` | Trigger / Execution hooks |
| Settings | `SettingsRepository.upsert(key,value)` | owner setup, license, features |

## 3. Outputs
| Operation | Output |
|---|---|
| `WorkflowRepository.get / findById / getAllActiveIds / getActiveTriggerCount` | `WorkflowEntity` (+ `shared`, `tags`) or `null` |
| `WorkflowFinderService.findWorkflowForUser(id, user, scopes)` | entity or `null` → 404 `Could not load the workflow - you can only access workflows owned by you` (API layer) |
| `ExecutionRepository.findSingleExecution(id, { includeData, unflattenData })` | `IExecutionResponse` — `data` as **flatted string** unless `unflattenData`; `workflowData` snapshot `{id,name,nodes,connections,settings,active,activeVersionId,isArchived,createdAt,updatedAt,pinData,staticData}` |
| `findManyByRangeQuery / findRangeWithCount` | `ExecutionSummary[]` with `{count, results, estimated}` |
| `ExecutionPersistence.create` | new `executionId` (stringified integer) |
| `updateExistingExecution` | `boolean` (false when 0 rows matched guard) |
| Errors | `CorruptedExecutionDataError`, TypeORM `QueryFailedError` (unique/duplicate), `DbConnectionTimeoutError` |

## 4. Responsibilities
- Transactions: workflow create = `workflow_entity` + `shared_workflow` + `workflow_history` in one transaction; execution create = `execution_entity` + `execution_data` in one transaction.
- Versioning: `versionId` is regenerated **only when `nodes` or `connections` change** (settings/name-only PATCH keeps `versionId`) and a `workflow_history` row is written; `versionCounter` increments; `activeVersionId` set on activate / `null` on deactivate; `workflow_publish_history` row per (de)activation.
- Serialization: `execution_data.data` is `flatted.stringify(IRunExecutionData)`; `workflowData` as JSON; `pinData` never stored in execution snapshot.
- Status vocabulary: `'new' | 'running' | 'success' | 'error' | 'crashed' | 'canceled' | 'waiting' | 'unknown'`; `finished` (deprecated bool) kept in sync (`true` only for `success`/`error` terminal states with `finished` flag from run data).
- Save policy: `toSaveSettings` (`saveDataErrorExecution`, `saveDataSuccessExecution`, `saveManualExecutions`, `saveExecutionProgress`) decides whether a finished execution is kept, soft-deleted (manual & not saved) or hard-deleted.
- Soft-delete/prune: `deletedAt` then hard delete after buffer (leader only).
- Migrations: `@n8n/db/src/migrations/{common,sqlite,postgresdb,mysqldb}` — schema is versioned; a fresh 2.9.4 DB has `workflow_entity.name` **without** a unique index (duplicate names allowed; verified live).
- Recovery: on boot, in-progress executions → `markAsCrashed` (regular mode) / recovered from event log.

## 5. Non-responsibilities
- No business validation of workflow payload (→ Validation / API DTO). No permission checks except via `shared_*` join helpers (`findIfShared`).
- Does not decide execution status — `determineFinalExecutionStatus` lives in Execution lifecycle; Persistence stores what it is told, except `setRunning`/`markAsCrashed`/`cancel*` helpers which are explicit transitions.
- Does not hold binary data (→ `BinaryDataService`, filesystem/S3).
- Does not encrypt credentials (→ Credentials LEGO owns `credentials_entity` semantics; Persistence only provides the repository).
- Does not own `webhook_entity` semantics (→ Webhook LEGO) — provides the repository only.

## 6. Dependencies (verified)
| Module | Class |
|---|---|
| `@n8n/db` entities, repositories, migrations, `DbConnection`, `@n8n/typeorm` | INTERNAL (owned) |
| `cli/src/executions/execution-persistence.ts`, `execution-data/fs-store.ts`, `cli/src/execution-lifecycle/*` (save hooks, `to-save-settings.ts`, `shared`) | INTERNAL / boundary to Execution (hooks call repositories) |
| `cli/src/workflows/workflow.service.ts`, `workflow-history.ee/*`, `workflow-finder.service.ts`, `workflow-static-data.service.ts` | INTERNAL |
| `flatted` | EXTERNAL (wire format — must stay byte compatible) |
| `sqlite3`/`pg`/`mysql2` drivers, `@n8n/config` `database.*`, `executions.*` | EXTERNAL |
| `n8n-workflow` `IRunExecutionData`, `ExecutionStatus`, `IWorkflowBase`, `WorkflowExecuteMode` | SHARED |
| Consumers: Execution (`ActiveExecutions`, `WorkflowRunner`, `WaitTracker`), Trigger (`getAllActiveIds`, static data), Webhook (`WorkflowRepository`, waiting executions), API (all controllers), Credentials (`CredentialsRepository`) | CROSS-BOUNDARY (inbound) |

## 7. Error behavior
| Case | Behaviour |
|---|---|
| `POST /rest/workflows` with existing `id` | 400 `Workflow with id X exists already.` (`WorkflowService`/`BadRequestError` before insert) |
| Duplicate workflow name | **allowed** (200) — no unique constraint in 2.9.4 |
| Load unknown workflow | repository `null` → API 404 (message above) |
| Load unknown execution via `GET /rest/executions/:id` | 200 `{}` (service returns `undefined`, envelope of empty) — not 404 |
| `GET /rest/executions/abc` | 400 `Execution ID is not a number` |
| Update with guard not met (`requireNotFinished`) | returns `false`; caller logs; no throw |
| Corrupt flatted payload | `CorruptedExecutionDataError` on `unflattenData` |
| `DELETE /rest/workflows/:id` on non-archived | 400 `Workflow must be archived before it can be deleted.` (archive first: `isArchived=true`) |
| DB unreachable | `DbConnectionTimeoutError` at boot; `/healthz/readiness` 503 |

## 8. Lifecycle
```
Workflow:  create (tx: entity + shared + history) → update (versionId bump iff nodes/connections changed; history row)
           → activate (activeVersionId, publish_history) → deactivate (activeVersionId=null) → archive (isArchived) → delete
Execution: create {status:'new', finished:false} (tx entity+data) → setRunning {status:'running', startedAt}
           → [saveExecutionProgress updates] → workflowExecuteAfter → updateExistingExecution {status:'success'|'error'|'waiting'|…, stoppedAt, data, workflowData}
           → (manual & !saveManual → softDelete) → prune: softDelete → hardDelete
Boot:      pending 'running'/'new' → markAsCrashed
```
Golden (live): webhook execution row `{status:'success', mode:'webhook', finished:1}` + `execution_data` row (`len 1782`, `workflowVersionId` = workflow `versionId`), `lastNodeExecuted:'Code'`; response keys `createdAt,customData,data,deletedAt,finished,id,mode,retryOf,retrySuccessId,startedAt,status,stoppedAt,storedAt,waitTill,workflowData,workflowId`.

## 9. Data ownership
- **Owns:** `workflow_entity`, `workflow_history`, `workflow_publish_history`, `workflow_statistics`, `shared_workflow`, `workflows_tags`, `tag_entity`, `folder*`, `execution_entity`, `execution_data`, `execution_metadata`, `execution_annotation*`, `settings`, `variables`, `installed_*`, `migrations`; plus `binary data` id references (not blobs).
- **Provides repositories but not semantics for:** `webhook_entity` (Webhook), `credentials_entity`/`shared_credentials` (Credentials), `user`/`project`/`role`/`auth_*` (Auth/API).

## 10. External interfaces
- Repositories (`@n8n/db`): `WorkflowRepository`, `ExecutionRepository`, `ExecutionDataRepository`, `ExecutionMetadataRepository`, `WorkflowHistoryRepository`, `WorkflowPublishHistoryRepository`, `SettingsRepository`, `SharedWorkflowRepository`, …
- Services: `ExecutionPersistence { create, hardDelete }`, `WorkflowService { getMany, update, delete, archive }`, `WorkflowStaticDataService`, `ExecutionService`.
- Config: `DB_TYPE`, `DB_SQLITE_*`, `DB_POSTGRESDB_*`, `EXECUTIONS_DATA_SAVE_*`, `EXECUTIONS_DATA_PRUNE*`, `N8N_EXECUTIONS_DATA_STORAGE_MODE`.

## 11. Compatibility requirements
- Byte-compatible `flatted` for `execution_data.data`; readers must accept both flatted and legacy JSON? — **No**: 2.9.4 only reads flatted (`parse` throws → corrupted). Keep flatted.
- `versionId` bump rule and `workflow_history` write must be preserved (editor conflict detection relies on it).
- Execution ids are integers stringified in the API; auto-increment.
- Status strings and `finished` semantics exactly as above.
- SQLite is the reference dialect for verification (`database.sqlite` under `N8N_USER_FOLDER/.n8n`); pooled SQLite (`DB_SQLITE_POOL_SIZE`) changes driver but not schema.
- Migrations must run forward from any released n8n schema; never edit an existing migration.

## 12. Phase-3 reconstruction addendum (POOL-004: pure core, JS/TS 1:1)

**Status:** IMPLEMENTED — self-verified in sandbox (unit goldens + A/B parity vs the pinned 2.9.x dist),
awaiting peer consensus and Agent-5 gate. **Owner of record:** agent-12 (`arena/01a0af71-n8n-rust-v-4`).
**Package:** `packages/persistence-lego/`. ZERO RUST; `reference/` untouched; UI untouched (rule 5).

### 12.1 Scope of this increment (DB-free pure core only)
Reconstructed 1:1 from source, all behavior observable without a live database:

| Ported unit (package path) | Reference source (`reference/n8n/…`) | Wire-visible behavior frozen |
| :--- | :--- | :--- |
| `src/utils/transformers.mjs` | `packages/@n8n/db/src/utils/transformers.ts` (full file) | `idStringifier`, `lowerCaser`, `objectRetriever`, `sqlite.jsonColumn`, `bigintStringToNumber` — exact `to`/`from` semantics incl. `FindOperator` pass-through |
| `src/utils/separate.mjs` | `@n8n/db/src/utils/separate.ts` | `[pass, fail]` partition, order preserving |
| `src/utils/is-string-array.mjs` | `@n8n/db/src/utils/is-string-array.ts` | every-string guard |
| `src/utils/sql.mjs` | `@n8n/db/src/utils/sql.ts` | identity template tag (interleave) |
| `src/utils/get-final-test-result.mjs` | `@n8n/db/src/utils/get-final-test-result.ts` | severity `error > warning > success`, filter before compare |
| `src/utils/generators.mjs` | `@n8n/db/src/utils/generators.ts` + `@n8n/utils/src/workflowId.ts` + `@n8n/constants` | `NANOID_ALPHABET` (62 chars, 0-9A-Za-z), `generateNanoId()` 16 chars, `generateHostInstanceId(type)` = `${type}-${id}`; RNG via `nanoid@3.3.8` `customAlphabet` (real pinned package) |
| `src/utils/build-workflows-by-nodes-query.mjs` | `@n8n/db/src/utils/build-workflows-by-nodes-query.ts` | byte-exact `whereClause`/`parameters` for `postgresdb` and `sqlite`; `Error('Unsupported database type')` otherwise |
| `src/entities/abstract-entity.mjs` | `@n8n/db/src/entities/abstract-entity.ts` | column-type maps per dialect (`simple-json`/`json`, `datetime`/`timestamptz`, `blob`/`bytea`), timestamp syntax (`STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')` / `CURRENT_TIMESTAMP(3)`), `tsColumnOptions {precision:3}`, `generateId` `@BeforeInsert` semantics (set only when falsy), `setUpdateDate` `@BeforeUpdate` |
| `src/repositories/execution-shaping.mjs` | `@n8n/db/src/repositories/execution.repository.ts` L149, L191-226, L269-344, L350-362, L1125-1140 + `cli/src/executions/execution-persistence.ts#create` | flatted string pass-through vs `unflattenData` (parse → truthy → `migrateRunExecutionData`), valid/invalid split (`executionData !== null`), response assembly incl. `customData` from `execution_metadata`, `serializeAnnotation` (`pick(id,name)` tags), success-with-`'[]'` anomaly report, `updateExistingExecution` payload split (`executionInformation` vs `executionData`), `MAX_UPDATE_BATCH_SIZE = 900` slicing, `ExecutionPersistence.create` insert/fs plans (`workflowSnapshot` pick, `storedAt`, `workflowVersionId ?? null`) |
| `src/repositories/to-save-settings.mjs` | `cli/src/execution-lifecycle/to-save-settings.ts` | `ExecutionSaveSettings` decision table incl. the frozen asymmetry: absent keys resolve raw config then collapse via `==='all'`; explicit `'DEFAULT'` returns the RAW config value (`'all'`/`'none'` string) uncoerced — hence the reference type `boolean \| 'all' \| 'none'` |

### 12.2 Explicitly NOT in this increment (still reference behavior, next tasks)
TypeORM entities/decorators metadata, repositories' SQL/query-builder paths, `DbConnection`, migrations, fs-store I/O, pruning/cancellation query paths (`stopBeforeRun/stopDuringRun/deleteExecutionsByFilter`), `restoreBinaryDataId`, and every driver-level concern. These need a driver harness (sqlite/pg) and remain owned by the reference until a later POOL task ports them with a live-DB golden.

### 12.3 Ports declared (no hidden dependency)
| Port | Replaces | Injected |
| :--- | :--- | :--- |
| `P-PERSIST-CONFIG` | `Container.get(GlobalConfig).database.type` / `executions.save*` | `setPersistenceConfig({ dbType, executions })`; default `dbType:'sqlite'`, executions defaults `all/true` per `@n8n/config` defaults |
| `P-PERSIST-WORKFLOW` | `n8n-workflow` `jsonParse`, `migrateRunExecutionData` | consumed read-only from pinned `n8n-workflow@2.9.1` via `src/consumed.mjs` (swappable for workflow-lego/execution-data-lego ports when integrated) |
| `P-PERSIST-REPORTER` | `ErrorReporter.error` / `Logger.info` edge calls | injected; default silent collector |
| flatted wire format | `flatted@3.2.7` (pnpm catalog pin) | REAL pinned package — the wire format must stay byte compatible (§11) |

### 12.4 Frozen truths (machine-checked)
- `handleExecutionRunData(flattedString, {unflattenData:true})` ≡ real `parse` + `migrateRunExecutionData` (A/B vs dist, incl. v0→v1 lifting); falsy parse result → `undefined`.
- `ExecutionPersistence.create` plan is insert-order deterministic; `workflowSnapshot` contains exactly `{connections,nodes,name,settings,id}`; `workflowVersionId = workflowData.versionId ?? null`.
- `updateExistingExecution` never transports `id/data/workflowId/createdAt/startedAt/customData` in `executionInformation`; `data` is `stringify`ed into `executionData` only when present.
- `markAsCrashed` batches slice 900; string id normalizes to `[id]`.
- `toSaveSettings({})`/`null` resolve to config defaults (boolean via `==='all'`); explicit per-workflow `'DEFAULT'` returns the RAW config value (`'all'`/`'none'`) — evidenced asymmetry, machine-pinned.
- `handleExecutionRunData(..., {unflattenData:true})` on a JSON-primitive root (`'null'`, `'0'`, ...) throws the raw flatted error (the falsy-guard is unreachable with flatted@3.2.7 — defensive code preserved).
- `buildWorkflowsByNodesQuery` SQL strings are byte identical to source (tab-indented template literals), `parameters.nodeTypeN` numbered in input order.
- `generateNanoId()` ∈ `[0-9A-Za-z]{16}`; `generateHostInstanceId('main')` matches `/^main-[0-9A-Za-z]{16}$/`.

### 12.5 Verification
`npm test --prefix packages/persistence-lego` → 7 suites, **57/57 PASS** (self-reported; machine log in `results/POOL-004-persistence-pure-core.md`). A/B side executes ONLY if `.runtime` is present (`scripts/setup-reference-runtime.sh`); without it, goldens still run and A/B is reported SKIPPED — never silently passed. Manifest: `packages/persistence-lego/manifest/source-pins.json` pins sha256 of every ported reference file.
