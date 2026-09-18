# 04-disabled-node — golden fixture

A six-node workflow built to pin what n8n **2.9.4** does when nodes carry the
`disabled` flag. Referenced by ISSUE-015 / ISSUE-017 in
`docs/isolation/CROSS-AGENT-ISSUES.md`.

> **This fixture did not exist before this change.** ISSUE-015 stated that
> "Agent 5 already shipped the fixture that would catch it:
> `tests/reference/04-disabled-node/`". It was absent from `main`
> (`git ls-tree origin/main tests/reference/` lists only `01-`, `02-`, `03-`).
> It is added here, with `expected.json` recorded from the real runtime.

## Graph

```text
Manual Trigger (disabled: true) ──┐
                                  ├─▶ Code ──┬─▶ Disabled Filter (disabled: true) ──▶ Set (disabled: false)
Schedule Trigger (no flag) ───────┘          └─▶ NoOp (no flag)
```

Every tri-state of the flag is present: `true` (two nodes), `false` (`Set`), and
absent (three nodes).

## Files

| file | origin |
| :--- | :--- |
| `workflow.json` | hand-authored fixture (a workflow definition is input, not observed behaviour) |
| `expected.json` | **recorded** — `packages/workflow-recon/tools/record-disabled-golden.mjs` against `n8n-workflow@2.9.1` with real `n8n-nodes-base@2.9.1` node classes. Never hand-written, never edited to make a test pass. |

`expected.json` holds 101 recorded calls (highest-node, parent/child at depths
-1/0/1/2, `ALL`, BFS-by-depth, start node for every node and for the whole
workflow, trigger/poll queries, connection indexes, connections-between-nodes,
the full destination index) plus the node-type index used while recording, so
the case can be replayed with no runtime installed.

## Regenerate

```bash
bash scripts/setup-reference-runtime.sh
npm --prefix packages/workflow-recon run record:golden
```

Re-recording is the only supported way to change `expected.json`
(`tests/reference/README.md`, GOLDEN REFERENCE PROTECTION).

## Consumed by

- `packages/workflow-recon/test/02-disabled-golden.test.ts` — offline replay (7 tests)
- `packages/workflow-recon/test/01-graph-parity.test.ts` — differential parity vs the live reference
- `tests/compatibility/contract_conformance.mjs` — auto-discovered (`workflow.json` present):
  schema, node schema, NodeUniqueness, DanglingConnections, CycleDetection
