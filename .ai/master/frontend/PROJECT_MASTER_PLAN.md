<!-- PRESERVED from agent-1 @ 8c299609 during the P2.11 reconciliation. Curated: not generated, not deleted by `npm run lego:ai`. -->
> **This is the frontend consumption view, not the canonical document.**
>
> The canonical, manifest-derived document for this subject is
> [`../PROJECT_MASTER_PLAN.md`](../PROJECT_MASTER_PLAN.md). Where the two disagree on a *number*, the canonical
> document wins: its figures are generated from the manifests at build time,
> whereas this view was hand-written against backend baseline `6f7b66da` (P2.10)
> and is **not** updated by regeneration.
>
> Known differences at the time of reconciliation: XA-5 is **closed** (the eleven
> `lego.*` codes are published; error contract 1.1.0, 35 codes), the operation
> count is **139** (not 173), and gate rules now run through **F17**.
>
> It is preserved because it carries frontend reasoning, UX consequences and
> cross-agent reconciliation notes that no backend manifest derives.

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

This table is a **projection, not a source**: it restates `domains.json` at `6f7b66da` (Agent 2's
registry) — the id, status, contract version and phase of each domain, in registry order. The registry
is authoritative; when the two disagree, this document is wrong. Status distribution at that commit:
**8 implemented, 5 partial, 7 planned, 1 contract-only, 1 legacy, 4 template**, over 82 capabilities
(62 of them with operations published). A `0.0.0` contract version means *not published*: planned
domains have no consumable surface yet.

| # | Domain | Status (contract version) | Phase |
| :-- | :--- | :--- | :--- |
| 1 | `platform-kernel` | implemented (`1.0.0`) | P0 |
| 2 | `lego-foundation` | implemented (`1.1.0`) | P2.6 |
| 3 | `ai-foundation` | contract-only (`1.0.0`) | P2.10 |
| 4 | `compatibility` | implemented (`1.0.0`) | P2 |
| 5 | `auth` | partial (`0.1.0`) | P5 |
| 6 | `auth.identity` | implemented (`1.0.0`) | P2.9 |
| 7 | `credentials` | planned (`0.0.0` — not published) | P5 |
| 8 | `workflow` | partial (`0.1.0`) | P3 |
| 9 | `execution` | partial (`0.1.0`) | P3 |
| 10 | `node-registry` | partial (`0.1.0`) | P6 |
| 11 | `dynamic-parameters` | planned (`0.0.0` — not published) | P7 |
| 12 | `webhook` | planned (`0.0.0` — not published) | P4 |
| 13 | `storage` | partial (`0.1.0`) | P8 |
| 14 | `worker` | planned (`0.0.0` — not published) | P11 |
| 15 | `realtime` | implemented (`0.1.0`) | P0 |
| 16 | `settings` | implemented (`1.0.0`) | P2 |
| 17 | `editor-ui-host` | implemented (`1.0.0`) | P0 |
| 18 | `workspace` | planned (`0.0.0` — not published) | P3 |
| 19 | `observability` | planned (`0.0.0` — not published) | deferred |
| 20 | `data-tables` | planned (`0.0.0` — not published) | deferred |
| 21 | `legacy-rest` | legacy (`0.1.0`) | P3-P7 |
| 22 | `runtime-host` | implemented (`1.0.0`) | P0 |
| 23 | `reference-lego` | template (`1.1.0`) | P2.6 |
| 24 | `reference-lego.validation` | template (`1.1.0`) | P2.7 |
| 25 | `reference-lego.validation.schema` | template (`1.0.0`) | P2.7 |
| 26 | `reference-lego.repository` | template (`1.0.0`) | P2.7 |

The count is **26**. Earlier prose said 25; that count is obsolete and the registry is the source of
truth (recorded in `PROJECT_DECISIONS.md`).

## 4. The 15 official AI/Agent LEGO

Official targets, listed with their current publication state (details and reconciliation live in
`AI_AGENT_LEGO_MASTER_PLAN.md`): AI Foundation, Skill, Agent Machine, Memory, Workspace,
Context & Session, Universal Translation, Node Creator, Capability, MCP Adapter, Runtime Adapter,
Artifact, Approval, Agent Event & Work Trace, Token & Usage.

