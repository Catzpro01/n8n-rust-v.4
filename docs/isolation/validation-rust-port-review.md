# Validation LEGO — Contract Conformance Review of the Rust port (`crates/n8n-validation`)

**Reviewer:** Agent 4 (contract owner, `contracts/validation.contract.md`)
**Subject:** `crates/n8n-validation/src/lib.rs` @ `c912866b` ("feat(phase-3): initialize Rust workspace and port LEGOs"), 103 lines
**Reference for parity:** `tests/reference/agent-4/validation/workflow-rules.ts` (TS implementation, 10/10 golden), golden cases D1–D10 in `docs/isolation/validation-golden-cases.md`
**Mode:** read-only review. `crates/**` is a forbidden path for Agent 4; no Rust was modified. `cargo` is not available in this sandbox, so findings are from source reading, not compilation or test execution.

**Verdict: NON-CONFORMANT (7 findings, 3 blocking).** The port implements the three rule *algorithms* but not the contract's *interface, semantics or compatibility requirements*. Goldens D4, D5, D6, D7, D8, D10 would fail as written.

---

## 1. Findings

| # | Severity | Contract clause | Rust port behaviour | Golden impact |
|---|---|---|---|---|
| F1 | **BLOCKING** | §11.7 `validateWorkflow` is opt-in; `allowCycles` **defaults to `true`** (reference parity — n8n allows runtime loops such as *Loop Over Items*) | No `validate_workflow` entry point and no option; `detect_cycles` is unconditional | D6 (`A→B→A`, default options → `valid:true`) **fails**; any real workflow using a loop node is rejected |
| F2 | **BLOCKING** | §11.8 CycleDetection considers **only `main`** connections; `ai_*` edges excluded | `detect_cycles` iterates `outputs.values()` — **all** connection types | D8 (`ai_tool`-only cycle → valid) **fails**; every AI agent + tool sub-graph with a back-reference is flagged |
| F3 | **BLOCKING** | §3 / §7 output is `{ valid, errors[] }` and **accumulates all** errors; never throws | Each function returns `Result<(), ValidationError>` and stops at the **first** violation | D4/D5 with multiple problems report only one; callers cannot show a full error list (editor UX regression vs the TS contract) |
| F4 | HIGH | §4.4 / D5 `INVALID_CONNECTION_TYPE` — connection `type` must be ∈ `nodeConnectionTypes` (13 values) | No check; `connection_type` is an unvalidated `String` | D5 **fails** |
| F5 | HIGH | §3 `ValidationError = { code, message, node?, path? }` with codes `DUPLICATE_NODE_NAME`, `DANGLING_CONNECTION`, `INVALID_CONNECTION_TYPE`, `CYCLE_DETECTED`, `INVALID_INPUT`; frozen messages (`Duplicate node name "X"`, `Connection from "A" to unknown node "B"`, `Cycle detected: A → B → A`) | Enum variants with different messages (`Node with name 'X' is duplicated`, `Connection targets non-existent node 'X'`, `Workflow contains cycle involving node 'X'`); no `code`, no `path`, no `INVALID_INPUT` | Message/shape parity with the TS reference and golden D3/D4/D7 **fails**; JSON consumers get a different envelope |
| F6 | MEDIUM | §2 input is `WorkflowContract` (`nodes: NodeContract[]`, `connections`, …); determinism requirement: DFS visits nodes in `nodes[]` order, edges in output/index order, reports the **cycle path** | Takes `&[String]` names (loses node metadata such as `disabled`); adjacency built from `HashMap` iteration → **non-deterministic** edge order; reports only one node name, not the path | D7 expects `Cycle detected: A → B → A`; port yields `…involving node 'A'` or `'B'` depending on hash seed |
| F7 | LOW | §9 / §3.3 of blueprint: connection-type vocabulary owned by Validation (`NODE_CONNECTION_TYPES`, parity-tested against `nodeConnectionTypes`) | Not present in `n8n-validation` nor `n8n-connection` | No single source of truth for the 13 types in Rust |

