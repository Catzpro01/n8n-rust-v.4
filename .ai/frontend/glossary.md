# Frontend glossary

One line per term. A term missing here probably should not be used in a frontend
conversation: inventing vocabulary is how two agents end up disagreeing.

| Term | Meaning |
| ---- | ------- |
| **LEGO** | A unit with identity, owner, contract, version, dependency + test boundary, lifecycle and upgrade path. `ui-frontend` is the frontend one. |
| **Sub-LEGO** | A nested unit (`settings.localization.rtl`), existing only with an independently meaningful contract, ownership, boundary or upgrade path. |
| **Not a LEGO** | Components, buttons, icons, helpers, framework files: internals of the unit that owns them. |
| **Surface** | A published user-facing area — 12 (`navigation`, `settings`, `workflow-editor`, …). Every capability attaches to one. |
| **Extension point (hook)** | A named place a future capability may attach (`ui:settings:section`). 15 declared, `1.1.0`, each with `mutates` and an attribute whitelist. |
| **Port** | A sub-LEGO's published boundary (`ui:panel:selection`). The only thing another unit may depend on. |
| **Internals / private area** | The `src/sub-legos/**` path a unit owns; importing a sibling's internals is a build error, not a style preference. |
| **Capability** | What the frontend offers beyond the stock UI (`translation`): declared in `manifest/capabilities.json`, registered only when installed. |
| **Availability vs activation** | Available = declared and resolvable; activated = loaded and running. Different questions, different answers. |
| **Lifecycle state** | `available → installed → loaded → active → idle | unloaded | disabled`. Only `loaded/active/idle` may serve a request. |
| **Criticality** | `core` (absence breaks the instance), `optional` (degrades to a declared fallback), `enhancement` (absence needs no notice). |
| **Trust level** | `core`, `feature`, `extension`, `untrusted` — what code may do (routes, session, endpoints, hooks); inherited, never promoted by nesting. |
| **Degradation** | The declared behaviour when a non-core capability is absent: `fail-loud`, `fallback`, `continue`. |
| **Device profile** | A declared budget (`desktop`, `laptop`, `low-memory`, `android`, `termux-companion`, `remote-only`), not a platform check. |
| **Support state** | `supported`, `degraded`, `remote`, `unsupported` — the four answers a capability gets per profile. |
| **Envelope / operation context** | One boundary crossing's semantic context: capability, operation, contract version, correlation id, authorization context, deadline, cancellation, idempotency. |
| **Correlation id** | The identity that ties a frontend action to a backend log line. Boundary-level, never per component. |
| **Semantic error code** | A stable machine id (`credential.not_found`); display text is presentation and belongs to translation. |
| **Message slot** | A named place a surface renders text (`forms`, `backend-errors`). 13 slots; the vocabulary translation will fill. |
| **Locale** | `id, en, ar, zh, ru, jv`. Arabic is RTL. Owned by `contracts/localization.contract.md`. |
| **Boot payload** | The JSON the browser receives: one `<meta>` tag + `GET /rest/frontend/bootstrap`. Budget 32 KB, ~26 KB base64. |
| **Adapter** | The framework boundary (`src/adapters/`). The framework name appears nowhere else. |
| **Seam** | Where declarations cross and implementations do not: 13 inputs, each with its allowed sources. Implementation files, route tables, ports and credential stores are refused. |
| **Capability identity** | The one shape both sides project a capability into: 16 fields, `null` for anything undeclared; `origin` sits beside it, not inside. |
| **Shared vocabulary lock** | `src/vocabulary.mjs`: backend-owned concepts quoted with contract, version, owner, file and symbol; local words declare what they map to and why. |
| **Degradation state** | What a consumer must do when a capability cannot serve: the eight `AVAILABILITY_STATES`, `available` … `feature-unsupported` (data, `negotiation.mjs`). |
| **Operation outcome** | "May *this* operation run": the eight degradation states plus `operation-denied`, `operation-unpublished`, `permission-missing`, `permission-unknown`. Never one "unavailable". |
| **Zero-install mode** | A supported install with no model, agent runtime or MCP provider: inference is a capability, not a requirement, and the UI names the absent layer. |
| **Agent runtime / simulation runtime** | Two kinds of thing that can run an agent; a simulation is never reported as real work. |
| **Model / tool / application provider** | Three provider kinds: inference, tools via a gateway, an application reachable directly (GitHub needs no gateway). |
| **MCP** | Interoperability for tools, resources and prompts — not the Agent Machine, never a transport in a business contract. States: connected, unavailable, permission-required, capability-unsupported. |
| **Work trace** | A bounded agent timeline: 26 event types / 7 namespaces, 18 fields, 200 rows, 280-char summaries. References artifacts and approvals; no payload, no chain of thought. |
| **contract-only** | Canonical status for "contract fixed and gate-checked, implementation missing" — what a catalog calls `declared`. |
| **declared-not-locked** | A contract four declarations name and no `contract-lock.json` row publishes: fields quotable, version not renderable (`ai.context`, `ai.agent-session`, `XA-20`). |
| **Conversation** | The transcript a user reads. Not a session, not a context window: the frontend renders none of it for AI state. |
| **Session** | Bounded agent state: identity plus references (`contextRef`, `artifactRef`, `traceRef`). Seven states, `created … cancelled`; never a transcript. |
| **Context window** | What is loaded now: one of seven scopes (`GLOBAL … TASK`), selectively loaded, six lifecycle states, a size and a checksum. Not memory. |
| **Memory** | What survives context replacement. **No store exists** (`XA-12`): the fifth concept is named as absent, and counting loaded context is not counting memory. |
| **Execution** | A workflow run — the fifth concept. A session references one (`executionId`); this surface renders no execution affordance, because the Agent Machine has no runtime. |
| **Rollover** | Replacing a full window with a compacted one at a declared threshold — never at the limit, never a UI action. Rendered as `prepare`, `compacting`, `rolled-over`. |
| **Continuation package** | The fourteen quoted sections a rollover carries over (identity, objective, plan, work, decisions, `refs`, …). Never chain-of-thought, never a transcript. An envelope (`target`, `verification`) travels with it and is not a section. |
| **Continuity verification** | `verified` / `degraded` / `failed` from what the package carries; ruled but unpublished (`XA-20`), so rendered as pending. Absent ≠ empty: `[]` means "none". |
| **Publication pending** | A word quoted from a file no contract row publishes: owner, domain and the decision that asks for one (`XA-9`, `XA-12`, `XA-17`, `XA-20`), never an invented version. |
| **Canonical word** | The word the owning contract declares; a local word maps to it (`inference:invoke → ai:model:invoke`) or carries a reason. |
| **Delegation** | A child agent's parentage, task, runtime and session — recorded, granting nothing: it holds exactly the permissions it was given. |
| **Fail-soft / fail-closed** | Fail-soft: a broken LEGO must not stop the stock UI. Fail-closed: an invalid declaration stops the descriptor, never ships a half-truth. |
| **Impact graph** | "If this changes, what must be tested?" — answered from declaration data, not by reading source. |
| **Selective test map** | `fast-contract → boundary → browser → integration → full`: run the smallest valid set, escalate when the graph says so. |
| **Dry-run plan** | The target, files, contracts, dependencies, test impact and risk of a change, produced before anything is touched. |
| **Superseded** | A specification kept for traceability that no longer governs work (see `contracts/micro-frontend.contract.md`). |
| **Skill** | Procedural knowledge (how) — not a capability (what), not an agent (who). `ai.skill@1.0.0`: six states, four operations, none offered, nothing executes. |
