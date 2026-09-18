# Workflow LEGO — `disabled` fidelity record (TASK-404)

| | |
| :--- | :--- |
| Author | Workflow LEGO owner (agent-1 lineage, Arena session `arena/01a0b1cb-n8n-rust-v-4`) |
| Date | 2026-09-18 |
| Scope | ISSUE-015 (HIGH, OPEN), ISSUE-017 (HIGH, OPEN), ISSUE-016 (MEDIUM, deferred) |
| Reference | n8n 2.9.4 — `reference/n8n/packages/workflow/src/workflow.ts`, commit `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Oracle | `n8n-workflow@2.9.1` + real `n8n-nodes-base@2.9.1` node classes (installed by `scripts/setup-reference-runtime.sh`) |
| Deliverable | `packages/workflow-recon/` (TypeScript reconstruction) + `tests/reference/04-disabled-node/` (recorded golden) |
| Language | TypeScript only — `PROJECT_RULES.md` rule 1 keeps Rust out of `crates/` and `apps/` |

ISSUE-015 and ISSUE-017 both say the port treats `disabled` as a field instead of
behaviour, and both point at a fixture that was supposed to exist. This record
does three things: states the reference semantics with line numbers, records the
observed answers from the real runtime, and delivers a reconstruction plus a
committed test that consumes the fixture.

---

## 1. The fixture ISSUE-015 cited did not exist

ISSUE-015: *"Agent 5 already shipped the fixture that would catch it:
`tests/reference/04-disabled-node/` (a disabled node wired mid-chain)."*

```text
$ git ls-tree -r --name-only origin/main tests/reference/ | grep disabled
(no output)
$ ls tests/reference/
01-empty-workflow  02-one-node  03-linear  README.md  agent-4  baseline  connection
execution-data  expression  harness  workflow-rust
```

So no committed test could have consumed it — the "R1: crates do not read
`tests/reference/**`" blocker was under-stated: for this case there was nothing
to read. The fixture now exists, with `expected.json` recorded from the oracle.

## 2. Reference semantics — where `disabled` is consulted

| site | code | effect |
| :--- | :--- | :--- |
| `workflow.ts:282` | `queryNodes`: `if (node.disabled === true) continue;` | disabled nodes never appear in `getTriggerNodes()` / `getPollNodes()`, **before** the type check |
| `workflow.ts:498` | `getHighestNode`: `if (this.nodes[nodeName].disabled === false)` | the node counts as its own highest node **only when the flag is literally `false`** |
| `workflow.ts:553` | `getHighestNode`: `if (this.nodes[connection.node].disabled !== true)` | a parentless ancestor is added unless the flag is `true` — an **absent** flag qualifies |
| `workflow.ts:824` | `__getStartNode`: `if (node && !node.disabled)` | single-candidate fast path |
| `workflow.ts:839` | `__getStartNode` trigger/poll scan: `if (node.disabled === true) continue;` | a disabled trigger is not a start node |
| `workflow.ts:853` | `__getStartNode` `STARTING_NODE_TYPES` scan: same test | same, for the fallback scan |

`getParentNodes` / `getChildNodes` / `getConnectedNodes`
(`common/get-connected-nodes.ts`) never read the flag.

### The asymmetry that is easiest to get wrong

`:498` uses `=== false`, `:553` uses `!== true`. For a node with **no** incoming
main connections, `getHighestNode` returns `currentHighest` — so an absent flag
and `false` give different answers for the same call. Observed on both sides
(`packages/workflow-recon`, synthetic case `disabled===false root counts as
highest, absent flag does not`):

```text
Explicitly Enabled (disabled: false)   reference -> ["Explicitly Enabled"]   recon -> ["Explicitly Enabled"]
Flag Absent        (no disabled key)   reference -> []                        recon -> []
```

## 3. Recorded evidence (`tests/reference/04-disabled-node/expected.json`)

Fixture: a **disabled** `manualTrigger` and an enabled `scheduleTrigger` both feed
`Code`, which fans out to a **disabled** `filter` (then `Set`, `disabled: false`)
and to a `noOp` with no flag. 101 calls recorded from `n8n-workflow@2.9.1`:

```text
getStartNode()                    "Schedule Trigger"     # the disabled trigger is skipped (:839)
getStartNode(Manual Trigger)      "Manual Trigger"       # see below
getStartNode(Set)                 "Schedule Trigger"
getHighestNode(Manual Trigger)    []
getHighestNode(Set)               ["Schedule Trigger"]
getHighestNode(Disabled Filter)   ["Schedule Trigger"]
getParentNodes(Set)               ["Schedule Trigger","Manual Trigger","Code","Disabled Filter"]
getChildNodes(Code)               ["NoOp","Set","Disabled Filter"]
getTriggerNodes()                 ["Schedule Trigger"]   # disabled trigger excluded (:282)
getPollNodes()                    []
```

`getStartNode(Manual Trigger) === "Manual Trigger"` is worth spelling out: the
disabled trigger asked for its own start node gets **itself** back. Chain:
`getHighestNode` returns `[]` (`disabled !== false`, no incoming) → `getStartNode`
pushes the destination node → `__getStartNode` rejects it three times (`:824`,
`:839`, `:853`) and returns `undefined` → `getStartNode` falls back to
`this.nodes[nodeNames[0]]` (`:880-884`), which is the disabled node. A port that
"helpfully" returns `undefined` here is wrong.

## 4. Correction to ISSUE-015

ISSUE-015 states: *"for a workflow containing a disabled node, `get_parent_nodes`
/ `get_child_nodes` in Rust will return a different set than n8n 2.9.4."*

**That is not what the reference does.** Recorded from `n8n-workflow@2.9.1`:

```text
getParentNodes(Set)   ["Schedule Trigger","Manual Trigger","Code","Disabled Filter"]
getChildNodes(Code)   ["NoOp","Set","Disabled Filter"]
```

Both sets **include** the disabled nodes (`Manual Trigger`, `Disabled Filter`).
`getConnectedNodes` — the single implementation behind both
(`common/get-parent-nodes.ts`, `get-child-nodes.ts`) — has no `disabled` branch at
all. The divergence class is real but narrower than recorded: it is
`getHighestNode` and start-node selection, not the parent/child traversals. A
port "fixed" to filter disabled nodes out of parent/child sets would *introduce*
a divergence.

ISSUE-017's claim (start node must skip a disabled trigger) **holds** and is
pinned by test.

## 5. Delivered

| path | what |
| :--- | :--- |
| `packages/workflow-recon/src/workflow.ts` | `WorkflowRecon` — the graph surface, each method annotated with its reference line range |
| `packages/workflow-recon/src/connections.ts` | `mapConnectionsByDestination` + the four traversal helpers, quirks included |
| `packages/workflow-recon/src/{types,constants,index}.ts` | type surface, vocabulary snapshot, public entry |
| `packages/workflow-recon/tools/reference-runtime.mjs` | oracle wiring: real node classes → registry (+ versioned node types via `getNodeType`) |
| `packages/workflow-recon/tools/collect.mjs` | the comparison surface (one function, used by recorder and both tests) |
| `packages/workflow-recon/tools/record-disabled-golden.mjs` | the only writer of `expected.json` |
| `packages/workflow-recon/test/01-graph-parity.test.ts` | differential parity vs live `n8n-workflow@2.9.1`: 4 golden fixtures + 6 synthetic cases |
| `packages/workflow-recon/test/02-disabled-golden.test.ts` | offline replay of the recorded golden (7 tests, no runtime needed) |
| `tests/reference/04-disabled-node/{workflow.json,expected.json,README.md}` | the fixture and its recorded answers |

ISSUE-016 (`pin_data` stored but never read) is addressed on this side too:
`getPinDataOfNode` is implemented per `workflow.ts:330` and covered by a test.

## 6. Reproduction

```text
$ bash scripts/setup-reference-runtime.sh
  n8n-workflow 2.9.1 / n8n-core 2.9.1 / n8n-nodes-base 2.9.1

$ npm --prefix packages/workflow-recon run record:golden
  recorded 101 calls -> tests/reference/04-disabled-node/expected.json
  (n8n-workflow 2.9.1, 6 node types from real classes)

$ npm --prefix packages/workflow-recon test
  # tests 18   # pass 18   # fail 0   # skipped 0

$ npm --prefix packages/workflow-recon run typecheck   # tsc --noEmit, strict + erasableSyntaxOnly
  (exit 0)

$ mv .runtime /tmp/ && npm --prefix packages/workflow-recon run test:golden ; mv /tmp/.runtime .
  # pass 7   # fail 0   # skipped 0        <- golden replay needs no runtime
```

## 7. What this does NOT close

- **ISSUE-015 / ISSUE-017 for the Rust port stay OPEN.** Nothing in `crates/`
  was touched (forbidden by `PROJECT_RULES.md` rule 1). The fixture and its
  recorded answers are now available to whoever owns that code, and
  `tests/reference/04-disabled-node/expected.json` is the acceptance criterion.
- **The integration gate is still BLOCKED**, for a reason unrelated to this task:
  the Phase-2 Rust guard fails on the 22 Rust artifacts under `crates/`
  (`bash tests/integration/run_gate.sh --offline-only` → Stage 1 `20/21`,
  Stage 2 `FAIL`). That is a policy contradiction between `PROJECT_RULES.md`
  ("ZERO RUST") and the Phase-3 Rust workspace, and it needs an orchestrator
  decision, not a unilateral delete.
- Cycle detection stays owned by the Validation LEGO (ISSUE-003 Option A):
  `WorkflowRecon` declares no acyclicity check, matching upstream.