| Official LEGO | Where it is declared today (evidence at `6f7b66da`) | State |
| :--- | :--- | :--- |
| AI Foundation | `contracts/contract-lock.json` row `ai.foundation` | published contract (1.0.0, Manager) |
| Capability | lock rows `lego.domain-registry`, `lego.negotiation`, `lego.envelope`, `lego.interaction`; ADR-0010 | published infrastructure |
| Context & Session | `ai-foundation.json` -> `context` (`ai.context`) | contract-only |
| Agent Machine | `ai-foundation.json` -> `agentSession`, `delegation` | contract-only |
| Artifact | `ai-foundation.json` -> `artifact` | contract-only |
| Approval | `ai-foundation.json` -> `approval` (fail-closed) | contract-only |
| Agent Event & Work Trace | `ai-foundation.json` -> `events` (26 types) plus `lego.envelope` | contract-only |
| Runtime Adapter | `ai-foundation.json` -> `agentRuntime` | contract-only |
| MCP Adapter | `ai-foundation.json` -> `mcp` (an edge interop boundary) | interop declared; a real transport stays XA-16 |
| Node Creator | `manifest/node-contract.json`; no drafting capability in the registry | AI drafting `publicationPending` (XA-15) |
| Workspace | registry domain `workspace` (contract `0.0.0`; both capabilities legacy/unsupported) | planned (XA-13) |
| Skill | absent from the registry and the lock | `publicationPending` (XA-11) |
| Memory | absent; `ai.context` covers the window, not memory | `publicationPending` (XA-12) |
| Universal Translation | absent from the registry (the old "out of scope" note is superseded) | `publicationPending` (XA-14) |
| Token & Usage | no `ai.usage` row; `modelGateway.countTokens` and delegation budgets only | `publicationPending` (XA-17) |

Nothing in this table claims a runtime exists. *Published* means a contract in the lock or a registry
entry; *contract-only* means the contract is declared while any implementation behind it is
prohibited until its phase; `publicationPending` means only a decision exists, and the decision is the
Manager's, not this document's.

Two reconciliation rules apply: an official LEGO may be a top-level domain or a legitimate nested
domain, but **never a duplicate of an existing core domain** — so the AI Workspace concept binds to
the existing `workspace` domain (XA-13), not to a new `ai-workspace`; and Capability binds to the
existing capability/registry/negotiation infrastructure, not a parallel vocabulary.

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

## 9. AI Foundation: what it is — and what it is not

AI Foundation is the **shared AI substrate**: one set of contracts for AI identity, model abstraction,
capability resolution, context binding, policy, session integration, resource accounting, the event
interface, provider selection and lifecycle. It is deliberately none of the following:

| It is not | Because |
| :--- | :--- |
| the agent loop | the loop belongs to a runtime behind `ai.agent-runtime` |
| a model vendor | models arrive through the `ai.model-gateway` contract, from a provider |
| MCP itself | MCP is an edge interop adapter that maps onto the tool gateway |
| an external agent runtime | external runtimes stay external and replaceable |
| a filesystem implementation | filesystem access is a capability inside a workspace scope |
| a terminal implementation | terminal/process execution is a capability, not substrate |
| a memory database | memory is **XA-12** (unpublished); context is not memory |

**One** AI Foundation supports AI Assistant, AI Copilot, AI Node, Agent Machine, the Execution AI mode
and every external runtime adapter. There must not be a separate AI engine per experience.

## 10. Responsibilities: who owns what in this project

| Agent | Owns | Must not |
| :--- | :--- | :--- |
| **agent-2** (backend) | core LEGO, backend contracts, the registry/dependency graph, capability and operation vocabulary, AI Foundation, Agent Machine/Context/Session/Memory/Workspace contracts, provider and runtime taxonomy, security model, project governance, the workforce backend model, the implementation roadmap | create a competing frontend vocabulary |
| **agent-1** (frontend, this branch) | AI Assistant, AI Copilot, AI Node, the Execution AI mode, the AI status bar, token UI, context/session UI, skill UI, memory UI, agent tree, work trace, artifact UI, approval UI, capability UI, MCP UI, runtime UI, workspace UI, Node Creator UI, translation UI, accessibility, localization, responsive behaviour, the beginner/advanced experience — plus the durable project memory in `.ai/master/` | resolve a manager-owned question, invent backend vocabulary, or restate a generated declaration as its own source |
| **manager** | cross-domain ownership, open vocabulary conflicts, permission-namespace conflicts, contract publication ownership, project-level roadmap changes, integration order, protected-branch decisions, cross-agent conflicts, external-runtime policy, workforce governance | — (the manager is the arbiter of last resort) |

The machine-readable form of "who decides what is still open" is
`docs/n8n-lego/decisions/cross-agent-decisions.json`: every row carries owner, affected domains,
current interpretation, decision required, blocking level, date and references.

## 11. Reading test — thirty questions a new agent must answer from this tree

If any row cannot be answered from the named document, the documentation is incomplete and that is a
defect in `.ai/master/`, not a reason to read the chat.

