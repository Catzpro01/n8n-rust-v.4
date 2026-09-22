# AI frontend contract matrix

**Status:** specification. **Owner:** agent-01. **Backend authority:** `arena/01a0c521 @ 6f7b66da`
(P2.10). **Vocabulary source of truth:** `packages/frontend-lego/src/vocabulary.mjs` — every
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
| Copilot chat | as above + `ai.context`, `ai.agent-session` | `contextScope`, `agentSessionState`, `agentSessionField` | `context.load`, `context.compact`, session `create`/`status`/`close` | chain-of-thought, raw prompts, full model output |
| Copilot trace | `ai.agent-events` (in `ai.foundation@1.0.0`) | `agentEventType` (26), `agentEventEnvelopeField`, `traceField` | `subscribe`, `emit` | payload bodies (only `payloadRef`), reasoning |
| Copilot agents | `ai.agent-runtime`, `ai.agent-delegation` | `runtimeLocality`, `delegationField`, `delegationBudgetField`, `delegationNodeField` | `create`, `start`, `send`, `pause`, `resume`, `cancel`, `status`, `stream`, `artifact`, `close`, `delegate` | another agent's private context; inherited permissions (there are none) |
| Copilot files | `ai.artifact` | `artifactKind`, `artifactRetention`, `decisionApprovalState` | `create`, `read` | artifact content inline as state; `storageRef` internals vs credential material |
| Skills | **XA-11 pending** (`ai.skill`); the quoted vocabulary is `manifest/ai-lego-set.json#id=skill`, consumed by `skills.mjs` (P2.12) | `skillLifecycle` (6), `skillOperation`, `skillDisclosureLevel` (L0–L3), `skillPermission`, `aiLegoStatus`, `degradation` | none: discovery only (`list`/`search`/`filter`/`detail` over handed-over data); select/load/release/execute are backend operations and are `offered: false` | a skill's private reasoning; a validator's internals; a skill body beyond the disclosure level asked for |
| Memory | **XA-12 pending** (`ai.memory`); today `ai.context` + `ai.artifact` + `ai.decision` | `contextScope`, `artifactKind`, `decisionRisk` | `context.load`, `artifact.read`, `decision.inspect` | the whole memory store; embeddings or vectors |
| Capabilities | `lego.domain-registry@1.1.0` (manager) + `ai.foundation` taxonomy | `capabilityStatus`, `capabilityCriticality`, `capabilityMigrationState`, `lifecycle`, `interaction`, `transportKind`, `aiPermission` | per capability `operations[]` | an operation's HTTP route; a module path; a port |
| Context & Session | `ai.context`, `ai.agent-session` | `contextScope`, `agentSessionState`, `zeroInstallLayerState` | `context.load`, `context.compact`, session `create`/`status`/`close` | the raw window; the model's tokenizer internals |
| Approval | `ai.approval` | `decisionApprovalState`, `approvalDecision` | `request`, `resolve`, `inspect` | who voted beyond the declared actor field |
| MCP | `ai.foundation@1.0.0` mcp block (**XA-16** pending for a capability of its own) | `mcpConcept`, `mcpObjectView`, `mcpConnectionState` | `tools.list`, `tool.describe`, `tool.call` (through the tool gateway) | transport internals; a server's full tool dump |
| Runtime & workspace | `ai.agent-runtime`; workspace is the `workspace` domain (planned, contract `0.0.0`) + **XA-13** pending | `runtimeLocalityView`, `providerKind`, `runtimeKind`, `delegationNodeField` | runtime lifecycle `status`; workspace `inspect`/`list` when available | the host filesystem beyond the declared workspace; a shell |
| Node creator | `node-registry@0.1.0` (agent-4) + `workflow.crud`; AI drafting **XA-15** pending | `capabilityStatus`, `interaction` (the backend `manifest/node-contract.json` is named by `domains.json.foundation` but published by no contract row — recorded with XA-9) | `resolve`, `describe`, `list`, `workflow.inspect`/`patch`/`validate` | node source code; a package's private files |
| Translation | **XA-14 pending** (no translation domain/capability) | the declared locale set (`src/i18n.mjs` → `SUPPORTED_LOCALES`: `id`, `en`, `ar`, `zh`, `ru`, `jv`) + frontend capability `translation` | none until published | dictionaries inside a contract; a second contract |
| Token & usage | **XA-17 pending** (`ai.usage`); today `ai.model-gateway.countTokens` + declared costs | `resourceDimension`, `resourceProfile`, and the presentation usage fields in §2 | `countTokens`, `model.describe` | a token count nobody reported (it is `estimated` or absent) |
| Status bar | a projection of the surfaces above | `agentSessionState`, `degradation`, `operationOutcome` | none (it renders state) | anything not already in a declaration |


### The Skill surface (implemented, P2.12)

