# `Workflow` traversal members used by the Connection fixtures — port notes for Agent 1

| Field | Value |
| :--- | :--- |
| Author | `agent-3` (Connection). **Owner of the code: Agent 1** (`crates/n8n-workflow`, contract CD-04). This is a hand-off, not a change. |
| Why | 14 probes in `tests/reference/connection/*` are `wf.*` ops (`getNodeConnectionIndexes` ×7, `getHighestNode`, `getStartNode` ×2, `getParentNodesByDepth`, `getParentMainInputNode`, …). They are pinned to n8n 2.9.4 runtime behaviour and currently *skipped* by every Rust runner. Porting these five members turns them into checks. |
| Source | `reference/n8n/packages/workflow/src/workflow.ts` (line refs below), n8n 2.9.4 |
| Current Rust state (`3fc3156c`) | `get_start_node` exists as a *simplified* port (`lib.rs:207`, comment says node-type heuristics not ported); `get_highest_nodes` is "simplified"; the other three do not exist. |

All five operate on the two maps + `nodes` only; none needs the expression runtime. `getParentMainInputNode`
additionally needs `NodeHelpers.getNodeOutputs` (Agent 2, CD-05) — see §5.

## 1. `getNodeConnectionIndexes(nodeName, parentNodeName, type = 'main')` — `workflow.ts:746-810`

Returns `{ sourceIndex, destinationIndex } | undefined`. **BFS upward** over `connectionsByDestinationNode`.

```
if getNode(parentNodeName) is null → undefined                       // L753-756
visited = Set; queue = [nodeName]
while queue: current = queue.shift()                                  // FIFO
  if visited has current → continue; visited.add(current)
  typeConnections = byDest[current]?.[type]; if none → continue
  for typedConnectionIdx in 0..len:                                    // = destination input index
    slot = typeConnections[typedConnectionIdx]; if null → continue
    for destinationIndex in 0..slot.len:                               // = position inside the slot
      connection = slot[destinationIndex]
      if connection.node == parentNodeName →
          return { sourceIndex: connection.index, destinationIndex }  // L793-798  ← NOTE: destinationIndex is the
                                                                        //   position in the slot, NOT the input index
      if !visited has connection.node → queue.push(connection.node)
return undefined
```

Pinned: 02 `IF -> B` → `{1,0}`; 02 `Merge <- IF (BFS finds first reachable path)` → `{1,0}`; 02 `Merge <- Sparse` →
`undefined` (harness renders `{"undefined": true}`); 03 `Agent <- Tool` default type → `undefined`, with
`type: 'ai_tool'` → found; 04 `Merge <- Loop` through the cycle.

## 2. `getHighestNode(nodeName, nodeConnectionIndex?, checkedNodes?)` — `workflow.ts:492-575`

Returns `string[]` of the top-most **non-disabled** ancestors over `main` input edges only.

```
currentHighest = []
if nodes[nodeName].disabled === false → currentHighest.push(nodeName)  // L499: strict === false, so `undefined` does NOT count
if !byDest[nodeName] or !byDest[nodeName].main → return currentHighest
checkedNodes = checkedNodes || [] (SHARED across recursion — not copied); if includes(nodeName) → return currentHighest
checkedNodes.push(nodeName)
returnNodes = []
for connectionIndex in 0..byDest[nodeName].main.length:
  if nodeConnectionIndex given and != connectionIndex → continue
  for connection in slot (skip null):
    if checkedNodes includes connection.node → skip
    if connection.node not in nodes → skip                              // L544 dangling refs ignored
    addNodes = getHighestNode(connection.node, undefined, checkedNodes)
    if addNodes empty and nodes[connection.node].disabled !== true → addNodes = [connection.node]
    for name in addNodes: push to returnNodes if absent
return returnNodes                                                      // NOTE: currentHighest is only returned on the early exits
```

Pinned: 04 `highest nodes of End` → `["Trigger", "Sparse"]` (order = discovery order over input slots).

## 3. `getStartNode(destinationNode?)` + `__getStartNode(nodeNames)` — `workflow.ts:817-891`

