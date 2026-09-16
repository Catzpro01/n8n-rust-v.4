# LEGO Isolation: Persistence

**Agent:** Agent 4 — Phase 2 LEGO Isolation
**Reference:** n8n 2.9.4 (`reference/n8n`, upstream `b6dc2787`)
**Status:** VERIFIED (ANALYZED → ISOLATED → TESTED → VERIFIED; documentation + contract, no source change required; smoke 11/11 before and after, live verification passed — see `docs/isolation/agent-4-report.md`)

---

## 1. Where persistence lives

n8n 2.9.4 already extracted its persistence layer into a dedicated workspace
package — this is the LEGO:

```
packages/@n8n/db/                     package name: @n8n/db
├── src/connection/                   DbConnection, DbConnectionOptions  (TypeORM DataSource; sqlite | postgresdb)
├── src/entities/                     TypeORM entities (schema)
├── src/repositories/                 @Service() repositories extending TypeORM Repository<T>
├── src/migrations/{sqlite,postgresdb,common}/
├── src/subscribers/                  UserSubscriber (project name sync)
├── src/utils/transformers.ts         idStringifier, objectRetriever, sqlite.jsonColumn
└── src/entities/types-db.ts          IWorkflowDb, IExecutionDb, IExecutionResponse, IExecutionFlattedDb, ...
```

The ORM is a **vendored TypeORM fork** (`@n8n/typeorm`). Database type is
`GlobalConfig.database.type` (`sqlite` default, `postgresdb`). MySQL/MariaDB
were removed before 2.x. SQLite uses a pooled driver
(`SqlitePooledConnectionOptions`) with `simple-json` columns; Postgres uses
`json`/`timestamptz`.

Column type helpers (`entities/abstract-entity.ts`): `JsonColumn`,
`DateTimeColumn`, `WithTimestamps`, `WithTimestampsAndStringId`
(16-char nanoid string ids generated in `@BeforeInsert`).

Persistence is consumed from `packages/cli` through DI-injected repositories
plus a thin set of cli-side services that add *policy* (what/when to save).
Those cli files are part of the Persistence LEGO's boundary, listed per
sub-area below.

---

## 2. Sub-LEGO A — Workflow persistence

### Entities

| Entity | Table | Purpose |
| :--- | :--- | :--- |
| `WorkflowEntity` | `workflow_entity` | Draft: `name`, `nodes`, `connections`, `settings`, `staticData`, `pinData`, `meta`, `versionId`, `activeVersionId`, `active` (deprecated), `isArchived`, `triggerCount`, `versionCounter`, `parentFolder` |
| `WorkflowHistory` | `workflow_history` | Immutable versions: `versionId` (PK), `workflowId`, `nodes`, `connections`, `authors`, `name`, `description`, `autosaved` |
| `WorkflowPublishHistory` | `workflow_publish_history` | activation/deactivation audit |
| `SharedWorkflow` | `shared_workflow` | `(workflowId, projectId, role)` ownership |
| `WorkflowTagMapping`, `TagEntity`, `Folder`, `WorkflowStatistics`, `WorkflowDependency` | — | auxiliary |

**Important 2.x model:** the *editor draft* lives in `workflow_entity.nodes/connections`;
the *active/published* version is `workflow_entity.activeVersionId → workflow_history`.
Runtime (webhooks, triggers) always loads `activeVersion.nodes/connections`.
`active` boolean is kept in sync but is deprecated in favour of `activeVersionId !== null`.

### Save (`POST /rest/workflows`, `PATCH /rest/workflows/:id`)

`WorkflowsController.create` (cli/src/workflows/workflows.controller.ts:103-255):

```
DTO validation (CreateWorkflowDto, zod)        → 400 on failure (see api.md)
new WorkflowEntity(); Object.assign(body); active=false; versionId=uuid()
validateEntity (class-validator: name 1..128)  → BadRequestError
externalHooks 'workflow.create'
replaceInvalidCredentials, addNodeIds
transaction:
   save WorkflowEntity
   save SharedWorkflow{role:'workflow:owner', projectId}
   WorkflowHistoryService.saveVersion(user, workflow, id, autosaved)   → workflow_history row
   findWorkflowForUser(...)                                            → response
```

`WorkflowService.update` (:281-495) — same pattern; every content change
mints a new `versionId`, writes a history row, and if the workflow is active
and `publishIfActive`, updates `activeVersionId` and re-adds it to the
`ActiveWorkflowManager` (Trigger LEGO).

