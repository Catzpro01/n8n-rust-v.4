# Frontend status, gates and blockers (agent-1)

**Status:** living record, hand-written (agent-1). **Owner:** agent-1 (frontend + compatibility).
**Canonical for:** the frontend half of the project — what the frontend branch has verified, what
blocks it, and which frontend decisions are recorded. Backend facts are canonical in the generated
`CURRENT_STATUS.md`, `KNOWN_BLOCKERS.md` and `PROJECT_DECISIONS.md` (from Agent 2's manifests at
`464c1216`). If a number here disagrees with a generated document, the generated one wins for
backend facts and this file is a defect.

## 1. What the frontend branch owns

`packages/frontend-lego` (framework-neutral, **zero runtime dependencies**), `contracts/frontend.contract.md`,
the seam/identity/negotiation/vocabulary modules, the AI UI specification in `.ai/master/AI_*.md`,
the retrieval pack (`.ai/frontend/`, `.ai/cards/`, `.ai/index/`, `.ai/maps/`, `.ai/README.md`), the
boundary evidence `docs/n8n-lego/evidence/frontend-boundary-p25.json`, and the frontend open-decision
register `docs/n8n-lego/decisions/cross-agent-decisions.json` (**19 rows: 6 resolved, 13 open**).

## 2. Verified gates (frontend)

| Gate | Result |
| :--- | :--- |
| `node --test packages/frontend-lego/test/*.test.mjs` | 275 tests across 30 suites — 275 pass, 0 skip, 0 fail (P2.11 merged tree) |
| `test/29-alignment.test.mjs` with `N8N_BACKEND_LEGO_ROOT` at a backend tree | 7/7, 0 skipped, zero vocabulary drift |
| `node --test apps/n8n-lego/test/*.test.mjs` (the app suite, backend + the frontend boundary tests) | 392/392 |
| `npm run lego:arch`, `lego:foundation`, `lego:capabilities`, `lego:scaleout`, `lego:ai:check` | all OK on the merged tree |
| `node apps/n8n-lego/scripts/capture-frontend-evidence.mjs` | 50/50 PASS |
| `python3 tools/sublego-audit/audit.py` | AUDIT PASSED (12 LEGOs, 20 Sub-LEGOs, 5 Agents) |
| `test/30-master-plan.test.mjs` | 10/10 — the master set is the union of 11 generated + 19 hand-written documents, and `lego:ai:check` proves the generated half is in sync |
| Retrieval pack | 81,678 B of an 81,920 B budget (242 B headroom) |
| Boot descriptor | 18,126 B JSON (budget 32 KB) |

## 3. Frontend blockers

| ID | Blocker | Evidence | Consequence |
| :--- | :--- | :--- | :--- |
| F-1 | Browser/isolation profile gates unproven locally | `npm run verify:fast` = 5/10; G06–G10 need `packages/workflow-lego/node_modules` | not demonstrated in this environment; the run rewrites `docs/isolation/*`, which are reverted |
| F-2 | The backend tree is not part of the frontend package | `test/29` runs 7/7 against the P2.11 tree when `N8N_BACKEND_LEGO_ROOT` is set (a wrong path fails, never skips); without it the comparisons are skipped | the vocabulary lock is compared with real declarations when a backend tree is present |
| F-3 | Unpublished backend concepts are consumed as `publicationPending` | `XA-5`, `XA-8` … `XA-18` | each such surface renders `capability-unavailable` / `feature-unsupported` with the reason, never a mock |

## 4. Frontend decisions already recorded (agent-1 record)

1. The frontend consumes declarations only; it never imports backend implementation to stay in sync.
2. Presentation names are never silent aliases; an alias is declared (`executions` → `execution`).
3. Every UI contract covers ten states and keeps five outcomes distinguishable
   (`capability-unavailable`, `operation-unpublished`, `version-incompatible`, `migration-required`,
   `feature-unsupported`).
4. Chain-of-thought is never rendered, stored or inferred; decisions carry summaries, evidence, risk,
   approval state and artifacts.
5. Token numbers are `reported` or `estimated`, never fabricated; the visible message count is never
   conflated with model input.
6. Zero-install is a valid product state, not an error, and the UI says so.
7. Local dispatch precedes network transport; no internal HTTP between local LEGO.
8. No readiness claim the gates do not support: scale-out is **NOT READY** (process-local execution id
   allocation, local JSON system of record) and the AI Foundation is **contract-only**.

## See also

- `CURRENT_STATUS.md` — backend facts and counts (generated).
- `AI_UI_EXPERIENCE_MASTER_PLAN.md` — the frontend AI architecture.
- `docs/n8n-lego/decisions/cross-agent-decisions.json` — open questions with owners.
