# AI frontend contract matrix

> **SUPERSEDED IN PART — P2.12.** The row marking **Skills** as `XA-11 pending` is HISTORICAL.
> `ai.skill@1.0.0` is now locked and published (`manager`, domain `ai-foundation`) with exactly
> four operations: `skill.list`, `skill.resolve`, `skill.describe`, `skill.validate-selection`,
> and permissions `ai:skill:read` / `ai:skill:select`. There is no execute operation and no
> `ai:skill:execute` permission. See the generated [`AI_CONTRACT_MATRIX.md`](AI_CONTRACT_MATRIX.md).
> **XA-11 remains `open-for-manager`** — publishing the contract did not settle where Skill
> ultimately belongs.
>
> **P2.13 UPDATE (2026-09-22, `main @ e754c5df`).** `ai.context` and `ai.agent-session` are
> **declared-not-locked**: declared in `manifest/ai-foundation.json`, registered `contract-only` in
> `manifest/domains.json` (5 operations, 5 permissions each), claimed as `@1.0.0` in
> `manifest/ai-lego-set.json`, and published by **no** row of `contracts/contract-lock.json` (15 rows,
> none of them either contract). The Context & Session surface therefore quotes fields, scopes,
> states, sections, operations and permissions **with provenance**, reports the pair as
> `declared-not-locked`, renders **no version**, keeps the rollover phase machine and the verification
> results in `PENDING_PUBLICATIONS`, and offers **no operations**. Arbitration: **XA-20**.
> The rows below marked *HISTORICAL* were written when these contracts were assumed published.
>
> **P2.14 UPDATE (2026-09-22, `main @ 67e638ef`).** P2.13 is merged in full (PR #45 backend,
> PR #46 frontend), so the P2.13 row's `declared-not-locked` and its two `PENDING_PUBLICATIONS`
> entries are HISTORICAL: both rows are locked on protected main at `efa3da35`
> (`PROMOTED_PUBLICATIONS` keeps the two promoted word lists). **Memory is published**:
> `ai.memory@1.0.0` is locked by agent-2 on `arena/01a0c90d-n8n-rust-v-4 @ f11aee01` with four
> operations (`memory.remember`, `memory.recall`, `memory.list`, `memory.forget`) and two
> permissions (`ai:memory:read`, `ai:memory:write`), and the frontend consumes it (nine quoted
> sets, `manifest/memory.json`, `src/memory.mjs`, rule **A29**, `test/34`). It is
> **declared-not-locked** against protected main, which carries no `ai.memory` row yet.
> **XA-12 stays `open-for-manager`** for the half the contract defers — relevance-ranked traversal,
> explicit edge creation (`relate`) and retention-policy enforcement — and none of the three may be
> implied by the UI. **XA-21**: the descriptor-assembly heap pin is **not edited**; the P2.14 runs
> measured **3,808–3,875 KB** against the 4,096 KB pin, with the boot payload byte-identical at
> **18,126 B** because the Memory view is built on demand.

**Status:** specification. **Owner:** agent-01. **Backend authority:** `main @ e754c5df` (P2.12
complete, P2.13 in progress); written earlier against `arena/01a0c521 @ 6f7b66da` (P2.10), which is
kept as the historical baseline of §1. **Vocabulary source of truth:** `packages/frontend-lego/src/vocabulary.mjs` — every
"vocabulary" cell below names a set in that lock, so the words can be checked instead of trusted.
**Companions:** `AI_UI_EXPERIENCE_MASTER_PLAN.md` (which surfaces exist),
`AI_UX_PROGRESSIVE_DISCLOSURE.md` (what is visible), `AI_UI_STATES_AND_FLOWS.md` (what every
surface must render), `AI_ACCESSIBILITY_AND_LOCALIZATION.md` (keyboard, RTL, locales),
`AI_UI_IMPLEMENTATION_PHASES.md` (when it is built).

The matrix is the *consumption* contract of the AI experience: which canonical declaration each
surface reads, which vocabulary it may render, and what it must never read. A surface that needs a
word which is not in a lock set must either propose it (`publicationPending`, with owner, decision
and reason) or present it as a **presentation name** that is visually distinct from backend
vocabulary — never as a silent alias of a backend contract.

---

## 1. Surface → contract

| Surface | Canonical contract (id@version, owner) | Vocabulary (lock set) | Operations it may call | Must never read |
| :--- | :--- | :--- | :--- | :--- |
| AI Assistant | `ai.foundation@1.0.0` (manager), `ai.model-gateway` | `aiKind`, `aiPermission`, `agentEventType`, `decisionApprovalState` | `models.list`, `model.describe`, `generate`, `stream`, `countTokens` | a provider URL, key or header; a module file; a rendered screen |
| Copilot chat | as above + `ai.context`, `ai.agent-session` (**declared-not-locked**, `XA-20`) | `contextScope`, `agentSessionState`, `agentSessionField` | **none today** — the five declared operations (`context.load`, `context.compact`, session `create`/`status`/`close`) are rendered as facts and answer `operation-unpublished` | chain-of-thought, raw prompts, full model output, a transcript |
| Copilot trace | `ai.agent-events` (in `ai.foundation@1.0.0`) | `agentEventType` (26), `agentEventEnvelopeField`, `traceField` | `subscribe`, `emit` | payload bodies (only `payloadRef`), reasoning |
| Copilot agents | `ai.agent-runtime`, `ai.agent-delegation` | `runtimeLocality`, `delegationField`, `delegationBudgetField`, `delegationNodeField` | `create`, `start`, `send`, `pause`, `resume`, `cancel`, `status`, `stream`, `artifact`, `close`, `delegate` | another agent's private context; inherited permissions (there are none) |
| Copilot files | `ai.artifact` | `artifactKind`, `artifactRetention`, `decisionApprovalState` | `create`, `read` | artifact content inline as state; `storageRef` internals vs credential material |
| Skills | `ai.skill@1.0.0` (locked at P2.12; `XA-11` still decides where it belongs) | `skillField`, `skillOperation`, `skillPermission` | `skill.list`, `skill.resolve`, `skill.describe`, `skill.validate-selection` — **no** `execute`, **no** `ai:skill:execute` | a skill's private reasoning; a validator's internals |
| Memory | **`ai.memory@1.0.0`** (published by agent-2 at P2.14; `XA-12` stays open for the deferred half) | `memoryScope` (5), `memoryKind` (6), `memoryRetention` (5), `memoryField` (13), `memoryLifecycle` (2), `memoryGraphNode` (10), `memoryGraphEdge` (11), `memoryOperation` (4), `memoryPermission` (2) | `memory.remember`, `memory.recall`, `memory.list`, `memory.forget` — **named, never offered**; `traverse`, `relate`, ranking and retention enforcement are future stages | the whole memory store dumped into context; embeddings, vectors or a relevance score; a persistence or provider-connected claim; a write, forget or restore affordance |
| Capabilities | `lego.domain-registry@1.1.0` (manager) + `ai.foundation` taxonomy | `capabilityStatus`, `capabilityCriticality`, `capabilityMigrationState`, `lifecycle`, `interaction`, `transportKind`, `aiPermission` | per capability `operations[]` | an operation's HTTP route; a module path; a port |
| **Context & Session (P2.13)** | `ai.context`, `ai.agent-session` — **declared-not-locked** (`XA-20`), both `contract-only` in `domains.json`, both claimed `@1.0.0` in `ai-lego-set.json` | 13 quoted sets — `contextScope` (7), `contextField` (9), `contextLifecycle` (6), `continuationSection` (14), `contextOperationVerb` (5), `contextOperation` (2), `contextPermission` (2), `agentSessionState` (7), `agentSessionField` (10), `agentSessionReference` (3), `agentSessionOperation` (3), `agentSessionPermission` (3), `tokenKind` (3); 10 of them new at P2.13 — + 2 local sets (`continuationAffordance` 6, `contextUsageReport` 4) + **2 `PENDING_PUBLICATIONS` rows** (`contextRolloverPhase`, `continuationVerification`) | **none.** `Continue session` answers `operation-unpublished`, as do the declared verbs `rollover`, `rehydrate`, `verify` — no backend file registers them | the raw window; the model's tokenizer internals; a token count nobody reported; a Memory store; an execution affordance |
| Approval | `ai.approval` | `decisionApprovalState`, `approvalDecision` | `request`, `resolve`, `inspect` | who voted beyond the declared actor field |
| MCP | `ai.foundation@1.0.0` mcp block (**XA-16** pending for a capability of its own) | `mcpConcept`, `mcpObjectView`, `mcpConnectionState` | `tools.list`, `tool.describe`, `tool.call` (through the tool gateway) | transport internals; a server's full tool dump |
| Runtime & workspace | `ai.agent-runtime`; workspace is the `workspace` domain (planned, contract `0.0.0`) + **XA-13** pending | `runtimeLocalityView`, `providerKind`, `runtimeKind`, `delegationNodeField` | runtime lifecycle `status`; workspace `inspect`/`list` when available | the host filesystem beyond the declared workspace; a shell |
| Node creator | `node-registry@0.1.0` (agent-4) + `workflow.crud`; AI drafting **XA-15** pending | `capabilityStatus`, `interaction` (the backend `manifest/node-contract.json` is named by `domains.json.foundation` but published by no contract row — recorded with XA-9) | `resolve`, `describe`, `list`, `workflow.inspect`/`patch`/`validate` | node source code; a package's private files |
| Translation | **XA-14 pending** (no translation domain/capability) | the declared locale set (`src/i18n.mjs` → `SUPPORTED_LOCALES`: `id`, `en`, `ar`, `zh`, `ru`, `jv`) + frontend capability `translation` | none until published | dictionaries inside a contract; a second contract |
| Token & usage | **XA-17 pending** (`ai.usage`); today `ai.model-gateway.countTokens` + declared costs | `resourceDimension`, `resourceProfile`, and the presentation usage fields in §2 | `countTokens`, `model.describe` | a token count nobody reported (it is `estimated` or absent) |
| Status bar | a projection of the surfaces above | `agentSessionState`, `degradation`, `operationOutcome` | none (it renders state) | anything not already in a declaration |

Every "operations it may call" cell names the semantic operation, never a route. The frontend
negotiates with `negotiateOperation()` and renders the **12 distinguishable outcomes** —
`available`, `degraded`, `capability-unavailable`, `optional-absent`, `version-incompatible`,
`dependency-disabled`, `migration-required`, `feature-unsupported`, `operation-denied`,
`operation-unpublished`, `permission-missing`, `permission-unknown` — and never collapses them into
"unavailable" (`lego.negotiation@1.0.0`; frontend `operationOutcome`).

## 2. The UI data contract (what each state may contain)

Every object below is a *view* projection: the frontend derives it from declarations and never
inspects an implementation. Field names in **bold** are canonical (quoted from `ai.foundation@1.0.0`
or a `lego.*` contract); the rest are frontend presentation fields, and they are listed so an
implementer cannot quietly add a field that is not here.

| View | Fields | Never |
| :--- | :--- | :--- |
| **AI request** | `requestId`, `sessionId`, `scope`, `capabilityId`, `operation`, `interaction`, `permission`, `approvalState`, `messageKey` parameters | prompt text bodies, credentials, provider URLs |
| **agent state** | `sessionId`, **`agentId`**, **`parentSessionId`**, **`taskId`**, **`runtimeId`**, **`status`**, `depth`, `children`, `grantedCapabilities`, `effectivePermissions` | chain-of-thought, another agent's context |
| **skill state** | `skillId`, `version`, `active`, `procedure` summary, `capabilityIds`, `validators`, `references`, `tokenBudget` | the skill's private reasoning; a validator's source |
| **context state** | **`contextId`**, **`scope`**, **`parent`**, **`snapshot`**, **`version`** (declared, **not rendered** while unlocked), **`source`**, **`dependencies`**, **`size`**, **`checksum`**, `used`, `budget`, `remaining`, `rolledOver`, `continuationOf` | the raw window; embeddings; a version label for an unlocked contract |
| **session state** | **`sessionId`**, **`agentId`**, **`parentSessionId`**, **`taskId`**, **`workflowId`**, **`executionId`**, **`runtimeId`**, `index`, **`status`**, **`createdAt`**, **`updatedAt`**, **`contextRef`**, **`artifactRef`**, **`traceRef`**, `continuationOf`, `contextWindow` | a transcript copy; an inlined payload; a state outside the seven declared ones |
| **continuation package** | the 14 declared sections (`identity` … `compressedHistory`) + envelope `sourceContextId`, `target`, `verification`, lineage ids | chain-of-thought; a transcript; a section name invented locally (`important references` is published as `refs`) |
| **capability availability** | `id`, `status`, `availability`, `degradation`, `lifecycle`, `criticality`, `trust`, `operations[]`, `permissions[]`, `interaction`, `transport`, `source` | an operations list inferred from routes; a private port |
| **approval** | **`approvalId`**, **`action`**, **`actor`**, **`risk`**, **`requestedAt`**, **`resolvedAt`**, **`decision`**, **`reason`**, `scope` | who might approve; any credential the action will use |
| **artifact** | **`artifactId`**, **`kind`**, **`size`**, **`mime`**, **`createdAt`**, **`owner`**, **`checksum`**, **`retention`**, `previewKind`, `actions[]` | the payload inline; a signed URL with credentials |
| **token usage** | `message`, `context`, `output`, `total`, **`source`** (`reported` \| `estimated`), `model` | a fabricated count; a vendor price table |
| **event** | **`eventId`**, **`timestamp`**, **`type`**, **`sessionId`**, **`scope`**, `agentId`, `parentId`, `taskId`, `status`, `durationMs`, `summary`, `references` | payload; reasoning; credentials |
| **runtime** | **`runtimeId`**, **`kind`**, **`version`**, **`availability`**, **`transport`**, **`locality`**, `supports`, `health` | a vendor field as a contract field |
| **workspace** | `workspaceId`, `name`, `scope`, `status`, **`runtimeId`**, `terminalState`, `tree` (paged) | the host filesystem; an unrestricted path |

## 3. Presentation names vs backend vocabulary

The frontend may name its own surfaces. It may **not** create a backend-visible synonym. Where a
presentation name exists, it is a *view* with a declared mapping in the lock (`mapsTo`,
`mirror`, `extra` reasons):

| Presentation name | What it renders | Mapping |
| :--- | :--- | :--- |
| `Agent: Working` / `Agents 5` | session status + child count | `agentSessionState`, `delegationNodeField.children` |
| `Context 61%`, `12.4k / 32k` | context budget | `ai.context` (`used`, `budget`) |
| `Skills 3 active` | active skill procedures | **XA-11** (no canonical set yet) |
| `Memory 12 relevant` | retained records at a declared scope — or the honest absence of a list (`rendered` / `empty` / `not-handed-over` / `refused` are four different things) | `ai.memory` (`memory.list`: scope-filtered, ordered `createdAt` asc then `memoryId` asc, `limit` 1..100 default 50, opaque cursor); no score, no countdown, no durability claim |
| `Capabilities 7` | declared capability list with source label | `capabilityStatus` + `providerKind`/`runtimeKind` |
| `— MCP`, `— Runtime`, `— Remote` | the source of a capability | `runtimeLocalityView`, `mcpObjectView` |
| `Runtime · Hermes · Remote · Connected` | runtime identity + locality + availability | `ai.agent-runtime` `runtimeMetadata` (a vendor name is data, never a field) |
| `Workspace · project-name` | where work happens | `workspace` domain (**XA-13** for agent-scoped sandboxes) |
| `Language · Bahasa Indonesia` | response language | the declared locale set + the `translation` capability |
| `Execution AI` | a Copilot mode | `contextScope: EXECUTION`; no capability of its own beyond a declared mode |
| `Session 03 · Continuation linked` | session identity + lineage read from references | `agentSessionField` (`parentSessionId`), `sessionReference` (`contextRef`); never inferred from time or order |
| `Rollover preparing` | the published lifecycle word, not the ruled phase name | `contextLifecycleState.prepare` ← ruled `PREPARE` (**`publicationPending`**, `XA-20`) |
| `Context compacting` / `Rolled over` | compaction and its result | `contextLifecycleState.compacting` / `.rolled-over` |
| `Continue session` | the offered affordance, which no operation backs | **`operation-unpublished`** — the surface renders the offer and says what is missing |
| `Continuity verified` / `Degraded: 2 sections` / `Continuation failed` | the three verification results, ruled but unpublished | `verificationResult` **`publicationPending`** (`XA-20`); a missing section degrades, a section carried as `[]` says "there were none" |
| `Context 61% · reported` | usage honesty | `tokenKind` (quoted from `reference-scenarios.json`, `XA-17`) + a source label `reported` \| `estimated` \| `not-reported` \| `over-budget` |

## 4. Proposals — backend vocabulary this plan needs

Each row is recorded in `docs/n8n-lego/decisions/cross-agent-decisions.json` with evidence, arbiter
and what the frontend does meanwhile. Until a row is resolved, the frontend may render the
presentation name but must not send the proposed word to the backend as if it existed.

| Decision | Proposed vocabulary | Owner to decide | Why it is needed | What the frontend does meanwhile |
| :--- | :--- | :--- | :--- | :--- |
| **XA-11** | `ai.skill` (skill id, version, procedure summary, capability refs, validators, token budget) | manager | the Skills surface has no canonical set; inventing one would be a second vocabulary | renders presentation names only; no skill state is sent to the backend |
| **XA-12** | `ai.memory` — the bounded surface is now published (`@1.0.0`: four operations, two permissions, provider boundary, scope isolation, checksum integrity) | manager | published at P2.14 by agent-2; what stays open is the deferred half: relevance-ranked traversal, explicit edge creation (`relate`) and retention-policy enforcement | renders the published record shape, the four list states and the persistence boundary; never a score, a countdown, a write affordance or a durability claim, and reports `declared-not-locked` against a tree with no row |
| **XA-13** | agent-scoped workspace semantics (`workspaceId`, scope, runtime binding) | manager | `workspace.projects` is `unsupported` and the domain contract is `0.0.0`; the plan forbids implying host access | shows workspace only when the declaration exists; otherwise `feature-unsupported` |
| **XA-14** | `translation@…` capability (request/response language pairs) | manager | the frontend capability `translation` is `declared`; no backend domain publishes translation | language control renders the locale set; the capability stays `declared` |
| **XA-15** | node drafting/validation capability (draft → validate → preview) | manager | `Create with AI` needs a declared draft/validate step, not a frontend invention | the flow is specified but gated; validation reuses `workflow.validate` where available |
| **XA-16** | `ai.mcp-adapter` (client/server capability, tool/resource/prompt exposure) | manager | MCP has a vocabulary block and a mapping rule but no capability of its own | shows MCP concepts and connection states; calls tools through the tool gateway |
| **XA-17** | `ai.usage` (per-call/session usage with `source: reported \| estimated`) | manager | per-message and per-run cost must be honest; there is no usage capability today | shows `countTokens` results and declared costs, labelled `estimated` |
| **XA-20** | lock `ai.context` + `ai.agent-session` — and decide the rollover phase machine (`NORMAL`/`PREPARE`/`ROLLOVER`) and the verification results (`verified`/`degraded`/`failed`) | manager | P2.13 renders vocabulary for contracts that four files declare and no lock row publishes; four consumers (P2.13 UI, P2.14 Memory, P2.16 Agent Machine, P2.24 Token & Usage) would otherwise each settle the question differently | quotes every declared word with provenance, reports `declared-not-locked`, renders no version, keeps both ruled vocabularies in `PENDING_PUBLICATIONS`, offers no operation |
| **XA-21** | the descriptor-assembly heap pin (4,096 KB) | manager | the pin is a budget on the whole package at import; P2.12 filled it to 3,780 KB and P2.13 measures 4,251 KB, so P2.14 cannot fit without a ruling | the Context & Session view is built on demand, not eagerly; the boot payload is unchanged (18,126 B); the check is reported FAIL with its measurement and the pin is **not** edited |

Still open from the foundation gate and kept visible: **XA-5** (`lego.*` degradation codes),
**XA-8** (permission namespace), **XA-9** (which contract publishes `manifest/foundation.json`),
**XA-10** (`ai:app:*` vs `app:<application>:*`), **XA-18** (Workspace scope semantics, raised at
P2.11), **XA-19** (Skill runtime ownership, resolved at P2.12 — kept here because `XA-11` is its
neighbour). The register holds 21 rows, 13 open at P2.13;
`docs/n8n-lego/decisions/cross-agent-decisions.json` is the machine-readable copy and wins over this
table.

## 5. Seam compliance (the mechanical rule set)

1. **Thirteen inputs, seven forbidden sources.** A surface may consume only the seam's declared
   inputs (`capability-id`, `capability-status`, `version`, `operations`, `permissions`,
   `lifecycle`, `availability`, `degradation`, `interaction-class`, `transport-capability`,
   `error-code`, `localization`, `observability-metadata`) and never from an implementation file,
   a module path, a route table, a port, a credential store, a model output or a rendered screen.
2. **One capability identity.** Sixteen declared fields, filled from the declaration; a field
   nobody declared is `null`, and a capability the caller was not granted is not described at all.
3. **Fail closed.** Unknown capability, operation, owner, permission, interaction class, transport
   or event is refused by name — never guessed, never defaulted to "available".
4. **No credentials, ever.** No AI surface accepts, stores, renders or forwards credential
   material; a declaration that carries one is refused.
5. **No transport in a business contract.** A surface shows *what* an operation does; the transport
   is chosen by cost and eligibility (local → event → stream → rest → ipc → remote), never named in
   the contract, and never downgraded silently (a `stream` request is never served as a `call`).
