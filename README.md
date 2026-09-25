# n8n-rust-v.4

High-Performance Rust Port of n8n with Arena AI Virtual SSH Engine.

The port never rewrites n8n from guesswork: n8n 2.9.4 is the behavioral
reference, every component is isolated behind an explicit contract, and only then
is a Rust replacement attempted.

## Project status

| Stage | State |
| :--- | :--- |
| ANATOMY (`docs/anatomy/`) | ✅ Completed |
| CONTRACT (`contracts/`) | ✅ Completed |
| REFERENCE SOURCE (`reference/n8n/`, n8n 2.9.4) | ✅ Completed |
| REFERENCE RUNTIME (baseline 11/11 smoke test) | ✅ Completed |
| WORKFLOW ISOLATION & LEGOS (01–04) | ✅ VERIFIED |
| **CURRENT PHASE** | **🚀 PHASE 3 — RUST RUNTIME (ACTIVE)** |
| RUST IMPLEMENTATION (8 Workspace Crates) | ✅ **ACTIVE** (`crates/` compiled & passing all tests) |

## Governance & Single Source of Truth (P0 Constitution)

Proyek ini berada di bawah tata kelola arsitektur tunggal (P0 Governance):
1. **Fase Resmi: PHASE 3 — RUST RUNTIME (ACTIVE)**. Fase isolasi Phase 2 telah selesai dan terverifikasi. Seluruh pengembangan runtime saat ini berada di Phase 3.
2. **Status Rust: ACTIVE**. Status Rust bukan lagi "not started" atau "reserved". Cargo workspace mendefinisikan dan mengompilasi 8 crates aktif (`n8n-common`, `n8n-workflow`, `n8n-connection`, `n8n-validation`, `n8n-node-model`, `n8n-execution-data`, `n8n-expression`, `n8n-nodes-rust`).
3. **Single Source of Truth**: Branch `main` adalah satu-satunya acuan kebenaran mutlak bagi semua agen. Dilarang melakukan rollback ke zero-Rust atau mengklaim fase sebelum Phase 3.
4. **Compatibility Baseline (n8n v2.9.4)**: Perilaku referensi n8n v2.9.4 dan kontrak formal dipertahankan penuh sebagai standar keabsahan perilaku engine.
5. **LEGO = Development Boundary, Bukan Runtime Overhead**: Pembagian LEGO hanya berfungsi sebagai batas modul dan pemisahan tugas saat isolasi/pengembangan. Pada hot-path runtime, engine tidak memecah eksekusi menjadi lapisan serialisasi JSON / IPC antar-crate yang berat, melainkan menggunakan representasi Runtime IR terpadu dengan alokasi minimal/zero-copy.
6. **Feature & Node Freeze**: Penambahan node baru dibekukan sementara hingga arsitektur Kernel Runtime IR (P1: `ExecutionContext`, `ExecutionFrame`, `NodeExecutor`, Data Plane) dibakukan.

<!-- BEGIN GENERATED milestone-governance: npm run lego:ai renders this block from docs/n8n-lego/milestones.json; do not edit by hand -->
## Overall Milestone Progress

**82.9%**

`█████████████████░░░ 82.9%`

**126 / 152 slices implemented.**

| | |
| --- | ---: |
| Implemented | 126 |
| Verifying | 1 |
| In progress (not verifying) | 0 |
| Planned | 19 |
| Blocked | 4 |
| Proposed | 2 |
| Total in the completion KPI | 152 |

The percentage is `implemented / total` from `docs/n8n-lego/milestones.json`, programs P0–P11 plus future programs, rounded to one decimal. It is not estimated from time, PR count, or lines of code. Merged/verifying work is not counted as implemented. `in-progress` and `verifying` contribute 0% because the register has no objective fractional checklist.

```text
P0  ████████████████████ 100.0%  2/2
P1  ████████████████████ 100.0%  2/2
P2  ███████████████████░  94.1%  32/34
P3  ███████████████████░  94.4%  17/18
P4  ██████████████████░░  90.0%  9/10
P5  ███████████░░░░░░░░░  55.6%  10/18
P6  ██████████████████░░  88.6%  31/35
P7  ░░░░░░░░░░░░░░░░░░░░   0.0%  0/1
P8  ░░░░░░░░░░░░░░░░░░░░   0.0%  0/1
P9  ███████████████████░  95.7%  22/23
P10 ░░░░░░░░░░░░░░░░░░░░   0.0%  0/1
P11 ░░░░░░░░░░░░░░░░░░░░   0.0%  0/1
```

## Program Overview

| Program | Focus | Progress | State |
| --- | --- | ---: | --- |
| P0 | Core Application Bootstrap | 100.0% | complete |
| P1 | n8n Compatibility / Behavioral Baseline | 100.0% | complete |
| P2 | LEGO / AI / Plugin Foundation | 94.1% | complete |
| P3 | Workflow + Execution + Unlimited Nodes | 94.4% | complete |
| P4 | Trigger / Webhook / Ingress | 90.0% | complete |
| P5 | Identity / Authentication / Authorization / Credentials (Security) | 55.6% | complete |
| P6 | Node Registry / Node Runtime | 88.6% | complete |
| P7 | Dynamic Parameters / Schema Runtime | 0.0% | planned |
| P8 | Storage / Data Layer | 0.0% | planned |
| P9 | Observability / Diagnostics / Operations | 95.7% | complete |
| P10 | Multi-Tenant / Isolation / Quota | 0.0% | planned |
| P11 | Worker / Distributed Scaling / HA | 0.0% | planned |

## Active Execution

### Active work

The queue is `executionPointer` only. Historical `P2.27` is not the next slice, and there is no `P2.28`.

```text
`P5-M08` (verifying, completion 0%)
   ↓ `P5-M09`
      ↓ `P5-M07`
         ↓ `P9-S01`
            ↓ `P3-S01`
               ↓ `P4-S01`
                  ↓ `P6-S01`
                     ↓ `P6-S02`
                        ↓ `P2-S02`
                           ↓ `P2-S03`
```

### 🟠 P5-M08 — Public /api/v1 second surface