Transaction boundary: `projectRepository.manager.transaction(...)` around
entity + share + history. Uniqueness: `workflow_entity.name` has a unique
index → `send()` maps unique-constraint errors to
*"There is already an entry with this name"*.

### Load

* `WorkflowRepository.findById(id)`, `.findOne({relations:{activeVersion:true, shared:true}})`
* `WorkflowFinderService.findWorkflowForUser(id, user, scopes, {includeTags, includeParentFolder, includeActiveVersion})`
  (adds sharing/permission filtering — API/domain concern).
* `ActiveWorkflowsService.getAllActiveIdsInStorage()` → ids with `activeVersionId IS NOT NULL`.
* `WorkflowRepository.getActiveWorkflowsWithVersion / getAllActiveWithVersion` (paged, used by `addActiveWorkflows('init')`).

### Static data

`WorkflowStaticDataService.saveStaticData(workflow)` /
`saveStaticDataById(id, data)` — writes `workflow_entity.staticData` only when
`workflow.staticData.__dataChanged === true`. Called by Trigger/Webhook LEGO
after every emit and by execution hooks after finish. Not saved for
`manual` mode.

---

## 3. Sub-LEGO B — Execution persistence

### Entities

| Entity | Table | Key columns |
| :--- | :--- | :--- |
| `ExecutionEntity` | `execution_entity` | `id` (auto-increment, stringified), `workflowId`, `mode`, `status`, `finished` (deprecated), `createdAt`, `startedAt`, `stoppedAt`, `waitTill`, `retryOf`, `retrySuccessId`, `deletedAt` (soft delete), `storedAt: 'db' \| 'fs'` |
| `ExecutionData` | `execution_data` | `executionId` (PK/FK cascade), `data: text` (flatted), `workflowData: json` (snapshot), `workflowVersionId` |
| `ExecutionMetadata` | `execution_metadata` | `(executionId, key, value)` from `$execution.customData` |
| `ExecutionAnnotation` (+tags) | `execution_annotation` | EE: vote/note/tags |

`ExecutionStatus` (n8n-workflow): `'canceled' | 'crashed' | 'error' | 'new' | 'running' | 'success' | 'unknown' | 'waiting'`.

### Lifecycle writes (in order)

```
1. ActiveExecutions.add(executionData)                       cli/src/active-executions.ts:62
     └─ ExecutionPersistence.create(payload)                  cli/src/executions/execution-persistence.ts:34
          transaction:
            insert execution_entity { mode, finished:false, status:'new', workflowId, retryOf, createdAt, storedAt }
            storedAt==='db' → insert execution_data { executionId, workflowData: snapshot{id,name,nodes,connections,settings}, data: flatted.stringify(runExecutionData), workflowVersionId }
            storedAt==='fs' → FsStore.write(...)   (N8N_EXECUTIONS_DATA_STORAGE_MODE=filesystem)
     └─ (regular mode) ExecutionRepository.setRunning(id)     → status:'running', startedAt:now
2. hookFunctionsSaveProgress (if saveExecutionProgress)       execution-lifecycle-hooks.ts:307
     └─ saveExecutionProgress → updateExistingExecution(id, {data}, {requireNotFinished / requireNotCanceled})
3. hookFunctionsSave.workflowExecuteAfter(fullRunData)        execution-lifecycle-hooks.ts:362-475
     ├─ !manual && staticData changed → saveStaticDataById
     ├─ manual && !saveSettings.manual && !waitTill → executionRepository.softDelete(id); return
     ├─ shouldNotSave (success && !saveSuccess | error && !saveError) && !waitTill && !manual
     │      → executeErrorWorkflow; executionPersistence.hardDelete({...}); return
     ├─ prepareExecutionDataForDbUpdate(...)  → UpdateExecutionPayload (pristine workflowData subset)
     ├─ updateExistingExecution({executionId, workflowId, executionData})
     │      └─ ExecutionRepository.updateExistingExecution(id, {status, finished, startedAt?, stoppedAt, waitTill, data, workflowData}, conditions?)
     │            transaction: update execution_entity WHERE id (+conditions) ; update execution_data { data: flatted.stringify, workflowData }
     │            returns false if 0 rows affected (conditions not met)
     ├─ updateExistingExecutionMetadata(id, resultData.metadata)
     └─ !manual → executeErrorWorkflow(...)
```

`determineFinalExecutionStatus(runData)` (execution-lifecycle/shared): success
unless `resultData.error` / `crashed` / `canceled` / `error`; `waitTill` → `waiting`.

