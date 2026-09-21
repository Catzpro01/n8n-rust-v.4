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
| B-9 | Legacy i18n ownership is unresolved | `domains.json → legacy.unresolvedOwnership` (the top-level `legacy` block, *not* the `legacy-rest` domain): `/rest/credential-translation`, `/rest/node-translation-headers` are constant empty objects with no business logic; the registry's own `why` still says the project decided **not** to build a Translation LEGO — an assumption superseded by `PROJECT_DECISIONS.md` and XA-14 | translation must not be forced into `credentials`, `node-registry` or `workflow`; the decision belongs to the manager (XA-14), and until it lands the registry rationale above is stale text, not policy | manager + agent-2 |

## 3. Environment / verification blockers

| # | Blocker | Evidence | Effect |
| :-- | :--- | :--- | :--- |
| B-10 | Linux/browser profile verification is partly unavailable in the local environment | `npm run verify:fast` = 5/10: G06–G10 need `packages/workflow-lego/node_modules`, which is not installed here | the isolation/browser profile gates are unproven locally; the run rewrites `docs/isolation/*`, which is why those files are reverted after the run |
| B-11 | The Rust backend tree is not on this branch | `test/29-alignment.test.mjs` reports 4 skips by default and 7/7 with `N8N_BACKEND_LEGO_ROOT` pointing at the P2.10 tree | the vocabulary lock is compared for real only when the backend tree is present; a *wrong* path fails instead of skipping |
| B-12 | No in-repo evidence of an active external control plane | nothing in this repository declares a Supabase schema or RPC as active | **do not claim a control-plane path is operational.** Control-plane state (jobs, tasks, claims, coordination) is metadata, never code authority; if an activation is required, it is a blocker recorded here until someone can point at it |

## 3b. Read this with

- `CURRENT_STATUS.md` — the readiness table this document makes honest.
- `PROJECT_DECISIONS.md` — the decisions behind each row (A-*, XA-*).
- `PROJECT_MASTER_PLAN.md` — ownership, so a blocker can be routed to the right agent.
- `docs/n8n-lego/decisions/cross-agent-decisions.json` — the machine-readable register.

## 4. Blocker handling rules

1. A blocker row names an **owner** and the artifact that carries it, so it can be verified.
2. Fixing a blocker updates the row with the evidence that fixed it — the row is not deleted.
3. A phase report may not describe a blocked area as complete; it cites this document.
4. A blocker that requires a decision (not work) is recorded in
   `docs/n8n-lego/decisions/cross-agent-decisions.json` and linked here.
5. A newly discovered blocker is added here in the same change that discovers it.
