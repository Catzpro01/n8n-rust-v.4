# Project decisions — the durable record

**Status:** record (append-only). **Owner:** agent-01 for the frontend questions; manager for the
questions marked Manager; agent-2 for backend questions. **Machine-readable source:**
`docs/n8n-lego/decisions/cross-agent-decisions.json` (17 rows: XA-1 … XA-17) and
`.ai/cards/decisions.md` (frontend delivery decisions D1 … D26). This document explains how to read
them, records the decisions the project addendum settled, and states what may never be silently
superseded.

---

## 1. How a decision becomes authoritative

1. A question is asked against a **declaration** (never against a feeling): a registry entry, a
   contract row, a module constant.
2. The answer is either **resolved by an existing declaration** (cited) or **recorded as open** with
   an arbiter, the evidence gathered, the current interpretation and what is blocked.
3. A resolved row keeps its finding after it is fixed, so the reasoning survives.
4. An open row is never closed by choosing a new shared word in a branch. The frontend fails closed
   and keeps the question visible.
5. Superseding a row is allowed; deleting it is not. The old row stays with a pointer to what
   replaced it.

## 2. Decisions settled by this addendum (documented, not implemented)

| # | Decision | Why | Consequence in this repository |
| :-- | :--- | :--- | :--- |
| **A-1** | The project has **26 core LEGO domains**, not 25 | `domains.json` at `6f7b66da` declares 26 | `PROJECT_MASTER_PLAN.md §3`, `CURRENT_STATUS.md` use the registry as the count; earlier prose is obsolete |
| **A-2** | **Universal Translation is an official LEGO target** | the addendum overturns the earlier "translation is out of scope" assumption | `.ai/constitution.md` no longer lists six-language translation as out of scope; `TRANSLATION_PLAN.md` states the target; **XA-14** asks the manager for the publishing contract, and the frontend capability `translation` stays `declared` |
| **A-3** | The AI **Workspace** binds to the existing `workspace` domain | a second `ai-workspace` domain would duplicate a core domain | **XA-13**; the workspace view renders `feature-unsupported` until the domain publishes a contract |
| **A-4** | The AI **Capability** binds to the published registry/negotiation infrastructure | capability is not implementation and needs no second vocabulary | `CORE_LEGO_ARCHITECTURE.md`, `SKILL_AND_CAPABILITY_PLAN.md`; no new capability words |
| **A-5** | **Agent Machine is contract-only** | the contracts exist, the runtime does not | `AI_AGENT_LEGO_MASTER_PLAN.md §4`; no runtime code, no fake engine |
| **A-6** | **Two agent worlds** (product/runtime vs development workforce) are separate | they share concepts but not authority | `PROJECT_WORKFORCE_ORCHESTRATION.md` |
| **A-7** | **GitHub is the only source of truth for code** | control planes may hold state, never code | `PROJECT_WORKFORCE_ORCHESTRATION.md`; no second authoritative code registry |
| **A-8** | **Zero-install is a valid installation** | `zeroInstall` in `ai-foundation.json`; `AI Foundation ready` + `no provider configured` | the status bar has a valid-absent shape, not an error banner |
| **A-9** | **No chain-of-thought storage, ever** | privacy and honesty; trace carries summaries and references | `SECURITY_AND_APPROVAL_MODEL.md §6`, `AI_UX_PROGRESSIVE_DISCLOSURE.md §4` |
| **A-10** | **Certification of readiness is gate-backed** | gates, tests and evidence decide; prose does not | `CURRENT_STATUS.md` states what is *not* ready (scale-out) instead of rounding up |

## 3. Frontend decisions that stay in force

The delivery decisions D1 … D26 in `.ai/cards/decisions.md` are unchanged by this addendum. The ones
a future agent is most likely to trip over:

- **D23** — the vocabulary is **quoted**, not imported: `vocabulary.mjs` records the contract, version,
  owner, file, path and how to read the value, and `test/29` compares it against the backend when the
  backend tree is present (`N8N_BACKEND_LEGO_ROOT`), failing rather than skipping when the path is set
  but wrong.
- **D24** — a quoted word carries its **provenance**; an unpublished file carries a structured
  `publicationPending` record (owner, domain, decision, what) — never an invented version.
- **D25** — the **seam is closed**: 13 declared inputs, 7 forbidden sources, one 16-field capability
  identity, and an unknown input is refused by name.
- **D26** — the AI vocabulary is **declared, not implemented**: six frontend AI capabilities with no
  entry point, no provider client and no model call.

## 4. Open questions and who owns them

| Rows | Owner | What it is about |
| :--- | :--- | :--- |
| XA-5 | agent-2 | the `lego.*` degradation codes are named by `interaction.mjs` actions but published by no contract |
| XA-8 | manager | permission namespace: published AI operations use `ai:*`; the frontend's six AI capabilities declare five view words (four mapped, two reasoned) |
| XA-9 | manager | which contract publishes `manifest/foundation.json` (trust, resources, device profiles, transport targets) |
| XA-10 | manager | `ai:app:*` vs `app:<application>:*` for an application provider |
| XA-11 … XA-17 | manager | publishing Skill, Memory, Workspace semantics, Translation, node drafting, MCP adapter capability and Token & Usage |

Full text, evidence and current interpretation: `docs/n8n-lego/decisions/cross-agent-decisions.json`
(the register is the source; this table is a map).

## 5. What may never be reopened silently

- A resolved row (XA-1, XA-2, XA-3, XA-4, XA-6, XA-7) is not reopened by a branch choosing different
  words; reopening means a new row with evidence.
- The 26-domain count (A-1) and the official LEGO list (A-2) come from the registry and the manager;
  a branch may document them, never redefine them.
- A `publicationPending` record is replaced by a **published contract**, not by a nicer guess.
- The frontend never resolves a Manager question to make a UI look finished.
