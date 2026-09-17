# Validation LEGO — Rust Port Specification (`crates/n8n-validation`)

| Field | Value |
|---|---|
| Author | Agent 4 (LEGO `validation`) — spec only; `crates/**` is outside Agent 4 allowed_paths |
| Implementation & `cargo test` | **Orchestrator / central Implementer**, after the n8n anatomy reconstruction docs are 100% complete (Orchestrator decision 2026-09-17, Option B — Agent 4 `forbidden_paths: crates/**, apps/**` stands) |
| TS seam to replace | `packages/validation-lego/src/validation-surface.ts` (rules part: `src/rules/workflow-rules.ts`) |
| Normative sources (priority) | n8n 2.9.4 source › `contracts/validation.contract.md` (§4.4, §7, §11.7–11.9) › TS oracle `tests/reference/agent-4/validation/workflow-rules.ts` › fixtures `tests/reference/agent-4/validation/fixtures/D*.json` |
| Supersedes | `validation-rust-port-review.md` §2 (kept as history; findings F1–F7 map to the requirements below) |
| Status of current crate (main @ 06412afb) | NON-CONFORMANT — see §9 gap table |

---

## 1. Purpose

`n8n-validation` is a **pure, side-effect-free** rule engine. Given a workflow document it returns an accumulated `ValidationReport`. It never executes, never persists, never touches node types, never panics on user input.

Reference parity note: n8n 2.9.4 itself does **not** reject duplicate names, dangling connections or cycles at save time (golden A/B/C). These rules are the *new capability* agreed in ISSUE-003 Option A and are **opt-in** — callers decide what to do with the report. Consequently `allow_cycles` defaults to **true** (n8n runtime loops are legal).

## 2. Public API (exact)

```rust
// crates/n8n-validation/src/lib.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValidationCode {
    InvalidInput,           // "INVALID_INPUT"
    DuplicateNodeName,      // "DUPLICATE_NODE_NAME"
    DanglingConnection,     // "DANGLING_CONNECTION"
    InvalidConnectionType,  // "INVALID_CONNECTION_TYPE"
    CycleDetected,          // "CYCLE_DETECTED"
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub code: ValidationCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub node: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub path: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationReport { pub valid: bool, pub errors: Vec<ValidationIssue> }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ValidateOptions { pub allow_cycles: bool }
impl Default for ValidateOptions { fn default() -> Self { Self { allow_cycles: true } } }

/// Mirrors `NodeConnectionTypes` in n8n 2.9.4 packages/workflow/src/interfaces.ts.
pub const NODE_CONNECTION_TYPES: [&str; 13] = [
    "ai_agent","ai_chain","ai_document","ai_embedding","ai_languageModel","ai_memory",
    "ai_outputParser","ai_retriever","ai_reranker","ai_textSplitter","ai_tool","ai_vectorStore","main",
];

/// Entry point. Takes untyped JSON on purpose: malformed input is a *report*, not an `Err`/panic.
pub fn validate_workflow(workflow: &serde_json::Value, opts: ValidateOptions) -> ValidationReport;

/// Composable parts (operate on a pre-validated shape, see §4).
pub fn check_node_uniqueness(wf: &WorkflowView) -> Vec<ValidationIssue>;
pub fn check_dangling_connections(wf: &WorkflowView) -> Vec<ValidationIssue>;
pub fn detect_cycles(wf: &WorkflowView) -> Vec<ValidationIssue>;

/// Internal typed view built by `validate_workflow` after the INVALID_INPUT gate.
pub struct WorkflowView<'a> {
    pub node_names: Vec<&'a str>,                       // nodes[] order, duplicates kept
    pub connections: &'a serde_json::Map<String, serde_json::Value>, // may be empty
}
```

Serialised shape must equal the TS oracle: `{"valid":bool,"errors":[{"code","message","node"?,"path"?}]}`. `node`/`path` are **omitted** when absent (not `null`).

Why `serde_json::Value` rather than `n8n_connection::WorkflowConnections` / `Vec<INode>`: the contract requires INVALID_INPUT reporting for malformed documents (golden D10), `null` output slots, targets missing `node`, unknown connection-type keys. A strongly-typed `HashMap<String, HashMap<String, Vec<Vec<ConnectionItem>>>>` cannot represent those states and would `Err` in serde before validation runs. A thin adapter `impl From<&n8n_connection::WorkflowConnections> for serde_json::Value` may be offered for typed callers.

