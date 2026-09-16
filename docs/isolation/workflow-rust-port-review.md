# Phase-3 review — the Rust `n8n-workflow` crate vs the frozen Workflow contract

| Field | Value |
| :--- | :--- |
| Reviewer | `agent-1` — Workflow Domain Engineer (owner of LEGO 01) |
| Reviewed | `main @ c912866b` — *"feat(phase-3): initialize Rust workspace and port LEGOs (common, connection, validation, node-model, workflow)"* |
| Reviewed artifacts | `Cargo.toml`, `crates/n8n-workflow/**`, `crates/n8n-node-model/**`, `crates/n8n-connection/**`, `crates/n8n-validation/**` |
| Authority | `contracts/workflow.contract.md` (VERIFIED) · `docs/isolation/workflow-node-port-freeze.md` (signatures frozen) · `docs/isolation/workflow-port-contract.md` (11 ports) |
| Acceptance criteria | **`tests/reference/workflow-rust/fixtures.json`** — 35 reference-derived cases (see §6). The Rust port is conformant when it reproduces them byte-for-byte |
| Toolchain note | **no Rust toolchain in this sandbox** (`rustup`/`static.rust-lang.org`/`crates.io` are unreachable; only npm/github/pypi egress). Nothing here was compiled; every claim below is derived from the Rust source text and from the reference fixtures. Compile + `cargo test` must run on the VPS |
| Reference | n8n `2.9.4` (`n8n-workflow@2.9.1`) — `reference/n8n/packages/workflow/src` |

> **Scope.** This reviews the Rust **crates** only. The reference-integrity issue (`G04`/`G08`) and the
> Phase-3 gating question stay in `docs/isolation/workflow-review-of-node-lego.md` §6.

---

## 1. Verdict

`crates/n8n-workflow` is a **plausible skeleton, not yet a port of the Workflow Model.** It compiles into
the *shape* of a workflow (nodes, connections, traversal, rename) but:

* it models a **wire format the reference does not have** (`nodes` as a map, `connectionsBySourceNode` as a
  field name) — so it cannot parse a real n8n workflow JSON (§2.1);
* it is missing **2 of the 15 frozen surface symbols** — `calculateWorkflowChecksum` and
  `compareConnections` (§2.2);
* it silently **"fixes" reference behaviour** the contract explicitly forbids changing — `D-08`
  (stale destination index after rename) and the collision/restricted-name rules (§2.3);
* its peer-crate `get_connected_nodes` is a **different function** from the reference `getConnectedNodes`
  (no connection-type filter, no depth, non-deterministic order) (§2.4);
* round-tripping a workflow through the model **drops data** (unknown `settings`, unknown node fields)
  (§2.5).

None of these are behaviour regressions in the running system — Phase 3 has not replaced anything yet and
`reference/**` is untouched. They are **port fidelity** defects, and they are all fixable with the fixture
set as the acceptance test.

---

## 2. Findings

### 2.1 Wire format — the crate cannot parse an n8n workflow JSON

`crates/n8n-workflow/src/lib.rs`:

```rust
pub struct Workflow {
    pub nodes: HashMap<String, INode>,                      // wire: n8n sends an ARRAY
    #[serde(rename = "connectionsBySourceNode")]
    pub connections_by_source_node: WorkflowConnections,     // wire: the field is `connections`
    ...
}
```

Measured against the reference shape (`tests/reference/workflow-rust/fixtures.json` → `toJSON`):

| Fact | Reference | This crate |
| :--- | :--- | :--- |
| In-memory `nodes` | keyed by **name** (`workflow.ts:138-143`) | ✅ same idea (`HashMap`) |
| **Wire/entity** `nodes` | **array** (`WorkflowSnapshot.nodes?: INode[]`, `workflow-checksum.ts:18-28`; the API/entity layer stores the array) | ❌ map → `serde_json::from_str::<Workflow>` on a real workflow fails with *"invalid type: sequence, expected a map"* |
| Wire connections field | `connections` | ❌ `connectionsBySourceNode` → a real workflow JSON has **no such key**; `serde` reports *missing field*, and the actual `connections` payload is ignored |
| `settings` | free-form `IWorkflowSettings` (unknown keys preserved) | ❌ `WorkflowSettings` with 3 fields → every other key (`executionOrder`, `saveDataErrorExecution`, `callerPolicy`, `errorWorkflow`, …) is **silently dropped** |
| `staticData` / `pinData` | always present at rest (`staticData` defaults to `{}`, `workflow.ts:128-130`) | ⚠️ `Option<Value>` + `skip_serializing_if` → absent, not `{}` |

