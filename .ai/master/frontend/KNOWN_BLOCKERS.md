<!-- Curated (agent-1). Preserved from the P2.11 reconciliation; B-13 and B-14 added at P2.13 (2026-09-22, main @ e754c5df). Not generated, not deleted by `npm run lego:ai`. -->
> **This is the frontend consumption view, not the canonical document.**
>
> The canonical, manifest-derived document for this subject is
> [`../KNOWN_BLOCKERS.md`](../KNOWN_BLOCKERS.md). Where the two disagree on a *number*, the canonical
> document wins: its figures are generated from the manifests at build time,
> whereas this view was hand-written against backend baseline `6f7b66da` (P2.10)
> and is **not** updated by regeneration.
>
> Known differences at the time of reconciliation: XA-5 is **closed** (the eleven
> `lego.*` codes are published), the operation count is **not 173**, and gate rules
> run through **F17**.
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

# Known blockers

**Status:** record. **Owner:** whoever owns the blocked artifact (named per row); the manager
arbitrates anything cross-domain. **Rule:** a blocker is never silently converted into "done", and a
blocker is never downgraded to make a status document look complete. Evidence is a file, a line or a
test — not a feeling.

---

## 1. Scale-out: **NOT READY** (class-A blockers)

The project must not claim multi-process or multi-instance production readiness while these stand.

| # | Blocker | Evidence | Consequence | Owner |
| :-- | :--- | :--- | :--- | :--- |
| B-1 | Execution id allocation is process-local | `apps/n8n-lego/src/store.mjs` → `newExecutionId()` returns `String(nextExecutionCounter())` from an **in-process** counter | two instances (or a restart) can mint the same id; ids are not durable identity | agent-2 (`storage` / `execution` domains) |
| B-2 | The local JSON file is the system of record | `store.mjs` header: "`file` (default, atomic JSON writes … good enough for a single instance on a small VPS)"; `memory` backend is throwaway | no shared persistence; a second process cannot see the first's state | agent-2 (`storage`) |
| B-3 | No durable/shared persistence contract yet | `storage` domain is `implemented` but the domain registry declares no storage contract row that promises shared persistence | consumers cannot rely on a shared backend existing | manager + agent-2 |

Intended long-term boundary (not implemented): **storage contract → durable identity allocation →
shared persistence implementation**, with the implementation progressing `local → SQLite → Postgres`
(or another shared backend) **without consumers changing**. Nobody may mark scale-out ready by
implementing one of these three without the others.

## 2. Backend/publication blockers (cross-agent)