## 3. Determinism rules (normative — contract §11.9)

Error order must not depend on JSON key order or on `HashMap` iteration. Never iterate a `HashMap`/`serde_json::Map` directly to produce output.

1. **Nodes**: `nodes[]` array order.
2. **Connection sources** (`ordered_sources`): names in `nodes[]` order (first occurrence only) that exist as keys in `connections`, **then** the remaining `connections` keys (unknown sources) sorted lexically (byte order).
3. **Connection types** within a source: keys sorted lexically.
4. **Outputs / targets**: array order (`oi`, `ti`).
5. **Rule order** in the report: uniqueness → dangling/type → cycles.

## 4. Input gate → `INVALID_INPUT`

Evaluate in this order and return immediately on first hit (`valid:false`, exactly one error):

| Condition | message | path |
|---|---|---|
| `workflow` is not an object, or `workflow.nodes` is not an array, or any element is not an object with string `name` | `Workflow must be an object with a \`nodes\` array of named nodes` | — |
| `workflow.connections` present and not an object (arrays count as not-object) | `` `connections` must be an object `` | `["connections"]` |

Missing `connections` ≡ `{}`. Any other field (`id`, `type`, `parameters`, `disabled`, …) is ignored — `disabled` does **not** exempt a node from any rule (golden D9).

## 5. Rule: `check_node_uniqueness`

```
seen = {}
for (i, name) in node_names.enumerate():
    if name in seen: push { code: DUPLICATE_NODE_NAME, node: name, path: ["nodes", i.to_string(), "name"],
                            message: format!("Duplicate node name \"{name}\"") }
    seen.insert(name)
```
All duplicates are reported (second and later occurrences), not just the first.

## 6. Rule: `check_dangling_connections` (also emits `INVALID_CONNECTION_TYPE`)

```
names = set(node_names)
for source in ordered_sources():
    by_type = connections[source]
    if source ∉ names:
        push { DANGLING_CONNECTION, node: source, path: ["connections", source],
               message: "Connection from unknown node \"{source}\"" }
    if by_type is not object: continue
    for ty in sorted(by_type.keys()):
        outputs = by_type[ty]
        if ty ∉ NODE_CONNECTION_TYPES:
            push { INVALID_CONNECTION_TYPE, node: source, path: ["connections", source, ty],
                   message: "Unknown connection type \"{ty}\" on node \"{source}\"" }
        if outputs is not array: continue
        for (oi, output) in outputs.enumerate():           // output may be null → treat as []
            if output is not null and not array:
                push { DANGLING_CONNECTION, node: source, path: ["connections", source, ty, oi], message: "Malformed connection output from \"{source}\"" }
                continue
            for (ti, target) in (output or []).enumerate():
                path = ["connections", source, ty, oi, ti]
                if target is not object or target.node is not string:
                    push { DANGLING_CONNECTION, node: source, path, message: "Malformed connection target from \"{source}\"" }
                    continue
                if target.node ∉ names:
                    push { DANGLING_CONNECTION, node: source, path,
                           message: "Connection from \"{source}\" to unknown node \"{target.node}\"" }
                if target.type is string and target.type ∉ NODE_CONNECTION_TYPES:
                    push { INVALID_CONNECTION_TYPE, node: source, path: path + ["type"],
                           message: "Unknown connection type \"{target.type}\" on node \"{source}\"" }
```
Note: for an unknown type key `foo` whose targets also carry `type:"foo"`, **two** INVALID_CONNECTION_TYPE issues are produced (key + target) — golden D5.

## 7. Rule: `detect_cycles` — only when `allow_cycles == false`

Scope: **`main` edges only** (contract §11.8; `ai_*` edges are tree-shaped attachments and must be ignored — golden D8). Edges whose source or target is not a known node are skipped (already reported by §6).