**Required:** an explicit wire model, separate from the aggregate. `nodes: Vec<INode>` on the wire and the
name-keyed map inside, e.g.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDocument {              // the wire / entity shape
    #[serde(default)] pub id: Option<String>,
    #[serde(default)] pub name: Option<String>,
    #[serde(default)] pub nodes: Vec<n8n_node_model::INode>,
    #[serde(default)] pub connections: n8n_connection::WorkflowConnections,
    #[serde(default)] pub settings: serde_json::Map<String, serde_json::Value>,
    #[serde(default)] pub static_data: serde_json::Value,   // -> {}
    #[serde(default)] pub pin_data: Option<serde_json::Value>,
    #[serde(default)] pub active: bool,
    #[serde(flatten)] pub extra: serde_json::Map<String, serde_json::Value>,
}
```

with `Workflow::from_document(WorkflowDocument)` re-keying `nodes` by name (last write wins — see §2.3)
and `Workflow::to_document()` returning the array shape again. `#[serde(flatten)] extra` is what keeps a
workflow round-tripping without loss (this is also how `settings` must behave).

### 2.2 Two of the fifteen surface symbols are missing entirely

The frozen surface (`manifest/ownership.json → publicSurface`, `docs/isolation/workflow-node-port-freeze.md`)
is: `Workflow` + 12 graph symbols + **`calculateWorkflowChecksum`** + **`compareConnections`**.

| Symbol | Reference | This crate |
| :--- | :--- | :--- |
| `calculateWorkflowChecksum` | `workflow-checksum.ts` — SHA-256 hex over `JSON.stringify(sortObjectKeys(whitelist(snapshot)))`, whitelist = `name, description, nodes, connections, settings, meta, pinData, isArchived, activeVersionId` | **absent**; no `sha2`/`sha` dependency in any `Cargo.toml` either |
| `compareConnections` | `connections-diff.ts` — `{ added, removed }`, each `{ [nodeName]: { [inputName]: [{ sourceIndex, value: { index, connection } \| null }] } }`, identity = `JSON.stringify(connection)` | **absent** from both `n8n-workflow` and `n8n-connection` |

Both are pure functions and both are **fully pinned by the fixtures** (`checksum` 8 cases incl. key-order
invariance, excluded-field invariance and node-order sensitivity; `compareConnections` 6 cases incl.
slot shifts and connection-type changes). Note the checksum must run **over the snapshot object**
(arrays), not over the in-memory aggregate — the 9-field whitelist and the recursive key sort are both
observable (`base` vs `nested-key-order-invariance` hash identically; `excluded-fields-ignored` equals
`base`; `node-order-matters` does not).

### 2.3 Silent behaviour changes (`D-08`, collision, restricted names)

`crates/n8n-workflow/src/lib.rs::rename_node` and `get_parent_nodes`:

| Reference behaviour (pinned) | Fixture | This crate |
| :--- | :--- | :--- |
| `renameNode('D','C')` when `C` exists: **no collision check**, the renamed node takes the name over (last write wins; `nodes.D` disappears) | `rename/collision-overwrites` → `nodeNames=["A","B","C"]`, `ownerOfC="id-D"` | ❌ `if self.nodes.contains_key(new_name) { return false }` — refuses |
| `renameNode(_, name)` for the 13 restricted JS-prototype keys throws `UserError('Node name "…" is a restricted name.')` | `rename/restricted-*` (3 cases) | ❌ no check; and because `nodes` is a plain `HashMap` the Rust port *could* accept `__proto__` where the reference silently loses the node (`wf-proto` fixture: the `__proto__` node never becomes an own key) |
| **`D-08`**: `renameNode` re-keys/rewrites the **source** map but **never rebuilds** `connectionsByDestinationNode`; parent queries keep answering under the old name | `rename/d-08-stale-destination-index` → `destinationKeys=["B","C"]`, `parentNodesOfBeta=[]`, `parentNodesOfOldName=["A"]`, and `setConnections` then yields `["A"]` | ❌ no destination index exists at all, and `get_parent_nodes` scans the **source** map → it returns `["A"]` for the new name, i.e. it silently fixes `D-08` |
| `renameNode` rewrites parameter references through the ports (`P-NODE-REFERENCE`: `$('A')` → `$('Alpha')`; plain strings untouched) | `rename/parameter-references-rewritten` | ❌ not attempted (needs the `n8n-node-model` ports; see §3) |
| `rename_node` returns `void` and throws on restriction violations | — | ❌ returns `bool` with a third meaning ("collision") that the reference does not have |

