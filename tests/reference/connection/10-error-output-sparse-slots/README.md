# 10 — error output + sparse output slots (R-08)

Recorded from the real `n8n-workflow@2.9.1` runtime through `tests/reference/harness/run.js`
(`UPDATE=1 node run.js connection`). 31 probes. Nothing hand-written in `expected.json`.

## Graph
```
Trigger → Http(onError=continueErrorOutput)
Http.main[0] (success) → Ok → Merge#0
Http.main[1] (error)   → Fail → Merge#1,  Fail → Log
Http.main[1]           → Log            (so Log has two parents: Http and Fail)
Http.main[2] = null    Http.main[3] = []   (sparse slots as n8n serialises them)
```

## What it pins (verified against source, `reference/n8n/packages/workflow/src`)
| Fact | Where in source |
|---|---|
| `null` / `[]` slots are skipped, never create destination entries (`byDestination` has no ghost keys) | `common/map-connections-by-destination.ts` (`connectionsByIndex?.forEach`) |
| Error output is just **sourceIndex 1** — no special `error` connection type in 2.9.4; `indexes Fail<-Http = {1,0}` | `workflow.ts getNodeConnectionIndexes` |
| `getChildNodes(Http, depth -1)` returns **`Log` twice** (`[Log, Log, Merge, Fail, Ok]`) — `unshift` happens before the recursion dedups; only the recursive branch dedups via `indexOf/splice`. Port must reproduce this, not "fix" it. | `common/get-connected-nodes.ts` L67-93 |
| `getParentNodes(Log)` **is** deduped (`[Trigger,Http,Fail]`) because the duplicate arrives through the recursive branch | same |
| `getHighestNode(Merge)=[Trigger,Fail]`: `Fail` is reported as *highest* because `Http` was already in the shared `checkedNodes` when the `Fail` branch climbed → `addNodes=[]` → `Fail` itself is pushed. Order-dependent by design. | `workflow.ts:538-556` |
| `getParentNodesByDepth(Merge)` reports `Http` with `indicies [0,1]` (both output slots) at depth 2 | `workflow.ts getParentNodesByDepth` |
| `getNodeConnectionIndexes(Merge, Http)` (no direct edge) → `{0,0}` **not** `undefined`: the method is a BFS up the *ancestor chain* (queue over `connectionsByDestinationNode`) and returns at the first ancestor edge whose source is `parentNodeName` — here `Ok←Http` at slot position 0 | `workflow.ts:746-800` |
| `destinationIndex` is the **position inside the slot array**, not the node input index: `Merge<-Fail = {0,0}` although Fail feeds Merge input 1; `Log<-Fail = {0,1}` because the Fail→Log entry is 2nd in Log's byDest slot | same (`destinationIndex` loop variable) |

Runner results with this case added: spec runner 82 ok / 0 mismatch / 59 skipped; `n8n-workflow` crate @ main
55 ok / 1 mismatch (D-11, pre-existing) / 85 skipped.
