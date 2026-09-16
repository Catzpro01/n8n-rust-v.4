# Phase 2 Integration Report

## Phase
Phase 2 — LEGO Isolation

## Reference
n8n `2.9.4` — `reference/n8n`, upstream commit `b6dc2787c45677a29a9612cd27eb911302961a83`

## Audit metadata
| Field | Value |
| :--- | :--- |
| Guardian | Agent 5 — Integration & Verification |
| Audit date | 2026-09-16 (re-audited 2026-09-17 after `main` moved to `82be4146`) |
| Branch audited | `arena/01a0ac12-n8n-rust-v-4` (content of `origin/main`, merged in for audit) |
| Rust implementation | none — correct for Phase 2 |
| Reference source modified this cycle | **no** |

## Agents
| Agent | LEGO | Branch head | Work delivered |
| :--- | :--- | :--- | :--- |
| Agent 1 | workflow | `e65a2f38` (bootstrap) | contract + `docs/isolation/workflow.md` (landed on `main`, not on branch) |
| Agent 2 | node | `e65a2f38` (bootstrap) | contract only |
| Agent 3 | connection | `e65a2f38` (bootstrap) | contract only |
| Agent 4 | validation | `e65a2f38` (bootstrap) | contract only |
| Agent 5 | integration | this branch | master map, dependency graph, compatibility matrix, issue log, performance findings, 2 new automated harnesses |

## LEGO Status
See `docs/isolation/LEGO-MASTER-MAP.md` for the full table.

| LEGO | Owner | Status | Blocking reason |
| :--- | :--- | :--- | :--- |
| Workflow | Agent 1 | ANALYZED | depends at runtime on uncontracted `expression` (ISSUE-002); hidden global-state coupling (ISSUE-006) |
| Node | Agent 2 | BLOCKED | no `docs/isolation/node.md` (ISSUE-007); runtime cycle with expression (ISSUE-004) |
| Connection | Agent 3 | BLOCKED | no `docs/isolation/connection.md` (ISSUE-007) |
| Validation | Agent 4 | BLOCKED | no isolation doc; contract ≠ source (ISSUE-003); `DisabledHandling` untested (ISSUE-005) |
| Execution Data / Expression / Trigger / Webhook / Scheduler / Persistence / Credentials / API | Agents 3–4 | PLANNED | anatomy docs only, no contracts (ISSUE-002) |

## Contract Status
* Present and well-formed: `workflow`, `node`, `connection`, `validation` — 4/4 machine-verified.
* **Structural gap:** none of the four contracts contains the sections required by brief §6 —
  `Purpose`, `Responsibilities`, `Non-responsibilities`, `Dependencies`, `Error behavior`,
  `Lifecycle`, `Data ownership`, `Compatibility requirements`. Each has only `Data Schema` +
  `Invariants`. Because `Non-responsibilities` is missing everywhere, boundary ownership cannot be
  proven from contracts alone.
* **1 contract conflict:** cycle detection is claimed by both `workflow.contract.md` and
  `validation.contract.md` → `ISSUE-003`. Agent 5 records the conflict and does **not** resolve it.
* **8 contracts missing** for LEGOs listed in the brief → `ISSUE-002`.

## Dependency Status
Derived from source by `tests/integration/boundary_audit.py`; full table in `DEPENDENCY-GRAPH.md`.

* 28 cross-LEGO edges, all enumerated and documented.
* 12 DIRECT RUNTIME, 16 TYPE-ONLY (type-only edges impose no runtime coupling).
* The brief's example graph was **not** adopted verbatim: `packages/workflow` has no execution root
  (execution lives in `packages/core`, out of Phase-2 scope) and `workflow → expression` is a real
  runtime edge the example omitted.

## Boundary Violations
**None introduced by Agents 1–4.** All 28 edges are within `packages/workflow` and none crosses into
HTTP, database, or filesystem concerns. Specifically checked and clean:

| Anti-pattern from brief §7 | Found? |
| :--- | :--- |
| Webhook mutating persistence internals | no (no webhook code in scope) |
| Node calling the database directly | **no** — zero typeorm/DataSource references in `packages/workflow` |
| Expression mutating Workflow internals | no — `expression → workflow` is TYPE-ONLY |
| Workflow knowing HTTP details | no |

## Hidden Dependencies
8 signals found (all inherited from upstream, all recorded as `ISSUE-006`):

| Kind | Count | Examples |
| :--- | ---: | :--- |
| global mutable state (`getGlobalState`) | 3 | `workflow.ts:132`, `expression.ts:354`, `workflow-data-proxy.ts:89` |
| env-var coupling (`process.env`) | 4 | `expression.ts:35,428`, `workflow-data-proxy-env-provider.ts:16,19` |
| filesystem type coupling | 1 | `interfaces.ts:7` — `import type { PathLike } from 'fs'` (type-only, benign) |
| database coupling | 0 | — |

Answer to the brief's key question — *can a LEGO be replaced without knowing another LEGO's
implementation detail?* — **Connection: yes. Validation: yes. Node: no** (runtime cycle with
Expression). **Workflow: no** (ambient global timezone state).

## Circular Dependencies
16 cycles detected. 13 are TYPE-ONLY in at least one direction → ACCEPTED and documented.
3 are runtime cycles with no contract coverage → **ARCHITECTURE WARNING** (`ISSUE-004`):
`expression ↔ node`, `expression ↔ shared-util`, `node ↔ shared-util`.

## Compatibility Tests
`tests/compatibility/COMPATIBILITY-MATRIX.md`.
* `node tests/compatibility/contract_conformance.mjs` → **21/21 PASS** (re-run 2026-09-16).
* Behaviors verified compatible: empty workflow, one node, linear workflow.
* Behaviors **NOT VERIFIED**: manual execution, webhook, execution persistence, expression —
  no isolated implementation and/or no contract exists for these in Phase 2.

## Integration Tests
* `python3 tests/integration/boundary_audit.py` → **PASS** (re-run 2026-09-16).
* `bash tests/integration/run_gate.sh [--offline-only]` → composite gate, offline stages **PASS**.

## Regression
**11/11 — NOT RE-RUN this cycle.**
Baseline `tests/reference/baseline/SMOKE_TEST_RESULTS.md` records 11/11 PASS on VPS `157.10.160.95`.
`python3 tests/integration/regression_gate.py` executed here returns **1/5** purely because the
verification sandbox has no n8n process and no Docker:
```
[FAIL] 1/5 Healthz check failed: <urlopen error [Errno 111] Connection refused>
[FAIL] 4/5 DB check failed: [Errno 2] No such file or directory: 'docker'
[PASS] 5/5 LEGO Contracts present and verified
```
This is an **environment limitation, not a detected regression** — no reference source was modified
this cycle. Per brief §12 an unexecuted gate is never counted as a pass.

## Live Verification
**NOT RUN** (no live n8n instance reachable from the verification environment).

## Remaining Issues
| ID | Type | Severity | Owner | Status |
| :--- | :--- | :--- | :--- | :--- |
| ISSUE-001 | Integration flow bypassed (all work direct to `main`) | HIGH | orchestrator / all | OPEN |
| ISSUE-002 | 8 LEGOs without contracts | HIGH | Agent 3, Agent 4 | OPEN |
| ISSUE-003 | Validation contract ≠ source; cycle-detection ownership conflict | MEDIUM | Agent 4 + Agent 1 | OPEN |
| ISSUE-004 | 3 undocumented runtime cycles | MEDIUM | Agent 2 + Agent 3 | OPEN |
| ISSUE-005 | `DisabledHandling` / `typeVersion` untested | MEDIUM | Agent 4 | OPEN |
| ISSUE-006 | Global-state + env hidden coupling | LOW | Agent 1 + Agent 3 | OPEN |
| ISSUE-007 | 3 missing isolation docs | MEDIUM | Agents 2, 3, 4 | OPEN |
| ISSUE-008 | Unreviewed supabase commit direct to `main`; anon-readable orchestration tables | MEDIUM | orchestrator | OPEN |

