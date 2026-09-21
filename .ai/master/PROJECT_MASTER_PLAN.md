# Project master plan — n8n LEGO

**Status:** specification (durable project memory). **Owner:** agent-01 (frontend + project memory).
**Backend authority:** agent-2, `arena/01a0c521-n8n-rust-v-4 @ 6f7b66da` (P2.10).
**Frontend baseline:** `arena/01a0c53e-n8n-rust-v-4` (this branch).
**Protected main:** `cb71dbb201d635b15b49933764c2c2336e745809`.

This is the entry document of `.ai/master/`. It exists so a newly spawned agent can understand the
project **without reading the historical chat**. Everything here is planning and reconciliation; no
document in this tree implements a runtime, and none of them may become a second source of truth for
something that is already generated from a declaration.

---

## 1. What n8n LEGO is

n8n LEGO is **not a rewrite for its own sake**. The original n8n experience stays familiar and
valuable while the internals are progressively decomposed into modular LEGO domains behind stable
contracts:

```
original n8n UX
  → compatibility boundary
  → LEGO contracts
  → independent domain implementations
  → domain-by-domain replacement
  → measured JS → Rust migration where justified
```

Built-in n8n behaviour is preserved unless an explicit architecture decision replaces it. The project
does not optimise for Rust purity, and it does not optimise for AI novelty at the cost of workflow
reliability. The long-term goal is a system that is **powerful, modular, resource-efficient,
replaceable, observable, beginner-friendly and agent-ready**.

## 2. Ownership and authority (read this before editing anything)

| Artifact | Canonical owner | What it is |
| :--- | :--- | :--- |
| `apps/n8n-lego/src/lego/manifest/domains.json` | agent-2 | the domain/capability registry — **generated truth** for domains, capabilities, operations, ownership, status |
| `apps/n8n-lego/src/lego/manifest/ai-foundation.json` | manager (contract `ai.foundation@1.0.0`) | the published AI vocabulary and contract shapes |
| `apps/n8n-lego/src/lego/manifest/foundation.json` | manager domain `lego-foundation` | trust, resources, device profiles, transport bindings (**no contract-lock row** — XA-9) |
| `apps/n8n-lego/src/lego/contracts/contract-lock.json` | agent-2 | the pinned contract ids, versions and owners |
| `packages/frontend-lego/manifest/*.json` | agent-1 | the **frontend** declarations (surfaces, capabilities, contracts), consumed by the pack and the gates |
| `packages/frontend-lego/src/vocabulary.mjs` | agent-1 | the vocabulary **lock**: every shared word quoted with provenance, every local word mapped or declared |
| `.ai/` (card, glossary, index, cards, maps) | agent-1 | the retrieval pack: small, budget-enforced, drift-checked |
| `.ai/master/` (this tree) | agent-1, with agent-2/manager authority respected per document | the durable project specification |
| `docs/n8n-lego/decisions/*.json` | agent-1 | the machine-readable decision register (backend-visible questions included) |
| git branches, PRs, code | GitHub | the **only** source of truth for code |

Rules that follow from this table:

1. **Chat is not authority.** A decision becomes authoritative only when it is documented and locked
   here or in the owning declaration.
2. **Generated data stays generated.** The registry and the contract lock are not restated by hand;
   the master documents summarise them and link to them.
3. **No second backend vocabulary.** Where this tree touches backend concepts it is a *consumption
   view* and says so; the words themselves come from the quoted contracts.

## 3. The 26 current core LEGO domains

Verified against `domains.json` at `6f7b66da` (26 domains, 82 capabilities, 62 with published
operations). Status distribution: **8 implemented, 5 partial, 7 planned, 1 contract-only, 1 legacy,
4 template**.

| # | Domain | Status | Phase |
| :-- | :--- | :--- | :--- |
| 1 | `platform-kernel` | implemented | P2 |
| 2 | `lego-foundation` | implemented | P2 |
| 3 | `ai-foundation` | **contract-only** | P2.10 |
| 4 | `compatibility` | implemented | P2 |
| 5 | `settings` | partial | P2 |
| 6 | `editor-ui-host` | implemented | P2 |
| 7 | `legacy-rest` | **legacy** (must shrink) | P3–P7 |
| 8 | `workflow` | partial | P3 |
| 9 | `execution` | partial | P3 |
| 10 | `webhook` | planned | P4 |
| 11 | `workspace` | **planned** (contract `0.0.0`) | P3 |
| 12 | `auth` | implemented | P2 |
| 13 | `credentials` | partial | P2 |
| 14 | `auth.identity` | implemented | P2 |
| 15 | `node-registry` | partial (`0.1.0`) | P6 |
| 16 | `dynamic-parameters` | planned | P6 |
| 17 | `storage` | implemented | P3 |
| 18 | `data-tables` | planned | P6 |
| 19 | `runtime-host` | implemented | P7 |
| 20 | `realtime` | implemented | P7 |
| 21 | `worker` | planned | P7 |
| 22 | `observability` | planned | P7 |
| 23 | `reference-lego` | template | — |
| 24 | `reference-lego.validation` | template | — |
| 25 | `reference-lego.validation.schema` | template | — |
| 26 | `reference-lego.repository` | template | — |

