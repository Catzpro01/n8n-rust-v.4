<!-- Curated (agent-1). Rewritten for P2.13 on 2026-09-22 against main @ e754c5df; not generated, not deleted by `npm run lego:ai`. -->
> **This is the frontend consumption view, not the canonical document.**
>
> For live counts read the generated [`../CURRENT_STATUS.md`](../CURRENT_STATUS.md) and
> [`../AI_CONTRACT_MATRIX.md`](../AI_CONTRACT_MATRIX.md): they are derived from the manifests at
> build time. Where this view and a registry disagree on a *number*, the **registry wins** and this
> file is a defect. For milestone status the canonical source is
> [`docs/n8n-lego/milestones.json`](../../../docs/n8n-lego/milestones.json) — this document is a
> reading of it, not a second copy.
>
> Historical baselines are kept below and labelled, because a status document that quietly
> re-dates itself is how a reader ends up trusting a stale number.

# Current status

**Status:** living record, re-measured at P2.13. **Owner:** agent-01 (frontend) for the frontend
rows; manager/agent-2 for the backend rows. **Update rule:** every number here is verified against
the tree at the commit named below, never remembered.

---

## 1. Baselines and heads

| Ref | Commit | Notes |
| :--- | :--- | :--- |
| `main` (protected) | `e754c5df35b41b0ff2ac769519f05f056835411c` | **current baseline** — "Backend LEGO P2.6–P2.12: publish `ai.skill@1.0.0` (#44)". Never modified, never force-pushed, never merged into by an agent. |
| agent-1 branch | `arena/01a0c6b4-n8n-rust-v-4` | P2.13 frontend: the Context & Session surface, the vocabulary lock additions, the milestone register. Work stays here until the manager reconciles. |
| agent-2 branch | `arena/01a0c6b5-n8n-rust-v-4` | P2.13 backend side (independent; not read as authority by this branch beyond the merged tree at `e754c5df`). |
| HISTORICAL `main` | `cb71dbb201d635b15b49933764c2c2336e745809` | the P2.11 reconciliation baseline. Superseded by `e754c5df`; kept so the P2.11 evidence stays readable. |
| HISTORICAL backend tree | `6f7b66da` | the P2.10 tree the vocabulary lock was first compared against (38 quoted sets then, 53 now). Superseded by `e754c5df`. |

## 2. Where the project is

| Question | Answer | Source |
| :--- | :--- | :--- |
| current milestone | **P2.13 — Context & Session + milestone reconciliation**, in progress | `docs/n8n-lego/milestones.json` |
| previous milestone | **P2.12 — Skill**, complete: `ai.skill@1.0.0` locked, 4 operations, 2 permissions, no Skill runtime; `XA-19` resolved, `XA-11` still open | register + `contract-lock.json` |
| milestone before that | P2.11 — reconciliation of both agent branches, complete | register |
| strategic phase | Phase A (contracts) complete; Phase B in progress (Skill delivered, Context & Session in progress, Memory/Workspace/Agent Machine planned). Phases A–F are **not** replaced by the milestone layer | `manifest/ai-lego-set.json#phases` |
| AI runtime / model inference | **NOT IMPLEMENTED** — no provider client, no inference path, zero-install is valid | `manifest/ai-foundation.json#notImplemented` |
| Agent Machine runtime | **NOT IMPLEMENTED** — contract-only | `AGENT_MACHINE_PLAN.md` |
| Memory store | **DOES NOT EXIST** (`XA-12`): Memory is what survives context replacement, Context is what is loaded now | `CONTEXT_SESSION_MEMORY_PLAN.md` |
| Workspace executor / MCP runtime / Runtime Adapter runtime | **NOT IMPLEMENTED** — contract-only | `WORKSPACE_AND_EXTERNAL_ACTION_PLAN.md`, `MCP_AND_RUNTIME_ADAPTER_PLAN.md` |
| Rust | **NOT STARTED** for any LEGO contract (ADR-0005 keeps Rust locked; `crates/` is a different world) | `.ai/constitution.md` |
| Scale-out (multi-process / multi-instance) | **NOT READY** — class-A storage blockers B-1, B-2, B-3 stand | `KNOWN_BLOCKERS.md §1` |

## 3. The Context & Session surface (what P2.13 added)

One LEGO, two contracts, five things that stay distinct: **Conversation ≠ Session ≠ Context window
≠ Memory ≠ Execution**.