Non-findings (correct): dangling check covers both unknown **source** and unknown **target**; uniqueness uses a `HashSet` single pass; recursion-stack DFS is a valid cycle detector for the graph it is given; `dfs` is recursive (stack depth = longest path) — acceptable for n8n-sized graphs but the TS version is iterative; note for very large workflows.

Additional scope note: the crate covers only the **new capability** (§4.4). The reference-fidelity part of the LEGO — `validateFieldType` + 12 `tryToParse*` coercions, 14 type guards, ~40 zod schemas (blueprint §3) — has no Rust counterpart yet. That is acceptable for a Phase-3 skeleton but must be tracked; the frozen error strings in contract §7 are the acceptance criteria when it is ported.

---

## 2. Required changes for conformance (spec for the crate owner)

> Superseded by the full specification `docs/isolation/validation-rust-port-spec.md`; kept for history.

```rust
pub struct ValidateOptions { pub allow_cycles: bool }          // Default: allow_cycles = true
impl Default for ValidateOptions { fn default() -> Self { Self { allow_cycles: true } } }

#[derive(Serialize)] pub struct ValidationIssue {
    pub code: ValidationCode,          // DUPLICATE_NODE_NAME | DANGLING_CONNECTION | INVALID_CONNECTION_TYPE | CYCLE_DETECTED | INVALID_INPUT
    pub message: String,               // frozen strings, see contract §4.4 / golden D3–D7
    pub node: Option<String>,
    pub path: Option<Vec<String>>,     // e.g. ["connections","Trigger","main","0","0"]
}
#[derive(Serialize)] pub struct ValidationReport { pub valid: bool, pub errors: Vec<ValidationIssue> }

pub const NODE_CONNECTION_TYPES: [&str; 13] = [ "ai_agent","ai_chain","ai_document","ai_embedding","ai_languageModel","ai_memory","ai_outputParser","ai_retriever","ai_reranker","ai_textSplitter","ai_tool","ai_vectorStore","main" ];

pub fn check_node_uniqueness(nodes: &[NodeContract]) -> Vec<ValidationIssue>;         // all duplicates, in nodes[] order
pub fn check_dangling_connections(nodes: &[NodeContract], c: &WorkflowConnections) -> Vec<ValidationIssue>; // + INVALID_CONNECTION_TYPE
pub fn detect_cycles(nodes: &[NodeContract], c: &WorkflowConnections) -> Vec<ValidationIssue>;              // main edges only; iterate nodes[] order and Vec order (not HashMap order); message "Cycle detected: A → B → A"
pub fn validate_workflow(wf: &WorkflowContract, opts: ValidateOptions) -> ValidationReport;                // never panics; malformed → INVALID_INPUT
```

Determinism: build adjacency by iterating `nodes` in slice order and, for each source, `connections[source]["main"]` outputs in `Vec` order — do **not** iterate the `HashMap` to build edges. Use an explicit stack (iterative DFS) with white/grey/black colouring to reproduce the TS path reporting exactly.

Acceptance (machine-checkable): load every `tests/reference/agent-4/validation/fixtures/D*.json`, run `validate_workflow(input.workflow, input.options)`, serialise with sorted keys and compare to `expected` — 13 fixtures, zero diffs. Additionally port the D1–D10 table (`docs/isolation/validation-golden-cases.md` §D) as `#[test]`s, feeding the same JSON fixtures (`tests/reference/01-empty-workflow`, `03-linear`). A cross-language parity harness can run `node --test tests/reference/agent-4/validation/validation.test.ts` and `cargo test -p n8n-validation` on identical fixtures and diff the serialized `ValidationReport`.

---

## 3. Process note

`c912866b` landed on `main` directly (author Catzpro01) without an agent → Agent 5 → integration flow and without a `tasks/TASK-*.yaml` manifest — same pattern as ISSUE-001/008 (Agent 5 caveat C4). It also opens Phase 3 while caveat **C1** (11/11 re-run on the VPS + PostgreSQL) is still open, which Agent 5's verdict named as the precondition for the first Rust commit. Not Agent 4's call to make; recorded for the orchestrator.

