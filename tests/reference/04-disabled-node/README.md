# 04 — disabled node (golden, positive fixture)

A `manualTrigger` with `disabled: true` feeding an enabled `Code` node.

Structurally the workflow is **valid** — a disabled node is still a node, still uniquely named,
and its edges still resolve. `disabled` is not a validation rule; it is runtime behaviour
(`contracts/validation.contract.md` §5, `DisabledHandling` moved to non-responsibilities).

What it pins is **start-node resolution**, and the reference is asymmetric about the flag:

| Site | Reference test | Consequence for a node that omits `disabled` |
| :--- | :--- | :--- |
| `workflow.ts:498` (`getHighestNode`, the node itself) | `disabled === false` | **not** its own highest |
| `workflow.ts:553` (`getHighestNode`, a parent) | `disabled !== true` | **is** included |
| `workflow.ts:825` (`__getStartNode`, single candidate) | `!node.disabled` | qualifies |
| `workflow.ts:839` / `:853` (trigger / `STARTING_NODE_TYPES`) | `disabled === true` → skip | qualifies |

Expected results for this fixture, derived from the pinned reference runtime
(`n8n-workflow@2.9.1`):

```text
getStartNode()        -> undefined      (the only trigger is disabled; `Code` is not a trigger)
getHighestNode('Code') -> []            (the parent is disabled, so nothing is reported)
```

Evidence: `tests/reference/start-node/fixtures.json` cases `D-01` and `D-12`, produced by
`node tests/reference/start-node/build-fixtures.mjs` against the runtime installed by
`scripts/setup-reference-runtime.sh`. Re-derive with `--check`.

Consumed by `crates/n8n-workflow/tests/conformance.rs`
(`test_fixture_disabled_node_is_not_a_start_node`) and by
`crates/n8n-workflow/tests/start_node_fixtures.rs`.
