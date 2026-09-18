# TASK RESULT: TASK-404-workflow-disabled-fidelity

- **STATUS**: `SUCCESS` (fixture + evidence half of ISSUE-015/017; Rust port half stays OPEN with its owner)
- **AGENT**: `agent-1` (Workflow LEGO owner) — Arena session `arena/01a0b1cb-n8n-rust-v-4`
- **LEGO COMPONENT**: `workflow`
- **TIMESTAMP**: `2026-09-18 00:20 UTC`

## Summary

The `dynamic_task_pool` is unreachable from this sandbox
(`curl -v https://gqctxugkxekdqxsaqrum.supabase.co/` → `SSL_ERROR_SYSCALL`), so the
task was taken from the highest-severity OPEN item the Workflow owner may act on:
ISSUE-015/017, the `disabled` flag treated as storage instead of behaviour.
Two findings: the golden fixture ISSUE-015 cites (`tests/reference/04-disabled-node/`)
**did not exist on `main`**, and ISSUE-015's claim that `get_parent_nodes` /
`get_child_nodes` diverge is **wrong** — the reference includes disabled nodes in
both sets; only `getHighestNode` and start-node selection consult the flag
(`workflow.ts:282,498,553,824,839,853`). Delivered: the recorded fixture, a
TypeScript reconstruction of the Workflow graph surface (`packages/workflow-recon/`,
no Rust per `PROJECT_RULES.md` rule 1), a differential test against the live
`n8n-workflow@2.9.1`, and an offline replay of the golden that needs no runtime.
Record: `docs/isolation/workflow-disabled-fidelity.md`; ledger entry: ISSUE-023.

## Operations actually executed

| # | operation | command | result |
| :-- | :--- | :--- | :--- |
| 1 | probe task pool | `curl -v https://gqctxugkxekdqxsaqrum.supabase.co/` | TLS handshake fails (`SSL_ERROR_SYSCALL`) — pool unreachable, DNS resolves |
| 2 | read reference | `sed -n '240,925p' reference/n8n/packages/workflow/src/workflow.ts` | 6 `disabled` sites located: `:282,498,553,824,839,853` |
| 3 | install oracle | `bash scripts/setup-reference-runtime.sh` | `n8n-workflow 2.9.1`, `n8n-core 2.9.1`, `n8n-nodes-base 2.9.1` (885 packages) |
| 4 | write reconstruction | `packages/workflow-recon/src/{workflow,connections,types,constants,index}.ts` | 5 source files, every method annotated with its reference line range |
| 5 | record golden | `npm --prefix packages/workflow-recon run record:golden` | `recorded 101 calls -> tests/reference/04-disabled-node/expected.json (n8n-workflow 2.9.1, 6 node types from real classes)` |
| 6 | golden stability | re-record after the registry fix, `JSON.stringify(calls)` compare | `true` — the fix changed version resolution only, observed answers identical |
| 7 | parity + golden tests | `npm --prefix packages/workflow-recon test` | `# tests 18 / # pass 18 / # fail 0 / # skipped 0` |
| 8 | offline proof | `mv .runtime .runtime-hidden && … test:golden` | `# pass 7 / # fail 0` with **no runtime installed**; `.runtime` restored |
| 9 | typecheck | `npm --prefix packages/workflow-recon run typecheck` | `tsc --noEmit` exit `0` (strict, `erasableSyntaxOnly`) |
| 10 | regression gate | `bash tests/integration/run_gate.sh --offline-only` | Stage 1 `25/26` (was `20/21`), Stage 2 `FAIL` — the **same single pre-existing FAIL** (Phase-2 Rust guard, 22 artifacts in `crates/`); `diff` of failing checks before/after: identical |
| 11 | ledger + docs | `docs/isolation/CROSS-AGENT-ISSUES.md` (ISSUE-023), `docs/isolation/workflow-disabled-fidelity.md`, `tests/reference/04-disabled-node/README.md` | written |

## Key recorded values (from the oracle, not reasoned)

```text
getStartNode()                    "Schedule Trigger"    # disabled trigger skipped (workflow.ts:839)
getStartNode(Manual Trigger)      "Manual Trigger"      # falls back to the disabled node (:880-884)
getHighestNode(Manual Trigger)    []                    # disabled !== false (:498)
getHighestNode(Set)               ["Schedule Trigger"]  # disabled ancestor skipped (:553)
getParentNodes(Set)               ["Schedule Trigger","Manual Trigger","Code","Disabled Filter"]
getTriggerNodes()                 ["Schedule Trigger"]  # disabled excluded (:282)
```

## Not done / handed on

- `crates/**` untouched (forbidden). ISSUE-015/017 for the Rust port remain OPEN;
  `tests/reference/04-disabled-node/expected.json` is now the acceptance criterion.
- Integration gate still BLOCKED on the `PROJECT_RULES.md` "ZERO RUST" vs Phase-3
  Rust workspace contradiction — needs an orchestrator decision (ISSUE-023 §4).
- Live 11/11 not run: no docker and no VPS access in this sandbox
  (`command -v docker` → not found), so Stage 3 is `NOT RUN`, not passed.