The count is **26**. Earlier prose said 25; that count is obsolete and the registry is the source of
truth (recorded in `PROJECT_DECISIONS.md`).

## 4. The 15 official AI/Agent LEGO

Official targets, listed with their current publication state (details and reconciliation live in
`AI_AGENT_LEGO_MASTER_PLAN.md`): AI Foundation, Skill, Agent Machine, Memory, Workspace,
Context & Session, Universal Translation, Node Creator, Capability, MCP Adapter, Runtime Adapter,
Artifact, Approval, Agent Event & Work Trace, Token & Usage.

**9 are published** (`ai.foundation@1.0.0` and the domains it contracts), **6 are
`publicationPending`** with a recorded decision and a Manager arbiter: Skill (XA-11), Memory
(XA-12), Universal Translation (XA-14), MCP Adapter (XA-16), Token & Usage (XA-17), Node Creator's
AI drafting (XA-15). Two reconciliation rules apply: an official LEGO may be a top-level domain or a
legitimate nested domain, but **never a duplicate of an existing core domain** — so the AI Workspace
concept binds to the existing `workspace` domain (XA-13), not to a new `ai-workspace`; and Capability
binds to the existing capability/registry/negotiation infrastructure, not a parallel vocabulary.

## 5. Document map

| Area | Document |
| :--- | :--- |
| project, ownership, domains, phases | `PROJECT_MASTER_PLAN.md`, `CORE_LEGO_ARCHITECTURE.md`, `IMPLEMENTATION_PHASES.md` |
| current facts and blockers | `CURRENT_STATUS.md`, `KNOWN_BLOCKERS.md`, `PROJECT_DECISIONS.md` |
| AI/Agent LEGO, runtimes, providers | `AI_AGENT_LEGO_MASTER_PLAN.md`, `AI_RUNTIME_AND_PROVIDER_PLAN.md`, `PROVIDER_TAXONOMY.md` |
| context, tokens, memory | `CONTEXT_SESSION_MEMORY_PLAN.md`, `TOKEN_USAGE_AND_RESOURCE_PLAN.md`, `MEMORY_GRAPH_OBSIDIAN_PLAN.md` |
| skills, agents, actions | `SKILL_AND_CAPABILITY_PLAN.md`, `AGENT_MACHINE_PLAN.md`, `WORKSPACE_AND_EXTERNAL_ACTION_PLAN.md` |
| edges of the system | `MCP_AND_RUNTIME_ADAPTER_PLAN.md`, `NODE_CREATOR_PLAN.md`, `TRANSLATION_PLAN.md` |
| examples and safety | `REFERENCE_AGENT_SCENARIOS.md`, `SECURITY_AND_APPROVAL_MODEL.md` |
| how the project is built | `PROJECT_WORKFORCE_ORCHESTRATION.md` |
| the AI product itself (frontend) | `AI_UI_EXPERIENCE_MASTER_PLAN.md`, `AI_FRONTEND_CONTRACT_MATRIX.md`, `AI_UX_PROGRESSIVE_DISCLOSURE.md`, `AI_UI_STATES_AND_FLOWS.md`, `AI_ACCESSIBILITY_AND_LOCALIZATION.md`, `AI_UI_IMPLEMENTATION_PHASES.md` |

## 6. The strangler pattern (how legacy shrinks)

`legacy-rest` is a **temporary boundary**, not the future architecture. For every carve-out:

1. choose one route family; 2. the target domain owns the contract; 3. the contract is
published and locked; 4. the server mounts the new surface **before** legacy routing; 5. the legacy
handler is removed; 6. the legacy aggregate shrinks; 7. the architecture gate verifies the shrink.

Never grow `legacy-rest` with new business logic, never create a "misc" domain to make ownership
look complete, and never resolve an alias by creating a second domain (`executions` is a *surface
alias* of the canonical `execution`).

## 7. Principles that do not change

Contract before implementation · one owner per responsibility · no duplicate vocabulary · aliases do
not create ownership · native local dispatch before network transport · MCP is interoperability, not
business architecture · external runtimes stay external · Skill is not an agent · Capability is not
implementation · Memory is not context · Context is not conversation · Artifact is not event payload ·
Approval is not permission inheritance · Work Trace is not chain-of-thought · token telemetry is not
decoration · nesting does not grant authority · zero-install is valid · resource-aware operation is
first-class · Rust is a measured optimisation · legacy must shrink · main is protected · GitHub is
the source of truth for code · do not claim readiness the gates do not support · a failed negative
test is useful evidence · replaceable implementations preserve contracts.

## 8. What this tree must never do

Implement a runtime (inference, agent loop, MCP client/server, memory store, workspace executor,
translation engine) · invent backend vocabulary or versions · create a second domain for a naming
difference · store chain-of-thought · add internal HTTP between local LEGO · claim scale-out
readiness while the declared blockers stand · rewrite external runtimes in Rust · paste the whole
memory or vault into context.
