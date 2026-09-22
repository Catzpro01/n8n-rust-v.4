<!-- Curated (agent-1). Preserved from the P2.11 reconciliation and re-measured for P2.13 @ e754c5df (2026-09-22); not generated, not deleted by `npm run lego:ai`. -->
> **This is the frontend consumption view, not the canonical document.**
>
> The canonical, manifest-derived document for this subject is
> [`../IMPLEMENTATION_PHASES.md`](../IMPLEMENTATION_PHASES.md). Where the two disagree on a *number*, the canonical
> document wins: its figures are generated from the manifests at build time,
> whereas this view was hand-written against backend baseline `6f7b66da` (P2.10)
> and is **not** updated by regeneration.
>
> Known differences at the time of reconciliation: XA-5 is **closed** (the eleven
> `lego.*` codes are published), the operation count is **not 173**, and gate rules
> run through **F17**. Since then `ai.skill@1.0.0` was published (P2.12) and
> `ai.context` / `ai.agent-session` are declared but **not** locked (P2.13, `XA-20`).
>
> This banner deliberately names no live totals. Counts move every phase (P2.12
> published `ai.skill` and added an error code), and a correction notice that
> hardcodes them goes stale exactly like the text it corrects. For current
> figures read the generated [`CURRENT_STATUS.md`](../CURRENT_STATUS.md) and
> [`AI_CONTRACT_MATRIX.md`](../AI_CONTRACT_MATRIX.md), which are derived from
> the manifests; where this snapshot disagrees with them, they win.
>
> It is preserved because it carries frontend reasoning, UX consequences and
> cross-agent reconciliation notes that no backend manifest derives.

# Implementation phases

**Status:** specification (sequencing, not a schedule). **Owner:** manager for project phases;
agent-01 for the frontend phases. **Rule:** architecture first -> contract second -> test third ->
implementation last. No phase may silently bypass contract stabilisation, and a phase starts only when
its dependencies are **published**, not merely planned.

---

## 1. Project phases

| Phase | Theme | Exit condition |
| :-- | :--- | :--- |
| **0** | Core LEGO boundaries and governance | domains have owners, contracts, forbidden dependencies; the registry is the count |
| **1** | Contract stabilization | contract ids/versions/owners locked; incompatibilities declared |
| **2** | Capability and operation vocabulary | capabilities publish `operations[]`; interaction classes and permissions are declared |
| **3** | AI Foundation contracts | `ai.foundation@1.0.0` published, `contract-only`, zero implementation |
| **4** | Skill / Memory / Workspace / Context | each published and reconciled with existing domains (XA-11 ... XA-13) |
| **5** | Agent Machine | runtime + delegation + session + events contracts, still contract-first |
| **6** | Artifact / Approval / Work Trace / Token | durable output, human gates, bounded observation, honest usage |
| **7** | MCP / Runtime Adapters / provider integrations | edge interoperability without internal transport |
| **8** | Node Creator / Translation | creation and language become first-class, still contract-first |
| **9** | External runtime integration | one real external runtime through a stable adapter |
| **10** | Native controlled agent runtime | the Agent Machine runs, with policy, budgets and approvals |
| **11** | Measured optimization and Rust migration | only where the measurement justifies it |

**Current position: project Phase 4 in progress.** Phase 3 (AI Foundation contracts) is complete;
Phase 4 (Skill / Memory / Workspace / Context) has one published contract (`ai.skill@1.0.0`, P2.12)
and one milestone in progress (Context & Session, P2.13 — vocabulary and presentation, contracts
still unlocked). Memory and Workspace stay planned and gated (`XA-12`, `XA-13`, `XA-18`).

### 1b. The milestone layer (canonical: `docs/n8n-lego/milestones.json`)

The project phases above are coarse and were answering "what is done?" from six documents that
disagreed. Since P2.13 there is one machine-readable register beneath them, owned by the manager:

| Milestone | Subject | Phase | Status |
| :--- | :--- | :--- | :--- |
| P2.11 | reconciliation of both agent branches; workforce governance moved out of the product manifests | A | complete |
| P2.12 | Skill — `ai.skill@1.0.0`, 4 operations, 2 permissions, no Skill runtime (`XA-19` resolved, `XA-11` open) | B | complete |
| **P2.13** | **Context & Session + milestone reconciliation** — one LEGO, two contracts (`ai.context`, `ai.agent-session`), vocabulary and presentation only, no runtime (`XA-20`, `XA-21` open) | A/B | **in progress** |
| P2.14 | Memory (gated by `XA-12`) | B | planned (indicative id) |
| P2.15 | Workspace (gated by `XA-13`, `XA-18`) | B | planned (indicative id) |
| P2.16 | Agent Machine runtime (gated by `XA-16`; depends on Approval — fails closed) | B/C | planned (indicative id) |
| P2.17–P2.20 | Artifact, Approval, MCP Adapter, Runtime Adapter | C | planned (indicative ids) |
| P2.21–P2.24 | Work Trace, Node Creator, Translation, Token & Usage | D | planned (indicative ids) |
| P2.25 | External runtime providers | E | planned (indicative id) |
| P2.26 | Native optimization / Rust, by measurement only | F | planned (indicative id) |

Rules the register enforces (and `test/33-milestones.test.mjs` checks): every milestone names the
strategic Phase A … Phase F it sits in, and those phases are **not** replaced or re-numbered by the
milestone layer; an indicative id is refined ONLY by updating
the register; a status comes from six words (`planned`, `ready`, `in-progress`, `blocked`,
`complete`, `superseded`); a `complete` row names the commit it was verified against; history is
preserved, never rewritten to look current; and counts are delegated to the generated
`CURRENT_STATUS.md` instead of being copied.

The order of work inside every milestone is unchanged: architecture first -> contract second ->
test third -> implementation last.

## 2. Dependency-aware order for the 15 AI/Agent LEGO

1. AI Foundation · 2. Capability · 3. Context & Session · 4. Token & Usage · 5. Skill · 6. Memory ·
7. Workspace · 8. Agent Machine · 9. Artifact · 10. Approval · 11. Agent Event & Work Trace ·
12. MCP Adapter · 13. Runtime Adapter · 14. Node Creator · 15. Universal Translation.

This is a roadmap, **not permission to implement everything immediately**. Item 5 (Skill) is
published as `ai.skill@1.0.0`; item 3 (Context & Session) is declared in four places and locked in
none (`XA-20`), which is why P2.13 ships vocabulary and presentation and no runtime; items 4 and 6-7
and 12-15 remain `publicationPending` (XA-11 ... XA-17) and are blocked on a decision, not on code.

## 3. Frontend phases (the part this branch owns)

P3 skeleton -> P4 AI Assistant -> P5 Copilot chat/context/session -> P6 trace/agents/approvals/
artifacts -> P7 skills/memory -> P8 MCP/runtimes/workspace -> P9 node creator/translation/usage ->
P10 hardening. Each phase's scope, dependencies, tests and exit gate are specified in
`AI_UI_IMPLEMENTATION_PHASES.md`; the definition of done is shared (all ten states, six locales, RTL,
keyboard, no new vocabulary, boot payload unchanged, evidence regenerated, lazy discipline).

## 4. Acceptance model for a new LEGO (any phase)

Registry entry · public contract · version · owner · capability set · operation vocabulary ·
permissions · interaction classes · lifecycle · resource profile · security boundary · degradation
behaviour · tests **including negative tests** · architecture gate · evidence · documentation ·
cross-agent reconciliation. A LEGO is **not** complete because code exists.

## 5. What no phase does

No provider client, no model inference, no agent runtime, no MCP client/server, no memory store, no
workspace executor, no translation engine, no rewrite of an external runtime, no Rust without a
measurement, no new dependency without evidence, no second vocabulary, no readiness claim the gates do
not support. If a phase needs one of these before its contract exists, it stops and the gap becomes a
recorded decision or blocker.