```
adj: IndexMap<&str, Vec<&str>>   // insertion order = nodes[] order (or Vec<Vec<usize>> indexed by node position)
for name in node_names: adj.entry(name).or_default()      // first occurrence wins
for source in ordered_sources():
    if source ∉ adj: continue
    outputs = connections[source]["main"]; if not array: continue
    for output in outputs: if not array: continue; for t in output:
        if t is object and t.node is string and t.node ∈ adj: adj[source].push(t.node)

colour = WHITE for all
for root in adj.keys() (nodes[] order):
    if colour[root] != WHITE: continue
    stack = [(root, next=0)]; path_stack = [root]; colour[root] = GREY
    while stack non-empty:
        frame = stack.top
        if frame.next < adj[frame.node].len():
            to = adj[frame.node][frame.next]; frame.next += 1
            if colour[to] == GREY:
                cycle = path_stack[path_stack.index_of(to)..] + [to]
                return vec![{ CYCLE_DETECTED, node: to, path: ["connections", frame.node, "main"],
                              message: "Cycle detected: " + cycle.join(" → ") }]   // U+2192 with spaces
            if colour[to] == WHITE: colour[to] = GREY; stack.push((to, 0)); path_stack.push(to)
        else:
            colour[frame.node] = BLACK; stack.pop(); path_stack.pop()
return vec![]
```
Iterative DFS (no recursion — stack-safe for large workflows). Exactly **one** CYCLE_DETECTED issue is reported (first back-edge in deterministic order). Self-loop `A→A` yields `Cycle detected: A → A`, `node: "A"`, `path: ["connections","A","main"]`.

## 8. `validate_workflow` composition

```
gate (§4) → early return
errors = check_node_uniqueness ++ check_dangling_connections
if !opts.allow_cycles: errors ++= detect_cycles
ValidationReport { valid: errors.is_empty(), errors }
```
Must never panic or return `Err` for any `serde_json::Value`. Recommended: `#[deny(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]` on the crate, and a proptest/fuzz target feeding arbitrary `Value`s.

## 8a. P3 — `INVALID_CONNECTION_TYPE` (Agent 5 blocker P3, CROSS-AGENT-ISSUES "required decision #3") — complete handoff

Ownership per Orchestrator decision (Option B): **specified by Agent 4 here; implemented centrally.** Everything the implementer needs:

| Item | Value |
|---|---|
| Enum variant | `ValidationCode::InvalidConnectionType` → serialises as `"INVALID_CONNECTION_TYPE"` (4th of the 4 codes in `contracts/validation.contract.md` §3; plus `INVALID_INPUT` as the gate code) |
| Whitelist | `NODE_CONNECTION_TYPES` (§2, 13 entries, source: n8n 2.9.4 `packages/workflow/src/interfaces.ts` `NodeConnectionTypes`). Owned by Validation; Connection may re-export, never redefine (§11). |
| Emission point 1 — type key | in `check_dangling_connections`, for each `ty` in `sorted(connections[source].keys())` with `ty ∉ NODE_CONNECTION_TYPES`: `{ code: INVALID_CONNECTION_TYPE, node: source, path: ["connections", source, ty], message: "Unknown connection type \"{ty}\" on node \"{source}\"" }` — emitted **before** iterating that key's outputs, and iteration still continues (targets under an unknown key are still checked for dangling). |
| Emission point 2 — target `type` field | for each well-formed target with `target.type` a string `∉ NODE_CONNECTION_TYPES`: same code/message, `path: ["connections", source, ty, oi, ti, "type"]`, emitted **after** the target's dangling check. A missing/non-string `target.type` is *not* an error (n8n treats the key as authoritative). |
| Does not affect | `valid` short-circuiting (all issues accumulate), cycle detection (unknown-type edges are never `main`, so never traversed), node uniqueness. |
| Oracle fixture | `tests/reference/agent-4/validation/fixtures/D05-invalid-connection-type.json` — input `A --foo--> B`, expected **exactly two** issues in this order: key-level `["connections","A","foo"]`, then target-level `["connections","A","foo","0","0","type"]`, both `node:"A"`, `valid:false`. Current crate result on the probe: `valid=true, codes=[]` (`tests/reference/agent-4/rust-parity/README.md`). |
| Unit tests to add (names) | `invalid_type_key_reported`, `invalid_type_on_target_reported`, `valid_ai_types_not_reported` (all 13 whitelist entries pass), `unknown_type_targets_still_checked_for_dangling` (`A --foo--> Ghost` ⇒ INVALID_CONNECTION_TYPE ×2 **and** DANGLING_CONNECTION ×1, in that path order) |
| Reference-parity note | n8n 2.9.4 itself does not reject unknown types at save time (golden C); this rule is opt-in enforcement (ISSUE-003 Option A), so the crate must expose it through `validate_workflow`, never by failing deserialisation. |

