# Foundation completion gate — Agent 1 (frontend side)

The last frontend-side gate before Agents 3–6, the AI Foundation, the Copilot, the agent node
and external agent integrations. Contracts and vocabulary only: no feature, no model, no
adapter, no UI. Every claim below is backed by a command in [§20](#20-readiness-evidence).

Phase commit: `58e0c2dd` on top of the parent `561d2225`; follow-up commit (this change) on the
same branch, aligned against the backend foundation at P2.10 (`6f7b66da`).

---

## 1. Branch

`arena/01a0c53e-n8n-rust-v-4` — pushed to `Catzpro01/n8n-rust-v.4`. Work is committed here and
nowhere else: no merge, no `main` write, no branch reset. The canonical session branch
`arena/01a0c4f9-…` cannot be pushed from this box (Manager transfer).

## 2. HEAD

`58e0c2dd` ("frontend-lego: the foundation completion gate — closed seam, canonical vocabulary,
AI contracts"), parent `561d2225`, plus the follow-up commit that carries this alignment work
(`frontend-lego: align the vocabulary lock with P2.10 and enforce its publication`). Between them
they carry every file listed in §20; `main` at `cb71dbb2` is untouched.

## 3. Relationship to `main`

`main` has no `packages/frontend-lego` at all — everything here is additive to it. The three
files this phase touched outside the package are additive too: `manifest/capabilities.json` was
**extended** from 1 to 7 declared capabilities (nothing removed, nothing re-spelled), the app's
evidence script **gained** checks, and `contracts/frontend.contract.md` **gained** sections
§19.14–§19.15 while its §19.16 rule block was regenerated from the same `ARCHITECTURE_RULES` the
tests read. No other agent's files were modified: `apps/n8n-lego/src/lego/**` (Agent 2) is read
through `git show origin/a2:<path>` and never written.

## 4. Shared vocabulary decisions

One word, one meaning, on both sides. `packages/frontend-lego/src/vocabulary.mjs` pins **60**
vocabulary sets — **38 canonical + 22 local** — re-quoted against the backend foundation at
`arena/01a0c521-n8n-rust-v-4 @ 6f7b66da` (P2.10):

- **33 quoted from a published contract** with contract id, version, owner, file and declaration:
  `degradation` (8, `lego.interaction@1.0.0`), `lifecycle` (11, `lego.negotiation@1.0.0`),
  `changeKind` (5, `lego.contract-compat@1.0.0`), `interaction` (4, `lego.interaction@1.0.0`),
  `capabilityStatus` (8 incl. the new `contract-only`, `lego.domain-registry@1.1.0`), the
  `ai.foundation@1.0.0` vocabulary (kinds, localities, session states, 26 event types, envelope /
  session / delegation / budget fields, scopes, risks, approval states, side effects, artifact
  kinds and retention, resource dimensions and profiles, MCP concepts, zero-install states,
  transport kinds), the 22 permissions the published `ai.*` operations require, and the
  application-provider trio.
- **5 quoted from a file no contract row publishes** (`manifest/foundation.json`: trust levels,
  transport bindings, resource and device fields) — each carries a structured
  `publicationPending` record naming the owner (`manager`), the domain (`lego-foundation`) and
  the decision that asks for a row (`XA-9`) instead of borrowing the closest-sounding contract.
- **22 declared locally** with a total mapping into the canonical set and a reason for every value
  the canonical set does not have — including the two view vocabularies (`runtimeLocalityView`
  collapses three canonical localities into "runs here"; `mcpObjectView` names what the UI shows)
  and `frontendCapabilityPermission`, whose four AI words map onto published `ai:*` names and
  whose two non-AI words carry their reasons (XA-8).
- **5 declared overlaps**: a spelling shared by two canonical sets is allowed only when the two
  share a declared subject (`sessionId`, `status`) or when the overlap is declared with its
  reason (`available`, `degraded`, `migration-required`, `server`, `remote`).

Decisions taken, all machine-checked:

- The verdict a consumer sees (`state`) is the canonical `lego.interaction` word — the frontend
  never answers with a word the foundation does not use (`test/23`).
- `version-mismatch`/`unsupported`-style local spellings are gone from the negotiation path; the
  vocabulary names are the canonical ones (`available`, `degraded`, `capability-unavailable`,
  `optional-absent`, `version-incompatible`, `dependency-disabled`, `migration-required`,
  `feature-unsupported`).
- Local spellings that ride in a **pinned browser contract** (`unitStatus` inside the 18,126-byte
  boot payload) are *mapped*, not renamed: renaming them would change a browser contract for a
  naming reason. Every such mapping is declared data, and `vocabularyConflicts()` fails when a
  local value has no mapping or no reason.
- `BACKEND_STATES` (how much of a capability this instance implements) now speaks the canonical
  `capabilityStatus` subset, with `unknown` declared as a frontend-only extra (nobody declared a
  status ≠ "it is implemented").
- A capability id that appears under two origins is **reported**, never merged:
  `capabilityCollisions()` returns the id with both origins (`frontend-registered`,
  `frontend-declared`, `backend-advertised`).
- Every quoted value was **verified against the P2.10 tree**, not just recorded: `test/29` reads
  each declaration (module export or JSON path) and compares it, and also compares the quoted
  *semantics* (the eight degradation actions, the callable lifecycle states). Pointed at the
  unpacked backend tree it answers **38/38 sets, 0 drift, 0 skips**.
- The verification found and fixed four real defects in the first draft of the lock: a set that
  quoted the AI profile keys under a resource-class name (removed as mis-quoted), an
  `aiPermission` set that had read only the vocabulary file (8 names) instead of the 22 the
  published operations require, a `zeroInstall` state set that kept duplicate values, and three
  provider-kind words that duplicated canonical terms — those were **renamed** to the canonical
  `model-provider` / `tool-provider` / `application-provider` because nothing pinned depends on
  the spelling.

## 5. Seam

`packages/frontend-lego/src/seam.mjs` makes the boundary closed on both axes: **13 declared
inputs**, each with the sources it may be read from (`capability-id`, `capability-status`,
`version`, `operations`, `permissions`, `lifecycle`, `availability`, `degradation`,
`interaction-class`, `transport-capability`, `error-code`, `locale-set`,
`observability-metadata`), and **7 sources that may never be read** (`implementation-file`,
`module-path`, `route-table`, `port`, `credential-store`, `model-output`, `screen`) — each with
its reason.

`consumeInput({ input, source })` answers with a verdict and a reason; `requireInput` turns a
refusal into `frontend.seam.unknown-input` or `frontend.seam.forbidden-source`. An input nobody
declared is refused too: a chain of thought is not an input, it is a forbidden one. The frontend
does not probe the backend — and there is no code path that could, because the seam has no
filesystem or network access and the package still has **0 runtime dependencies** (§16).

## 6. Operation negotiation

A capability is not one switch; `negotiateOperation()` answers "may *this* operation run, and if
not, why not" with **12 distinct outcomes** and a reason list, never collapsed into one
"unavailable": `available`, `degraded`, `capability-unavailable`, `optional-absent`,
`version-incompatible`, `dependency-disabled`, `migration-required`, `feature-unsupported`,
`operation-denied`, `operation-unpublished`, `permission-missing`, `permission-unknown`.

- Precedence is declared data (`OPERATION_PRECEDENCE`, 12 rows: access → capability blockers →
  permissions → publication → degraded/available), so the same question always gets the same
  answer (`test/25`).
- Access comes before publication: a caller that was not granted the capability learns nothing
  about it, not even that its operation list is empty.
- Operations are semantic (`workflow.inspect`, `workflow.patch`, `workflow.validate`,
  `workflow.execute`) and the interaction class is declared per operation; the transport is
  chosen by the host (§19.2 of the contract) — never an HTTP endpoint.
- **Backend-advertised operations are first-class and currently absent**: Agent 2's registry
  publishes `{id, status}` per capability and no `operations[]` (verified at `aef6b606`, 71
  capabilities, `0` with operations). The frontend therefore answers `operation-unpublished`
  with `exists: null` and fails closed, instead of assuming a route implies an operation
  (decision record XA-2).

## 7. AI contract additions

Six capabilities are declared, with no entry path and no implementation
(`manifest/capabilities.json`, all `status: "declared"`): `ai-assistant`, `ai-copilot`,
`ai-agent-node`, `agent-machine`, `execution-ai-mode`, `agent-work-trace`. Each declares its
operations, interaction classes, required permissions, resource requirements and its declared
fallback. `src/agents.mjs` owns the vocabulary: provider kinds, runtime kinds, locality, MCP
objects and states, runtime identity fields, and fail-closed declaration validators.

**Nothing infers.** `test/26` proves there is no model call, no provider client and no vendor
field in the code (comments may name products as examples; code may not), that the six
capabilities agree with the manifest, and that none of their metadata reaches the browser boot
payload. Model and provider identity appear only through `RUNTIME_IDENTITY_FIELDS`
(`sessionId`, `runtimeId`, `agentId`, `parentAgentId`, `taskId`, `executionId`, `model`,
`provider`) and only when a runtime exposes them — a capability is never described by guessing
its model.

## 8. Event contract

`src/agent-events.mjs` is one transport-neutral vocabulary: **26 event types in 7 namespaces**
(`agent.*` 9, `context.*` 2, `tool.*` 4, `decision.*` 3, `approval.*` 3, `artifact.*` 2,
`runtime.*` 3), covering `agent.created/started/waiting/paused/resumed/delegated/completed/failed/
cancelled`, `context.loaded/compacted`, `tool.requested/started/completed/failed`,
`decision.created/approved/rejected`, `approval.requested/granted/denied`,
`artifact.created/updated`, `runtime.connected/disconnected/unavailable`.

- The list is closed; an undeclared type is refused, and a namespace's delivery classes
  (`call`/`event`/`stream`/`batch`) are declared, so the same event can be carried by any
  runtime without a transport leaking into the contract.
- A foreign runtime is mapped in by declaration (`createEventNormalizer({ runtimeId, map })`),
  and an **unmapped event is refused, not dropped** — a timeline that silently loses events is
  worse than one that says it cannot read a source.
- Vendor names (Hermes, Claude Code, Gemini CLI, Antigravity, OpenClaw, DeepSeek Harness,
  MiroFish, 9Router, Composio) appear in documentation only; `describeAgentEvents()` names none
  of them (`test/27`).

## 9. Trace contract

A work trace row carries exactly the 18 declared fields — `sequence`, `timestamp`, `eventType`,
`agentId`, `parentAgentId`, `taskId`, `executionId`, `sessionId`, `runtimeId`, `capability`,
`operation`, `status`, `durationMs`, `summary`, `payloadRef`, `artifactRef`, `decisionRef`,
`approvalState` — and no others: `payload`, `body`, `content`, `messages`, `transcript`,
`reasoning`, `chainOfThought`, `thoughts`, `token`, `authorization` and `credential` are refused
**by name**, because they belong to the session, not to telemetry.

The trace is bounded (200 rows) and ordered by `(timestamp, sequence)`; a row that is dropped or
refused is counted, never swallowed, so a UI can say "this view is incomplete" instead of
implying it saw everything. A 280-character summary is a sentence, not a document, and a large
result travels as `payloadRef`/`artifactRef`.

## 10. Delegation

`buildDelegationTree(events, { grants, sessions })` records parentage, task, runtime, session,
status and depth per agent, and reports cycles and unknown parents instead of repairing them
silently. **Authority never flows down the tree**: a child's `effectivePermissions` are exactly
its own grants (`inherited: false`), and a child with no grants holds none — a delegation is
recorded, not granted (`test/27`, rule A22). Being approved is recorded as an approval state with
a `decisionRef`; it is not a permission either.

## 11. Provider / runtime / tool model

Three **provider** kinds (`model-provider`, `tool-provider`, `application-provider`) and two
**runtime** kinds (`agent-runtime`, `simulation-runtime`), with `local`/`remote` locality — kept
distinct, validated fail-closed (`validateProviderDeclaration`, `validateRuntimeDeclaration`),
and never written with a vendor name or an endpoint. Consequences the contract states plainly:

- An **application provider is first-class**: GitHub is reachable without Composio, and a tool
  gateway is one way to reach tools, not the way.
- A **simulation is never reported as real work**: preference is real-local → real-remote →
  simulation, and a simulation runtime's events are still `agent.*` events with a
  `runtimeId` — the UI can always tell where they came from.
- A credential-shaped key (token, key, secret, password, cookie, endpoint) is refused where a
  declaration is validated.

## 12. MCP

MCP is modelled as an **interoperability layer**, not the Agent Machine: 8 objects
(`client-capability`, `server-capability`, `tool`, `resource`, `prompt`, `connection`,
`authorization`, `availability`) and 4 UI states — `connected`, `unavailable`,
`permission-required`, `capability-unsupported` — plus a label derived from the state so the
surface cannot improvise one. Transport internals never appear: `mcpRelationship()` has no
transport field at all, and `authorization` is a state (`granted`/`required`/`not-required`),
never material.

## 13. Zero-install and resource-aware availability

`describeInstallation()` reports 8 layers separately (`core`, `aiFoundation`, `inference`,
`agentRuntime`, `simulationRuntime`, `toolGateway`, `modelProvider`, `mcp`) and states that an
installation with no model, no runtime and no MCP provider is **valid** — `zeroInstall: true`,
`valid: true`, a message naming what can be added later, and a declared list of what a user can
configure. Inference is a capability, not a requirement; nothing renders as broken.

Resource-aware selection reads a **declared budget**, never a platform check: `profiles.mjs` now
carries `memoryMb`, `storageMb`, `cpuCores`, `input`, `alwaysOnline`, `meteredNetwork`,
`onBattery`, `latencyBudgetMs`, `executionModel` per profile, and a capability/runtime may
declare `memoryMb`, `storageMb`, `cpuCores`, `requiresLocalExecution`, `requiresNetwork`,
`heavy`, `batteryHeavy`, `costClass`, `maxLatencyMs`, `input`. A local runtime on a thin client
is *placed*, not required: `suitableRuntimes()` marks it unreachable with the reason, and the
remote option is what a thin client uses. "Install every runtime locally" is not a state this
contract can express.

## 14. Localization

`id, en, ar, zh, ru, jv`; Arabic is the only RTL locale; locale identity, direction, message
keys, the fallback chain and the plural *contract* live here; dictionaries, translation content,
loading strategy and the runtime stay outside (`test/22`). The locale set is quoted from
`contracts/localization.contract.md` (agent-9 lineage) rather than redefined, and the pack's
locale block is drift-checked against `i18n.mjs` (`test/12`).

## 15. Security

Fail-closed, in one place per question:

- **Unknown capability, operation, owner, permission, interaction, transport, event, provider
  kind, runtime kind or MCP object** → refused by name with the reason (`test/21`, `test/25`,
  `test/26`, `test/27`).
- **Foreign hook** → refused at registration, with the owning surface named (rule A16).
- **Placement** → grants nothing; a consumer that was not granted a capability is not handed its
  metadata, not even whether it exists (rule A04).
- **Credentials** → not representable: permissions are `<domain>:<action>` names, declarations
  with credential-shaped keys are refused, and the observability vocabulary rejects `token`,
  `authorization`, `cookie`, `password`, `secret`, `subject`, `scopes` and `content` by name.
- **Chain of thought** → no field for it anywhere: not in a trace row, not in a declaration, not
  in the seam (it is an input the seam refuses).
- **No HTTP between local modules** → the local transport is direct, with serialization `none`,
  and an interaction no transport can carry is refused (`test/15`, evidence check).

## 16. Performance

- Boot payload **bytes unchanged**: the evidence script's byte-identical check against the P2.5
  baseline still passes at **18,126 B JSON** (24,168 B base64, budget 32 KB), and the new AI
  vocabulary is proven **absent** from the descriptor by two tests and one evidence check.
- New metadata is paid for on demand: `describeSeam()`, `describeAgents()`,
  `describeAgentEvents()` and `describeVocabulary()` are called by a consumer, not at boot; a
  work trace is created by the UI layer with a declared row cap.
- Package cost is unchanged in kind: **0 runtime dependencies**, cold import + assembly still
  inside the existing budget (evidence: import ms and heap KB are recorded in the same report).
- Rule count grew 17 → **24** and the boot descriptor did not grow at all.

## 17. `.ai`

The pack (81,715 B total, budget 80 KB → 205 B headroom — the seam and permission facts were
paid for by moving the eight degradation triggers back to `negotiation.mjs`) now answers the AI question:
`.ai/index/capabilities.json` carries the declared entries plus generated `vocabularies`,
`negotiation`, `delivery`, `localization`, `ai` and `seam` blocks, and **every one of those
blocks is drift-checked** against the module it summarizes (`test/12`). The frontend card names
every module the package ships (including the three new ones) inside its 8,192 B budget, the
glossary now defines the seam, the capability identity, the degradation and operation
vocabularies, zero-install, MCP, the work trace and delegation, and four decisions (D23–D26)
record why the vocabulary is quoted, why the seam is closed, why AI is declared rather than
implemented, and that a quoted word records its publication. A stale block is a red test, not a
comment.

## 18. Tests

`265` frontend architecture tests across `29` suites, `36/36` app tests, `50/50` evidence checks,
`26/26` conformance checks, the sub-LEGO audit PASSED, `verify:fast` at its unchanged 5/10
baseline (G06–G10 need `packages/workflow-lego/node_modules`). New this phase:

| Suite | What it proves |
| :--- | :--- |
| `24-vocabulary.test.mjs` | provenance, verbatim quoting, declared extras with reasons, refusal of unknown terms, normalisation, collision reporting |
| `25-operations.test.mjs` | every one of the 12 outcomes is producible, precedence coverage, malformed names refused |
| `26-ai-contracts.test.mjs` | declared-not-installed, no inference or vendor field, kinds stay distinct, fail-closed validators, zero-install, budget-derived runtime selection, MCP without transport, identity vs chain of thought, no boot-payload leak |
| `27-agent-events.test.mjs` | closed event vocabulary, delivery classes, refusals, mapping and unmapped refusal, ordering, bound with drop counting, delegation without inheritance, cycles reported, approvals as gates |
| `28-seam.test.mjs` | the closed input list, forbidden sources, one 16-field identity on both sides, normalisation and refusal, no secret/transcript/transport in the seam |
| `29-alignment.test.mjs` | the lock against the backend tree: every quoted value and the quoted semantics, a pending publication that must name a recorded decision, the contract-lock rows, and the comparison itself proven to fail on a renamed, missing or invented term. Skips (4 tests) only while the backend is absent; with `N8N_BACKEND_LEGO_ROOT` pointed at the other agent's tree it runs for real (**7/7, 0 skips**) |

## 19. Manager decisions

Ten cross-agent rows are recorded machine-readably in
`docs/n8n-lego/decisions/cross-agent-decisions.json`, each with evidence, arbiter and what is
blocked. Six are **resolved from declarations** — against P2.10 (`6f7b66da`) where it answers
them: XA-1 (the canonical backend identity is `execution`; the registry now also publishes the
alias `executions → execution` with `/rest/executions` as the surface origin), XA-2 (**operations
are published**: 62 of 82 capabilities carry `{ name, interaction, permission, idempotent,
status }`), XA-3 (the 501 feature map is owned by the `compatibility` domain,
`compat.http@1.0.0`, agent-1 — the file is byte-identical on both branches), XA-4 (owner field),
XA-6 (**the manager owns the AI vocabulary**: `ai.foundation@1.0.0`, domain `ai-foundation`,
`contract-only`), XA-7 (`transportRouting.kinds` = `in-process`/`worker`/`remote`/`mcp`). Four
need someone else:

| Row | Question | Arbiter | What the frontend does meanwhile |
| :--- | :--- | :--- | :--- |
| XA-5 | Which contract publishes the `lego.*` degradation codes? | agent-2 | renders the declared action verbatim; does not invent a code |
| XA-8 | Which permission namespace do AI capabilities use? | Manager | keeps its own words, declares the mapping into `ai:*`, and fails closed on an undeclared permission |
| XA-9 | Which contract publishes `manifest/foundation.json`? | Manager | quotes the values with a structured `publicationPending` record — no invented version |
| XA-10 | `ai:app:*` or `app:github:*` for an application provider? | Manager | keeps both sets separate and never treats them as interchangeable |

No new shared word was chosen to close a question: an open row stays open.

## 20. Readiness evidence

| Command | Result |
| :--- | :--- |
| `node --test packages/frontend-lego/test/*.test.mjs` | 265 tests, 261 pass, **4 skipped** (backend comparisons absent), 0 fail |
| `node --test apps/n8n-lego/test/*.test.mjs` | 36/36 pass |
| `N8N_BACKEND_LEGO_ROOT=/tmp/a2/apps/n8n-lego/src/lego node --test packages/frontend-lego/test/29-alignment.test.mjs` | **7/7 pass, 0 skipped** — 38 canonical sets compared against the P2.10 tree, 0 drift, plus the quoted semantics |
| `node apps/n8n-lego/scripts/capture-frontend-evidence.mjs` | **50/50 PASS**, boot payload byte-identical at 18,126 B |
| `frontend.conformance()` (via `test/19`) | 26 rules, 26 live checks, all pass (A25: a quoted word carries its provenance, and an unpublished file is recorded; A26: a declared permission is a declared word) |
| `python3 tools/sublego-audit/audit.py` | AUDIT PASSED (12 LEGOs, 20 Sub-LEGOs, 5 Agents) |
| `npm run verify:fast` | 5/10 — the unchanged baseline; G06–G10 require `packages/workflow-lego/node_modules` |
| `git show origin/a2:apps/n8n-lego/src/compat/capability.mjs \| diff - apps/n8n-lego/src/compat/capability.mjs` | identical — the app side of the compatibility boundary did not fork |
| Secrets / credential material | not representable: refused by name in declarations, events and the seam |

**No merge, no `main` write, no feature implementation, no second backend registry, no HTTP
between local modules, no model call anywhere in this package.**

### Gate checklist (§24)

| Gate | State |
| :--- | :--- |
| One canonical capability identity, collisions detectable | ✅ `seam.mjs` (16 fields + provenance), `detectCollisions`, rule A24 |
| No frontend/backend vocabulary conflict left unexplained | ✅ 38 canonical + 22 local sets, 5 declared overlaps, `vocabularyConflicts()` |
| Operation outcomes distinguishable, never collapsed | ✅ 12 outcomes, declared precedence, rule A19 |
| AI contracts declared, zero implementation | ✅ 6 capabilities, no entry path, rule A20 |
| Event vocabulary transport-neutral and closed | ✅ 26 types / 7 namespaces, rule A21 |
| Trace bounded, reference-only, no chain of thought | ✅ 18 fields, 200-row cap, refusals by name, rule A22 |
| Delegation cannot inherit authority | ✅ `inherited: false`, own grants only, rule A22 |
| Provider / runtime / tool kinds distinct, application provider first-class | ✅ `PROVIDER_KINDS`, `RUNTIME_KINDS` |
| MCP represented without transport | ✅ 8 objects, 4 states, no transport field |
| Zero-install valid, resource-aware without local runtimes | ✅ `describeInstallation`, budget-derived selection |
| Localization boundary unchanged and canonical | ✅ `id/en/ar/zh/ru/jv`, `ar` RTL, dictionaries outside |
| Fail-closed on every unknown | ✅ 26 rules, suites 21/24/25/26/27/28/29 |
| Boot payload budget preserved | ✅ 18,126 B, AI vocabulary absent from it |
| `.ai` knowledge backed by manifests/contracts | ✅ generated blocks, drift-checked |
| Every cross-agent question recorded with an arbiter | ✅ decision record, 4 resolved / 3 assigned |
| Report | ✅ this document, 20 items |
