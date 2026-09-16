# Node LEGO — Conformance Harness Spec (acceptance for crates/n8n-node-model)

**Author:** Agent 2 · **Date:** 2026-09-17 · **Status:** BINDING once implemented
**Purpose:** turn `node-golden-cases.md` (prose, VERIFIED-BY-EXECUTION) into a
machine-executable parity gate for the `n8n-node-model` Rust port — the same acceptance
architecture Agent 1 used for `n8n-workflow` (`build-fixtures.mjs` → `fixtures.json` →
`tests/reference_fixtures.rs`). Crate-side files below are owned by the crate's
implementor; `crates/**` remains a forbidden write for agent-2.

---

## 1. Components

| Component | Path (today) | Owner / destination |
|---|---|---|
| Golden data (machine-readable GC-1..GC-7 + serde probes) | `docs/isolation/node-fixtures.json` | agent-2 (in-tree, byte-stable) |
| Generator + drift checker | `docs/isolation/node-fixtures.build.cjs` (`--check`) | agent-2; re-derives from reference dist, byte-compares |
| Rust acceptance harness | `crates/n8n-node-model/tests/reference_fixtures.rs` | **crate owner** (Phase-3 assignment) |
| Integration move (optional, at gateway) | `tests/reference/node-rust/` | orchestrator step — path is outside agent-2's write set |

The fixtures are deterministic by construction (`--check` proves byte-identical
re-derivation). The generator additionally contains a **regression tripwire**: every
GC expectation is hard-asserted against the frozen golden values from
`node-golden-cases.md`; on mismatch it exits 3 instead of writing — STOP, INVESTIGATE,
DOCUMENT, per the project regression rule.

## 2. Rust harness layout (required, mirrors crates/n8n-workflow)

One file `crates/n8n-node-model/tests/reference_fixtures.rs` with:

```rust
const ACCESS_CASES: usize = 3;       // applyAccessPatterns
const CONNECTION_CASES: usize = 1;   // getConnectionTypes
const RENAME_CASES: usize = 1;       // renameFormFields
const OUTPUT_CASES: usize = 4;       // getNodeOutputs
const INPUT_CASES: usize = 2;        // getNodeInputs
const PARAM_CASES: usize = 3;        // getNodeParameters
const VERSIONED_CASES: usize = 5;    // versionedNodeType ops
// + serdeConformance round-trips: 5 descriptions, 2 INode samples
```

- Fixture load via `env!("CARGO_MANIFEST_DIR")/./../../` (same `repo_root()` convention as
  `crates/n8n-workflow/tests/reference_fixtures.rs`). NO default-path fallback that could
  mask a missing fixture: file absence = test failure, count assertion = no silent skipping.
- Comparison: `serde_json::Value` deep equality (like workflow harness); object key order is
  irrelevant, array order is observable. `connections_from_text`-style parsing is not needed
  here (none of GC-1..GC-7 depends on object-key order).
- Real-instance serde coverage comes from `tests/reference/0*/workflow.json`
  (read at test time, as the workflow conformance tests already do), NOT from copies.
- Rig compatibility: zero extra deps — `serde_json` + existing crate deps only, so
  `tools/rust-offline-rig/run.sh test` can execute the harness offline.

## 3. Port-shape expectations per case category

