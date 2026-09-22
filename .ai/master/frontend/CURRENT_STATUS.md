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
| `node --test packages/frontend-lego/test/*.test.mjs` | **298 tests across 31 suites: 297 pass, 1 skip** (the Skill drift comparison needs a tree that publishes `manifest/skill.json`), **0 fail** |
| `N8N_LEGO_CATALOG_DIR=<pinned catalog> node --test apps/n8n-lego/test/*.test.mjs` | 399/399 (396/399 without the catalog: three node-catalog suites need it) |
| `node apps/n8n-lego/scripts/capture-frontend-evidence.mjs` | 55/55 PASS (incl. the P2.12 Skill surface) |
| `N8N_BACKEND_LEGO_ROOT=<agent-2 P2.12 tree> node --test .../test/{29-alignment,31-skills}.test.mjs` | 22/22, 0 skipped — every difference between the quoted vocabulary and the moved declarations is reported and registered (`XA-19`); a path without a backend **fails**, it never skips |
| `python3 tools/sublego-audit/audit.py` | AUDIT PASSED (12 LEGOs, 20 Sub-LEGOs, 5 Agents) |
| `npm run verify:fast` | 5/10 with the workspace bare; **7/10** once `packages/workflow-lego/node_modules` is installed (G01–G07 pass, G06/G07 being the two TypeScript builds). G08–G10 need a *live reference runtime* (`.runtime/node_modules` or `/home/user/.n8n-live/node_modules` with `n8n-workflow` + `n8n-core`), which is the workflow/Rust track's environment — `KNOWN_BLOCKERS.md` BL-3. No browser-parity claim is made from this sandbox. |

## 4. Readiness — the honest version

| Area | State | Evidence |
| :--- | :--- | :--- |
| Frontend architecture / contracts / gates | **ready** | the gates above |
| AI Foundation | **contract-only** — declared, not implemented | `ai.foundation@1.0.0`, status `contract-only` |
| AI experiences (Assistant, Copilot, AI Node, Execution AI mode) | **specified, not built** | `.ai/master/AI_UI_*` |
| Agent Machine | **contracts only**, no runtime | `AGENT_MACHINE_PLAN.md` |
| Multi-process / multi-instance scale-out | **NOT READY** | `KNOWN_BLOCKERS.md` BL-1 (process-local execution ids), BL-2 (local JSON is the system of record), BL-4 (cross-agent vocabulary arbitration, incl. `XA-19`) |
| Browser/isolation profile gates | **unproven locally** | `KNOWN_BLOCKERS.md` BL-3 — `npm run verify:fast` = 5/10 in the dev sandbox; `tests/e2e/frontend-boundary.mjs` runs in CI |
| Control plane (jobs/tasks) | **no in-repo activation evidence** — not claimed operational | `KNOWN_BLOCKERS.md` BL-6 |

## 5. This change

**P2.12 (agent-1, this branch).** The frontend consumes the Skill vocabulary the backend declares
(`manifest/ai-lego-set.json#id=skill`, quoted through the vocabulary lock) and renders **discovery and
state presentation only**: six lifecycle states as six facts, progressive disclosure, search/filter/detail,
the canonical unsupported answer (`capability-unavailable` / `lego.capability_unavailable`, decision
`XA-11`) while `ai.skill` has no contract-lock row, and a compatibility verdict that names what was
required, what was offered and whether the two could be compared. A declaration that moved past the
quote — agent-2's P2.12 tree changed the operation list and claimed `ai.skill@1.0.0` — is **reported as
drift and registered (`XA-19`)**, never adopted. Files: `src/skills.mjs`, `manifest/skills.json`,
`test/31-skills.test.mjs` (15 tests), contract §19.18, conformance rule A27.

Master set measured by `test/30-master-plan.test.mjs` (the authority): **28 documents, 206,832 B of a
262,144 B budget**, largest `AI_UI_EXPERIENCE_MASTER_PLAN.md` at 23,141 B of a 32,768 B per-file cap.
Boot payload byte-identical at **18,126 B**; retrieval pack **81,881 B of 80 KB** — 39 B of headroom, so
this view stays terse on purpose.

## 6. What a new agent should read, in order

1. `.ai/README.md` -> `.ai/constitution.md` (hard rules, what is out of scope).
2. `.ai/master/PROJECT_MASTER_PLAN.md` (what the project is, who owns what, the 26 domains).
3. `.ai/master/CURRENT_STATUS.md` (this file) and `.ai/master/KNOWN_BLOCKERS.md`.
4. The area document you need (`AI_*`, `AGENT_MACHINE_PLAN`, `WORKSPACE_AND_EXTERNAL_ACTION_PLAN`, ...).
5. `docs/n8n-lego/decisions/cross-agent-decisions.json` for anything cross-agent, and
   `.ai/cards/recipes.md` for the exact commands of a task shape.