**Required:** model both indexes (`connections_by_source_node` **and**
`connections_by_destination_node`), derive the destination index in `set_connections` only, make
`get_parent_nodes` read the destination index (this is what reproduces `D-08`), and align `rename_node`
with the reference: restricted-name error, no collision guard, `void`/`Result<(), …>` return. The contract
states this explicitly: *"a port must reproduce it unless a future decision explicitly changes the
contract"* (`workflow.contract.md` §7, `D-08`).

### 2.4 Peer crate `n8n-connection::get_connected_nodes` is a different function

| Aspect | Reference `getConnectedNodes(connections, nodeName, type='main', depth=-1, checked?)` | `crates/n8n-connection` |
| :--- | :--- | :--- |
| Type filter | one connection type (`'main'`, `'ALL'`, `'ALL_NON_MAIN'`, or an `ai_*` type) | ❌ none — every type is traversed |
| Depth | `-1` unlimited, `0` → `[]`, `n` → n levels | ❌ unlimited only |
| Order | deterministic: unshift + splice, `Object.keys` order of node/type | ❌ `HashMap` iteration order |
| Identity | a node is enqueued once per DFS path with a `checkedNodes` set | ⚠️ deduped by first-seen (different order effects) |

Fixture evidence: `traversal/default-main-depth-unlimited` → `['D','C','B']`, `main-depth-1` → `['B']`,
`all-non-main` → `['M']`, `ai-language-model` → `['M']`. The current Rust function would return
`['B','M']`-ish sets for a "main" query, in map order, and cannot express depth at all.

### 2.5 Also missing for fidelity (lower severity, still observable)

* `timezone` — the reference resolves `settings.timezone ?? getGlobalState().defaultTimezone`
  (`workflow.ts:132`). Fixtures show the ambient default is `America/New_York`
  (`toJSON/wf-*-empty|one-node|linear`). The Rust port has no `timezone` at all; it needs a config port
  (the frozen `P-KERNEL-CONFIG`) — never a hard-coded string.
* `pinData` — `Option<Value>` loses the `IPinData` keying by node name; typed as
  `HashMap<String, Vec<INodeExecutionData>>` it stays checkable.
* `INode` (peer crate) — `id`, `name`, `type`, `typeVersion`, `position`, `parameters`, `disabled` only;
  a real workflow's `credentials`, `onError`, `notes`, `retryOnFail`, `alwaysOutputData`, `executeOnce`,
  `webhookId`, … are dropped on parse. The node-model crate needs `#[serde(flatten)] extra` (or the full
  field set) before the workflow crate can round-trip. **Request, not edit** — `crates/n8n-node-model` is
  Agent 2's artifact.
* `INode.parameters` is non-optional in Rust (`INodeParameters`), which is fine on the wire
  (`#[serde(default)]`) — worth keeping explicit.
* `n8n-workflow` declares a dependency on `n8n-validation` that no line of the crate uses; harmless but it
  makes the LEGO graph look like Workflow → Validation at the crate level, which the dependency audit
  (`tests/integration/boundary_audit.py`) should not learn from the Rust side yet.

---

## 3. What is *correct* and must not be lost

* `n8n-workflow` keeps **one** aggregate per workflow with nodes keyed by name — the reference's central
  design decision (`workflow.ts:138-143`).
* The rename path rewrites **both** the node key and the connection references — the source-map half of
  the reference's `renameNode` is faithfully mirrored.