## Final Integration Checklist (brief §22)
```
[✗] All contracts consistent           — 1 conflict (ISSUE-003), 8 contracts missing (ISSUE-002)
[✗] All boundaries documented          — 1 of 4 isolation docs exists (ISSUE-007)
[✓] Dependency graph reviewed          — DEPENDENCY-GRAPH.md, source-verified, automated
[✗] No hidden dependency               — 7 real signals (ISSUE-006)
[✗] No circular dependency violation   — 3 undocumented runtime cycles (ISSUE-004)
[✓] Reference tests pass               — 3/3 golden fixtures conform
[~] Compatibility tests pass           — 21/21 executed; 4 behavior rows NOT VERIFIED
[✓] Integration tests pass             — boundary audit PASS
[ ] 11/11 smoke test PASS              — NOT RUN (no live host)
[ ] Live verification PASS             — NOT RUN
[✓] Main buildable                     — reference source untouched; no build performed here
[ ] Main runnable                      — NOT RE-VERIFIED this cycle
[✓] No Rust prematurely introduced     — crates/ and apps/ clean, enforced by both harnesses
```

## Recommendation
**NOT READY.**

Ordered path to VERIFIED:
1. Agents 2, 3, 4 publish `docs/isolation/{node,connection,validation}.md` (ISSUE-007).
2. Agent 4 + Agent 1 resolve cycle-detection ownership and realign `validation.contract.md` with
   actual n8n 2.9.4 source (ISSUE-003).
3. Agent 3 + Agent 4 publish the 8 missing contracts, starting with `expression` and
   `execution-data` — they are already on the runtime path of contracted LEGOs (ISSUE-002).
4. All four contracts extended with the 10 sections required by brief §6.
5. Agent 4 specifies disabled-node semantics with a source reference; Agent 5 adds the fixture (ISSUE-005).
6. Re-run `bash tests/integration/run_gate.sh` on the VPS with n8n 2.9.4 + PostgreSQL live → require
   offline stages PASS **and** 11/11 PASS.
7. Re-route future work through agent branches → `integration` → `main` (ISSUE-001).

## Re-audit — 2026-09-17

`main` advanced `0b87375f → 82be4146` (supabase migration schema, `.env.example`, `.gitignore`,
`skills-lock.json`, `.agents/skills/**` — 45 files, +2820). Merged into this branch and the full
offline gate was re-executed.

| Check | Result (re-run) | Delta vs 2026-09-16 |
| :--- | :--- | :--- |
| Contract conformance | **21/21 PASS** | unchanged |
| Boundary & dependency audit | **PASS**, 28 edges | unchanged |
| Circular dependencies | 16 (3 flagged) | unchanged |
| Hidden coupling signals | 8 | unchanged |
| Phase-2 Rust guard | clean | unchanged |
| `reference/n8n/**` modified | **no** | unchanged |
| Golden fixtures / 11/11 baseline modified | **no** | unchanged |
| Live 11/11 | **NOT RUN** (no docker / no n8n host) | unchanged |
| Agent branches `agent-1..4` | still at bootstrap `e65a2f38` | unchanged |

**Verdict:** the new commit is **non-blocking** for Phase 2 — it adds orchestration tooling only and
violates no LEGO boundary. It is logged as `ISSUE-008` for process (direct-to-main, recurrence of
ISSUE-001) and for the `anon_read_*` RLS policies that make all orchestration tables world-readable.

No previously reported issue has been resolved since the first audit. **Status is unchanged.**

## Final Status
**BLOCKED**

Not `FAILED`: no reference behavior has been broken and no regression has been detected —
`reference/n8n/` is byte-identical to its import and contains no Rust.
Not `VERIFIED`: the definition in brief §24 requires four verified agents, consistent contracts, a
live 11/11 pass and live verification. None of those four conditions is currently met.

---

### How to reproduce this audit
```bash
bash tests/integration/run_gate.sh --offline-only   # anywhere: Node 22 + Python 3
bash tests/integration/run_gate.sh                  # on the VPS, with n8n + PostgreSQL running
```
