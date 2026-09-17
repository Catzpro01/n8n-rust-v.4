# Agent-3 review (Tahap 2, STANDING-WORKER-PROTOCOL) — Validation LEGO increment `fa6a1de0`

| Field | Value |
| :--- | :--- |
| Reviewer | `agent-3` (LEGO 03 `connection`) |
| Reviewed task | `tasks/TASK-306-validation-audit-request.yaml` — agent-4, subject commit `fa6a1de0` (on main via `99b47f86`) |
| Reviewed at | `arena/01a0ac05-n8n-rust-v-4` @ `ff285577` (main `b809399b` merged) |
| Why agent-3 | The increment implements `DanglingConnections` / `CycleDetection`, i.e. the consumer side of `contracts/connection.contract.md` §3.1–3.2, §3.6 (CD-06). |

## Vote: **APPROVED**

### Rubrik 1 — Jalur berkas ✅
`git show --name-only fa6a1de0` → 6 files: `contracts/validation.contract.md`, `docs/isolation/validation.md`,
`docs/isolation/validation-golden-cases.md`, `tests/reference/agent-4/README.md`,
`tests/reference/agent-4/validation/{validation.test.ts,workflow-rules.ts}`. All inside the task's `allowed_paths`;
nothing under `crates/**`, `apps/**`, `reference/n8n/**`.

### Rubrik 2 — Integritas golden oracle (n8n 2.9.4) ✅
Re-checked against the real runtime (`n8n-workflow@2.9.1` in `tests/reference/harness/node_modules`):

| Claim in increment | Runtime probe | Result |
| :--- | :--- | :--- |
| reference accepts cycles (`allowCycles` default `true`) | `getConnectedNodes({A→B, B→A}, 'A')` → `['B']`, terminates | consistent with connection contract §3.6 |
| reference accepts dangling targets | `new Workflow({Trigger→Ghost})` constructs; `getNode('Ghost')` → `null` | matches `docs/isolation/validation.md` §2 row |
| reference accepts duplicate names | two nodes named `Code` → `Object.keys(wf.nodes).length === 1` (silent collapse) | "silently accepts" is accurate; last-write-wins is worth one sentence in the doc (non-blocking) |
| `NODE_CONNECTION_TYPES` list | identical to `interfaces.ts` L2249-2263 (13 values) | ✅ |
| `CycleDetection` is `main`-only (D8) | same edge filter as reference `graph-utils.buildAdjacencyList` (main only) | consistent with connection contract |

The D-rules are correctly labelled **NEW CAPABILITY**, opt-in, not wired into any reference path — exactly what
ISSUE-003 Option A and connection contract CD-06 require. No deviation from 2.9.4 behaviour is introduced.

### Rubrik 3 — Bukti nyata ✅
```
$ node --test tests/reference/agent-4/validation/validation.test.ts
# pass 6  # skipped 4          (A/B/C need N8N_RUNTIME)
$ N8N_RUNTIME=$PWD/tests/reference/harness node --test tests/reference/agent-4/validation/validation.test.ts
# pass 10  # fail 0  # skipped 0
```
Matches the task's `pre_audit_results` (10/10). Deliverable is physical code + tests, not a report.

### Non-blocking notes (no vote impact)
1. `workflow-rules.ts` duplicates the `NodeConnectionTypes` list; when `packages/validation-lego/` is created it
   could import the type vocabulary through a seam instead (connection-lego exposes the same 13 values in
   `src/kernel/vocabulary.ts`, drift-checked).
2. `detectCycles` `path` for the back-edge is `['connections', <from>, 'main']` without the output index; fine for
   the contract's message-level guarantee, mention in §11.8 if the path shape is meant to be stable.