| Fact | Value |
| :--- | :--- |
| contracts consumed | `ai.context` (what is loaded now) + `ai.agent-session` (bounded state: identity plus references) |
| publication state | **declared-not-locked** — declared in four backend files, registered `contract-only` in `domains.json`, claimed as `@1.0.0` in `ai-lego-set.json`, and published by **no** `contract-lock.json` row (`XA-20`) |
| quoted vocabulary the surface renders | **13 quoted sets** — 10 added at P2.13 (`contextField` 9, `contextLifecycle` 6, `continuationSection` 14, `contextOperationVerb` 5, `contextOperation` 2, `contextPermission` 2, `agentSessionReference` 3, `agentSessionOperation` 3, `agentSessionPermission` 3, `tokenKind` 3) + 3 already in the lock (`contextScope` 7, `agentSessionState` 7, `agentSessionField` 10). Plus **2 local sets** (`continuationAffordance` 6, `contextUsageReport` 4) |
| pending publication | **2 `PENDING_PUBLICATIONS` rows** — `contextRolloverPhase` (`NORMAL → PREPARE → ROLLOVER`) and `continuationVerification` (`verified / degraded / failed`); ruled by the brief, declared by no backend file. 4 of the 10 new quoted sets also carry a `publicationPending` record (`XA-20` ×3, `XA-17` ×1) |
| operations offered by the UI | **none**. The five published operations are rendered as facts; `Continue session` is answered `operation-unpublished`, and so are `rollover`, `rehydrate` and `verify` (declared verbs nobody registered) |
| refusals | no fabricated token figure (a usage number carries its declared kind or is not rendered), no Memory store, no execution affordance, no transcript, no chain-of-thought, no secret, no threshold at 100%, no silent reset |
| boot payload | **unchanged, 18,126 B** — the view is not in the descriptor, and it is built on demand |
| code | `packages/frontend-lego/src/context-session.mjs` + `manifest/context-session.json`; contract §19.19; rule **A28**; tests `32-context-session.test.mjs` (46) |

## 4. The frontend package as declared today

| Fact | Value | Source of truth |
| :--- | :--- | :--- |
| architecture rules | **28** (A1–A28), as data, mirrored in contract §19.16 | `src/conformance.mjs` |
| architecture tests | **363** across **33** suites | `packages/frontend-lego/test/` |
| shared vocabulary lock | **53** quoted sets with provenance (43 at `e754c5df`, **+10** at P2.13; 10 quoted from a file no contract publishes), **24** local sets (22 → **+2**), **2** `PENDING_PUBLICATIONS` rows (both new) | `src/vocabulary.mjs` |
| surfaces / hooks / units | 12 / 15 (`1.1.0`) / 19 in a 3-level hierarchy | `manifest/*.json` |
| declared capabilities | 7 (`translation` + 6 AI), installed **0**, no entry path | `manifest/capabilities.json` |
| contract lock rows the frontend reads | **15**, of which `ai.skill@1.0.0` is the newest; `ai.context` / `ai.agent-session` are absent | `contracts/contract-lock.json` |
| boot payload | 18,126 B JSON / 24,168 B base64, budget 32 KB, byte-pinned to P2.5 | evidence capture |
| `.ai/` retrieval pack | 10 curated files under an 80 KB total budget and per-level budgets | `src/knowledge.mjs`, `test/12` |
| runtime dependencies | **0** | `packages/frontend-lego/package.json` |

Backend counts (domains, capabilities, operations, error codes) are **not** restated here: they are
generated into [`../CURRENT_STATUS.md`](../CURRENT_STATUS.md) from the manifests, and the registry
wins over any prose.

## 5. Gates, as last run on this branch

