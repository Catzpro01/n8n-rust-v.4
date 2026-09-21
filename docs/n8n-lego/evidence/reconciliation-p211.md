# P2.11 reconciliation record — agent-1 (frontend) into agent-2's backend tree

**Recorded:** 2026-09-22 · **Branch:** `arena/01a0c53e-n8n-rust-v-4` · **Author:** agent-1
(frontend + compatibility, owner of `packages/frontend-lego`, the frontend AI UI specification and
the frontend evidence).

This record is the durable half of the reconciliation report: every number below is measured in the
tree, not summarised from a chat message. Byte-for-byte traceability: `git diff <base> <head>`.

## 1. Exact commits

| Role | Commit | Note |
| :--- | :--- | :--- |
| Base (agent-1 branch tip) | `8c299609` | "master docs: artifact retention quoted from the contract…" |
| Agent-2 backend authority | `464c1216` | P2.11 "the repository as project memory — master plan, AI LEGO set, governance" |
| Reconciliation commit 1 | `bf0920e5` | the backend tree + the master memory, one canonical answer per subject |
| Reconciliation commit 2 | `4934aae7` | the documents and the workflow union instead of picking a side |
| Reconciliation commit 3 | `dc0442f2` | the id collision, XA-5 closed, this record |
| Reconciliation commit 4 | `de61abeb` | the executable reader test (30 questions) |

**There is no merge base.** `git merge-base 8c299609 464c1216` is empty: agent-2's branch
`arena/01a0c521-n8n-rust-v-4` is a separate history (352 commits, root `f4e6edef`… see §7) that
does not share an ancestor with `main` (`cb71dbb2`). The reconciliation is therefore a **reviewed
file-level import**, not a git merge — and it is not a cherry-pick, because the two trees disagree
about files that both changed.

Scale: `git diff --shortstat 8c299609 <head>` → 150+ files changed, ~27.9k insertions, ~1.5k
deletions; 119 files added, 31 modified.

## 2. Files merged (from `464c1216`)

* `apps/n8n-lego/src/lego/**` — registry, AI Foundation contracts (`ai-foundation.mjs`,
  `manifest/ai-foundation.json`, 11 contract-only capabilities), contract lock (14 rows),
  error contract (35 codes, F16), domains/surface aliases (26 domains), node contract, reference
  LEGO, negotiation/envelope/interaction/foundation modules.
* `apps/n8n-lego/test/**` — the P2.6–P2.11 suites, including F17 (`lego-ai-set.test.mjs`) and the
  capability-contract conformance suite. 392 tests.
* `apps/n8n-lego/scripts/fetch-n8n-*.mjs`, `bin/**`, `src/**` — the backend application itself.
* `tools/lego/**` — architecture gate (+selftest), capability conformance, foundation gate
  (+selftest), scale-out readiness, impact graph, planner, AI pack generator.
* `docs/architecture/adr/ADR-0001…ADR-0011`, `docs/n8n-lego/BACKEND_LEGO.md`,
  `docs/n8n-lego/LEGO_INTEGRATION_NOTES.md`, `docs/n8n-lego/evidence/backend-lego-p2*.json`,
  `docs/n8n-lego/decisions/cross-agent-decisions.backend.json`.
* `.github/workflows/n8n-lego.yml` (their architecture job + gate job; the frontend package and
  suite added to both), `scripts/release.sh` (frontend LEGO vendoring kept),
  `tools/rust-offline-rig/**` (their version — the Rust port stays LOCKED).

## 3. Files intentionally excluded

`git diff --name-status HEAD origin/a2` reports **0 files** present in agent-2's tree and missing
here: nothing was silently dropped. What is *not* adopted is narrower:

| Not adopted | Why |
| :--- | :--- |
| agent-2's version of 18 shared files (`.ai/**`, `apps/n8n-lego/src/{ui,server}.mjs`, `domains.json`, `package.json`, `tools/lego/ai-pack.mjs`, `contracts/micro-frontend.contract.md`, `docs/n8n-lego/{FRONTEND_COMPATIBILITY,ROADMAP}.md`, …) | each is the deliberate superset described in §4; adopting their copy would have deleted the frontend mount, the frontend contract, the frontend evidence and the frontend master documents |
| the removal of the frontend boot descriptor from `ui.mjs`/`server.mjs` | the descriptor is a shipped, tested frontend surface (`GET /rest/frontend/bootstrap` + the additive `<meta>` tag) |
| `.ai/**` regeneration instead of import | `.ai/` is generated; the generator preserves the frontend pack and the hand-written documents, and `npm run lego:ai:check` proves the result is in sync |

## 4. Conflicts resolved

1. **The frontend mount.** Agent-2's `ui.mjs`/`server.mjs` dropped the descriptor loader. Restored;
   the app serves the descriptor and the boot tag, and the stock bundle stays byte-identical.
