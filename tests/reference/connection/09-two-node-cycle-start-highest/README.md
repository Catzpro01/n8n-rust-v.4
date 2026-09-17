# 09 — two-node cycle: getStartNode / getHighestNode must terminate (ISSUE-028 pinned)

Agent 5's Stage 2k found that the Rust port stack-overflowed on `A → B → A` (`get_start_node(B)`) while the engine
returns `"A"`. No golden covered `getStartNode`/`getHighestNode` on a graph with **no acyclic entry** — case 04 has a
`Trigger`. This case pins the minimal repro plus its neighbours, all recorded from `n8n-workflow@2.9.1`:

| probe | pinned | why |
|---|---|---|
| `highest(B)` / `highest(A)` | `["A"]` / `["B"]` | `checkedNodes` guard (workflow.ts:513-521, 541-545): the node that closes the cycle is dropped, the other parent is returned |
| `start(B)` / `start(A)` | `"A"` / `"B"` | `getStartNode` falls through to `getHighestNode` when no trigger/poll/starting type exists |
| `start()` (no destination) | `null` | no starting-type node, no `nodes[0]` promotion in this path |
| `getNodeConnectionIndexes(A ← A)` | `{0,0}` | BFS revisits `A` through `B` and stops |
| self-loop `S → S` | `highest(S)=[]`, `start(S)="S"`, `parents(S)=[]`, `indexes(S←S)={0,0}` | `checkedNodes` contains `S` before its own parent list is scanned |
| `P → Q(disabled) → P` | `highest(P)=[]`, `highest(Q)=["P"]`, `start(P)="P"` | `disabled === false` short-circuit is **not** taken for undefined `disabled`; disabled `Q` is walked through but not emitted (`disabled !== true`) |
| graph-utils on `{A,B}` | roots `[]`, leaves `[]`, extractable `{}` | pure-cycle selection: no error, no start/end |

Records are recorded, not derived. Values that look odd (`highest(S)=[]`, `highest(P)=[]`) are the reference behaviour.