| # | Question | Where the answer is |
| :-- | :--- | :--- |
| 1 | What is n8n LEGO? | `PROJECT_MASTER_PLAN.md §1` |
| 2 | What are the 26 current core domains? | `PROJECT_MASTER_PLAN.md §3`, `CORE_LEGO_ARCHITECTURE.md §1` |
| 3 | What are the 15 official AI/Agent LEGO? | `AI_AGENT_LEGO_MASTER_PLAN.md §1` |
| 4 | What is implemented? | `CURRENT_STATUS.md §2`, `CORE_LEGO_ARCHITECTURE.md §3` |
| 5 | What is contract-only? | `CURRENT_STATUS.md §2`, `AI_AGENT_LEGO_MASTER_PLAN.md §1` |
| 6 | How does AI Assistant differ from Copilot? | `AI_UI_EXPERIENCE_MASTER_PLAN.md §1` |
| 7 | What is Agent Machine? | `AGENT_MACHINE_PLAN.md §1` |
| 8 | How do Skills and Capabilities differ? | `SKILL_AND_CAPABILITY_PLAN.md §1` |
| 9 | How do Memory and Context differ? | `CONTEXT_SESSION_MEMORY_PLAN.md §1`, `MEMORY_GRAPH_OBSIDIAN_PLAN.md §5` |
| 10 | How does the system write files and create projects? | `WORKSPACE_AND_EXTERNAL_ACTION_PLAN.md §2-3` |
| 11 | How does MCP fit? | `MCP_AND_RUNTIME_ADAPTER_PLAN.md §1` |
| 12 | How do Hermes / Claude / Gemini / OpenClaw fit? | `PROVIDER_TAXONOMY.md §1-2`, `AI_RUNTIME_AND_PROVIDER_PLAN.md §3` |
| 13 | How does token accounting work? | `TOKEN_USAGE_AND_RESOURCE_PLAN.md §1` |
| 14 | How does context rollover work? | `CONTEXT_SESSION_MEMORY_PLAN.md §4` |
| 15 | How does the Memory Graph connect to Obsidian? | `MEMORY_GRAPH_OBSIDIAN_PLAN.md §1` |
| 16 | How does Agent Machine interact with workflows? | `AGENT_MACHINE_PLAN.md §1` |
| 17 | How do permissions and approvals work? | `SECURITY_AND_APPROVAL_MODEL.md §1-3` |
| 18 | What can an agent execute? | `WORKSPACE_AND_EXTERNAL_ACTION_PLAN.md §2` |
| 19 | What is a Workspace? | `WORKSPACE_AND_EXTERNAL_ACTION_PLAN.md §1` |
| 20 | How are Artifacts stored? | `AI_FRONTEND_CONTRACT_MATRIX.md §2` (opaque `storageRef`, retention classes) |
| 21 | How is Work Trace represented? | `AGENT_MACHINE_PLAN.md §5`, `AI_UX_PROGRESSIVE_DISCLOSURE.md §2` |
| 22 | What is the resource-aware strategy? | `PLATFORM_AND_DEPLOYMENT_STRATEGY.md §1-2`, `AI_RUNTIME_AND_PROVIDER_PLAN.md §5` |
| 23 | What is the Rust strategy? | `PLATFORM_AND_DEPLOYMENT_STRATEGY.md §6` |
| 24 | How does the Arena Manager/Worker system work? | `PROJECT_WORKFORCE_ORCHESTRATION.md §1-5` |
| 25 | What does GitHub control? | `PROJECT_WORKFORCE_ORCHESTRATION.md §2` |
| 26 | What does the control plane (Supabase) control? | `PROJECT_WORKFORCE_ORCHESTRATION.md §2`, `KNOWN_BLOCKERS.md B-12` |
| 27 | What does the VPS/test gate control? | `PROJECT_WORKFORCE_ORCHESTRATION.md §6` |
| 28 | What are the current blockers? | `KNOWN_BLOCKERS.md §1-3` |
| 29 | What must never be done? | `PROJECT_MASTER_PLAN.md §8`, `PLATFORM_AND_DEPLOYMENT_STRATEGY.md §9`, `SECURITY_AND_APPROVAL_MODEL.md §1, §6` |
| 30 | What comes next? | `IMPLEMENTATION_PHASES.md §1-2`, `CURRENT_STATUS.md §5` |

## See also

- `PLATFORM_AND_DEPLOYMENT_STRATEGY.md` — deployment modes, low-resource strategy, Rust policy.
- `CURRENT_STATUS.md` — the verified numbers behind every claim here.