2. **Measured coupling instead of a declared excuse.** `src/frontend.mjs` read `process.env` at
   module scope (an undeclared scale-out finding). It now takes the injected environment; the
   composition root passes it. The descriptor **route family** (`src/frontend/routes.mjs`) is owned
   by `compatibility` (the wire boundary) while the loader stays with `editor-ui-host` — recorded in
   `domains.json` and as **XA-19**, because claiming both under one domain produced a real R2
   forbidden-direction finding.
3. **Master documents.** Both agents wrote `.ai/master/`. Resolution: one canonical document per
   subject, with the union kept (see §5). Generated backend documents carry the generator banner and
   name their owner; hand-written frontend documents say they are hand-written.
4. **`constitution.md` said "six-language translation features" are out of scope.** Superseded:
   Universal Translation is an official AI/Agent LEGO target (XA-23), and the legacy i18n ownership
   question stays open in `domains.json → legacy.unresolvedOwnership`.
5. **Decision-id collision.** Both agents allocated `XA-11…XA-14` for different questions. Agent-2
   published first; the frontend rows moved (`XA-11→XA-20` skill, `XA-12→XA-21` memory,
   `XA-13→XA-22` workspace, `XA-14→XA-23` translation) with a recorded map in the frontend register
   (`renumbering`), and `XA-5` was closed by agent-2's F16 publication.
6. **Workflow / ROADMAP / `package.json` / `my_progress.md`.** Union, not a winner: the architecture
   job *and* the frontend suite; both roadmaps' tracks; both script sets; agent-2's unique progress
   lines appended verbatim.
7. **`.ai/` ownership.** `tools/lego/ai-pack.mjs` now preserves the frontend-owned paths
   (`README.md`, `frontend/`, `cards/`, `index/`, `maps/`, the hand-written `master/*.md`) instead of
   deleting them on regeneration, and the frontend paths are not reported as orphans.

## 5. Canonical documents selected

31 documents in `.ai/master/`: 11 generated from the manifests by agent-2's generator, 20
hand-written. One canonical document per subject:

| Subject | Canonical document | Nature |
| :--- | :--- | :--- |
| Project overview, index, the reader test | `PROJECT_MASTER_PLAN.md` | generated |
| Core LEGO architecture, domains, contracts | `CORE_LEGO_ARCHITECTURE.md` | generated |
| AI/Agent LEGO set, F17 reconciliation | `AI_AGENT_LEGO_MASTER_PLAN.md` | generated |
| Contracts by version | `AI_CONTRACT_MATRIX.md` | generated |
| Runtime and provider plan | `AI_RUNTIME_AND_PROVIDER_PLAN.md`, `PROVIDER_TAXONOMY.md` | generated + hand-written view |
| What is true today | `CURRENT_STATUS.md`, `FRONTEND_STATUS.md` | generated + hand-written |
| Blockers | `KNOWN_BLOCKERS.md` | generated |
| Decisions and arbitration | `PROJECT_DECISIONS.md` (backend), `docs/n8n-lego/decisions/cross-agent-decisions.json` (frontend) | generated + hand-written |
| Phases | `IMPLEMENTATION_PHASES.md`, `AI_UI_IMPLEMENTATION_PHASES.md` | generated + hand-written |
| Scenarios | `REFERENCE_AGENT_SCENARIOS.md` | generated |
| Development workflow (not product architecture) | `PROJECT_WORKFORCE_ORCHESTRATION.md` | generated |
| AI Assistant / Copilot / AI Node experience | `AI_UI_EXPERIENCE_MASTER_PLAN.md` | hand-written |
| UI states, disclosure, a11y/l10n, frontend contracts | `AI_UI_STATES_AND_FLOWS.md`, `AI_UX_PROGRESSIVE_DISCLOSURE.md`, `AI_ACCESSIBILITY_AND_LOCALIZATION.md`, `AI_FRONTEND_CONTRACT_MATRIX.md` | hand-written |
| Agent machine, skills, context/session/memory, tokens | `AGENT_MACHINE_PLAN.md`, `SKILL_AND_CAPABILITY_PLAN.md`, `CONTEXT_SESSION_MEMORY_PLAN.md`, `MEMORY_GRAPH_OBSIDIAN_PLAN.md`, `TOKEN_USAGE_AND_RESOURCE_PLAN.md` | hand-written |
| Workspace and external actions | `WORKSPACE_AND_EXTERNAL_ACTION_PLAN.md` | hand-written |
| MCP / runtime adapter, node creator, translation | `MCP_AND_RUNTIME_ADAPTER_PLAN.md`, `NODE_CREATOR_PLAN.md`, `TRANSLATION_PLAN.md` | hand-written |
| Security and approval | `SECURITY_AND_APPROVAL_MODEL.md` | hand-written |
| Platform, deployment, resources, Rust policy | `PLATFORM_AND_DEPLOYMENT_STRATEGY.md` | hand-written |
| Frontend hard stops | `FRONTEND_CONSTITUTION.md` | hand-written |