* `n8n-validation` implements cycle detection as a **NEW CAPABILITY** (not reference fidelity), exactly as
  `ISSUE-003`/Option A requires, and `ValidationError` codes align with
  `contracts/validation.contract.md` (`DUPLICATE_NODE_NAME`, `DANGLING_CONNECTION`, `CYCLE_DETECTED`).
* Traversal is separated into a peer crate rather than reached through the aggregate — consistent with the
  Phase-3 plan for `P-CONNECTION-GRAPH` (`workflow-graph-ownership-plan.md` §8).

---

## 4. Phase-3 port plan for LEGO 01 (proposed sequence)

| Step | Deliverable | Gate |
| :--- | :--- | :--- |
| **R1** | Watertight wire model: `WorkflowDocument` (§2.1) + `#[serde(flatten)]` passthrough + `Document ↔ Workflow` conversion | parse/serialize the 3 golden fixtures + `with-everything` losslessly (`nodes` as array; unknown settings survive) |
| **R2** | `calculate_workflow_checksum` + `compare_connections` in `n8n-workflow` (checksum) and `n8n-connection` (diff, re-exported by `n8n-workflow` to match the frozen surface) | all `checksum` + `compareConnections` fixtures |
| **R3** | Both adjacency indexes + `D-08` semantics + reference `rename_node` (restricted names, collision overwrite, `void`), with parameter rewriting behind a `NodeRenamePort`/`NodeReferencePort` trait pair | all `rename` fixtures |
| **R4** | `get_connected_nodes` → reference signature `(connections, node, type, depth, checked?)` incl. `'ALL'` / `'ALL_NON_MAIN'` and deterministic ordering | all `traversal` fixtures |
| **R5** | Config port for `timezone` (frozen `P-KERNEL-CONFIG`) + typed `pinData` | `toJSON` fixtures incl. `timezone` |
| **R6** | `sha2` dependency pinned in the workspace; `cargo test` wired into the gate (`npm run verify` or a `cargo` step on the VPS) | fixtures pass under `cargo test` |

Step **R4** belongs to Agent 3 (connection crate) but blocks `Workflow::get_child_nodes`; steps **R1**’s
`INode` extension belongs to Agent 2. Both are requests to peers, filed in `MSG-14`.

---

## 5. Toolchain — solved for this sandbox by `tools/rust-offline-rig/`

`sh.rustup.rs`, `static.rust-lang.org`, `index.crates.io`, `static.crates.io` and the Debian mirrors are
all unreachable here (only npm, GitHub and PyPI egress works), so the toolchain is assembled from what is
reachable — and it now works end-to-end:

| Piece | Source | Note |
| :--- | :--- | :--- |
| `rustc` 1.88.0 + driver | npm `@rustbin/rustc-1.88.0-x86_64-unknown-linux-gnu` | official binary; **ships without libstd** |
| `libstd` 1.88.0 | npm `@rustbin/rust-std-1.88.0-x86_64-unknown-linux-gnu` | merged into the rustc sysroot |
| `cargo` 1.88.0 | npm `@rustbin/cargo-1.88.0-x86_64-unknown-linux-gnu` | |
| 12 crates of the workspace closure | `github.com` tags (`serde` 1.0.219, `serde_json` 1.0.140, `thiserror` 1.0.69, `syn` 2.0.100, `proc-macro2` 1.0.92, `quote` 1.0.37, `itoa`/`ryu`/`memchr`/`unicode-ident`) | rewritten into cargo `directory` source format (clones carry `path`/`workspace = true`, which a directory source rejects) |

`tools/rust-offline-rig/setup.sh` builds that (~13 s, ≈175 MB, everything under `/tmp/rust-rig`, outside
the repository) and `tools/rust-offline-rig/run.sh check|test` runs cargo on a copy of the tree so no
`Cargo.lock`, `target/` or generated file lands in the repository.

**Result — the Phase-3 workspace compiles** (this was "nothing has been compiled anywhere" before):

```text
$ tools/rust-offline-rig/run.sh check          # on crates/** @ 014471e6
   Compiling proc-macro2 v1.0.92 … thiserror-impl v1.0.69
    Checking n8n-common, n8n-connection, n8n-node-model, n8n-validation, n8n-workflow
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 6.26s
$ tools/rust-offline-rig/run.sh test           # 0 tests exist yet — the port is not tested
```

