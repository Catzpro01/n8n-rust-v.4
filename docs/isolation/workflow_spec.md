# LEGO Specification: Workflow Pure Domain Model

## 1. Component Identity
- **LEGO ID**: workflow
- **Owner**: agent-1
- **Upstream Source**: reference/n8n/packages/workflow/src/workflow.ts
- **Interface Contract**: contracts/workflow.contract.md

## 2. Pure Data Structures (Decoupled from Node Runtime)
- WorkflowParameters: id, name, nodes, connections, active, settings, staticData, pinData.
- NodeConnectionMapping: bySource (Record<string, Record<string, IConnection[][]>>), byDestination.

## 3. Pure Functions (Mathematical and Deterministic)
1. buildConnectionMaps(connections: IConnections): NodeConnectionMapping
2. getNode(nodes: Record<string, INode>, name: string): INode | undefined
3. getParentNodes(connections: NodeConnectionMapping, nodeName: string): string[]
4. getChildNodes(connections: NodeConnectionMapping, nodeName: string): string[]
5. detectCycles(nodes: INode[], connections: NodeConnectionMapping): boolean
6. getStartNodes(nodes: INode[], connections: NodeConnectionMapping): INode[]

## 4. Decoupling Boundaries
- Expression Engine: Evaluasi ekspresi dipisahkan sepenuhnya ke LEGO expression via interface ExpressionEvaluator.
- Node Execution: Eksekusi node dipisahkan ke LEGO node via interface NodeExecutor.
- Database / Static Data: Serialisasi staticData dipisahkan ke LEGO persistence.

## 5. Golden Invariants
- Determinisme: Input graf yang sama SELALU menghasilkan adjacency list yang sama.
- Zero Side-Effects: Instansiasi Workflow tidak boleh memicu HTTP request, DB call, atau file IO.
- Non-Destructive: Validasi siklus tidak boleh mengubah urutan node asli.

## 6. Verification Plan
- Reference Smoke Test: 11/11 PASS
- Interface Contract Verification by Agent 5: VERIFIED
<<<<<<< HEAD

## 7. Phase 3 — Rust Implementation Notes (2026-09-16, agent-1)

> **Supersession note (2026-09-17).** The canonical Phase-3 Rust port of the
> Workflow LEGO is `crates/n8n-workflow` in the root workspace (serde-based,
> 15 frozen surface symbols, 35 reference fixtures — see
> `docs/isolation/workflow-rust-port-review.md`). The std-only crate
> described below was rebranded to **`tools/n8n-workflow-compat`** (package
> `n8n-workflow-compat`): it is now a self-contained **differential
> compatibility oracle** — an independent reference implementation whose only
> consumer is the `tests/compatibility/` suite — not a competing LEGO crate.
> The type mapping and semantic decisions below still document that oracle.

Crate: `tools/n8n-workflow-compat`, std-only, zero external dependencies
(offline pipeline constraint; the pure model needs no IO anyway — golden
invariant).

### 7.1 Type mapping (original TS → Rust)

| Original | Rust | Notes |
| :--- | :--- | :--- |
| `IConnections: Record<string, Record<string, IConnection[]>>` | `BTreeMap<String, BTreeMap<String, Vec<Option<Vec<Connection>>>>>` | Output-index level is a sparse `Vec<Option<..>>` preserving JS integer-like key sparsity; always iterated ascending (identical to JS numeric-key iteration). |
| `IConnection { node, type, index }` | `Connection { node, type_, index: usize }` | `type` → `type_` (Rust keyword). |
| `INode` | `INode { name, r#type, type_version: f64, position: [i64; 2], disabled: bool }` | Reduced to pure-model fields; `parameters`/`credentials`/… belong to LEGO `node`. |
| `Workflow` class | `Workflow` struct + `WorkflowParameters` | Pure subset: node-type resolution, default-parameter injection and the `Expression` engine are OUT (LEGO `node` / `expression`). |
| `NodeConnectionMapping` | `NodeConnectionMapping { by_source, by_destination }` | Built by `build_connection_maps`. |

### 7.2 Documented semantic decisions

1. **Key iteration order (determinism).** The original iterates
   `connections[node]` type keys and top-level node keys in JS object
   *insertion* order; Rust iterates `BTreeMap` keys *lexicographically*.
   Compatibility fixtures therefore list those keys in lexicographic order
   so both runtimes coincide (convention documented in
   `tests/compatibility/README.md`). This is what makes the golden invariant
   "same input ⇒ same adjacency list" hold by construction.
2. **`timezone` default.** Original: `settings.timezone ??
   getGlobalState().defaultTimezone`. Pure model: `"DEFAULT"` (no global
   state may be read — zero side effects).
3. **`detectCycles` / `findCycle` are NEW spec functions.** Original n8n has
   no load-time cycle detection (verified: no cycle check anywhere in
   `packages/workflow`); the acyclicity requirement comes from
   `contracts/workflow.contract.md` §2. Deterministic three-color DFS over
   sorted domain/neighbors, `main`-scope (execution semantics) or `all`-
   scope; read-only (non-destructive invariant).
4. **`getStartNodes` pure definition.** Original `getStartNode` needs
   `INodeTypes` (trigger/poll metadata — LEGO `node`). Pure definition:
   *a node is a start node iff it has no incoming MAIN connection*.
   Structural: `disabled` nodes are not filtered (execution-runtime
   concern). Deterministic sorted output.
5. **Faithful quirks preserved** (verified against the original, golden
   fixtures): sibling subtrees use per-call `checkedNodes` copies (a node can
   appear twice when reached via two distinct output indices — fixture
   `07-multi-io`), deeper nodes are "moved to front" on re-discovery
   (fixture `04-diamond`), the destination map preserves duplicate edges
   while traversal dedupes (fixture `10-duplicate-edges`), destination-map
   padding is empty lists `[]` (fixture `08-sparse-indices`).

### 7.3 Verification (Phase 3 → 4)

- Differential suite: 10 fixtures × original n8n (verbatim port, token-level
  proven against `reference/n8n/.../common/*.ts`) vs Rust, byte-exact diff
  (`tests/compatibility/run.sh`; golden outputs in `tests/compatibility/golden/`).
- `crates/n8n-workflow` embeds the same fixtures+expectations as golden
  tests (`tests/compat_golden.rs`), so `cargo test` alone is a
  self-contained compatibility gate: 25 unit tests + 10 golden tests.
- Status: Rust code complete and audited; **`cargo` execution (compile +
  test) is deferred to the VPS pipeline** — this sandbox's network policy
  blocks `static.rust-lang.org`/`crates.io`, so no Rust toolchain is
  installable here. Any stable toolchain ≥ 1.70 works (no dependencies).
=======
>>>>>>> origin/main