Save policy (`toSaveSettings`, `execution-lifecycle/to-save-settings.ts`):
workflow `settings.saveDataErrorExecution / saveDataSuccessExecution /
saveManualExecutions / saveExecutionProgress` override `GlobalConfig.executions.*`
defaults (`all / all / true / false`).

### Reads

* `ExecutionRepository.findSingleExecution(id, {includeData, unflattenData, includeAnnotation, where})`
  — with `includeData` joins `execution_data` + `metadata`; `unflattenData`
  runs `flatted.parse` (corrupt → `CorruptedExecutionDataError`).
* `findMultipleExecutions`, `findManyByRangeQuery` (summaries for the list UI),
  `getWaitingExecutions` (WaitTracker), `getInProgressExecutionIds`,
  `findIfShared/findIfAccessible` (API permission filtering).
* `ExecutionService.findOne / findRangeWithCount / retry / stop / delete` add
  permission and business rules on top.

### Other status transitions

| Method | Effect |
| :--- | :--- |
| `setRunning(id)` | `status='running', startedAt=now` |
| `markAsCrashed(ids)` | `status='crashed', stoppedAt=now` (recovery on boot) |
| `stopBeforeRun / stopDuringRun / cancelMany` | `status='canceled', stoppedAt=now` |
| `softDelete(id)` / `softDeletePrunableExecutions()` | `deletedAt=now` (pruning) |
| `hardDelete` (`ExecutionPersistence`) | delete rows + binary data + fs blobs |

Pruning (`ExecutionsPruningService`) runs on the leader only, using
`EXECUTIONS_DATA_MAX_AGE`/`EXECUTIONS_DATA_PRUNE_MAX_COUNT` with soft-delete
then hard-delete after `EXECUTIONS_DATA_HARD_DELETE_BUFFER`.

---

## 4. Sub-LEGO C — Execution *data* persistence (serialization)

* Run data (`IRunExecutionData`) is serialized with **`flatted`** (not
  `JSON.stringify`) to support circular references and shared objects; stored
  in `execution_data.data` as TEXT. Any Rust replacement must read/write the
  flatted wire format byte-compatibly (arrays of nodes with index references,
  strings prefixed to distinguish literals).
* `workflowData` column stores an `IWorkflowBase` snapshot **without**
  `pinData` (typed `ISimplifiedPinData`) and, since `ExecutionPersistence.create`,
  only `{id, name, nodes, connections, settings}`.
* Binary data is *not* in the DB — it goes through `BinaryDataService`
  (`filesystem` / `s3`; `default` in-memory mode inlines base64 into run data).
  `restore-binary-data-id.ts` fixes ids after execution id is known.
* Optional filesystem mode for run data: `storedAt='fs'`,
  `executions/execution-data/fs-store.ts` writes `<storage>/executions/<workflowId>/<executionId>.json`.

---

## 5. Sub-LEGO D — Metadata / configuration persistence

| Entity | Table | Repository | Used by |
| :--- | :--- | :--- | :--- |
| `Settings` | `settings` | `SettingsRepository` (`key`, `value`, `loadOnStartup`) | owner setup flag `userManagement.isInstanceOwnerSetUp`, license, community packages, `features.*` |
| `Variables` | `variables` | `VariablesRepository` | `$vars` (values cached in `VariablesService`) |
| `User`, `AuthIdentity`, `ApiKey`, `InvalidAuthToken`, `Role`, `Scope`, `Project`, `ProjectRelation` | — | — | Auth / RBAC (API LEGO consumers) |
| `WebhookEntity` | `webhook_entity` | `WebhookRepository` | Webhook LEGO |
| `ProcessedData` | `processed_data` | `ProcessedDataRepository` | dedupe helpers (`DataDeduplicationService`) |
| `ExecutionMetadata` | `execution_metadata` | — | `$execution.customData` |

Instance-level config that is **not** in the DB: `~/.n8n/config`
(`InstanceSettings`: `encryptionKey`, `tunnelSubdomain`, `fsStorageMigrated`).

Cache (`CacheService`, memory or Redis) sits beside persistence and is used
as a write-through for webhooks, activation errors, test-webhook registrations,
and variables. It is *not* a source of truth.

---

## 6. Connection and transactions

* `DbConnection.init()` builds the `DataSource`, `migrate()` runs pending
  migrations (`Migrations` list per driver; wrapped so `sqlite` gets
  `PRAGMA foreign_keys` handling), `close()` on shutdown.
