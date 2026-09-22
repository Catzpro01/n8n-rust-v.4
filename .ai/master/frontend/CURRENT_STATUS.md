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
| official AI/Agent LEGO | **15** — 3 published (incl. Skill, `ai.skill@1.0.0`), 6 declared `contract-only`, 2 partial (gated), 4 `publicationPending` | `AI_AGENT_LEGO_MASTER_PLAN.md` §1, `PROJECT_MASTER_PLAN.md` §4 |
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
| `node --test packages/frontend-lego/test/*.test.mjs` | **303 tests across 31 suites: 301 pass, 2 skip, 0 fail.** The two skips are the Skill comparisons that need a tree publishing `ai.skill@1.0.0`; on this branch the local backend copy predates the finalize (no lock row), and the alignment test states which sets it deferred instead of reporting a pass it did not perform |
| `N8N_LEGO_CATALOG_DIR=<pinned catalog> node --test apps/n8n-lego/test/*.test.mjs` | 399/399 (396/399 without the catalog: three node-catalog suites need it) |
| `node apps/n8n-lego/scripts/capture-frontend-evidence.mjs` | **56/56 PASS** (incl. the published Skill contract and the four consumed operations); boot payload byte-identical at 18,126 B |
| `N8N_BACKEND_LEGO_ROOT=<published tree @ `d0a338e4`> node --test .../test/{29-alignment,31-skills}.test.mjs` | **27/27, 0 skipped, Skill drift = 0** — the four operations, six states, disclosure levels, permissions and the lock row agree exactly with `ai.skill@1.0.0`; a path without a backend **fails**, it never skips |
| `python3 tools/sublego-audit/audit.py` | AUDIT PASSED (12 LEGOs, 20 Sub-LEGOs, 5 Agents) |
| `npm run verify:fast` | 5/10 with the workspace bare; **7/10** once `packages/workflow-lego/node_modules` is installed (G01–G07 pass, G06/G07 being the two TypeScript builds). G08–G10 need a *live reference runtime* (`.runtime/node_modules` or `/home/user/.n8n-live/node_modules` with `n8n-workflow` + `n8n-core`), which is the workflow/Rust track's environment — `KNOWN_BLOCKERS.md` BL-3. No browser-parity claim is made from this sandbox. |

## 4. Readiness — the honest version

| Area | State | Evidence |
| :--- | :--- | :--- |
| Frontend architecture / contracts / gates | **ready** | the gates above |
| AI Foundation | **contract-only** — declared, not implemented | `ai.foundation@1.0.0`, status `contract-only` |
| AI experiences (Assistant, Copilot, AI Node, Execution AI mode) | **specified, not built** | `.ai/master/AI_UI_*` |
| Agent Machine | **contracts only**, no runtime | `AGENT_MACHINE_PLAN.md` |
| Multi-process / multi-instance scale-out | **NOT READY** | `KNOWN_BLOCKERS.md` BL-1 (process-local execution ids), BL-2 (local JSON is the system of record), BL-4 (cross-agent vocabulary arbitration — `XA-19` is resolved, `XA-11` … `XA-18` are not) |
| Browser/isolation profile gates | **unproven locally** | `KNOWN_BLOCKERS.md` BL-3 — `npm run verify:fast` = 5/10 in the dev sandbox; `tests/e2e/frontend-boundary.mjs` runs in CI |
| Control plane (jobs/tasks) | **no in-repo activation evidence** — not claimed operational | `KNOWN_BLOCKERS.md` BL-6 |

## 5. This change

**P2.12 finalize (agent-1, this branch).** The backend published `ai.skill@1.0.0` in the contract lock
(`arena/01a0c521 @ d0a338e4`, owner manager, domain `ai-foundation`, status `implemented`) and `XA-19`
was resolved by adopting the **implemented** shape. The frontend now consumes exactly that contract:
the four caller operations (`skill.list`, `skill.resolve`, `skill.describe`, `skill.validate-selection`),
the six lifecycle states as six independent facts, the four disclosure levels and the two permission
words. `register`, `select`, `load` and `release` stay internal registry lifecycle methods — `load` is
deliberately not published, because publishing it would make lazy discovery a caller's concern — and
there is no `execute` operation and no `ai:skill:execute` permission at any layer. The tolerated
differences are gone: `REGISTERED_DRIFT` is empty, the four Skill sets now quote the lock row, and a
difference fails the gate instead of being registered after the fact. `XA-11` stays **open-for-manager**
for the modelling question (whether Skill belongs under `ai-foundation`). Files: `src/skills.mjs`,
`src/vocabulary.mjs`, `manifest/skills.json`, `test/29-alignment.test.mjs`, `test/31-skills.test.mjs`
(19 tests), contract §19.18, conformance rule A27.

Master set measured by `test/30-master-plan.test.mjs` (the authority): **28 documents, 210,253 B of a
262,144 B budget**, largest `AI_UI_EXPERIENCE_MASTER_PLAN.md` at 23,212 B of a 32,768 B per-file cap.
Boot payload byte-identical at **18,126 B**; retrieval pack **81,877 B of 80 KB** — 43 B of headroom, so
this view stays terse on purpose. Backend counts read from this branch's copy of the tree are still the
pre-finalize ones (14 contract rows, 82 capabilities); the published tree reports 15 rows, 83
capabilities and 143 operations.

## 6. What a new agent should read, in order

1. `.ai/README.md` -> `.ai/constitution.md` (hard rules, what is out of scope).
2. `.ai/master/PROJECT_MASTER_PLAN.md` (what the project is, who owns what, the 26 domains).
3. `.ai/master/CURRENT_STATUS.md` (this file) and `.ai/master/KNOWN_BLOCKERS.md`.
4. The area document you need (`AI_*`, `AGENT_MACHINE_PLAN`, `WORKSPACE_AND_EXTERNAL_ACTION_PLAN`, ...).
5. `docs/n8n-lego/decisions/cross-agent-decisions.json` for anything cross-agent, and
   `.ai/cards/recipes.md` for the exact commands of a task shape.
