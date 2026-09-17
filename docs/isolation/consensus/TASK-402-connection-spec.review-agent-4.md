# Consensus review — TASK-402-connection-spec (agent-3)

| Field | Value |
|---|---|
| Reviewer | agent-4 |
| Reviewed artefact | `docs/isolation/connection-workflow-members-spec.md` (a445a9ab) + `results/TASK-402-connection-spec.md` |
| Protocol | `docs/isolation/STANDING-WORKER-PROTOCOL.md` Tahap 2 — written rubric, no blind vote |
| **VOTE** | **APPROVED** |

## Rubric

### 1. Aturan jalur berkas — PASS
Deliverable is a single doc under `docs/isolation/`; no `crates/**`, no `apps/**`, no `reference/**` touched. The doc explicitly hands the code to Agent 1 (contract CD-04) instead of writing it — correct boundary behaviour.

### 2. Integritas golden oracle (n8n 2.9.4) — PASS, independently re-executed
I did not take the spec's pseudocode on trust; I drove the real `n8n-workflow` runtime (2.9.1 artifact of n8n 2.9.4) with minimal graphs and compared against the three non-obvious claims:

| Spec claim | Runtime result | Verdict |
|---|---|---|
| §1 `getNodeConnectionIndexes`: `destinationIndex` is the **position inside the slot**, not the input index | `A → M[input 1]`, `B → M[input 0]`: `idx(M,A) = {sourceIndex:0, destinationIndex:0}` — input index 1 is *not* reported | matches (quirk confirmed) |
| §2 `getHighestNode`: `disabled === false` strict, but ancestors with `disabled` undefined still returned via the `!== true` fallback | `A(disabled undefined) → B(false) → C`: `highest(C) = ["A"]` | matches |
| §4 `getParentNodesByDepth`: second hit at same depth merges `indicies` into the already-emitted object; field order `name, indicies, depth` | `IF` feeding both Merge inputs: `[{"name":"IF","indicies":[0,1],"depth":1},{"name":"T","indicies":[0],"depth":2}]` | matches |

Line references (`workflow.ts:746-810`, `492-575`, `620-685`) resolve to the described code. No divergence from n8n 2.9.4 found.

### 3. Keberadaan bukti nyata — PASS (with one process note)
Physical deliverable exists (137 lines, five members fully specified with pinned fixture expectations). Note: `results/TASK-402-connection-spec.md` has an empty operations table (Agent 5's T1 flag) — that is a gateway-stub artefact, the *work* is real and verifiable above. Not a rubric violation of the worker.

## Non-blocking suggestions (do not affect the vote)
- §5 `getParentMainInputNode`: state explicitly that the fixture pins only the early-return path; a stub with `outputs:['ai_tool']` is needed before the climb can be claimed — the doc says this, a one-line "NOT YET PINNED" banner would make it harder to miss.
- Consider adding the three runtime probes above as recorded fixtures so the spec is machine-checked (pattern: `tests/reference/agent-4/validation/gen-*-fixtures.mjs`).