`packages/frontend-lego/src/skills.mjs` consumes the declaration the application hands over and renders
discovery and state only. Six lifecycle states are six facts (`registered`, `available`, `selected`,
`loaded`, `active`, `released`) — never one boolean, and `executing: false` / `grants: null` on all six.
Progressive disclosure: **basic** = name, status, availability; **advanced** = lifecycle, required
capabilities, contract version, trust, degradation, owner, plus the fields the declaration does not
carry (rendered as "not published", never guessed). `ai.skill` has no contract-lock row, so the catalog
renders `optional-absent` and a request for a specific skill answers with `capability-unavailable` /
`lego.capability_unavailable` — no fallback capability, no execution control, no tool list.

A declaration whose words have moved past the quote is reported as drift (`declarationDrift`: field,
quoted value, declared value, both directions, owner) and registered as **XA-19**; the surface never
adopts a word it cannot quote, and a `versioning` claim (`ai.skill@1.0.0`) is reported as
`declaredVersion` while `published` stays false. Where a surface would need a permission, an authority, a
tool, a filesystem, a terminal or a model, the answer is that a skill implies none of them: an entry
carrying such a field is refused by name (`validateSkillInstance`).

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
| **context state** | **`contextId`**, **`scope`**, **`version`**, **`checksum`**, `used`, `budget`, `remaining`, `rolledOver`, `continuationOf` | the raw window; embeddings |
| **session state** | **`sessionId`**, `index`, **`status`**, `startedAt`, `updatedAt`, `continuationOf`, `contextWindow` | a transcript copy |
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
| `Memory 12 relevant` | loaded context entries + decisions + artifacts | `ai.context` + `ai.decision` + `ai.artifact`; **XA-12** for a persistent store |
| `Capabilities 7` | declared capability list with source label | `capabilityStatus` + `providerKind`/`runtimeKind` |
| `— MCP`, `— Runtime`, `— Remote` | the source of a capability | `runtimeLocalityView`, `mcpObjectView` |
| `Runtime · Hermes · Remote · Connected` | runtime identity + locality + availability | `ai.agent-runtime` `runtimeMetadata` (a vendor name is data, never a field) |
| `Workspace · project-name` | where work happens | `workspace` domain (**XA-13** for agent-scoped sandboxes) |
| `Language · Bahasa Indonesia` | response language | the declared locale set + the `translation` capability |
| `Execution AI` | a Copilot mode | `contextScope: EXECUTION`; no capability of its own beyond a declared mode |

## 4. Proposals — backend vocabulary this plan needs

Each row is recorded in `docs/n8n-lego/decisions/cross-agent-decisions.json` with evidence, arbiter
and what the frontend does meanwhile. Until a row is resolved, the frontend may render the
presentation name but must not send the proposed word to the backend as if it existed.

| Decision | Proposed vocabulary | Owner to decide | Why it is needed | What the frontend does meanwhile |
| :--- | :--- | :--- | :--- | :--- |
| **XA-11** | `ai.skill` (skill id, version, procedure summary, capability refs, validators, token budget) | manager | the Skills surface has no canonical set; inventing one would be a second vocabulary | renders presentation names only; no skill state is sent to the backend |
| **XA-12** | `ai.memory` (relevant entries with kind, reference, recency) | manager | "Memory" is currently only *loaded context*; a durable store is not modelled | shows loaded context, decisions and artifacts, and says so |
| **XA-13** | agent-scoped workspace semantics (`workspaceId`, scope, runtime binding) | manager | `workspace.projects` is `unsupported` and the domain contract is `0.0.0`; the plan forbids implying host access | shows workspace only when the declaration exists; otherwise `feature-unsupported` |
| **XA-14** | `translation@…` capability (request/response language pairs) | manager | the frontend capability `translation` is `declared`; no backend domain publishes translation | language control renders the locale set; the capability stays `declared` |
| **XA-15** | node drafting/validation capability (draft → validate → preview) | manager | `Create with AI` needs a declared draft/validate step, not a frontend invention | the flow is specified but gated; validation reuses `workflow.validate` where available |
| **XA-16** | `ai.mcp-adapter` (client/server capability, tool/resource/prompt exposure) | manager | MCP has a vocabulary block and a mapping rule but no capability of its own | shows MCP concepts and connection states; calls tools through the tool gateway |
| **XA-17** | `ai.usage` (per-call/session usage with `source: reported \| estimated`) | manager | per-message and per-run cost must be honest; there is no usage capability today | shows `countTokens` results and declared costs, labelled `estimated` |

Still open from the foundation gate and kept visible: **XA-5** (`lego.*` degradation codes),
**XA-8** (permission namespace), **XA-9** (which contract publishes `manifest/foundation.json`),
**XA-10** (`ai:app:*` vs `app:<application>:*`).

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
