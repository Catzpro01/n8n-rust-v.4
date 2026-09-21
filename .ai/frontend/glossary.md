# Frontend glossary

One line per term. If a term is missing here, it probably should not be used in a
frontend conversation — inventing vocabulary is how two agents end up disagreeing.

| Term | Meaning |
| ---- | ------- |
| **LEGO** | A unit with identity, owner, contract, version, dependency boundary, test boundary, lifecycle and upgrade path. `ui-frontend` is the frontend LEGO. |
| **Sub-LEGO** | A nested unit inside a LEGO (`settings.localization.rtl`). Exists only with an independently meaningful contract, ownership, boundary or upgrade path. |
| **Not a LEGO** | Components, buttons, icons, helpers, ordinary framework files. They are internals of the unit that owns them. |
| **Surface** | A user-facing area the frontend publishes: 12 of them (`navigation`, `settings`, `workflow-editor`, …). Every capability attaches to a surface. |
| **Extension point (hook)** | A named place where a future capability may attach (`ui:settings:section`). 15 declared, version `1.1.0`, each with `mutates` and (for cross-surface hooks) an attribute whitelist. |
| **Port** | A sub-LEGO's published boundary (`ui:panel:selection`). The only thing another unit may depend on. |
| **Internals / private area** | The `src/sub-legos/**` path a unit owns. Importing a sibling's internals is a build-level error, not a style preference. |
| **Capability** | What the frontend can offer beyond the stock UI (`translation`). Declared in `manifest/capabilities.json`, registered only when installed. |
| **Availability vs activation** | Available = declared and resolvable. Activated = loaded and running. They are different questions with different answers. |
| **Lifecycle state** | `available → installed → loaded → active → idle | unloaded | disabled`. Only `loaded/active/idle` may serve a request. |
| **Criticality** | `core` (absence is a broken instance), `optional` (degrades to a declared fallback), `enhancement` (absence needs no notice). |
| **Trust level** | `core`, `feature`, `extension`, `untrusted` — what code may do (routes, session, endpoints, hooks). Inherited, never promoted by nesting. |
| **Degradation** | The declared behaviour when a non-core capability is absent: `fail-loud`, `fallback`, `continue`. |
| **Device profile** | A declared budget (`desktop`, `laptop`, `low-memory`, `android`, `termux-companion`, `remote-only`), not a platform check. |
| **Support state** | `supported`, `degraded`, `remote`, `unsupported` — the four answers a capability gets per profile. |
| **Envelope / operation context** | The semantic context of one boundary crossing: capability, operation, contract version, correlation id, authorization context, deadline, cancellation, idempotency. |
| **Correlation id** | The identity that ties a frontend action to a backend log line. Boundary-level, never per component. |
| **Semantic error code** | A stable machine identifier (`credential.not_found`). Display text is presentation and belongs to the translation layer. |
| **Message slot** | A named place a surface renders text into (`forms`, `backend-errors`). 13 slots; the vocabulary translation will fill. |
| **Locale** | `id, en, ar, zh, ru, jv`. Arabic is RTL. Owned by `contracts/localization.contract.md`. |
| **Boot payload** | The JSON the browser receives: one `<meta>` tag + `GET /rest/frontend/bootstrap`. Budget 32 KB, currently ~26 KB base64. |
| **Adapter** | The framework boundary (`src/adapters/`). The framework name appears nowhere else. |
| **Seam** | Where declarations cross and implementations do not: 13 declared inputs, each with the sources it may be read from. Implementation files, route tables, ports and credential stores are refused. |
| **Capability identity** | The one shape both sides project a capability into: 16 fields, `null` for anything nobody declared; `origin` is recorded next to it, not inside it. |
| **Shared vocabulary lock** | `src/vocabulary.mjs`: concepts the backend foundation owns, quoted with contract id, version, owner, file and symbol — plus local words that declare what they map to and why. |
| **Degradation state** | What the consumer must do when a capability cannot serve: `available`, `degraded`, `capability-unavailable`, `optional-absent`, `version-incompatible`, `dependency-disabled`, `migration-required`, `feature-unsupported`. |
| **Operation outcome** | The answer to "may *this* operation run": the eight degradation states plus `operation-denied`, `operation-unpublished`, `permission-missing`, `permission-unknown`. Never collapsed into one "unavailable". |
| **Zero-install mode** | A supported installation with no model, no agent runtime and no MCP provider: `inference` is a capability, not a requirement, and the UI names the layer that is absent. |
| **Agent runtime / simulation runtime** | Two kinds of thing that can run an agent; a simulation is never reported as real work. |
| **Model / tool / application provider** | Three provider kinds: inference, tools through a gateway, and an application reachable directly (GitHub is first-class without a gateway). |
| **MCP** | An interoperability layer for tools, resources and prompts — not the Agent Machine, never a transport in a business contract. States: connected, unavailable, permission-required, capability-unsupported. |
| **Work trace** | A bounded agent timeline: 26 event types in 7 namespaces, 18 row fields, 200 rows, 280-character summaries. References artifacts and approvals; stores no payload and no chain of thought. |
| **contract-only** | Canonical status for “contract fixed and gate-checked, implementation missing” — what a catalog calls `declared`. |
| **Publication pending** | A word quoted from a file no contract row publishes: owner, domain and the decision that asks for one (`XA-9`), never an invented version. |
| **Canonical word** | The word the owning contract declares; a local word maps to it (`inference:invoke → ai:model:invoke`) or carries a reason. |
| **Delegation** | A child agent's parentage, task, runtime and session — recorded, granting nothing: a nested agent holds exactly the permissions it was given. |
| **Fail-soft / fail-closed** | Fail-soft: a broken LEGO must not stop the stock UI. Fail-closed: an invalid declaration stops the descriptor rather than shipping a half-truth. |
| **Impact graph** | "If this changes, what must be tested?" — answered from declaration data, not by reading source. |
| **Selective test map** | `fast-contract → boundary → browser → integration → full`. Run the smallest valid set; escalate when the graph says so. |
| **Dry-run plan** | The target, files, contracts, dependencies, test impact and risk of a change, produced before anything is touched. |
| **Superseded** | A specification kept for traceability that no longer governs work (see `contracts/micro-frontend.contract.md`). |