## 9. Gap table — current crate vs this spec

| Req | Current `lib.rs` | Finding |
|---|---|---|
| §2 `validate_workflow`, `ValidateOptions`, report struct | absent; three fns return `Result<(), ValidationError>` (fail-fast, single error) | F1, F3 — BLOCKING |
| §7 main-only edges | `detect_cycles` iterates `outputs.values()` (all types) | F2 — BLOCKING |
| §6 INVALID_CONNECTION_TYPE, §2 `NODE_CONNECTION_TYPES` | absent | F4, F7 |
| §5–§7 messages / `node` / `path` | thiserror strings differ (`Node with name '{0}' is duplicated` …), no path | F5 |
| §3 determinism | `HashMap` iteration builds adjacency and dangling order | F6 |
| §4 INVALID_INPUT | impossible — input is `&[String]` + typed map | F1 |
| `crates/n8n-workflow/tests/conformance.rs` | D1/D2 only; `return`s silently if fixture missing | vacuous-pass risk (review §5) |

## 10. Acceptance — must all hold on VPS before `n8n-validation` may be marked VERIFIED

1. **Parity fixtures**: `crates/n8n-validation/tests/parity.rs` loads every `tests/reference/agent-4/validation/fixtures/D*.json`, runs `validate_workflow(&fx["input"]["workflow"], serde_json::from_value(fx["input"]["options"]))`, canonicalises both sides (recursively key-sorted `serde_json::Value`; `serde_json` with `preserve_order` **off** already sorts map keys), asserts equality. **14/14, zero diffs.** Test must `panic!` if the fixture dir is missing (no silent skip). Reference implementation of the test body: review §5.
2. **Goldens D1–D10** from `docs/isolation/validation-golden-cases.md` as named `#[test]`s (the fixtures cover them; named tests keep the audit trail readable).
3. `cargo test -p n8n-validation` green; `cargo clippy -p n8n-validation -- -D warnings` clean.
4. Cross-language check on the same checkout: `node --test tests/reference/agent-4/validation/validation.test.ts` (11/11) and `cargo test -p n8n-validation` both pass — the fixtures are the shared oracle; if the TS oracle changes, `gen-fixtures.ts` regenerates them and the Rust side must be re-run.
5. No new dependency from `n8n-validation` on execution, persistence, or node-type registries (contract §5 Non-responsibilities). Allowed deps: `serde`, `serde_json`, optionally `indexmap`; `n8n-connection` only for the optional typed adapter.

## 11. Cross-boundary notes (for Agent 3 / `connection-rust-port-spec.md`)

- If `n8n-connection` later offers a deterministic, type-filtered traversal (e.g. `edges(connections, ty: &str) -> impl Iterator<(source, target)>` in `nodes[]`/array order), `detect_cycles` may consume it — but only if its ordering guarantees are documented equal to §3. Today's `has_path`/`invert_connections` iterate `HashMap` and span all types, so they must **not** be used for cycle detection.
- Validation owns the connection-type whitelist (`NODE_CONNECTION_TYPES`); Connection may re-export it but must not define a divergent copy.

## 12. Message log

- A4-MSG-04/05/06 (→ agent-5, broadcast): review verdict + spec pointers — `docs/isolation/validation-bus-outbox.json`.

---

## 13. Revision log

### 2026-09-17 — main @ `9e87c8cb` (8ed00851 "resolve R-01..R-05", 9e87c8cb indexmap pin)

Changes observed in `crates/n8n-validation/src/lib.rs` (45 lines, adaptation only):
- `n8n_connection::WorkflowConnections` is now `IndexMap<String, IndexMap<String, Vec<Option<Vec<ConnectionItem>>>>>` (insertion-ordered; sparse `null` slots representable). Validation loops gained `if let Some(items) = slot`.
- Public API, error enum, messages, fail-fast `Result` semantics: **unchanged**.

Effect on the gap table (§9):