Budget: 31 documents, ~227 KB of a 512 KB budget, largest ~29 KB of a 32,768 B per-file cap —
asserted by `test/30-master-plan.test.mjs`, which is the authority for these numbers. The retrieval
pack (`.ai/index*`, `.ai/domains/*`, `.ai/recipes/*`, `.ai/frontend/*`, `.ai/cards/*`, `.ai/maps/*`)
stays inside its own 81,920 B budget and is regenerated, never merged.

## 6. Canonical counts (measured)

| Count | Value | Where verified |
| :--- | :--- | :--- |
| Core domains | 26 (8 implemented / 5 partial / 7 planned / 1 contract-only / 1 legacy / 4 template) | `manifest/domains.json` |
| Capabilities | 82 (62 with published operations) | `manifest/domains.json` |
| Operations | **139** — never 173, and no document claims otherwise | `manifest/domains.json` |
| Published error codes | 35 (F16 added the 11 `lego.*` codes) | `contracts/errors.contract.json` |
| Locked contracts | 14 | `contracts/contract-lock.json` |
| Temporary boundary allowances | 1 | `manifest/domains.json` |
| Official AI/Agent LEGO | **15** | `manifest/ai-lego-set.json`, F17 test |
| LEGOs / Sub-LEGOs / Agents | 12 / 20 / 5 | sub-LEGO audit |
| Boot payload | 18,126 B JSON — unchanged by this reconciliation | frontend evidence |

No document in the merged tree claims 25 domains or 173 operations.

## 7. Test results (all run in the merged tree)

| Gate | Result |
| :--- | :--- |
| `node --test packages/frontend-lego/test/*.test.mjs` | **275 / 275 pass, 0 fail, 0 skipped** (30 suites) |
| `node --test apps/n8n-lego/test/*.test.mjs` (`npm run lego:gate`) | **392 / 392 pass, 0 fail** |
| `test/29-alignment` against `464c1216` (`N8N_BACKEND_LEGO_ROOT`) | **7 / 7**, 0 skipped, no vocabulary drift |
| `test/30-master-plan` | 10 / 10 — union, budget, canonical counts, no retired claim, boundary, reader test, registers |
| `node apps/n8n-lego/scripts/capture-frontend-evidence.mjs` | **50 / 50 PASS** |
| `python3 tools/sublego-audit/audit.py` | AUDIT PASSED — 100% bidirectional, 12 LEGOs / 20 Sub-LEGOs / 5 Agents |
| `npm run lego:arch` (+selftest), `lego:foundation`, `lego:capabilities`, `lego:scaleout` | OK — boundary, foundation, capability table, scale-out findings all declared/owned |
| `npm run lego:ai:check` | OK — `.ai/` in sync with the manifests (63 generated files) |

Negative tests were not weakened to pass: the gates above are the same ones that failed during the
merge (the R1 unowned-file and R2 forbidden-direction findings, the scale-out `process.env`
finding, and the frontend descriptor suite) and they were fixed in the code, not in the assertions.

## 8. Remaining blockers

* `BL-1` … `BL-6` (`KNOWN_BLOCKERS.md`) — class-A: process-local execution-id allocation and the
  local JSON system of record (both P8, agent-5), and their consequences. Scale-out stays
  **NOT READY**.
* Frontend environment blockers (`FRONTEND_STATUS.md` §3): `F-1` browser/isolation profile gates
  cannot be exercised in this sandbox (`verify:fast` 5/10); `F-2` the backend tree is compared
  through `N8N_BACKEND_LEGO_ROOT`, never vendored; `F-3` unpublished backend concepts are consumed
  as `publicationPending`.

## 9. Remaining decision ids

Frontend register (`cross-agent-decisions.json`): 19 rows — **7 resolved** (`XA-1`…`XA-7`, with
`XA-5` closed by agent-2's F16 publication) and **12 open-for-manager**: `XA-8`, `XA-9`, `XA-10`,
`XA-15`, `XA-16`, `XA-17`, `XA-18`, `XA-19`, `XA-20`, `XA-21`, `XA-22`, `XA-23`.
Renumbering map recorded in the register; next free id **`XA-24`**.
Agent-2's generated register adds `XA-11`…`XA-14` (AI LEGO ownership, MCP export list, translation
locale baseline, master documentation ownership) plus the unresolved ownership rows in
`domains.json → legacy.unresolvedOwnership` (i18n surfaces; `/rest/variables`).

## 10. Explicit confirmation: no AI runtime was implemented

Nothing in this reconciliation adds a runtime. There is no model inference, no provider client, no
model/tool gateway client, no agent runtime, no Agent Machine loop, no memory store, no skill
loader, no workspace engine, no MCP client or server, no runtime adapter, no Node Creator AI, no
translation runtime, no token or context optimiser, and no Rust (Rust stays LOCKED). The AI
surfaces are contracts, manifests, gates and documents: `ai-foundation` is `contract-only`, the
`ai.*` capabilities are `contract-only`, and the AI LEGO set of 15 is contract-only or planned.
