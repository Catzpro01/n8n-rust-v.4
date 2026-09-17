# Phase 2 LEGO Isolation: Workflow Model

**LEGO 01 — Workflow.** Structural isolation only. No Rust, no behavior change.

Reference: `reference/n8n/packages/workflow` at n8n **2.9.4** (commit `b6dc2787c45677a29a9612cd27eb911302961a83`, package version `n8n-workflow@2.9.1`).

---

## 1. Goal & boundary definition

Isolate the pure Workflow Model from the reference package so it becomes a LEGO with an explicit, machine-checked boundary — while n8n keeps behaving identically.

- **Input:** workflow JSON (`id`, `name`, `nodes`, `connections`, `settings`, `staticData`, `pinData`, `active`).
- **Output:** the Workflow aggregate plus adjacency indexes, graph traversal, connection diffing, content checksum and graph validation.

### Owns (10 source files)

| file | responsibility |
| :--- | :--- |
| `workflow.ts` | `Workflow` aggregate: nodes keyed by name, connections by source/destination, settings, static data, pin data, start node, renames, connection indexes |
| `common/get-child-nodes.ts` | child nodes by type/depth |
| `common/get-parent-nodes.ts` | parent nodes by type/depth |
| `common/get-connected-nodes.ts` | shared traversal implementation |
| `common/get-node-by-name.ts` | node lookup |
| `common/map-connections-by-destination.ts` | destination adjacency index |
| `common/index.ts` | barrel |
| `graph/graph-utils.ts` | adjacency list, root/leaf nodes, path checks, extractable-subgraph validation |
| `connections-diff.ts` | connection diffing |
| `workflow-checksum.ts` | workflow content checksum |

### Does NOT own (declared, reachable only through ports)

| artifact | owner | why it is out |
| :--- | :--- | :--- |
| `node-helpers` | LEGO 02 — Node Model | parameter defaults, output resolution |
| `node-parameters/rename-node-utils` | LEGO 02 — Node Model | form-field rewriting |
| `node-reference-parser-utils` | LEGO 02 — Node Model | access-pattern rewriting |
| `node-validation`, `workflow-validation` | LEGO 04 — Validation | validation rules |
| `expression`, `expressions/**`, `workflow-data-proxy*` | runtime | expression evaluation — out of scope this phase |
| execution, persistence, webhook runtime, scheduler, queue | `n8n-core`, `packages/cli` | never part of this package |

### Shared kernel (cross-LEGO vocabulary, not owned)

`interfaces`, `constants`, `utils`, `observable-object`, `global-state`, `errors/**`, `data-table.types`, `deferred-promise`.

---

## 2. Declared ports (the isolation surface)

Every dependency that leaves the LEGO is a declared port; the gate fails on any crossing that is not. Full contract: [`workflow-port-contract.md`](./workflow-port-contract.md).

| port | role | provides | adapter |
| :--- | :--- | :--- | :--- |
| `P-KERNEL-TYPES` | shared kernel | type vocabulary + `NodeConnectionTypes` | `src/ports/vocabulary.ts` |
| `P-KERNEL-CONSTANTS` | shared kernel | `STARTING_NODE_TYPES`, renameable-content sets, … | `src/ports/constants.ts` |
| `P-KERNEL-ERRORS` | shared kernel | `ApplicationError`, `UserError` | `src/ports/errors.ts` |
| `P-KERNEL-UTILS` | shared kernel | `dedupe`, `isObject` | `src/ports/utils.ts` |
| `P-KERNEL-OBSERVABLE` | shared kernel | static-data change tracking | `src/ports/observable-object.ts` |
| `P-KERNEL-CONFIG` | shared kernel | default timezone | `src/ports/config.ts` |
| `P-NODE-MODEL` | LEGO 02 | `getNodeParameters`, `getNodeOutputs` | `src/ports/node-model.ts` |
| `P-NODE-RENAME` | LEGO 02 | `renameFormFields` | `src/ports/node-rename.ts` |
| `P-NODE-REFERENCE` | LEGO 02 | `applyAccessPatterns` | `src/ports/node-reference.ts` |
| `P-EXPRESSION-RUNTIME` | runtime (out of scope) | `Expression` attached to a workflow | `src/ports/expression-runtime.ts` |
| `P-EXTERNAL-JSSHA` | third-party | SHA-256 fallback of the checksum | `src/ports/checksum-digest.ts` |

Two port implementations exist:

- `reference` (default) — binds every port to the pinned reference runtime `n8n-workflow@2.9.1`; behavior identical to n8n by construction.
- `strict` — standalone implementations with no reference runtime and no third-party deps; used to prove there is no hidden coupling.

---

## 3. What was actually changed

| artifact | change |
| :--- | :--- |
| `reference/n8n/**` | **nothing** — verified byte-for-byte (15 050 files, root hash pinned in `packages/workflow-lego/manifest/reference.sha256.json`) |
| `packages/workflow-lego/` | new: ownership manifest, ports + adapters, facade/seam, isolated build pipeline, 19 isolation tests |
| `tools/` | new: boundary mapper, kernel conformance, port surface extractor, reference manifest, extraction, digest, gate runner, live engine harness |
| `docs/` | this record, port contract, generated dependency map, verification report + evidence |
| `contracts/workflow.contract.md` | unchanged (the LEGO implements it; it is not redefined here) |