- **Status:** VERIFYING. Merged work is not implemented. Completion contribution: **0%**.
- **Purpose:** tags (5 operations), variables (4, licence-gated 403 like the community edition), executions list/get/delete (lastId cursor), GET /api/v1/openapi.yml of exactly the mounted operations. Re-planned by the Manager: credentials, users and /docs to P5-M09; resources without a backing model to P5-M10 (one delivery PR per slice)
- **PR:** #304 · **Merge:** `600a2145` · **Head:** `c102cff9`
- **Pending:** DEC-0015 runner verification is not PASS. Attempt 2 (2026-09-25T14:59:54Z-15:10:59Z) on PR head c102cff9: Level 2 conformance SUCCESS (run 36136621102, MDMTEST-n8n-wsl-5); Level 2 Windows SUCCESS (laptop-build-worker-2, attempt 1). Level 0 (MDMTEST-n8n-wsl-3), Level 1 (MDMTEST-n8n-wsl-2), Level 2 linux (MDMTEST-n8n-wsl-4) and post-merge cleanup (run 36137555071, MDMTEST-n8n-wsl) failed with the annotation that the self-hosted runner lost communication. No implementation-failure annotation was recorded. Classification: environmental, not an implementation REGRESSION. One environmental retry remains and was not spent: all five WSL runners were offline at observation. GitHub-hosted checks on merge 600a2145 passed. The slice stays in-progress/verifying and contributes 0% to the completion KPI.


### Blocked

