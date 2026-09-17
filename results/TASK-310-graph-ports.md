# TASK RESULT: TASK-310-graph-ports

- **STATUS**: `SUCCESS`
- **AGENT**: arena worker — session `arena/01a0aee7-n8n-rust-v-4`
- **LEGO COMPONENT**: `workflow` (reconstructed engine, JS)
- **TIMESTAMP**: `2026-09-17 11:20 UTC`
- **MANIFEST**: [`tasks/TASK-310-graph-ports.yaml`](../tasks/TASK-310-graph-ports.yaml)

---

### Summary (padat)

TASK-309 shipped with two simplifications it named itself; both are closed here against the reference
source. The waiting-node release pass now consults `requiredInputs` (`interfaces.ts:2355`,
`workflow-execute.ts:2107-2177`) in both supported forms — a count and an index list, ignored entirely
for `executionOrder: 'v0'` — and decides "is an ancestor still waiting" over **all** ancestors via a
new 1:1 port of `getConnectedNodes` / `getParentNodes`
(`common/get-connected-nodes.ts:11-95`, `common/get-parent-nodes.ts:11-18`) instead of only the direct
predecessors, which is what `workflow-execute.ts:2136` actually does. Because a port claim is only
worth what it is checked against, `test/graph-equivalence.test.mjs` now calls the **real**
`getParentNodes` / `getConnectedNodes` / `mapConnectionsByDestination` exported by the pinned
`n8n-workflow` 2.9.1 and compares them exactly across 8 graph fixtures (empty, linear, diamond, cycle,
self-loop, sparse input index, `ai_tool` multi-type, 3-way fan-in) and 7 type/depth variants — 22
`getParentNodes` lookups and 154 `getConnectedNodes` lookups, all identical. The new ancestor rule was
proved to matter by temporarily reverting it to the old direct-predecessor check: the suite drops to
27/28 with `not ok 24`, and returns to 31/31 when restored.

### Evidence

| check | result | exit |
| :--- | :--- | ---: |
| `npm run engine:test` | `# tests 31 · # pass 31 · # fail 0 · # skipped 0` | 0 |
| ↳ 3 PORT-equivalence cases vs real `n8n-workflow` 2.9.1 | identical on every fixture/variant | 0 |
| ↳ negative control (ancestor rule reverted to direct predecessors) | `not ok 24`, `27/28` → restored `31/31` | 1 → 0 |
| `bash tests/integration/run_gate.sh --offline-only` | stages 1-3 `OFFLINE STAGES : PASS` (21/21 · AUDIT PASS · 31/31), `LIVE 11/11 : NOT RUN` | 2 (INCONCLUSIVE by design) |
| `npm run verify` (Workflow LEGO, 11 gates) | `11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED` | 0 |
| `npm run rust:guard` | PASS — `crates/`, `apps/` still `.gitkeep`-only | 0 |
| `node packages/reconstructed-engine/test-run.mjs` | unchanged | 0 |

New behaviour, each with its own test:

| case | result | reference |
| :--- | :--- | :--- |
| `requiredInputs: 1` on a 2-input node, one branch dead | released with `[items, []]` | `:2174-2177` |
| `requiredInputs: 2` (== `inputs.length`) | **never** released with partial data | `:2119-2123` |
| `requiredInputs: [0]` / `[1]` / `[0,1]` | released / held / held | `:2160-2172` |
| `requiredInputs` with `executionOrder: 'v0'` | ignored, node released | `:2107-2110` |
| ancestor `P` still waiting, direct predecessors not | node held back | `:2136-2142` |
| expression form `'={{ … }}'` (Merge v3 really uses this) | treated as unspecified — **documented gap**, asserted so it cannot change meaning silently | `:2111-2121` |

### Boundary compliance

* `reference/n8n/**` read-only — gate `G04` re-verified the tree byte-identical (15 050 files,
  root `f8da35180669d798…`) in the same run that produced the 11/11.
* **Zero Rust** (rule 1): `rust:guard` exit 0. **UI untouched** (rule 5): no `editor-ui`, `.vue`,
  CSS/SCSS or theme file in the diff.
* Public API change is additive: `registerNodeType(type, handler, description?)` — the third
  argument is optional, so existing two-argument registrations keep working (verified by the
  28 pre-existing cases passing unchanged).

### Handed to the next worker

1. `requiredInputs` as an expression string still needs the Expression LEGO
   (`packages/workflow/src/expression.ts`) — the only named gap left in the release pass.
2. Not reconstructed yet: expressions `{{ … }}`, credentials, pin data, `waitTill` resume,
   sub-workflows, AI/routing nodes, execution timeout (`workflow-execute.ts:1487-1492`).
3. VPS `11/11` PostgreSQL smoke (caveat `C1` of `TASK-305`) still outstanding — unreachable from this
   sandbox (`157.10.160.95` → HTTP 000, no `docker`), so `run_gate.sh` stays `INCONCLUSIVE`.
