# 08 — traversal depth + type filter (getConnectedNodes core, pinned on n8n-workflow 2.9.1)

Graph: `Trigger→A→{B,C}→D→E` (diamond), `Tool ⟶ai_tool⟶ D`, `Model ⟶ai_languageModel⟶ D`, `Sub ⟶ai_tool⟶ Tool`.

Pins (all recorded from the real runtime, `UPDATE=1 node run.js connection`):
- `depth`: `0 → []`, `1 → direct`, `-1`/omitted → unbounded; each recursion level decrements (`newDepth`).
- Ordering: `unshift` + dedupe ⇒ farthest first, diamond node `D` appears once (`checkedNodes`).
- `ALL_NON_MAIN`: types = `Object.keys(byDest[D])` minus `main`, iterated in key order → `[Model, Sub, Tool]`.
- `ALL`: `[Model, Sub, Tool, Trigger, A, C, B]`; **quirk**: `parents E ALL` also yields `Model/Sub/Tool` because the
  filter is forwarded to the recursion (E has only `main` keys, but D has `ai_*`).
- `getHighestNode(E)` = `[Trigger, C]` (not `[Trigger]`): consequence of the shared `checkedNodes` array in
  `workflow.ts:492-575` documented in `connection-workflow-members-spec.md` §2 — recorded, not derived.
- `getParentNodesByDepth(E)` emits `D(1), B(2), C(2), A(3), Trigger(4)` with `indicies:[0]` each.
- `getNodeConnectionIndexes(D ← Sub, ai_tool)` = `{0,0}` (2-hop BFS over a non-main type).