- 🔴 **P5-M02** — Credential runtime integration. Reason: P6-S04 (proposed, #116): the engine has no credential-consuming node. packages/reconstructed-engine/node-registry.mjs implements only manualTrigger, start, noOp, set, code, function and functionItem, so SecretRef resolution in the execution path has no consumer (Manager finding, verified against main 600a2145). Completion contribution: 0%.
- 🔴 **P5-M05** — Multi-host key storage and shared session + rate-limiter state. Reason: P8-S01 (planned, not authorized): the P8 storage contract that shared key/session/rate-limiter state needs. Completion contribution: 0%.
- 🔴 **P5-M06** — Email-based password recovery. Reason: a mail-transport architecture decision (a dependency, or an injected transport contract); Node has no built-in SMTP. Completion contribution: 0%.
- 🔴 **P5-M10** — Public /api/v1 resources that need a backing model this product does not have yet. Reason: backing models this product does not have: projects/sharing, security audit, source control, data tables, workflow versions, a retry execution path, execution annotation tags (see P5-M08-EVIDENCE.md §1). Completion contribution: 0%.

Planned queue (planned ≠ authorized): `P5-M09` → `P5-M07` → `P9-S01` → `P3-S01` → `P4-S01` → `P6-S01` → `P6-S02` → `P2-S02` → `P2-S03`.

Not authorized: planned is not authorized: the Manager starts a queued slice by moving it to in-progress in a PR on main. P5-M04 is planned and measure-first. P7-S01, P8-S01, P10-S01 and P11-S01 are placeholders that need a Manager Master Prompt before any work.

## Status Legend

- ✅ Implemented — 100% completion contribution
- 🟠 Verifying — merged, post-merge verification not passed; 0% completion contribution
- 🔵 In progress — not merged as complete; 0% completion contribution
- 🟡 Planned — 0%
- 🔴 Blocked — 0%; the blocker stays visible
- ⚪ Proposed — 0%

## P0–P11 and future programs

## P0 — Core Application Bootstrap

**100.0%**

`████████████████████ 100.0%`

2 / 2 slices implemented. Remaining 0. 2 implemented.

- **Program status:** complete. Program status is not a substitute for the percentage.
- **Purpose:** Application bootstrap, runtime host, configuration edge, packaging baseline, process lifecycle, minimal compatibility shell (#90).

<details><summary>Slices (2)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `P0.1` | Baseline runtime | clean clone -> start -> browser smoke | ✅ Implemented | 100.0% |
| `P0.2` | Distribution channels + release script | Distribution channels + release script (tarball installer, INSTALL.md) | ✅ Implemented | 100.0% |

</details>

## P1 — n8n Compatibility / Behavioral Baseline

**100.0%**

`████████████████████ 100.0%`

2 / 2 slices implemented. Remaining 0. 2 implemented.

- **Program status:** complete. Program status is not a substitute for the percentage.
- **Purpose:** Original n8n UI compatibility, workflow JSON compatibility, node catalog/behavior baseline, REST compatibility baseline, regression oracle (#90).

<details><summary>Slices (2)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `P1.1` | Phase 1 compatibility inventory | Phase 1 compatibility inventory | ✅ Implemented | 100.0% |
| `P1.2` | Compatibility contract layer | Compatibility contract layer (REST/settings compatibility contracts) | ✅ Implemented | 100.0% |

</details>

## P2 — LEGO / AI / Plugin Foundation

**94.1%**

`███████████████████░ 94.1%`

32 / 34 slices implemented. Remaining 2. 32 implemented, 2 planned.

- **Program status:** complete. Program status is not a substitute for the percentage.
- **Purpose:** Contract-driven LEGO architecture, FE/BE domain boundaries, AI foundation, Agent Machine, Context/Session/Memory, Workspace, MCP boundary, portability, Node Creator, translation, usage integrity, provider adapters, readiness, P2.27 pluggable runtime/security foundation (#90).

<details><summary>Slices (34)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `P2.1-P2.4` | LEGO compatibility contract layer | LEGO compatibility contract layer (historical, pre-register) | ✅ Implemented | 100.0% |
| `P2.5` | Frontend LEGO | Frontend LEGO (historical, pre-register) | ✅ Implemented | 100.0% |
| `P2.6-P2.10` | Backend LEGO P2.6-P2.10 | Backend LEGO P2.6-P2.10 (historical, pre-register) | ✅ Implemented | 100.0% |
| `P2.11` | Reconciliation / foundation cleanup | Reconciliation / foundation cleanup | ✅ Implemented | 100.0% |
| `P2.12` | Skill | Skill | ✅ Implemented | 100.0% |
| `P2.13` | Context & Session | Context & Session | ✅ Implemented | 100.0% |
| `P2.14` | Memory | Memory | ✅ Implemented | 100.0% |
| `P2.15` | Workspace | Workspace | ✅ Implemented | 100.0% |
| `P2.16` | Agent Machine / execution foundation | Agent Machine / execution foundation | ✅ Implemented | 100.0% |
| `P2.17` | Agent Machine Runtime Foundation | Agent Machine Runtime Foundation | ✅ Implemented | 100.0% |
| `P2.18` | Universal Transport & Envelope Kernel | Universal Transport & Envelope Kernel | ✅ Implemented | 100.0% |
| `P2.19` | Artifact, Approval & Audit Foundation | Artifact, Approval & Audit Foundation | ✅ Implemented | 100.0% |
| `P2.20` | MCP vs Agent Control Boundary | MCP vs Agent Control Boundary | ✅ Implemented | 100.0% |
| `P2.21` | Runtime Adapter & Harness Stack | Runtime Adapter & Harness Stack | ✅ Implemented | 100.0% |
| `P2.22` | Node Compatibility & Portability | Node Compatibility & Portability | ✅ Implemented | 100.0% |
| `P2.23` | Node Creator & Translation | Node Creator & Translation | ✅ Implemented | 100.0% |
| `P2.24` | Token & Usage - honest accounting | Token & Usage - honest accounting | ✅ Implemented | 100.0% |
| `P2.25` | External provider integration - the first real adapters | External provider integration - the first real adapters | ✅ Implemented | 100.0% |
| `P2.26` | Provider, Workspace & GitHub Integration + Foundation Readiness | Provider, Workspace & GitHub Integration + Foundation Readiness | ✅ Implemented | 100.0% |
| `P2.27` | Contract-Driven Pluggable Runtime & Security Foundation | Contract-Driven Pluggable Runtime & Security Foundation | ✅ Implemented | 100.0% |
| `P2.27.0` | preflight & mainBaseline reconciliation to actual protected main 20ae0c1a | preflight & mainBaseline reconciliation to actual protected main 20ae0c1a | ✅ Implemented | 100.0% |
| `P2.27.1` | tiny Core kernel — plugin-runtime.mjs + lego.plugin-runtime@0.1.0 | tiny Core kernel — plugin-runtime.mjs + lego.plugin-runtime@0.1.0 | ✅ Implemented | 100.0% |
| `P2.27.2` | manifest + plugin registry + contract resolver | manifest + plugin registry + contract resolver (lego.plugin-runtime 0.2.0) | ✅ Implemented | 100.0% |
| `P2.27.3` | capability + permission policy | capability + permission policy (lego.plugin-runtime 0.3.0) | ✅ Implemented | 100.0% |
| `P2.27.4` | runtime locality policy | runtime locality policy (lego.plugin-runtime 0.4.0) | ✅ Implemented | 100.0% |
| `P2.27.5` | secret broker — scoped short-lived one-shot grants | secret broker — scoped short-lived one-shot grants (0.5.0) | ✅ Implemented | 100.0% |
| `P2.27.6` | resource budgets — declared limits enforced | resource budgets — declared limits enforced (0.6.0) | ✅ Implemented | 100.0% |
| `P2.27.7` | supervisor — lifecycle machine + quarantine | supervisor — lifecycle machine + quarantine (0.7.0) | ✅ Implemented | 100.0% |
| `P2.27.8` | circuit breaker + deadline + contract replay oracle | circuit breaker + deadline + contract replay oracle | ✅ Implemented | 100.0% |
| `P2.27.9` | side-by-side upgrade + rollback + supply-chain admission | side-by-side upgrade + rollback + supply-chain admission | ✅ Implemented | 100.0% |
| `P2.27.10` | frontend plugin boundary | frontend plugin boundary (final implementation slice) | ✅ Implemented | 100.0% |
| `P2-S01` | Frontend LEGO migration foundation + parity harness + status-region pilot | Frontend LEGO migration foundation + parity harness + status-region pilot | ✅ Implemented | 100.0% |
| `P2-S02` | Frontend LEGO shared notification surface + accessibility parity | Frontend LEGO shared notification surface + accessibility parity | 🟡 Planned | 0.0% |
| `P2-S03` | Frontend Evolution layers 3-6 | Frontend Evolution layers 3-6 (core workflow, platform, AI surfaces, legacy UI decommission) | 🟡 Planned | 0.0% |

</details>

## P3 — Workflow + Execution + Unlimited Nodes

**94.4%**

`███████████████████░ 94.4%`

17 / 18 slices implemented. Remaining 1. 17 implemented, 1 planned.

- **Program status:** complete. Program status is not a substitute for the percentage.
- **Purpose:** Workflow and Execution as first-class LEGO domains; logical workflow size decoupled from runtime working set (#75, #90).

<details><summary>Slices (18)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `P3 Slice A` | Persistent logical graph | Persistent logical graph (workflow.graph@0.1.0) | ✅ Implemented | 100.0% |
| `P3 Slice B` | Indexed edge access | Indexed edge access (lazy reverse index) | ✅ Implemented | 100.0% |
| `P3.2` | Slice C | lazy materialization — store port + bounded HOT cache + lifecycle/residency | ✅ Implemented | 100.0% |
| `P3.3` | Slice D | bounded runtime — capacity-bounded frontier with explicit backpressure | ✅ Implemented | 100.0% |
| `P3.4` | Slice E | bounded streaming execution state (execution.state-stream) | ✅ Implemented | 100.0% |
| `P3.5` | Slice F | fail-closed sha256 checkpoint/resume on the state-stream seam | ✅ Implemented | 100.0% |
| `P3.6` | Slice G | tier pressure — residencySummary + applyPressure hot/warm/cold relief | ✅ Implemented | 100.0% |
| `P3.7` | Slice H | bounded Workflow DNA (workflow.dna@0.1.0) | ✅ Implemented | 100.0% |
| `P3.8` | Slice I | execution-as-query (readyAfter/initialReady + fan bounds) | ✅ Implemented | 100.0% |
| `P3.9` | Slice J | execution IR + disableable optimization toggles + LRU cache | ✅ Implemented | 100.0% |
| `P3.10` | Slice L | compatibility oracle (#91 four modes, nine observables, toggle sweep) | ✅ Implemented | 100.0% |
| `P3.11` | Slice M | resource guard (mandatory budgets, five lanes, three-tier pressure) | ✅ Implemented | 100.0% |
| `P3.12` | Slice N | 1M scale stress suite + mandatory #75 documents | ✅ Implemented | 100.0% |
| `P3.13` | Slice K | execution optimizer (semantics-safe fusion + proven-pure cache) | ✅ Implemented | 100.0% |
| `P3.14` | Slice O | hardening (seeded property, byte-flip fuzz, error-family scans) | ✅ Implemented | 100.0% |
| `P3.15` | Slice P | closeout evidence, matrix reconciliation, mainBaseline refresh | ✅ Implemented | 100.0% |
| `P3.15-fix` | Restore immutable mainBaseline + correct P3 closeout evidence | Restore immutable mainBaseline + correct P3 closeout evidence | ✅ Implemented | 100.0% |
| `P3-S01` | Execution optimizer extensions | Execution optimizer extensions (semantic node elimination, content-addressed subgraph cache, resource-aware compilation, incremental execution, self-profiling, hot/cold path split) | 🟡 Planned | 0.0% |

</details>

## P4 — Trigger / Webhook / Ingress

**90.0%**

`██████████████████░░ 90.0%`

9 / 10 slices implemented. Remaining 1. 9 implemented, 1 planned.

- **Program status:** complete. Program status is not a substitute for the percentage.
- **Purpose:** Trigger model, webhook ingress, forms, schedules, event ingress, bounded ingress queues, safe admission, trigger observability and failure behavior (#90, #99).

<details><summary>Slices (10)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `P4.1` | Canonical ingress contracts | Canonical ingress contracts | ✅ Implemented | 100.0% |
| `P4.2` | Activation + generation lifecycle runtime | Activation + generation lifecycle runtime | ✅ Implemented | 100.0% |
| `P4.3` | Webhook route table, registration lifecycle, serving gate, ACK | Webhook route table, registration lifecycle, serving gate, ACK | ✅ Implemented | 100.0% |
| `P4.4` | Cron semantics, DST policy contract, duplicate-tick control | Cron semantics, DST policy contract, duplicate-tick control | ✅ Implemented | 100.0% |
| `P4.5` | Admission / backpressure / idempotency receipt machine | Admission / backpressure / idempotency receipt machine | ✅ Implemented | 100.0% |
| `P4.6` | Event / manual / test / waiting ingress orchestration | Event / manual / test / waiting ingress orchestration | ✅ Implemented | 100.0% |
| `P4.7` | Recovery / reconciliation / race safety | Recovery / reconciliation / race safety (journal, lease, recovery plan) | ✅ Implemented | 100.0% |
| `P4.8` | Advanced ingress efficiency | route atlas + atomic swap, adaptive clamp, payload capsule, burst fusion, brownout QoS, flight recorder | ✅ Implemented | 100.0% |
| `P4.9` | Compatibility + performance acceptance | compat matrix, deterministic replay capsule, acceptance suite | ✅ Implemented | 100.0% |
| `P4-S01` | Ingress innovation remainder | predictive admission controller (full), shadow compatibility path, P4 self-profiling, dedicated webhook/ingress plane | 🟡 Planned | 0.0% |

</details>

## P5 — Identity / Authentication / Authorization / Credentials (Security)

**55.6%**

`███████████░░░░░░░░░ 55.6%`

10 / 18 slices implemented. Remaining 8. 10 implemented, 1 verifying, 3 planned, 4 blocked.

- **Program status:** complete. Program status is not a substitute for the percentage.
- **Purpose:** Identity, sessions, authorization, credential boundary, key management, account security, API keys/service identity, certification (#85, #90).

<details><summary>Slices (18)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `P5.1` | Security Kernel | PrincipalSnapshot, SecurityContext, SecurityStamp | ✅ Implemented | 100.0% |
| `P5.2` | Session Kernel, Rotation, Revocation and CSRF Boundary | Session Kernel, Rotation, Revocation and CSRF Boundary | ✅ Implemented | 100.0% |
| `P5.3` | authorization engine, canonical permission universe, version-aware decision cache | authorization engine, canonical permission universe, version-aware decision cache | ✅ Implemented | 100.0% |
| `P5.4` | credential security boundary — SecretRef over the P2.27 broker, n8n redaction contract, canonical authorization | credential security boundary — SecretRef over the P2.27 broker, n8n redaction contract, canonical authorization | ✅ Implemented | 100.0% |
| `P5.5` | KeyProvider, authenticated envelope encryption, rotation, recovery and encrypted backup | KeyProvider, authenticated envelope encryption, rotation, recovery and encrypted backup | ✅ Implemented | 100.0% |
| `P5.6` | password recovery, bounded abuse controls, TOTP MFA, step-up | password recovery, bounded abuse controls, TOTP MFA, step-up | ✅ Implemented | 100.0% |
| `P5.7` | API keys | API keys (hashed), service principals, tenant policy, agent delegation | ✅ Implemented | 100.0% |
| `P5.8` | security plane certification, operator credential CLI, benchmark, runbook | security plane certification, operator credential CLI, benchmark, runbook | ✅ Implemented | 100.0% |
| `P5-M01` | Security hardening | soft-revoke API keys and service principals (bounded tombstones, REVOKED verdict, audit row kept); REST decision cache deferred on measured evidence (P5.8 finding 1: warm hit 438 ns p50 is not faster than uncached authorize 384 ns p50) | ✅ Implemented | 100.0% |
| `P5-M02` | Credential runtime integration | execution path resolves credentials via SecretRef over the P2.27 broker | 🔴 Blocked | 0.0% |
| `P5-M03` | Public /api/v1 first surface | API-key boundary in upstream order (recorded 401 goldens), key scopes always enforced through the P5.3 kernel, offset-cursor pagination, workflows resource (9 operations). Re-planned by the Manager: email recovery moved to P5-M06, service-principal REST/UI to P5-M07, remaining /api/v1 resources to P5-M08 (one delivery PR per slice) | ✅ Implemented | 100.0% |
| `P5-M04` | Key-rotation work list without an O(n) scan | measure first (per-batch scan vs the O(n) replaceAll persist), index only if the scan dominates | 🟡 Planned | 0.0% |
| `P5-M05` | Multi-host key storage and shared session + rate-limiter state | Multi-host key storage and shared session + rate-limiter state; depends on the P8 storage contract (P8-S01, not authorized) | 🔴 Blocked | 0.0% |
| `P5-M06` | Email-based password recovery | needs a mail transport decision first (Node has no built-in SMTP: a dependency or an injected transport contract), then upstream /rest/forgot-password delivery over the P5 reset-token primitive (split out of P5-M03) | 🔴 Blocked | 0.0% |
| `P5-M07` | Service-principal REST + UI management over the P5.7 programmatic lifecycle | Service-principal REST + UI management over the P5.7 programmatic lifecycle (create shown once, redacted list, revoke with tombstone) (split out of P5-M03) | 🟡 Planned | 0.0% |
| `P5-M08` | Public /api/v1 second surface | tags (5 operations), variables (4, licence-gated 403 like the community edition), executions list/get/delete (lastId cursor), GET /api/v1/openapi.yml of exactly the mounted operations. Re-planned by the Manager: credentials, users and /docs to P5-M09; resources without a backing model to P5-M10 (one delivery PR per slice) | 🟠 Verifying | 0.0% |
| `P5-M09` | Public /api/v1 credentials | Public /api/v1 credentials (list, create, update, delete, schema; secrets never returned, data validated against the credential type) and users (list, get, create, delete, change role), plus /api/v1/docs (needs a decision on serving Swagger UI without a runtime dependency). Split out of P5-M08 | 🟡 Planned | 0.0% |
| `P5-M10` | Public /api/v1 resources that need a backing model this product does not have yet | projects, audit, source-control, data-tables, workflow and credential transfer, workflow versions, execution retry, execution tags (upstream AnnotationTag). Blocked until those models exist; split out of P5-M08 | 🔴 Blocked | 0.0% |

</details>

## P6 — Node Registry / Node Runtime

**88.6%**

`██████████████████░░ 88.6%`

31 / 35 slices implemented. Remaining 4. 31 implemented, 2 planned, 2 proposed.

- **Program status:** complete. Program status is not a substitute for the percentage.
- **Purpose:** Node registry, lifecycle, installation/admission, runtime selection, official/community compatibility, plugin trust/runtime locality, native node migration where beneficial (#90, #100).

<details><summary>Slices (35)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `P6.1` | Canonical node registry contract | Canonical node registry contract | ✅ Implemented | 100.0% |
| `P6.2` | Registry Compiler + Immutable Epoch | Registry Compiler + Immutable Epoch (registry.compiler@0.1.0) | ✅ Implemented | 100.0% |
| `P6.3` | Transactional Package + Single-Flight Install | Transactional Package + Single-Flight Install (package.transaction@0.1.0) | ✅ Implemented | 100.0% |
| `P6.4` | Dependency Closure + Content-Addressed Store | Dependency Closure + Content-Addressed Store (registry.closure@0.1.0) | ✅ Implemented | 100.0% |
| `P6.5` | Workflow Node Resolution Manifest | Workflow Node Resolution Manifest (node.resolution@0.1.0) | ✅ Implemented | 100.0% |
| `P6.6` | Runtime Lease + Side-by-Side Upgrade | Runtime Lease + Side-by-Side Upgrade (runtime.lease@0.1.0) | ✅ Implemented | 100.0% |
| `P6.7` | Manifest/Implementation Split + HOT/WARM/COLD Residency | Manifest/Implementation Split + HOT/WARM/COLD Residency (node.residency@0.1.0) | ✅ Implemented | 100.0% |
| `P6.8` | Capability Compilation + Runtime Locality | Capability Compilation + Runtime Locality (node.capability@0.1.0) | ✅ Implemented | 100.0% |
| `P6.9` | Semantic Fingerprint + Compatibility Replay | Semantic Fingerprint + Compatibility Replay (node.semantics@0.1.0) | ✅ Implemented | 100.0% |
| `P6.10` | Orphan / Tombstone / Alias / Deprecation | Orphan / Tombstone / Alias / Deprecation (node.lifecycle@0.1.0) | ✅ Implemented | 100.0% |
| `P6.11` | Health + Crash Circuit Breaker + Quarantine | Health + Crash Circuit Breaker + Quarantine (node.health@0.1.0) | ✅ Implemented | 100.0% |
| `P6.12` | Supply-Chain Attestation + Revocation + Offline Mirror | Supply-Chain Attestation + Revocation + Offline Mirror (node.supply-chain@0.1.0) | ✅ Implemented | 100.0% |
| `P6.13` | Incremental Registry Compiler + Discovery/Runtime Split | Incremental Registry Compiler + Discovery/Runtime Split (registry.incremental@0.1.0) | ✅ Implemented | 100.0% |
| `P6.14` | Worker Registry Convergence + Handshake | Worker Registry Convergence + Handshake (node.worker-convergence@0.1.0) | ✅ Implemented | 100.0% |
| `P6.15` | Core Acceptance | Core Acceptance (node.acceptance@0.1.0) | ✅ Implemented | 100.0% |
| `P6.16` | Registry Integrity Chain + Freshness/Anti-Rollback | Registry Integrity Chain + Freshness/Anti-Rollback (registry.integrity@0.1.0) | ✅ Implemented | 100.0% |
| `P6.17` | Admission Explain Plan + Dependency Blast Radius | Admission Explain Plan + Dependency Blast Radius (node.admission@0.1.0) | ✅ Implemented | 100.0% |
| `P6.18` | SBOM/VEX + Policy Diff Gate | SBOM/VEX + Policy Diff Gate (node.sbom@0.1.0) | ✅ Implemented | 100.0% |
| `P6.19` | Canary Rollout + Side-by-Side Upgrade + Rollback | Canary Rollout + Side-by-Side Upgrade + Rollback (node.canary@0.1.0) | ✅ Implemented | 100.0% |
| `P6.20` | Emergency Revocation Bulletins | Emergency Revocation Bulletins (node.revocation@0.1.0) | ✅ Implemented | 100.0% |
| `P6.21` | The Node I/O Compiler | The Node I/O Compiler (node.io@0.1.0) | ✅ Implemented | 100.0% |
| `P6.22` | Just-in-Time Slot Leases | Just-in-Time Slot Leases (runtime.jit@0.1.0) | ✅ Implemented | 100.0% |
| `P6.23` | Cancellation + Accounting | Cancellation + Accounting (runtime.cancel@0.1.0) | ✅ Implemented | 100.0% |
| `P6.24` | Runtime Pools | Runtime Pools (runtime.pool@0.1.0) | ✅ Implemented | 100.0% |
| `P6.25` | Native ABI + Dual Artifacts | Native ABI + Dual Artifacts (node.abi@0.1.0) | ✅ Implemented | 100.0% |
| `P6.26` | The WASM Compilation Cache | The WASM Compilation Cache (runtime.wasm-cache@0.1.0) | ✅ Implemented | 100.0% |
| `P6.27` | Provenance Statements and the Transparency Log | Provenance Statements and the Transparency Log (node.provenance@0.1.0) | ✅ Implemented | 100.0% |
| `P6.28` | Metadata Freshness — Rollback, Freeze and Mix-and-Match | Metadata Freshness — Rollback, Freeze and Mix-and-Match (registry.freshness@0.1.0) | ✅ Implemented | 100.0% |
| `P6.29` | Name Claims, Handovers and Confusion | Name Claims, Handovers and Confusion (node.namespace@0.1.0) | ✅ Implemented | 100.0% |
| `P6.30` | Repair, Ordered Restoration and Offline Recovery | Repair, Ordered Restoration and Offline Recovery (registry.repair@0.1.0) | ✅ Implemented | 100.0% |
| `P6.31` | The Acceptance of the Milestone | The Acceptance of the Milestone (registry.acceptance@0.1.0) | ✅ Implemented | 100.0% |
| `P6-S01` | Live community / private / custom node installation path over the P6 admission pipeline | Live community / private / custom node installation path over the P6 admission pipeline | 🟡 Planned | 0.0% |
| `P6-S02` | Production WASM node/plugin sandbox engine | Production WASM node/plugin sandbox engine (P6.26 compilation cache and P2.27.4 locality are the foundation) | 🟡 Planned | 0.0% |
| `P6-S03` | Universal resilient scraper node | Universal resilient scraper node (candidate sub-slices S1-S21 in #115) | ⚪ Proposed | 0.0% |
| `P6-S04` | Native high-performance node catalog | Native high-performance node catalog (candidates N1-N12 in #116) | ⚪ Proposed | 0.0% |

</details>

## P7 — Dynamic Parameters / Schema Runtime

**0.0%**

`░░░░░░░░░░░░░░░░░░░░ 0.0%`

0 / 1 slices implemented. Remaining 1. 0 implemented, 1 planned.

- **Program status:** planned. Program status is not a substitute for the percentage.
- **Purpose:** Dynamic parameter schemas, option discovery, schema validation, caching, provider-backed lookup, parameter plugin boundaries (#90, #223).

<details><summary>Slices (1)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `P7-S01` | P7 implementation ladder per #223 §42 | P7 implementation ladder per #223 §42 (not authorized; requires a Manager Master Prompt) | 🟡 Planned | 0.0% |

</details>

## P8 — Storage / Data Layer

**0.0%**

`░░░░░░░░░░░░░░░░░░░░ 0.0%`

0 / 1 slices implemented. Remaining 1. 0 implemented, 1 planned.

- **Program status:** planned. Program status is not a substitute for the percentage.
- **Purpose:** Provider-neutral storage contracts, workflow/execution persistence, graph segments, indexes, transactions, migrations, backup/recovery, SQLite/PostgreSQL/object-store providers (#90).

<details><summary>Slices (1)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `P8-S01` | Storage contract foundation | Storage contract foundation (not authorized) | 🟡 Planned | 0.0% |

</details>

## P9 — Observability / Diagnostics / Operations

**95.7%**

`███████████████████░ 95.7%`

22 / 23 slices implemented. Remaining 1. 22 implemented, 1 planned.

- **Program status:** complete. Program status is not a substitute for the percentage.
- **Purpose:** Logs, metrics, traces, execution diagnostics, resource-pressure telemetry, replay diagnostics, plugin health, operator tooling, audit integration (#90, #101).

<details><summary>Slices (23)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `P9.1` | Canonical telemetry envelope and correlation context | Canonical telemetry envelope and correlation context | ✅ Implemented | 100.0% |
| `P9.2` | Structured logs and versioned severity/error taxonomy | Structured logs and versioned severity/error taxonomy | ✅ Implemented | 100.0% |
| `P9.3` | Metric contract and cardinality governance | Metric contract and cardinality governance | ✅ Implemented | 100.0% |
| `P9.4` | Trace contract and cross-boundary propagation | Trace contract and cross-boundary propagation | ✅ Implemented | 100.0% |
| `P9.5` | Semantic event contract + lifecycle events | Semantic event contract + lifecycle events (observability.semantic-event@1.0.0) | ✅ Implemented | 100.0% |
| `P9.6` | Bounded telemetry buffer + P0–P4 backpressure | Bounded telemetry buffer + P0–P4 backpressure (observability.telemetry-buffer@1.0.0) | ✅ Implemented | 100.0% |
| `P9.7` | fail-closed telemetry redaction + data classification | fail-closed telemetry redaction + data classification (observability.telemetry-redaction@1.0.0) | ✅ Implemented | 100.0% |
| `P9.8` | sampling + adaptive telemetry policy | sampling + adaptive telemetry policy (observability.telemetry-sampling@1.0.0) | ✅ Implemented | 100.0% |
| `P9.9` | resource/pressure telemetry | resource/pressure telemetry (observability.resource-pressure@1.0.0) | ✅ Implemented | 100.0% |
| `P9.10` | health/readiness model | health/readiness model (observability.health-readiness@1.0.0) | ✅ Implemented | 100.0% |
| `P9.11` | execution diagnostics contract | execution diagnostics contract (observability.execution-diagnostics@1.0.0) | ✅ Implemented | 100.0% |
| `P9.12` | Diagnostic Bundle Compiler | Diagnostic Bundle Compiler (observability.diagnostic-bundle@1.0.0) | ✅ Implemented | 100.0% |
| `P9.13` | Failure Correlation + Causal Evidence | Failure Correlation + Causal Evidence (observability.failure-correlation@1.0.0) | ✅ Implemented | 100.0% |
| `P9.14` | replay/compatibility evidence integration | replay/compatibility evidence integration (observability.replay-evidence@1.0.0) | ✅ Implemented | 100.0% |
| `P9.15` | retention + HOT/WARM/COLD policy | retention + HOT/WARM/COLD policy (observability.telemetry-retention@1.0.0) | ✅ Implemented | 100.0% |
| `P9.16` | operator inspection API | operator inspection API (observability.operator-inspection@1.0.0) | ✅ Implemented | 100.0% |
| `P9.17` | Low-Resource Observability Mode | Low-Resource Observability Mode (stacked on P9.16) | ✅ Implemented | 100.0% |
| `P9.18` | Telemetry Self-Observability | Telemetry Self-Observability (stacked on P9.17) | ✅ Implemented | 100.0% |
| `P9.19` | Multi-Tenant Telemetry Isolation Readiness | Multi-Tenant Telemetry Isolation Readiness (stacked on P9.18) | ✅ Implemented | 100.0% |
| `P9.20` | Observability Contract Oracle + Cross-Domain Acceptance | Observability Contract Oracle + Cross-Domain Acceptance (stacked on P9.19) | ✅ Implemented | 100.0% |
| `P9.21` | Advanced Diagnostics / Incident Intelligence | Advanced Diagnostics / Incident Intelligence (stacked on P9.20) | ✅ Implemented | 100.0% |
| `P9.22` | Full P9 Acceptance | Full P9 Acceptance (stacked on P9.21, final slice) | ✅ Implemented | 100.0% |
| `P9-S01` | Per-node execution cost/resource ledger correlated with P9 telemetry | Per-node execution cost/resource ledger correlated with P9 telemetry (#224 item 20) | 🟡 Planned | 0.0% |

</details>

## P10 — Multi-Tenant / Isolation / Quota

**0.0%**

`░░░░░░░░░░░░░░░░░░░░ 0.0%`

0 / 1 slices implemented. Remaining 1. 0 implemented, 1 planned.

- **Program status:** planned. Program status is not a substitute for the percentage.
- **Purpose:** Only when required: tenant lifecycle, storage/compute/capability isolation, per-tenant budgets, noisy-neighbor protection, tenant administration (#90, #78). Single-tenant remains the first target.

<details><summary>Slices (1)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `P10-S01` | Tenant-aware contracts beyond the P5 "default" tenant | Tenant-aware contracts beyond the P5 "default" tenant (not authorized) | 🟡 Planned | 0.0% |

</details>

## P11 — Worker / Distributed Scaling / HA

**0.0%**

`░░░░░░░░░░░░░░░░░░░░ 0.0%`

0 / 1 slices implemented. Remaining 1. 0 implemented, 1 planned.

- **Program status:** planned. Program status is not a substitute for the percentage.
- **Purpose:** Independent worker pools, queue/scheduler integration, remote plugin scaling, HA, recovery, distributed execution, horizontal scaling — never microservice-per-node (#90).

<details><summary>Slices (1)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `P11-S01` | Worker pool + queue integration foundation | Worker pool + queue integration foundation (not authorized) | 🟡 Planned | 0.0% |

</details>

## FUTURE-EVENT — Event & Automation Control Plane

**0.0%**

`░░░░░░░░░░░░░░░░░░░░ 0.0%`

0 / 1 slices implemented. Remaining 1. 0 implemented, 1 planned.

- **Program status:** planned. Program status is not a substitute for the percentage.
- **Purpose:** Thematic future program. Not a P number and not authorized: a slice starts only with a Manager Master Prompt. Legacy issue -> feature -> program -> future slice stays traceable.

<details><summary>Slices (1)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `FUTURE-EVENT-S01` | Durable signals, timers and external-event resume | Durable signals, timers and external-event resume (not authorized) | 🟡 Planned | 0.0% |

</details>

## FUTURE-RELIABILITY — Execution Reliability, Data Plane, Scheduling & Certification

**50.0%**

`██████████░░░░░░░░░░ 50.0%`

1 / 2 slices implemented. Remaining 1. 1 implemented, 1 planned.

- **Program status:** planned. Program status is not a substitute for the percentage.
- **Purpose:** Thematic future program. Not a P number and not authorized: a slice starts only with a Manager Master Prompt. Legacy issue -> feature -> program -> future slice stays traceable.

<details><summary>Slices (2)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `FUTURE-RELIABILITY-S01` | Standalone benchmark / reproducibility certification tooling | Standalone benchmark / reproducibility certification tooling (legacy P21) | ✅ Implemented | 100.0% |
| `FUTURE-RELIABILITY-S02` | Side-effect reliability | effect ledger, outbox/inbox, idempotency before retry (legacy P13; not authorized) | 🟡 Planned | 0.0% |

</details>

## FUTURE-PLATFORM — Release, Collaboration & Operator Platform

**0.0%**

`░░░░░░░░░░░░░░░░░░░░ 0.0%`

0 / 1 slices implemented. Remaining 1. 0 implemented, 1 planned.

- **Program status:** planned. Program status is not a substitute for the percentage.
- **Purpose:** Thematic future program. Not a P number and not authorized: a slice starts only with a Manager Master Prompt. Legacy issue -> feature -> program -> future slice stays traceable.

<details><summary>Slices (1)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `FUTURE-PLATFORM-S01` | Schema/compatibility gateway + upgrade simulator | Schema/compatibility gateway + upgrade simulator (legacy P14; not authorized) | 🟡 Planned | 0.0% |

</details>

## FUTURE-DISTRIBUTION — Worker Fabric, Storage Lifecycle & Disaster Recovery

**0.0%**

`░░░░░░░░░░░░░░░░░░░░ 0.0%`

0 / 1 slices implemented. Remaining 1. 0 implemented, 1 planned.

- **Program status:** planned. Program status is not a substitute for the percentage.
- **Purpose:** Thematic future program. Not a P number and not authorized: a slice starts only with a Manager Master Prompt. Legacy issue -> feature -> program -> future slice stays traceable.

<details><summary>Slices (1)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `FUTURE-DISTRIBUTION-S01` | Execution leases, fencing and stalled-worker recovery | Execution leases, fencing and stalled-worker recovery (legacy P19; not authorized) | 🟡 Planned | 0.0% |

</details>

## FUTURE-AI-ECOSYSTEM — AI Runtime Optimization & Ecosystem Interoperability

**0.0%**

`░░░░░░░░░░░░░░░░░░░░ 0.0%`

0 / 1 slices implemented. Remaining 1. 0 implemented, 1 planned.

- **Program status:** planned. Program status is not a substitute for the percentage.
- **Purpose:** Thematic future program. Not a P number and not authorized: a slice starts only with a Manager Master Prompt. Legacy issue -> feature -> program -> future slice stays traceable.

<details><summary>Slices (1)</summary>

| Slice | Title | Purpose | Status | Progress |
| --- | --- | --- | --- | ---: |
| `FUTURE-AI-ECOSYSTEM-S01` | Lazy tool/skill discovery + token-aware capability budgets | Lazy tool/skill discovery + token-aware capability budgets (legacy P18; not authorized) | 🟡 Planned | 0.0% |

</details>

## Future programs (legacy P12–P23 consolidated)

| Future program | Legacy milestones | Progress | Slices implemented |
| --- | --- | ---: | --- |
| FUTURE-EVENT | P12 | 0.0% | 0/1 |
| FUTURE-RELIABILITY | P13, P16, P17, P21 | 50.0% | 1/2 |
| FUTURE-PLATFORM | P14, P15, P22 | 0.0% | 0/1 |
| FUTURE-DISTRIBUTION | P19, P20 | 0.0% | 0/1 |
| FUTURE-AI-ECOSYSTEM | P18, P23 | 0.0% | 0/1 |

## Historical P2 ladder

17 completed milestones (`P2.11` … `P2.27`, with the `P2.27.x` sub-slices under program P2) are immutable implementation history. Historical pointers: current `P2.27`, previous completed `P2.26` (history, not active work). The generic `P2.17+` (planned) row is a historical placeholder label; it authorizes no work.

## Milestone Governance

- **Milestone authority:** `main` owns milestone truth (DEC-0020). Canonical register: [`docs/n8n-lego/milestones.json`](docs/n8n-lego/milestones.json); generated projections: this section of `README.md`, `.ai/master/MILESTONE_REGISTER.md` and `.ai/master/CURRENT_STATUS.md`. `arena-manager` is Manager planning memory only (canonical: false); `docs/n8n-lego/ROADMAP.md` is strategy narrative and owns no status.
- **Rule:** Milestone truth is main-owned. A milestone design found or developed in Manager memory becomes authoritative only when reconciled into main through a PR. arena-manager is not an alternate milestone authority, and its docs/ tree is a stale snapshot that is never copied over main.
- **Pending reconciliation:** A milestone change that exists only on arena-manager, a local worktree, a handoff, an issue, a PR body or chat is a proposal (pending reconciliation), never authoritative truth. A PR proposes a milestone state; only the merged state on main is authoritative.
- **Freshness:** generated by `npm run lego:ai` from register 2.1.0 (fingerprint `ef35264740fa7417`); `npm run lego:ai:check` fails when this section, the `.ai` pack or the register disagree.
- **Completion KPI:** implemented slices / slices in the active total. A verifying or blocked slice never increases the numerator.
- **Purpose field:** a slice purpose is `slice.purpose` when present, otherwise the text after the first `: ` in the canonical title, otherwise the title. No purpose is invented.
- **Top level:** programs P0–P11 only. There is no P12+ or P24+ and no P5.9; legacy P12–P23 are consolidated into future programs. New work is `Pn-Snn`, `Pn-Mnn` or `FUTURE-<THEME>-Snn`.
- **Post-merge sequence:** delivery PR → merge to main → post-merge verification → register status and evidence update → README milestone projection (generated) → .ai regeneration → governance PR → merge governance PR → final main verification.
- **No batching:** Every change of milestone state (planned -> in-progress, in-progress -> implemented, a split or a new blocker) is recorded on main by the next governance PR; updates are never batched into a later roadmap cleanup.
- **Completion rule:** Immediately after merge + post-merge verification, the slice and its features become implemented with PR, merge SHA, tests and evidence; remaining debt is recorded as Pn-Mnn. An open PR means in-progress, never implemented.
- One delivery PR per slice (DEC-0014); the post-merge register/README/.ai update is a separate governance PR, not a second delivery PR.
- A slice cycle is closed only when implementation, register, this README section, the generated `.ai` and evidence agree on `main`.
- Evidence lives in `docs/n8n-lego/evidence/`; each slice's `evidence` field names its file.
<!-- END GENERATED milestone-governance -->

## Structure

- `reference/n8n/` : pristine upstream n8n 2.9.4 source (read-only, hash-pinned)
- `docs/anatomy/` : system anatomy (18 documents)
- `contracts/` : formal LEGO contracts (`workflow`, `node`, `connection`, `validation`)
- `docs/isolation/` : Phase 2 isolation records, dependency map, port contract, verification report
- `packages/workflow-lego/` : the isolated Workflow Model LEGO (boundary, ports, tests, manifests)
- `tools/` : boundary mapper, kernel/port/reference gates, isolation extractor, model digest, gate runner, live engine harness
- `tests/reference/` : golden workflows + baseline smoke test evidence
- `tasks/`, `results/` : inbound task manifests and execution results
- `crates/` : active Rust implementation workspace (8 member crates)
- `docs/isolation/trigger-rust-port.md` : `trigger.lifecycle` port record (symbol map, divergences, evidence)
- `apps/n8n-rust/` : application entry point & runner

## Verify Rust Workspace

```bash
cargo check --workspace
cargo test --workspace
```

Without registry access (sandbox / review boxes) the offline rig builds the same crates
against the exact `Cargo.lock` versions; `n8n-nodes-rust` stays with the CI runner because
its `tokio` dev-dependency closure is not vendored:

```bash
tools/rust-offline-rig/setup.sh     # toolchain from npm + vendored crates from git
tools/rust-offline-rig/run.sh test
```

## Verify a Reference LEGO

```bash
scripts/setup-reference-runtime.sh        # n8n-workflow/core/nodes-base 2.9.1 == the n8n 2.9.4 dependency set
npm install --prefix packages/workflow-lego
npm run verify                            # 11 gates; writes docs/isolation/evidence/*

npm run verify:fast                       # same, without the live engine checks
npm run isolation:check                   # boundary + kernel + port + reference-integrity only
```

A failing gate means the isolation is void and must be rolled back — the records
are machine-readable in `docs/isolation/evidence/`.

## TypeScript baseline runtime (usable track)

Track terpisah yang membuat LEGO TypeScript bisa dipakai hari ini
(install → start → deploy VPS) sementara Rust tetap beku di track ini:

```bash
bash scripts/install.sh && bash scripts/start.sh && bash scripts/doctor.sh
npm run ts:test   # adapter (14) + runtime nyata (44) + integrasi (3)
```

Kontrak: `contracts/ts-baseline-runtime.contract.md` ·
Panduan: `docs/TS-BASELINE.md` · Bukti gate: `results/TS-BASELINE-GATES.md`.