This review does not change any status: Validation LEGO (TypeScript) remains **VERIFIED**; the Rust crate has **no** status until it passes the goldens and an Agent 5 gate.

---

## 4. Addendum — `182df8de` "test(phase-3): add unit test suites"

Re-checked after the follow-up commit (same author, direct to `main`). Diff to `crates/n8n-validation/src/lib.rs` is **test-only**: 4 `#[test]`s (`uniqueness pass/fail`, `cycle pass/fail`). Library code is byte-identical to `c912866b`, so **all findings F1–F7 remain open**. Observations on the tests themselves:

| Test | Covers | Contract gap it does *not* cover |
|---|---|---|
| `test_node_uniqueness_fail` | first duplicate reported | multiple duplicates (F3), frozen message (F5), `path` (F5) |
| `test_cycle_detection_fail` | `A→B→A` on `main` is an error | this is golden **D6**, whose contract-expected result under default options is `valid:true` (F1) — the test asserts the **opposite** of the contract |
| `test_cycle_detection_pass` | linear A→B→C | diamond DAG (no false positive), self-loop path, `ai_*`-only cycle → valid (F2, D8) |
| — | — | dangling connections have **no** test at all (D4/D5, F4) |

Coverage vs golden table D1–D10: **1 of 10** aligned (D2 linear), **1 of 10** contradicted (D6), 8 untested. Recommendation unchanged: no status for the crate until it implements §2 of this review and passes D1–D10.

## 5. Addendum — main @ `02ed3308` (6603ebc7, b6a3389b, 02ed3308)

Re-diffed `crates/n8n-validation/src/lib.rs` against the reviewed revision: **no library change**. F1–F7 remain open; verdict unchanged: **NON-CONFORMANT**.

New material touching the Validation boundary:

| Item | Observation | Impact |
|---|---|---|
| `crates/n8n-workflow/tests/conformance.rs` | Calls `validate_node_uniqueness` on `tests/reference/01-empty-workflow` and `03-linear` (golden D1/D2 happy paths only). Imports `detect_cycles` but never calls it. | Covers 0 of the 6 failing goldens (D4–D8, D10). Not a conformance gate for this LEGO. |
| Same file, `if !fixture_path.exists() { return; }` | Missing fixture ⇒ test passes silently. | **Vacuous pass risk** — a CI checkout without `tests/reference` reports green. Should `panic!`/`assert!` on a missing fixture. |
| `n8n_connection::has_path` / `invert_connections` (new) | Iterates `HashMap` — same non-determinism class as F6; `has_path` is BFS over *all* connection types, so if reused for cycle detection it would inherit F2. | Advisory to crate owner (`connection` is not my boundary). |

### Machine-checkable acceptance now available
Since `b1f967d5` the TS oracle emits language-neutral fixtures — `tests/reference/agent-4/validation/fixtures/D01…D13.json` (`{input:{workflow,options}, expected}`; canonical form = recursively key-sorted JSON). Recommended replacement for the two hand-written cases in `conformance.rs`:

```rust
// crates/n8n-validation/tests/parity.rs (proposed; not written by Agent 4 — crates/** is out of my allowed_paths)
#[test]
fn ts_oracle_parity() {
    let dir = std::path::Path::new("../../tests/reference/agent-4/validation/fixtures");
    assert!(dir.exists(), "fixtures missing: {}", dir.display());   // never skip silently
    let mut n = 0;
    for entry in std::fs::read_dir(dir).unwrap() {
        let p = entry.unwrap().path();
        if !p.file_name().unwrap().to_str().unwrap().starts_with('D') { continue; }
        let fx: serde_json::Value = serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap();
        let report = n8n_validation::validate_workflow(&fx["input"]["workflow"], &fx["input"]["options"]); // spec §2
        assert_eq!(canonical(serde_json::to_value(&report).unwrap()), canonical(fx["expected"].clone()), "{}", p.display());
        n += 1;
    }
    assert_eq!(n, 14);
}
```
Pass criterion: 13/13 with zero diffs. Until that test exists and passes, `n8n-validation` must not be marked VERIFIED.
