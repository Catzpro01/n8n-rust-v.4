<!-- PRESERVED from agent-1 @ 8c299609 during the P2.11 reconciliation. Curated: not generated, not deleted by `npm run lego:ai`. -->
> **This is the frontend consumption view, not the canonical document.**
>
> The canonical, manifest-derived document for this subject is
> [`../AI_AGENT_LEGO_MASTER_PLAN.md`](../AI_AGENT_LEGO_MASTER_PLAN.md). Where the two disagree on a *number*, the canonical
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

# The 15 official AI/Agent LEGO

**Status:** specification (planning) + reconciliation. **Frontend owner:** agent-01.
**Backend authority:** agent-2 `@ 6f7b66da`; the AI vocabulary is `ai.foundation@1.0.0`, owned by the
**manager** (XA-6, resolved). **Rule:** an official LEGO is a real repository object — a top-level
domain or a legitimate nested domain — never chat prose, and never a duplicate of an existing core
domain.

---

## 1. The fifteen, their publication state and where they live

| # | LEGO | Publication state at P2.10 | Registry home | Frontend surface | Decision |
| :-- | :--- | :--- | :--- | :--- | :--- |
| 1 | **AI Foundation** | **published** — `ai.foundation@1.0.0`, status `contract-only`, 11 capabilities | domain `ai-foundation` | all AI surfaces | — |
| 2 | **Capability** | **published** — registry + `lego.interaction`, `lego.negotiation` | `lego.domain-registry@1.1.0` | Capabilities list, source labels | — |
| 3 | **Context & Session** | **contract-only** — declared as `ai.context` + `ai.agent-session` | `ai-foundation` | context chip, session line | — |
| 4 | **Agent Event & Work Trace** | **contract-only** — declared as `ai.agent-events`, 26 types / 7 namespaces | `ai-foundation` | Trace tab, status bar | — |
| 5 | **Artifact** | **contract-only** — declared as `ai.artifact`, 8 kinds, 4 retention classes | `ai-foundation` | Files tab | — |
| 6 | **Approval** | **contract-only** — declared as `ai.approval`, fail-closed | `ai-foundation` | approval card, trace rows | — |
| 7 | **Runtime Adapter** | **contract-only** — declared as `ai.agent-runtime` + `runtimeMetadata` | `ai-foundation` | runtime line in agent detail | — |
| 8 | **Workspace** | **partially published** — domain `workspace` exists (`planned`, contract `0.0.0`, `projects` unsupported) | domain `workspace` | workspace view (gated) | **XA-13** |
| 9 | **Node Creator** | **partially published** — `node-registry@0.1.0` (catalog resolve/describe/list, icons) | domain `node-registry` | node editor; `Create with AI` gated | **XA-15** |
| 10 | **Skill** | `publicationPending` | — (no capability, no contract) | Skills chip/list | **XA-11** |
| 11 | **Memory** | `publicationPending` | — (today: context + decisions + artifacts) | Memory chip, memory graph | **XA-12** |
| 12 | **MCP Adapter** | `publicationPending` (vocabulary block published) | `ai.foundation` mcp block | capability-first MCP rows | **XA-16** |
| 13 | **Token & Usage** | `publicationPending` (today: `countTokens`, declared costs) | — | token chips, usage view | **XA-17** |
| 14 | **Universal Translation** | `publicationPending` (no domain, no capability) | — | language control, `Translate response` | **XA-14** |
| 15 | **Agent Machine** | **contract-only**: `ai.agent-runtime` + `ai.agent-delegation` contracts exist; **no runtime is built** | `ai-foundation` | agent tree, agent detail | — |

**2 published (AI Foundation, Capability), 6 declared `contract-only`, 2 partially published and
gated (Workspace XA-13, Node Creator XA-15), 5 `publicationPending`.** No LEGO in this table is
implemented by this branch, and "published" never means "running": a lock row or a registry entry is
a *contract*, and the `ai.*` family is explicitly `contract-only` — implementation behind it is
forbidden until its phase.

## 2. Reconciliation rules (the hard part)

1. **No duplicate domain.** `workspace` already exists as a core LEGO; the AI Workspace concept binds
   to it (XA-13). Capability binds to the registry/negotiation infrastructure already published — no
   parallel capability vocabulary. Translation does **not** get forced into `credentials`,
   `node-registry` or `workflow`; if it needs a home, the manager decides (XA-14).
2. **One vocabulary.** Provider, transport, runtime, event and approval words come from
   `ai-foundation.json`; where the frontend needed its own view it declares a *view set* with a
   mapping (`vocabulary.mjs`) instead of a synonym.
