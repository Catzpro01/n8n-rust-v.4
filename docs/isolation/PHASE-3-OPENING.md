# PHASE 3 — FORMAL OPENING RECORD

**Date:** 2026-09-17
**Decision:** Phase 3 (Reference Test & Rust Contract Implementation) is **formally OPEN**.
**Authority:** Orchestrator decision, resolving ISSUE-012 required decision #1
("Formally open Phase 3 with a manifest/decision record"). Phase 2 closed VERIFIED by
Agent 5 in `results/TASK-305-phase2-final-verdict`'s manifest
(`REGRESSION_GATE_PASSED`, `READY_FOR_PHASE_3`).

This document exists because ISSUE-012 was filed when Rust landed on `main` with no
phase record: *"the only evidence of a phase change is a commit-message prefix."* The
phase is now opened in writing, with each of Agent 5's entry conditions answered below.

---

## 1. Entry conditions (per ISSUE-012) — status at opening

| # | Condition (Agent 5, ISSUE-012) | Status at opening | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | ISSUE-011 closed: reference tree byte-identical to pinned n8n 2.9.4 | **MET** — `node-model/index.ts` relocated to `docs/isolation/node-barrel.ts` (commit a445a9ab) | `node tools/workflow-reference-manifest.mjs --check` → `PASS (15050 files, root f8da35180669…)` |
| 2 | Compatibility tests driving each crate from `tests/reference/**` (PROJECT_RULES §5), incl. the `05-cyclic-invalid` negative fixture | **MET** — all 7 crates consume golden fixtures from disk; negative fixture is exercised | `crates/*/tests/*_fixtures.rs`; `tools/rust-offline-rig/run.sh test` → **60/60 PASS** in this sandbox |
| 3 | `INVALID_CONNECTION_TYPE` implemented in `n8n-validation` (4 of 4 contract codes) | **MET** — port of the TASK-306-approved `workflow-rules.ts`: `InvalidConnectionType` variant + `validate_connection_types` + full `validate_workflow` aggregate (`INVALID_INPUT`, accumulate-all, `allowCycles` default `true` per contract §11.7, cycles over `main` only per §11.8) | `crates/n8n-validation/src/lib.rs`, 9 unit + 4 fixture tests |
| 4 | `cargo` available in the verification environment | **MET** — offline rig repaired and committed: vendoring now covers `indexmap`/`equivalent`/`hashbrown`/`regex`/`aho-corasick` (+automata/syntax), dev-dep stripping and orphaned-feature pruning | `tools/rust-offline-rig/setup.sh`, `vendor_prep.py`; `run.sh check` PASS |
| 5 | Phase-3 decision record | **THIS DOCUMENT** | — |

Silent-skip conformance tests (ISSUE-014 defect 2) were removed in the same batch:
fixture reads are fail-loud `CARGO_MANIFEST_DIR`-relative paths, so deleting a golden
turns the suite red instead of green.
ISSUE-017 (proven HIGH): `getStartNode` returned a disabled trigger; the port now
implements the reference's asymmetric `disabled` semantics and the disabled-returning
final fallback, pinned by a runtime-derived `startNode` fixture group (7 cases) and the
transcribed spec `tests/reference/04-disabled-node/expected.json` — with a mutation
test proving the fixture fails if the port is reverted (see §5).

## 2. Scope of the Phase-3 workspace

Crates present on `main` (`Cargo.toml` workspace) and their fixture coverage:

| Crate | Ports | Golden fixtures consumed (from disk) |
| :--- | :--- | :--- |
| `n8n-common` | kernel wire types (`INodeExecutionData`, `BinaryData`, `IDataObject`) | `execution-data/01-single-item`, `execution-data/06-binary-reference`, `03-linear` |
| `n8n-connection` | connection model, `mapConnectionsByDestination`, `get-connected-nodes`, `hasPath` (main-only DFS) | `connection/01-linear` (8 probes), `connection/03-connection-types` (8 probes) |
| `n8n-validation` | 4 rule vocabulary + `validateWorkflow` aggregate | `05-cyclic-invalid` (negative), `03-linear` |
| `n8n-node-model` | `INode` + strict round-trip | `03-linear`, `04-disabled-node` |
| `n8n-execution-data` | item envelope helpers | `execution-data/01-single-item`, `execution-data/06-binary-reference` |
| `n8n-expression` | `is_expression`, `$json` path, interpolation (string-valued) | `expression/01-json-access` (5 probes; 8 recorded skips for JS-eval scope) |
| `n8n-workflow` | frozen 15-symbol workflow surface + `getHighestNode`/`getStartNode` | `workflow-rust/fixtures.json` (42 cases runtime-derived, `--check`-enforced), `01/03-linear`, `04-disabled-node` |

`apps/n8n-rust/` remains `.gitkeep`-only: no host application yet.

## 3. Recorded deliberate divergences (must not be "fixed" silently)

1. **`__getStartNode` registry branch** (`workflow.ts:830-842`): resolving
   `nodeType.trigger/poll` and the manual-chat-trigger exclusion requires the node-type
   registry, which lives outside the Workflow LEGO. The port exercises the
   no-registry branch; schedule/cron/poll nodes are only honoured if they also appear in
   `STARTING_NODE_TYPES`. Golden `startNode` cases were derived with a documented
   no-trigger/no-poll stub for exactly this reason.