| # | Blocker | Evidence | What stays blocked | Owner |
| :-- | :--- | :--- | :--- | :--- |
| B-4 | `lego.*` degradation codes are named but published by no contract | `interaction.mjs` actions name `lego.capability_unavailable` and friends; neither `domains.json` nor `errors.contract.json` declares a `lego` namespace | the UI shows the declared action text verbatim; a code-based UI path stays unavailable | agent-2 (XA-5) |
| B-5 | Permission namespace split (`ai:*` vs the frontend's view words) | published AI operations require `ai:*`; the six frontend AI capabilities declare five view words | no rename until the manager rules | manager (XA-8) |
| B-6 | `manifest/foundation.json` has no publishing contract | `contract-lock.json` has no row for it; `domains.json → foundation.vocabulary` names it | trust/resource/device/transport-target words carry a `publicationPending` record instead of a pinned version | manager (XA-9) |
| B-7 | Two application-permission namespaces | `ai:app:*` (operations) vs `app:github:*` (application vocabulary) | both sets stay separate and are never treated as interchangeable | manager (XA-10) |
| B-8 | Six official AI/Agent LEGO are unpublished | no `skill`, no `memory`, no `translation`, no `ai.usage`, no `ai.mcp-adapter`, no node-drafting capability in `domains.json` or the lock | their UI surfaces are specified and gated: `capability-unavailable` / `feature-unsupported`, never mocks | manager (XA-11 … XA-17) |
| B-13 | **Context & Session is declared in four places and locked in none** | `contracts/contract-lock.json` @ `e754c5df` holds **15** rows and none is `ai.context` or `ai.agent-session`, while `manifest/ai-foundation.json` declares both shapes (7 scopes, 9 context fields; 10 session fields, 3 references, 7 states), `manifest/domains.json` registers both capabilities `contract-only` with 5 operations and 5 permissions, and `manifest/ai-lego-set.json` **claims** `ai.context@1.0.0, ai.agent-session@1.0.0` | the frontend quotes the fields, scopes, states, sections and operations it can cite and reports the pair as `declared-not-locked`; it renders **no version**, keeps the rollover phase machine (`NORMAL → PREPARE → ROLLOVER`) and the verification results (`verified / degraded / failed`) in `PENDING_PUBLICATIONS`, and answers `Continue session`, `rollover`, `rehydrate` and `verify` as `operation-unpublished`. P2.14 (Memory), P2.24 (Token & Usage) and the Agent Machine all consume the same unpublished vocabulary | manager (**XA-20**) — options A–D in `docs/n8n-lego/decisions/XA-20-context-session-publication.md` |
| B-9 | Legacy i18n ownership is unresolved | `domains.json → legacy.unresolvedOwnership` (the top-level `legacy` block, *not* the `legacy-rest` domain): `/rest/credential-translation`, `/rest/node-translation-headers` are constant empty objects with no business logic; the registry's own `why` still says the project decided **not** to build a Translation LEGO — an assumption superseded by `PROJECT_DECISIONS.md` and XA-14 | translation must not be forced into `credentials`, `node-registry` or `workflow`; the decision belongs to the manager (XA-14), and until it lands the registry rationale above is stale text, not policy | manager + agent-2 |

## 3. Environment / verification blockers

| # | Blocker | Evidence | Effect |
| :-- | :--- | :--- | :--- |
| B-10 | Linux/browser profile verification is partly unavailable in the local environment | `npm run verify:fast` = 5/10: G06–G10 need `packages/workflow-lego/node_modules`, which is not installed here. The same absence empties `apps/n8n-lego/node_modules/n8n-editor-ui/dist`, so three page-level checks in the frontend evidence capture cannot run (`boot meta tag present on index.html`, `meta tag and endpoint carry the same descriptor`, `stock UI still templated`) and `tools/sublego-audit/audit.py` cannot import `yaml` | the isolation/browser profile gates are unproven locally and the evidence capture reports **52/56** instead of 56/56; the run rewrites `docs/isolation/*`, which is why those files are reverted after the run. These are environmental: all three page checks PASS at `e754c5df` where the bundle is installed, and none is a code regression |
| B-11 | The Rust backend tree is not on this branch | `test/29-alignment.test.mjs` reports 4 skips by default and 7/7 with `N8N_BACKEND_LEGO_ROOT` pointing at the P2.10 tree | the vocabulary lock is compared for real only when the backend tree is present; a *wrong* path fails instead of skipping |
| B-14 | The descriptor-assembly heap pin is exhausted by surface growth | `capture-frontend-evidence.mjs:204` asserts `cost.kb < 4096`; `frontend-boundary-p25.json` @ `e754c5df` records **3,780 KB** (56/56 PASS) and the P2.13 run (`docs/n8n-lego/evidence/frontend-boundary-p213-run.json`) measures **4,251 KB** → FAIL. Retained growth measured with GC: `context-session.mjs` +243 KB, `vocabulary.mjs` +88 KB, `manifests.mjs` +15 KB, `lego.mjs` +13 KB. The boot payload is unchanged at 18,126 B and the time budget is untouched (49.7 ms of 250 ms) | one evidence check of 56 is red, and P2.14 (Memory) cannot fit a third AI surface on the same eager import path. The pin was **not** edited — a gate is not edited to make a run green — so the check is reported FAIL with its measurement and the view is built on demand instead of eagerly | manager (**XA-21**) — options A–D in `docs/n8n-lego/decisions/XA-21-assembly-heap-budget.md` |
| B-12 | No in-repo evidence of an active external control plane | nothing in this repository declares a Supabase schema or RPC as active | **do not claim a control-plane path is operational.** Control-plane state (jobs, tasks, claims, coordination) is metadata, never code authority; if an activation is required, it is a blocker recorded here until someone can point at it |

## 3b. Read this with

- `CURRENT_STATUS.md` — the readiness table this document makes honest.
- `PROJECT_DECISIONS.md` — the decisions behind each row (A-*, XA-*).
- `PROJECT_MASTER_PLAN.md` — ownership, so a blocker can be routed to the right agent.
- `docs/n8n-lego/decisions/cross-agent-decisions.json` — the machine-readable decision register
  (21 rows, 13 open at P2.13).
- `docs/n8n-lego/milestones.json` — the canonical milestone register: status, boundary, dependencies,
  known limitations and the merge protocol for each milestone.
- `docs/n8n-lego/decisions/XA-20-context-session-publication.md` and
  `docs/n8n-lego/decisions/XA-21-assembly-heap-budget.md` — the two arbitration packages P2.13 filed.

## 4. Blocker handling rules

1. A blocker row names an **owner** and the artifact that carries it, so it can be verified.
2. Fixing a blocker updates the row with the evidence that fixed it — the row is not deleted.
3. A phase report may not describe a blocked area as complete; it cites this document.
4. A blocker that requires a decision (not work) is recorded in
   `docs/n8n-lego/decisions/cross-agent-decisions.json` and linked here.
5. A newly discovered blocker is added here in the same change that discovers it.
6. A blocker that is a **resource budget** rather than a missing decision (B-14) is still a blocker:
   it is measured, escalated and reported red until it is ruled on. Reporting 52/56 honestly beats
   reporting 56/56 after editing the pin.