3. **Publication is recorded, not assumed.** A concept without a contract is `publicationPending`
   with owner, domain and a recorded decision id — never a guessed version.
4. **Capability is not implementation.** A capability says *what can be done*; an implementation says
   *how*; a provider says *where*; a transport says *how bytes move*; a runtime says *where execution
   happens*. The frontend keeps all five distinct in its data contract.

## 3. The five semantic roles, kept distinct

| Role | Question | Example (frontend view) |
| :--- | :--- | :--- |
| Capability | what can be done | `github.search` |
| Skill *(XA-11)* | how the job should be done | `web-development`, `accessibility`, `SEO`, `GitHub` |
| Agent Machine | who/what orchestrates the job | Main ─ Research ─ Builder ─ Tester ─ Reviewer |
| Workspace | where the action occurs | `Workspace · project-name` |
| Approval | whether the action is allowed | `Approval required · Production workflow` |
| Artifact | what result was produced | `patch.diff`, `test-report.html`, `screenshot.png` |
| Work Trace | what operationally happened | Understand · Inspect · Decision · Completed |

## 4. Agent Machine as a native workflow primitive *(contracts only; no runtime here)*

Agent Machine is not a chatbot with tools; it is an execution/orchestration primitive that fits a
workflow graph:

```
Trigger → Agent Machine → children → join → next workflow step
Main ── Research
     ├─ Builder ── Frontend / Backend
     ├─ Tester
     └─ Reviewer            → Aggregator
```

The contract must support sequential, parallel, conditional, fan-out, fan-in, join, retry, pause,
resume, cancellation, budgets, delegation and dependency tracking. Published today:
`ai.agent-runtime` lifecycle (create, start, send, pause, resume, cancel, status, stream, artifact,
close — `pause` optional, `cancellation: false` legitimate), `ai.agent-delegation` (a child receives a
**subset** of the parent's authority; budgets `maxTokens`, `maxToolCalls`, `maxDurationMs`,
`maxChildren`; deadlines clamped), and `ai.agent-events` for observation. Details:
`AGENT_MACHINE_PLAN.md`. The graph semantics (fan-in, join, retry policy) are **not** published
anywhere yet — the plan states the requirement and records it as a Manager question, not a frontend
invention.

## 5. Two worlds that must never be mixed

| | Product/runtime agents | Development workforce agents |
| :--- | :--- | :--- |
| Who | agents executing **user** workloads inside n8n | agents building n8n LEGO itself |
| Examples | Agent Machine, AI Node, Hermes/Claude/Gemini/OpenClaw adapters | Arena Manager, Arena workers, agent-01, agent-02 |
| Ownership | user's instance, user's policy | project governance (`PROJECT_WORKFORCE_ORCHESTRATION.md`) |
| Lifecycle | session/execution lifecycle | branch/task/job lifecycle |

They may share concepts (delegation, trace, artifacts) but never authority, trust or lifecycle.

## 6. Acceptance for a new AI LEGO

A LEGO is not complete because code exists. Completion requires: registry entry · public contract ·
version · owner · capability set · operation vocabulary · permissions · interaction classes ·
lifecycle · resource profile · security boundary · degradation behaviour · tests (including negative
tests) · architecture gate · evidence · documentation · cross-agent reconciliation. Until every box is
ticked, the frontend renders the honest state — `capability-unavailable`,
`feature-unsupported` or `optional-absent` — instead of a mock.

## 7. Artifact storage and retention (what the UI may say)

The artifact contract is `ai.artifact` (Agent 2, **contract-only**). Its declared surface, quoted —
never invented — by the frontend:

| Field group | Declared |
| :--- | :--- |
| identity and metadata | `artifactId`, `kind`, `size`, `mime`, `createdAt`, `owner`, `checksum` |
| retention | `retention`, one of **`ephemeral`, `session`, `retained`, `pinned`** |
| location | `storageRef` — **opaque**, resolved only by the backend |

Kinds (8, declared): `patch`, `diff`, `log`, `report`, `screenshot`, `file`, `model-output`,
`simulation-result`.

Rules the frontend obeys:

- The UI renders the declared `retention` value and **names no class of its own**. A product-level
  vocabulary such as temporary / task / project / durable is a *request*, not a declared class; if a
  surface genuinely needs the extra granularity, the manager decides it rather than the UI inventing a
  fifth name (compare XA-18 for the same pattern).
- `storageRef` is opaque: no credential, no vendor field, no host path is ever rendered from it, and
  the UI never resolves it itself. Large objects live outside hot memory; events and context carry
  references, not payloads.
- When a reference cannot be resolved, the surface renders `artifact-unavailable` with the reason and
  keeps the artifact's metadata visible rather than fabricating content.