The isolated unit is *derived*, never hand-copied: `tools/workflow-isolation-extract.mjs` copies the 10 owned files from the reference and rewrites **only** the specifiers that map to a declared port (25 rewrites across 10 files). Reverting those rewrites must reproduce the reference bytes exactly, and that property is asserted by the tests.

---

## 4. Verification

Full report: [`workflow-verification.md`](./workflow-verification.md) · machine-readable: [`evidence/gate-report.json`](./evidence/gate-report.json).

| # | gate | result |
| :--- | :--- | :--- |
| G01 | boundary drift (owned files, crossings, inbound edges) | PASS |
| G02 | kernel snapshot conformance vs reference source | PASS |
| G03 | port surface == consumed imports | PASS |
| G04 | reference tree byte-identical to pinned hashes | PASS |
| G05 | extraction is a pure import rewrite | PASS |
| G06 | TypeScript build PASS (isolated unit, ports only) | PASS |
| G07 | TypeScript build PASS (boundary/ports/facade) | PASS |
| G08 | unit tests PASS (19 tests) | PASS |
| G09 | BEFORE vs AFTER digest — 252 section comparisons, 18 workflows | PASS · 0 differences |
| G10 | strict port mode — no hidden coupling | PASS |
| G11 | live engine — load, save, 1-node, linear, webhook, execution record | PASS · 7/7 |

**BEFORE:** n8n 2.9.4 → 11/11 PASS — VPS baseline, PostgreSQL + full CLI (`tests/reference/baseline/SMOKE_TEST_RESULTS.md`, `reference/n8n/REFERENCE_VERSION.md`).
**AFTER:** n8n 2.9.4 → 11/11 PASS — unchanged, and re-verified here in two ways:

1. **Byte identity (G04):** the tree that produced the 11/11 baseline is hash-pinned; all 15 050 files are unchanged, so the code that passed cannot have drifted.
2. **Live engine re-run (G11):** 7 checks executed against the real engine, including a webhook POST over HTTP (`HTTP 200 → {"smoke_test":"PASS","verified":true}`) and a real manual execution producing the expected items.

Two paths of the baseline cannot be replayed in this sandbox and are therefore *not* claimed locally: the full CLI/Postgres persistence path and Code-node execution (n8n 2.x runs JS code out of process via the task runner). Both are listed under `knownLimitations` in `evidence/live-verification.json`.

The digest corpus is n8n's own workflows (3 golden + 10 AI-workflow-builder reference workflows + 5 workflow-sdk fixtures, including `ai_tool` / `ai_languageModel` / `ai_outputParser` connection types), executed against real node descriptions from `n8n-nodes-base`.

---

## 5. How to reproduce

```bash
scripts/setup-reference-runtime.sh     # installs n8n-workflow/core/nodes-base 2.9.1 (the 2.9.4 dependency set)
npm install --prefix packages/workflow-lego
npm run verify                         # runs all 11 gates and writes docs/isolation/evidence/*
```

---

STATUS: VERIFIED

REFERENCE BASELINE:
11/11 PASS

AFTER ISOLATION:
11/11 PASS

BEHAVIOR CHANGE:
NONE DETECTED

RUST POLICY:
FORBIDDEN (PROJECT_RULES.md #1)

---

### Reading note for the next agent

`isolated` in this document means **the TypeScript Workflow Model now has an explicit, enforced boundary** (`packages/workflow-lego/`), not that reconstruction is complete. The running implementation is still the pinned reference runtime: `packages/workflow-lego/src/model-surface.ts` re-exports it, and that file is the seam the native JavaScript/TypeScript reconstruction must preserve.

Next in the sequence: **LEGO 02 Node Model** → LEGO 03 Connection → LEGO 04 Validation → native JavaScript/TypeScript LEGO reconstruction and parity verification.

### Governance status of this record (2026-09-17)

| Field | Value |
| :--- | :--- |
| Self-verification | `npm run verify` → 11/11 PASS on this branch |
| Guardian (Agent 5) verification | **PENDING** — audited `origin/main` *before* this branch existed, so `docs/isolation/LEGO-MASTER-MAP.md` still lists Workflow as `ANALYZED`. Verification request: `docs/isolation/workflow-handoff.md` §5 (`MSG-04`). |
| Merge status | PR #1 stays **unmerged** until Agent-5 verification (rule 7 of the agent brief). |
| Bus delivery | Supabase bus has no client and no `service_role` key in this environment → envelopes persisted in `docs/isolation/workflow-bus-outbox.json`. |

Peer-facing interface package (what LEGO 02/03/04 must implement or consume, plus the
`graph/**` / `connections-diff` ownership conflict and the `ISSUE-003` cycle-detection resolution):
`docs/isolation/workflow-handoff.md`.