* Transactions are TypeORM `manager.transaction(async tx => …)`. Boundaries
  found:
  * workflow create (entity + share + history),
  * `ExecutionPersistence.create` (entity + data),
  * `ExecutionRepository.updateExistingExecution` (entity + data),
  * credential create/update (entity + share),
  * project / user provisioning.
* SQLite pooled driver serializes writes; Postgres relies on
  `DB_POSTGRESDB_POOL_SIZE`.

---

## 7. Dependency map

```
@n8n/db (Persistence LEGO)
   ├── @n8n/typeorm (+ sqlite3/pg drivers)        EXTERNAL
   ├── @n8n/config GlobalConfig.database           config
   ├── n8n-workflow types (INode, IConnections, IRunExecutionData, ExecutionStatus)   SHARED (Agent 1/3 types only)
   ├── flatted                                     EXTERNAL (wire format)
   └── @n8n/backend-common Logger, @n8n/di         infra

Consumers (policy layer, cli)
   ├── executions/execution-persistence.ts, execution-data/{db,fs}-store.ts   INTERNAL to Persistence LEGO
   ├── execution-lifecycle/execution-lifecycle-hooks.ts (hookFunctionsSave*)  CROSS-BOUNDARY: lives in Execution
   │        LEGO (Agent 3) but *is* the write policy for execution persistence
   ├── active-executions.ts                                                    Execution (Agent 3)
   ├── workflows/workflow.service.ts, workflows.controller.ts                  API (Agent 4) → Persistence
   ├── workflow-static-data.service.ts                                         Persistence
   ├── credentials-helper.ts, credentials/credentials.service.ts               Credentials (Agent 4)
   └── active-workflow-manager.ts, webhooks/*                                  Trigger/Webhook (Agent 4)
```

Classification:

| Edge | Type |
| :--- | :--- |
| Persistence → n8n-workflow types | SHARED (type-only) |
| Execution hooks → ExecutionRepository | **CROSS-BOUNDARY** (Execution owns *when*, Persistence owns *how*) |
| API → WorkflowRepository | INTERNAL to Agent 4 |
| Trigger/Webhook → Workflow/WebhookRepository | INTERNAL to Agent 4 |
| Persistence → Execution | none (repositories never call the engine) |

---

## 8. Boundary decision

The `@n8n/db` package boundary is already a LEGO boundary: every consumer goes
through a `@Service()` repository or one of the four cli policy services
(`ExecutionPersistence`, `WorkflowStaticDataService`, `WorkflowHistoryService`,
`ExecutionService`). No consumer imports `@n8n/typeorm` query builders
directly except inside repositories (verified: `grep -rn "@n8n/typeorm" packages/cli/src`
only hits type imports, `In`, `Not`, `EntityManager`, and `QueryFailedError`
checks).

**No source change is made.** The contract is the repository method set listed
in `contracts/persistence.contract.md`, plus the two wire formats (flatted run
data, JSON workflow snapshot).

Recommended (not executed — outside "minimal"): the `hookFunctionsSave*`
functions are the single place where Execution decides persistence policy.
When Agent 3 isolates the execution loop, the `updateExistingExecution` /
`softDelete` / `hardDelete` calls there should be treated as the formal
Execution → Persistence port.

---

## 9. Reference tests

* Upstream: `packages/@n8n/db/src/repositories/__tests__/*`,
  `packages/cli/test/integration/execution.repository.test.ts`,
  `packages/cli/src/executions/__tests__/execution-persistence.test.ts`,
  `packages/cli/src/execution-lifecycle/__tests__/*`.
* Agent 4 golden: `tests/reference/agent-4/persistence/`
  * `persistence.test.ts` — workflow save/load and execution save/load/status
    against a **real SQLite database created by n8n 2.9.4 itself** (live
    runtime, see `tests/reference/agent-4/live/`), plus flatted round-trip and
    `determineFinalExecutionStatus` truth table.
  * `execution-status.golden.json` — status transition table.

---

## 10. Risks

* Execution ids are DB auto-increment integers exposed as strings; ordering
  assumptions (`ORDER BY id DESC`) are relied on by the UI and by
  `tests/integration/regression_gate.py`.
* `finished` is deprecated but still written and indexed; must remain in sync.
* `saveManualExecutions=false` soft-deletes rather than skips — behaviour the
  smoke test depends on (execution rows exist right after manual run).
* SQLite vs Postgres JSON column semantics differ (`simple-json` string vs
  native json). `objectRetriever` normalises reads; writes must be objects.