| Category | Rust surface (brief §2/§3) | Notes |
|---|---|---|
| `applyAccessPatterns.cases` | `pub fn apply_access_patterns(expression &str, previous &str, new &str) -> String` | pure string→string; early-return case must return input byte-identically |
| `getConnectionTypes.cases` | `pub fn get_connection_types(connections: &[NodeConnectionEntry]) -> Vec<NodeConnectionType>` | strings pass positionally; objects project `.type`; only `undefined`/`None` filtered |
| `renameFormFields.cases` | `pub fn rename_form_fields(node: &mut INode, rename: impl Fn(&str) -> String)` | mutates in place; only entries with `fieldType=="html"` AND a string `html` property are touched; other entries byte-identical |
| `getNodeOutputs.cases` | `pub fn get_node_outputs(node: &INode, description: &INodeTypeDescription, evaluator: Option<&dyn DynamicIoEvaluator>) -> Vec<NodeConnectionEntry>` | **dynamic branch behind the ISSUE-004 seam** (no Workflow type in node core); evaluator `None`/error ⇒ `warn` + `[]` fallthrough |
| `getNodeInputs.cases` | `pub fn get_node_inputs(...)` | same seam; dynamic-throw case ⇒ `[]` + warned |
| `getNodeParameters.cases` | `pub fn get_node_parameters(props, values, return_defaults, return_none_displayed, node_type_version: Option<f64>, description: Option<&INodeTypeDescription>) -> Value/Map` | display-gating; expression strings pass verbatim |
| `versionedNodeType.cases` | `VersionedNodeType` struct + `get_versioned_node_type` | **no-fallback**: absent version ⇒ `None`/undefined, never latest |
| `serdeConformance` | `INodeTypeDescription`, `INode` | deserialize → serialize round-trip equality |

## 4. Reference-observed semantics the harness pins (do not "improve")

1. **`onError:'continueErrorOutput'`**: `outputs` is **deep-copied** (description never
   mutates — every error case asserts `descriptionUnchangedAfterCall == true`); a single
   output is converted to a config object with `displayName:"Success"` **even when it was
   already a config object with its own displayName** (verified: `{type:"main",
   displayName:"Out"}` becomes `{type:"main", displayName:"Success"}`); then exactly one
   `{category:'error', type:'main', displayName:'Error'}` is **appended at the trailing
   index** (no rename for multi-output).
2. **Dynamic IO failure**: `getSimpleParameterValue` throw ⇒ `console.warn("Could not
   calculate inputs|outputs dynamically for node: ", <name>)` and result `[]`. The Rust
   port maps this to `log::warn!`/`tracing::warn!`; the harness asserts the `[]` result and
   no panic (log capture is out of scope).
3. **`versions`**: `currentVersion = defaultVersion ?? max(nodeVersions.keys)`;
   `getNodeType(n)` with absent `n` returns **undefined/None — no fallback**;
   `getVersionedNodeType(plain)` returns the identical object (identity, not a copy).
4. **Display-gating**: defaults are applied to rendered parameters only; explicitly typed
   values on display-hidden parameters are dropped (unless `returnNoneDisplayed`);
   expression strings (`={{ … }}`) pass through verbatim in all arms.

## 5. Acceptance wiring (brief §4, gate 1)

`n8n-node-model` is **RUST IMPLEMENTED-verified for the Node LEGO when**:

1. This harness reproduces all 26 entries (19 golden cases + 7 serde samples) green under
   `tools/rust-offline-rig/run.sh test` (offline).
2. The 6 frozen ports exist with the exact snake_cased names listed in brief §3
   (`get_node_parameters`, `get_node_inputs`, `get_node_outputs`, `get_connection_types`,
   `rename_form_fields`, `apply_access_patterns`) and crate exports match contract §11.
3. G-1..G-4 fixes from brief §1 are in place (serde probes cover them: version union,
   IO union incl. expression + config arms, required description fields, full INode
   optionals).
4. Byte-stability of the fixtures is re-confirmed by `--check` after any reference
   rebuild (tripwire exit 3 = regression investigation, not regeneration).

Deviation rule (from `node-golden-cases.md`): any mismatch is a **conformance defect** —
report via bus to agent-2/mediator; never "fix" the semantics to match the port.

## 6. Known non-goals

- The harness does not test the expression runtime (ISSUE-004 seam is an injected trait;
  GC dynamic cases only pin the failure fallthrough).
- No timing/perf assertions (perf gates live with Agent 5's Phase-3 gate variant — MSG-07).
- Full 532-reference-test coverage remains the Phase-3 stretch goal (brief §4.1); this
  pack is the **frozen-port minimum** that gates acceptance.