| Gate | Result |
| :--- | :--- |
| `npm run lego:gate` | see the rows below — it is the sum of them |
| `lego:arch` | OK — 26 domains, 1 temporary allowance, **15** locked contracts, every import inside its boundary |
| `lego:arch:selftest` | 26/26 |
| `lego:foundation` | OK — Foundation 1.0.0, 26 LEGOs, 12 node creation routes |
| `lego:foundation:selftest` | 15/15 |
| `lego:capabilities` | OK — 23 REST features vs 83 registered capabilities, owners and phases agree |
| `lego:scaleout` | OK — 41 files, 11 declared exceptions, no new process-local coupling |
| `lego:ai:check` | OK after `npm run lego:ai` (the register and decision changes made two generated documents stale; they were regenerated, not hand-edited) |
| `lego:test` | 439 tests — 436 pass, **3 fail**: `rest.test.mjs` node-catalog 404s (`GET /rest/types/nodes.json`, `GET /rest/types/node-versions.json`, `POST /rest/node-types`). Environmental in this sandbox (no installed `node_modules`) and **pre-existing at `e754c5df`** — the same three tests fail there, verified on a pristine `git archive` copy |
| `frontend-lego:test` | **363 / 363 pass, 0 skipped** — run as its own stage, because `lego:gate` chains with `&&` and the three environmental `lego:test` failures stop the chain before it |
| `capture-frontend-evidence.mjs` | **52/56** (`docs/n8n-lego/evidence/frontend-boundary-p213-run.json`) — 3 environmental page checks (no `n8n-editor-ui` bundle here, B-10; all three PASS at `e754c5df`) + 1 real: the 4,096 KB assembly-heap pin, measured **4,275 KB** in the final capture and 4,251–4,361 KB across runs (the probe carries ±70 KB of noise). The pin was **not** edited (`XA-21`, B-14). Boot payload unchanged: 18,126 B, byte-identical to the P2.5 pin. |
| `python3 tools/sublego-audit/audit.py` | **NOT RUN** — `ModuleNotFoundError: yaml` in this sandbox; environmental, reported as not run rather than passed |
| `npm run verify:fast` | 5/10 — G06–G10 need `packages/workflow-lego/node_modules` (B-10), unchanged from the P2.11 baseline |

A gate that cannot run is reported as **not run**. An environmental failure is not a code
regression, and is never silently dropped from the count either.

## 6. Readiness — the honest version

| Area | State | Evidence |
| :--- | :--- | :--- |
| Frontend architecture / contracts / gates | **ready** | §5, `test/01`–`test/33` |
| Context & Session presentation | **delivered as a vocabulary-and-state surface**; the contracts it consumes are not published | `test/32`, `XA-20` |
| AI Foundation | **contract-only** — declared, not implemented | `ai.foundation@1.0.0` |
| Skill | **published contract + registry surface**, no Skill runtime | `ai.skill@1.0.0`, `test/31` |
| Memory / Workspace / Agent Machine runtime | **not implemented** (`XA-12`, `XA-13`, `XA-16`) | `KNOWN_BLOCKERS.md §2` |
| Multi-process / multi-instance scale-out | **NOT READY** | B-1, B-2, B-3 |
| Browser / isolation profile gates | **unproven locally** | `verify:fast` 5/10 (B-10) |
| Control plane (jobs/tasks) | **no in-repo activation evidence** — not claimed operational | B-12 |
| Descriptor assembly heap budget | **over pin** (4,275 KB of 4,096 KB; P2.12 filled it to 3,780 KB) — escalated, not edited | `XA-21`, B-14 |

**A milestone is not finished because an agent's branch is.**
The current milestone closes only when the manager has reconciled both branches against `e754c5df`,
merged into protected main and verified the merged tree — two gates, RECONCILIATION PASS then MERGE
PASS, per
[`PROJECT_WORKFORCE_ORCHESTRATION.md`](PROJECT_WORKFORCE_ORCHESTRATION.md) §8 and
`docs/n8n-lego/milestones.json#policy.mergeProtocol`.

## 7. What a new agent should read, in order

1. `.ai/README.md` → `.ai/constitution.md` (hard rules, what is out of scope).
2. `docs/n8n-lego/milestones.json` — the canonical register: what is in progress, what is blocked,
   what the boundary of the current milestone is, and what must not be merged.
3. `.ai/master/PROJECT_MASTER_PLAN.md` and `.ai/master/CURRENT_STATUS.md` (generated counts).
4. This file, then [`KNOWN_BLOCKERS.md`](KNOWN_BLOCKERS.md) and
   [`IMPLEMENTATION_PHASES.md`](IMPLEMENTATION_PHASES.md).
5. The area document you need — for P2.13 that is
   [`../CONTEXT_SESSION_MEMORY_PLAN.md`](../CONTEXT_SESSION_MEMORY_PLAN.md) and
   [`../AI_FRONTEND_CONTRACT_MATRIX.md`](../AI_FRONTEND_CONTRACT_MATRIX.md).
6. `docs/n8n-lego/decisions/cross-agent-decisions.json` (21 rows, 13 open) and
   `.ai/cards/recipes.md` for the commands of a task shape.