2. **Expression crate is string-valued**: JS return-type preservation (single-`{{ }}`
   keeps `number`/`boolean`/`object`), `$data` alias, JS evaluation and
   `ExpressionError` envelopes are NOT ported yet; the unported probes are pinned
   (`UNPORTED_PROBES`) in `crates/n8n-expression/tests/expression_fixtures.rs`.
3. **UTF-16 vs UTF-8 key order** in `sortObjectKeys` (checksum): identical for ASCII,
   differs for astral-plane keys (documented in `checksum.rs`).
4. **Number text representation**: Rust `f64` prints `240.0` where JS prints `240`;
   wire round-trips assert semantic (numeric) equality, not text equality
   (`assert_js_eq` in `n8n-node-model/tests/node_fixtures.rs`).
5. **Fallback totality**: the port never throws; where the reference would `TypeError`
   on unknown nodes (`this.nodes[x].disabled`), the port returns `None`/empty.
6. **`serde_json` `preserve_order` is enabled workspace-wide** to keep JS object
   insertion order (error sequences and serialization follow document order, like the
   reference). The checksum sorts keys explicitly (port of `sortObjectKeys`) and does
   not rely on map ordering.

## 4. Gate discipline for Phase 3

- The Phase-2 guard in `tests/compatibility/contract_conformance.mjs` and
  `tests/integration/boundary_audit.py` no longer fails on the *existence* of
  `crates/**`; it now **requires this record to exist** when Rust is present. Removing
  `docs/isolation/PHASE-3-OPENING.md` while Rust exists fails the gate.
- Reference-tree integrity is now checked on every gate run
  (`tools/workflow-reference-manifest.mjs --check`, wired into `run_gate.sh` Stage 1) —
  an ISSUE-011 class break is caught statically, not weeks later.
- Golden fixtures stay append-only in meaning: expected values are derived from the
  pinned runtime (`build-fixtures.mjs --check` re-derives and fails on drift) or
  transcribed with source line citations (`04-disabled-node`). Editing goldens to match
  code remains the single disqualifying act.
- The 11/11 live regression gate remains required before "LIVE VERIFIED" claims; the
  offline rig makes `cargo test` claims locally reproducible (`run.sh test`).

## 5. Verification snapshot at opening (2026-09-17)

```
$ node tools/workflow-reference-manifest.mjs --check
Reference integrity check: PASS (15050 files, root f8da35180669d798…)

$ node tests/reference/workflow-rust/build-fixtures.mjs --check
fixtures match the pinned reference: 8 checksum, 6 diff, 6 shape, 6 rename, 9 traversal, 7 startNode cases

$ tools/rust-offline-rig/run.sh test       # offline, cargo 1.88.0
passed: 60  failed: 0

# Mutation falsification (ISSUE-017): with the strict self-check in
# get_highest_nodes mutated to the lenient form (disabled != Some(true)),
# fixture case `omitted-disabled-asymmetry` FAILS as designed; restored → 60/60.

$ node tests/compatibility/contract_conformance.mjs
31/31 PASS (incl. inverted CycleDetection for the 05-cyclic-invalid negative fixture)
```

## 6. Inherited caveats (carried from TASK-305, unchanged)

- **C1** — the live 11/11 must be re-run on the VPS + PostgreSQL as the first live
  Phase-3 verification step (the recorded baseline was local + SQLite).
- **C2** — before/after harness probe drift (TRACE vs PROPFIND): re-record strictly A/B
  when the VPS is reachable.
- **C3** — ISSUE-004 (3 runtime cycles) and ISSUE-006 (global state/env coupling) remain
  OPEN upstream facts; they must be cut before any LEGO is swapped into a live path.
- **C4** — process: work should route `agent → review → integration → main`; Supabase
  is unreachable from this sandbox (SSL blocked), so consensus runs through the repo
  (`STANDING-WORKER-PROTOCOL.md` applied with repo-recorded votes).
- **ISSUE-016** (`pin_data` inert field): DEFERRED to the execution-LEGO phase by
  design; `get_pin_data_of_node` is NOT implemented and execution is not opening.
- **ISSUE-015** (traversal `disabled`): CLOSED-CORRECTED — plain traversal does not
  filter disabled nodes in the reference either (`graph-utils.ts` has no such code);
  the surviving start-node part is fixed and pinned (§1, §5).

---

### Update 2026-09-17b (post-merge of peer batch)

Verification numbers refresh: `run.sh test` → **59/59 PASS** (vocabulary consolidation
added 2); `run_gate.sh --offline-only` → Stages 1/1.5/2/2.5 all PASS, Stage 3 live NOT
RUN → gate `INCONCLUSIVE` (ISSUE-018 closed by peer `7df7da0e`; result integrity
41/41). Workflow-LEGO isolation gate `node tools/workflow-isolation-gate.mjs` →
**11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED** (label per handoff §7.1:
`isolation_gate_11/11`, distinct from the VPS smoke 11/11 still pending as C1).