| Req | Before | Now |
|---|---|---|
| §3 determinism — source/type iteration | `HashMap` (random) | `IndexMap` → **insertion order = JSON key order**. Better than random, but still **not** §3 (nodes[]-order for known sources, sorted unknown sources, sorted types). Fixture D13 would still order errors differently. F6 → *partially mitigated, open*. |
| §3 — `detect_cycles` adjacency | `HashMap<&str, Vec<&str>>` + recursive DFS | unchanged → root iteration order still random. F6 open. |
| §6 null output slots | not representable (F1 sub-item) | representable now; skipped correctly. ✔ |
| §2/§4/§5–§8 (F1, F2, F3, F4, F5, F7) | open | **open** — no change |

Verdict: still **NON-CONFORMANT**; 3 blocking findings (F1, F2, F3) untouched. Note for implementer: `indexmap` now being a workspace dependency makes the §7 recommendation (`IndexMap<&str, Vec<&str>>` for adjacency) zero-cost to adopt.

### 2026-09-17 — oracle hardening (Agent 4, TS side)
Robustness test (#12, 300 PRNG-generated garbage documents + hand-written edge cases, both option sets) found the TS oracle **threw** on a non-array output slot (`main: [1]`) — a §8 violation. Fixed: such slots now yield `DANGLING_CONNECTION` "Malformed connection output from \"{source}\"" with path `["connections", source, ty, oi]`; `detect_cycles` skips them. New fixture **D14-malformed-output-slot**; acceptance count is now 14 fixtures. Self-loop shape `A → A` frozen by test.

### 2026-09-17 — executable evidence (main @ `e6c0188a`, Agent 1 offline rig)
Agent 1's `tools/rust-offline-rig` made `cargo test` possible in the sandbox. Probe `tests/reference/agent-4/rust-parity/run.sh`
runs the unmodified crate against the 14 fixtures: **10/14** (code-set parity only) — D05 (F4), D08 (F2), D10 (F1), D14 (F1) fail;
`findings.rs` reproduces F3 (fail-fast) and F2 (ai_tool cycle) on the real crate. **F6 downgraded**: with `IndexMap`
(8ed00851) the cycle witness was identical across 64 in-process runs × 12 processes and across two JSON key orders —
remaining F6 scope is only that error *order* follows JSON key order instead of §3 (`nodes[]` order, sorted types),
which matters for D13-style multi-error reports once accumulation (F3) is implemented. Verdict unchanged: NON-CONFORMANT,
blocking F1/F2/F3.

### 2026-09-17 — agent-1 Phase-3 increment `ebbfa593`/`6535009f` (reviewed by Agent 4, statically + TS replay; no cargo in sandbox)
Gap table §9 update: **F2 closed** (`detect_cycles` main-only), **F4/F7 closed** (`INVALID_CONNECTION_TYPE` on type key and edge `type`, message byte-equal; `NODE_CONNECTION_TYPES` 13/13), new negative golden `tests/reference/05-cyclic-invalid` consumed by `tests/cyclic_invalid.rs` (verified against TS oracle: `CYCLE_DETECTED`, path `connections.C.main`, `A → B → C → A`). **Still open:** F1/F3 (no `validate_workflow` report API, fail-fast `Result`), F5 (duplicate/dangling messages differ from frozen strings), F6 (source ordering), §10.1 parity.rs over D01–D14 absent. Review: `docs/isolation/consensus/TASK-404-phase3-opening.review-agent-4.md`.

### 2026-09-17 — TASK-408 (agent-1, `00370e3c`): F1/F3/F5/F6 closed, parity.rs 14/14 — crate status TESTED
Reviewed by Agent 4: `docs/isolation/consensus/TASK-408-validation-parity.review-agent-4.md` (APPROVED). Remaining for VERIFIED: §10.3 clippy, §10.4 same-checkout TS+cargo run (VPS).

### 2026-09-17 — Orchestrator decision: Option B
Agent 4's request for `crates/n8n-validation/**` access (A4-MSG-12) was **declined**; NO-RUST rule stands. Agent 4 obligations under Option B: (1) spec §2–§8 complete — done; P3 handoff added as **§8a**; (2) fixtures + acceptance oracle — `tests/reference/agent-4/validation/fixtures/D01…D14.json`, `gen-fixtures.ts`, anti-drift + robustness tests, probe `tests/reference/agent-4/rust-parity/` — done. Physical implementation is deferred to the central Implementer after the anatomy reconstruction docs are 100 % complete. Agent 5's "owner: Agent 4" for P3 should be read as *spec owner*, not *code owner*.