```
getStartNode(dest):
  if dest: names = getHighestNode(dest); if empty → [dest]
           n = __getStartNode(names); if n → n; else → nodes[names[0]]
  else:    __getStartNode(Object.keys(nodes))

__getStartNode(names):
  if names.length == 1 and nodes[names[0]] exists and !disabled → that node            // L822-827
  for name in names: nodeType = nodeTypes.getByNameAndVersion(...)
      if nodeType.description.name == MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE → continue
      if nodeType.trigger !== undefined or nodeType.poll !== undefined → if !disabled → return node   // needs node-type registry (Agent 2)
  sorted = all nodes sorted by STARTING_NODE_TYPES.indexOf(type)  (constants.ts:53-59: manualTrigger,
           executeWorkflowTrigger, errorTrigger, evaluationTrigger, formTrigger); NOTE: indexOf = -1 for
           non-start types, so they sort FIRST — harmless because the next loop filters by includes()
  for name in sorted: if STARTING_NODE_TYPES includes node.type and !disabled → return node
  return undefined
```

Pinned: 04 `start node of End` → `"Trigger"` (the fixture stub declares `Trigger*` nodes with `inputs: []`,
no `trigger`/`poll` — so the result comes from `getHighestNode` returning `[Trigger, Sparse]` and
`__getStartNode` falling through to `nodes[names[0]]`). 01 pins the same path.
The Rust `START_NODE_TYPES` check in `lib.rs:222` must use the 5-entry `STARTING_NODE_TYPES` list *and* the
`trigger`/`poll` registry check to be complete; the second half is CD-05 territory.

## 4. `getParentNodesByDepth(nodeName, maxDepth = -1)` → `searchNodesBFS(byDest, nodeName, maxDepth)` — `workflow.ts:620-685`

Returns `IConnectedNode[] = { name, indicies: number[], depth }[]` (sic: `indicies`). `main` only.

```
returnConns = []; queue = [{name: source, depth: 0, indicies: []}]; visited = {}; depth = 0
while queue non-empty:
  if maxDepth != -1 and depth > maxDepth → break
  depth++
  toAdd = queue; queue = []
  for curr in toAdd:
    if visited[curr.name]: visited[curr.name].indicies = dedupe(visited.indicies ++ curr.indicies); continue  // merges into the ALREADY-EMITTED object
    visited[curr.name] = curr; if curr.name != source → returnConns.push(curr)
    for slot in connections[curr.name]?.main (skip null): for c in slot:
        queue.push({ name: c.node, indicies: [c.index], depth })
return returnConns
```

Pinned: 02 `parents by depth of Merge` → `[{A,[0],1}, {Loop,[0],1}, {IF,[1,0],1}, {Trigger,[0],2}]` — note
`IF.indicies = [1,0]`: IF is reached twice at depth 1 (via both Merge inputs) and the second hit is merged into
the first object. Serialise field order `name, indicies, depth`.

## 5. `getParentMainInputNode(node)` — `workflow.ts:687-744`

Follows **non-main outputs** downward (e.g. `Tool --ai_tool--> Agent`) to find the node whose main input
this sub-node feeds. Needs `NodeHelpers.getNodeOutputs(workflow, node, nodeType.description)` (Agent 2,
CD-05) to know which output types the node declares.

```
nodeType = nodeTypes.getByNameAndVersion(node.type, node.typeVersion); if no outputs → node
nonMain = [types of outputs != 'main'].sort()
if nonMain non-empty:
  connected = []
  for type in nonMain: if bySrc[node.name]?.[type] → connected ++= getChildNodes(node.name, type)
  if connected non-empty: connected.sort(); return getParentMainInputNode(getNode(connected[0]))  (throws if missing)
return node
```

Pinned: 03 `parent main-input node of Tool (sub-node -> itself)` → **`"Tool"`**. The harness stub
(`tests/reference/harness/connection.js` `generic()`) declares `outputs: ['main']` for every node, so
`nonMain` is empty and the reference returns the node itself. The fixture therefore pins the **early-return
path only**; the `ai_tool → Agent` climb is *not* pinned yet because it needs a node type whose declared
outputs are `['ai_tool']` (Agent 2's registry). A future fixture with such a stub should expect `"Agent"`.

## 6. Where these belong

Per contract CD-04 all five stay in `n8n-workflow` (Agent 1). They consume, and must not re-implement,
`n8n-connection`'s `get_connected_nodes` (used by `getParentMainInputNode` via `getChildNodes`) and the
destination map. Once ported, `tests/reference/harness/rust/connection_reference_fixtures_full.rs` gains
five `match` arms and the 14 skipped probes become checks — agent-3 will add those arms on request.