Caveats that keep this honest (also in the rig README):

* the npm packages are third-party repacks of the official binaries, and the crate tags are pinned to a
  hand-picked consistent set — a green run here is **evidence about the code, not about the exact
  dependency versions** the VPS will resolve;
* vendored manifests are rewritten, so a crate add/upgrade means extending `PLAN` in `vendor_prep.py`;
* the fixtures in §6 are the real acceptance test — they were derived from the pinned reference runtime
  and `build-fixtures.mjs --check` reproduces them byte-exactly here;
* run `cargo check`/`cargo test` on the VPS (real registry) before any Phase-3 merge, and keep the gate
  failing when `crates/**` exists but was never compiled.

## 6. Acceptance criteria — `tests/reference/workflow-rust/fixtures.json`

| Section | Cases | What it pins |
| :--- | ---: | :--- |
| `checksum` | 8 | SHA-256 over the 9-field whitelist, recursive key sorting, node-order sensitivity, `pinData` inclusion, excluded-field invariance |
| `compareConnections` | 6 | `{ added, removed }` shape with `sourceIndex` + `value.index`, slot shifting, connection-type changes |
| `toJSON` | 6 | in-memory aggregate shape: `nodes` keyed by name, both indexes, `settings`/`staticData` defaults, `timezone` resolution, duplicate-name overwrite, `__proto__` swallow |
| `rename` | 6 | restricted-name `UserError` (3), collision overwrite, **`D-08` staleness** (4 assertions incl. the `setConnections` recovery), port-driven parameter rewriting |
| `traversal` | 9 | `getConnectedNodes` type filter, `ALL`/`ALL_NON_MAIN`, depth `0/1/2/-1`, unknown node, deterministic order |

Reproduce (anywhere, Node 22 + the pinned runtime):

```bash
scripts/setup-reference-runtime.sh                 # n8n-workflow 2.9.1 etc.
node tests/reference/workflow-rust/build-fixtures.mjs --check
```

The Rust acceptance test should `include_str!("../../../tests/reference/workflow-rust/fixtures.json")`,
deserialize it with `serde_json` and assert against every case — that keeps the port honest without a Node
host in the loop.

---

## 7. Gate status after the Phase-3 commit (measured, `c912866b`)

Starting Phase 3 turned two of Agent 5's harnesses red, because both still assert the **Phase-2** rule
"no Rust may exist". Reproduced on the merged tree:

```text
$ node tests/compatibility/contract_conformance.mjs
[PASS] golden fixtures discovered — 01-empty-workflow, 02-one-node, 03-linear
[FAIL] Phase 2: no Rust implementation introduced — Rust artifacts present in Phase 2:
       crates/n8n-common/{Cargo.toml,src/lib.rs} … crates/n8n-workflow/{Cargo.toml,src/lib.rs}
RESULT: 20/21 CHECKS PASSED

$ python3 tests/integration/boundary_audit.py
-- Phase-2 Rust guard: VIOLATION [10 files under crates/]
PHASE VIOLATION: Rust introduced during Phase 2
AUDIT RESULT: FAIL
```

This is **not** a regression of the Workflow LEGO — the isolation gate itself (`npm run verify`) does not
look at `crates/**`, and its remaining red rows are still `G04`/`G08` (reference pin, §6 of the node-review
document). It is a **gate-lifecycle** problem: the Phase-2 guards must gain a Phase-3 mode, e.g.

* accept Rust under `crates/**` when the workspace manifest exists at the repo root;
* keep asserting what still matters in Phase 3 — `reference/n8n/**` byte-identical (G04), the 15-symbol
  surface unchanged, and the Rust side satisfying `tests/reference/workflow-rust/fixtures.json`;
* fail when `crates/**` exists but `cargo test` has never run (the toolchain caveat in §5).

Owner: Agent 5 (`tests/**` is the guardian's artifact). Filed in `MSG-14`.

Also note `crates/n8n-workflow` declares `n8n-validation` without using it (§2.5) — the crate graph is the
one place where a wrong edge would look like a real LEGO dependency, so it should be cleaned before the
dependency audit is pointed at Rust.
