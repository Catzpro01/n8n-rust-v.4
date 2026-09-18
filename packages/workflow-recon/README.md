# @lego/workflow-recon — Workflow Model LEGO, reconstructed

Phase-3 TypeScript reconstruction of the n8n **2.9.4** Workflow Model graph
surface. Pure TypeScript, no Rust (`PROJECT_RULES.md` rule 1), no import from
`reference/` at runtime, and no build step: Node 22 strips the types and runs
the sources directly.

| | |
| :--- | :--- |
| Reference | `reference/n8n/packages/workflow/src/workflow.ts` (925 lines) + `src/common/**` |
| Reference commit | `b6dc2787c45677a29a9612cd27eb911302961a83` (n8n 2.9.4) |
| Oracle runtime | `n8n-workflow@2.9.1` — the artifact n8n 2.9.4 ships |
| Golden | `tests/reference/04-disabled-node/expected.json` (recorded, never hand-written) |
| Status | IMPLEMENTED (TypeScript) for the graph surface — 18/18 tests |

## What is reconstructed

`src/workflow.ts` — `WorkflowRecon`: `setNodes` / `setConnections` / `setPinData`
/ `setSettings`, `getNode`, `getNodes`, `queryNodes` (+ `getTriggerNodes`,
`getPollNodes`), `getPinDataOfNode`, `getHighestNode`, `getChildNodes`,
`getParentNodes`, `getConnectedNodes`, `getParentNodesByDepth`,
`searchNodesBFS`, `getNodeConnectionIndexes`, `__getStartNode`, `getStartNode`,
`getConnectionsBetweenNodes`.

`src/connections.ts` — `mapConnectionsByDestination`, `getConnectedNodes`,
`getChildNodes`, `getParentNodes`, `getNodeByName`, including the reference's
ordering quirks (see the fidelity notes at the top of that file).

## What is deliberately NOT here

| Concern | Owner | How it is reached |
| :--- | :--- | :--- |
| node parameter defaults (`workflow.ts:98-110`) | Node Model LEGO (02) | `applyNodeParameterDefaults` port (defaults to identity) |
| node type registry | Node Model LEGO (02) | `nodeTypes` constructor parameter |
| expression runtime | Expression LEGO | not touched |
| global state / default timezone (ISSUE-006) | platform | `defaultTimezone` parameter instead of `getGlobalState()` |
| execution, persistence, webhooks, scheduler | their own LEGOs | out of scope |

## Run

```bash
bash scripts/setup-reference-runtime.sh        # once: n8n-workflow/core/nodes-base 2.9.1 -> .runtime/
npm --prefix packages/workflow-recon install   # once: typescript + @types/node (typecheck only)

npm --prefix packages/workflow-recon test          # 18 tests (parity + golden)
npm --prefix packages/workflow-recon run test:golden   # 7 tests, runs WITHOUT the runtime
npm --prefix packages/workflow-recon run typecheck     # tsc --noEmit (strict, erasableSyntaxOnly)
npm --prefix packages/workflow-recon run record:golden # regenerate the golden from the oracle
```

`test/02-disabled-golden.test.ts` needs no install and no runtime: the golden
file carries both the recorded answers and the node-type index they were
recorded with. `test/01-graph-parity.test.ts` compares against the live
`n8n-workflow@2.9.1` and reports **skipped** (never passed) when the runtime is
missing.

## The `disabled` flag

`disabled` is behaviour, not storage. n8n consults it in six places and the
reconstruction reproduces all of them — see
`docs/isolation/workflow-disabled-fidelity.md` for the recorded evidence, the
line numbers, and the one asymmetry (`=== false` vs `!== true`) that is easiest
to get wrong.
