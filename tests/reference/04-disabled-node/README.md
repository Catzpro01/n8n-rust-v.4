# 04-disabled-node — `disabled` is behaviour in `getHighestNode` / `getStartNode`

Contract-sourced golden fixture (ISSUE-015 corrected scope + ISSUE-017). Every expected value
below is **traced by hand from the pinned reference source**
(`reference/n8n/packages/workflow/src/workflow.ts`), not invented:

| probe | trace |
| :--- | :--- |
| D-01 `getHighestNode("C")` → `["Trigger"]` | A disabled node mid-chain is *transparent*: `C` (omitted flag) is not pushed (`:498` strict `=== false`); recursion walks `C → B → A → Trigger`; `Trigger` has no parents and `disabled !== true` (`:553`) so it is added. `B` (`disabled: true`) never appears but does not block the walk. |
| D-02 `getHighestNode("Y")` → `[]` | `Y`'s only parent is `X` (`disabled: true`, no parents). Recursion returns `[]` and `:553` (`disabled !== true` → false) refuses to add `X`. |
| D-04a `getHighestNode("E")` → `["E"]` | `E.disabled === false` passes the **strict** `:498` check → the standalone node is its own highest node. |
| D-04b `getHighestNode("F")` → `[]` | `F.disabled === true` fails `:498`, no parents → `[]`. |
| D-04c `getHighestNode("Trigger")` → `[]` | Trigger **omits** the flag: `undefined === false` is false → not pushed. This is the D-04 asymmetry: the same node *as a parent* (`undefined !== true`) WOULD be included. |
| D-03a `getStartNode("D")` → `"Trigger"` | highest = `["Trigger"]`, single candidate, `!node.disabled` (`:824`) → returned. |
| D-03b `getStartNode("Y")` → `"Y"` | highest = `[]` → destination pushed (`:821-825`); single candidate `Y` not disabled → returned. |
| D-03c `getStartNode("F")` → `"Trigger"` | single candidate `F` is disabled → skipped; `__getStartNode` scans **all** nodes sorted by `STARTING_NODE_TYPES` index (`:846-855`, stable; absent types first, `indexOf` = -1) and returns the first non-disabled start-type node → `Trigger`. |
| scope probes | `getParentNodes("C")` → all transitive parents `["Trigger","A","B"]` and `getChildNodes("A")` → `["D","C","B"]` — disabled `B` appears in both, because `graph-utils.ts` has no `disabled` branch. The nearest-last order is the `getConnectedNodes` `unshift` behaviour. |

The `case.json`/`expected.json` pair uses the same probe shape as
`tests/reference/connection/04-cycle/` so the TS reference harness
(`tests/reference/harness/run.js`) can execute it unchanged against the pinned runtime;
`crates/n8n-workflow/tests/disabled_node.rs` drives the same pair from the Rust port.

Note on `type: "x"`: same convention as `04-cycle` — an opaque node type. For the Rust port it
is intentionally NOT in `START_NODE_TYPES`, which is what D-03c exercises (the sorted scan must
skip non-start types rather than treat them as candidates).
