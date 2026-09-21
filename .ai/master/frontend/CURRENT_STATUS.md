<!-- PRESERVED from agent-1 @ 8c299609 during the P2.11 reconciliation. Curated: not generated, not deleted by `npm run lego:ai`. -->
> **This is the frontend consumption view, not the canonical document.**
>
> The canonical, manifest-derived document for this subject is
> [`../CURRENT_STATUS.md`](../CURRENT_STATUS.md). Where the two disagree on a *number*, the canonical
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

# Current status

**Status:** living record. **Owner:** agent-01 (frontend) for the frontend rows; manager/agent-2 for
the backend rows. **Update rule:** this document is updated when an architecture milestone lands, and
its numbers are **verified**, never remembered. If a number here disagrees with a registry, the
registry wins and this file is a defect.

---

## 1. Baselines and heads

| Ref | Commit | Notes |
| :--- | :--- | :--- |
| `main` (protected) | `cb71dbb201d635b15b49933764c2c2336e745809` | never modified, never force-pushed |
| agent-1 branch `arena/01a0c53e-n8n-rust-v-4` | `396cd499` (platform/deployment strategy, registry-verified tables) on top of `b11dbc9e` <- `83afdddd` <- `bdd0f1d2` | frontend + compatibility + project memory |
| agent-2 branch `arena/01a0c521-n8n-rust-v-4` | `6f7b66daec9b90c33cc13ab5e7538ef931174c09` | P2.10 — capability contracts, operation vocabulary, AI Foundation contracts |

## 2. The architecture as declared today

| Fact | Value | Source of truth |
| :--- | :--- | :--- |
| core LEGO domains | **26** (8 implemented, 5 partial, 7 planned, 1 contract-only, 1 legacy, 4 template) | `domains.json` @ `6f7b66da` |
| capabilities | **82**, of which **62** publish `operations[]` | `domains.json` |
| contract rows | **14** (incl. `ai.foundation@1.0.0`, manager) | `contract-lock.json` |
| AI contract set | `ai.foundation@1.0.0`, status `contract-only`, 11 `ai.*` capabilities, 5 provider kinds, 26 event types | `manifest/ai-foundation.json` |
| official AI/Agent LEGO | **15** — 2 published, 6 declared `contract-only`, 2 partial (gated), 5 `publicationPending` | `AI_AGENT_LEGO_MASTER_PLAN.md` §1, `PROJECT_MASTER_PLAN.md` §4 |
| frontend vocabulary lock | 38 canonical sets + 22 local sets, provenance-pinned | `packages/frontend-lego/src/vocabulary.mjs` |
| seam | 7 declared sources, 7 forbidden sources, 13 inputs, 16-field identity | `src/seam.mjs`, `CORE_LEGO_ARCHITECTURE.md` |
| operation outcomes | 12, never collapsed | `src/negotiation.mjs` |
| AI event vocabulary | 26 types / 7 namespaces | `src/agent-events.mjs` |
| work trace | 18 fields, 200-row bound, reference-only, no chain-of-thought | `src/agent-events.mjs` |
| frontend AI capabilities | 6 declared, none installed, no entry path | `manifest/capabilities.json` |
| boot payload | 18,126 B JSON (budget 32 KB), no AI metadata inside | evidence report |
| runtime dependencies | 0 | `packages/frontend-lego/package.json` |

## 3. Gates (as last run)

| Gate | Result |
| :--- | :--- |
| `node --test packages/frontend-lego/test/*.test.mjs` | **283 tests across 30 suites: 279 pass, 4 skip** (backend comparisons absent), **0 fail** |
| `node --test apps/n8n-lego/test/*.test.mjs` | 36/36 |
| `node apps/n8n-lego/scripts/capture-frontend-evidence.mjs` | 50/50 PASS |
| `N8N_BACKEND_LEGO_ROOT=<P2.10 tree> node --test .../test/29-alignment.test.mjs` | 7/7, 0 skipped — every canonical set compared against the backend, zero drift |
| `python3 tools/sublego-audit/audit.py` | AUDIT PASSED (12 LEGOs, 20 Sub-LEGOs, 5 Agents) |
| `npm run verify:fast` | 5/10 — G06-G10 require `packages/workflow-lego/node_modules` (B-10) |

## 4. Readiness — the honest version

| Area | State | Evidence |
| :--- | :--- | :--- |
| Frontend architecture / contracts / gates | **ready** | the gates above |
| AI Foundation | **contract-only** — declared, not implemented | `ai.foundation@1.0.0`, status `contract-only` |
| AI experiences (Assistant, Copilot, AI Node, Execution AI mode) | **specified, not built** | `.ai/master/AI_UI_*` |
| Agent Machine | **contracts only**, no runtime | `AGENT_MACHINE_PLAN.md` |
| Multi-process / multi-instance scale-out | **NOT READY** | `KNOWN_BLOCKERS.md §1` (B-1, B-2, B-3) |
| Browser/isolation profile gates | **unproven locally** | `npm run verify:fast` = 5/10 (B-10) |
| Control plane (jobs/tasks) | **no in-repo activation evidence** — not claimed operational | B-12 |

## 5. This change

Adds the master documentation set (`.ai/master/`, **28 documents**, ≈190 KB of a 262,144 B budget (≈228 KB of headroom), largest document ≈23 KB of a
32,768 B per-file cap — the exact bytes and both limits are asserted by `test/30-master-plan.test.mjs`,
which is the authority; the figures here are rounded on purpose so they cannot drift) with its own gate (`test/30-master-plan.test.mjs`, now
18 tests), the 26-domain correction — the domain table is a **generated projection** of `domains.json`
@ `6f7b66da`, not prose — the platform/deployment strategy (four deployment modes, low-resource and
Termux viability, STREAM backpressure, the Rust-by-measurement rule), the recorded decision that
Universal Translation is an official LEGO target, the corrected fifteen-LEGO publication counts
(2 published, 6 declared `contract-only`, 2 partial and gated, 5 `publicationPending`), the extended
open-decision register (`recordVersion 1.1.0`, 18 rows), the thirty-question **reading test** a new
agent must be able to satisfy from this tree alone, and the blocker/status registers. It changes **no**
runtime, **no** contract and **no** boot payload: the boot descriptor is byte-identical at 18,126 B,
the retrieval pack is unchanged at 81,678 B (242 B headroom), and the only test expectation added is
test/30 itself.

Verified after the change: frontend **283 / 279 / 0 fail / 4 skip** across 30 suites (test/30
**18/18**); app **36/36**; `test/29` against the P2.10 tree **7/7, 0 skipped**; evidence **50/50**
(JSON regenerated); sub-LEGO audit **PASSED**; `verify:fast` **5/10** (the unchanged baseline, B-10).

## 6. What a new agent should read, in order

1. `.ai/README.md` -> `.ai/constitution.md` (hard rules, what is out of scope).
2. `.ai/master/PROJECT_MASTER_PLAN.md` (what the project is, who owns what, the 26 domains).
3. `.ai/master/CURRENT_STATUS.md` (this file) and `.ai/master/KNOWN_BLOCKERS.md`.
4. The area document you need (`AI_*`, `AGENT_MACHINE_PLAN`, `WORKSPACE_AND_EXTERNAL_ACTION_PLAN`, ...).
5. `docs/n8n-lego/decisions/cross-agent-decisions.json` for anything cross-agent, and
   `.ai/cards/recipes.md` for the exact commands of a task shape.
