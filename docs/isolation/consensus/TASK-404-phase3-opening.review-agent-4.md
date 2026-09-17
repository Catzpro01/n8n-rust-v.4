# Agent-4 review (Tahap 2, STANDING-WORKER-PROTOCOL) — TASK-404-phase3-opening (agent-1)

| Field | Value |
| :--- | :--- |
| Reviewer | `agent-4` (LEGO 04 `validation` — spec/oracle owner of `crates/n8n-validation` under Option B) |
| Reviewed task | `results/TASK-404-phase3-opening.md` — agent-1, commit `ebbfa593`, reviewed at branch head `6535009f` (`arena/01a0ace4-n8n-rust-v-4`) |
| Scope of this review | the **validation** slice only: `crates/n8n-validation/src/lib.rs`, `crates/n8n-validation/tests/cyclic_invalid.rs`, `tests/reference/05-cyclic-invalid/**`, `crates/n8n-connection` `NODE_CONNECTION_TYPES`. Workflow/gate parts are for agent-3/agent-5. |
| ⚠ ID clash | agent-1's `TASK-404-phase3-opening` and agent-4's `TASK-404-validation-lego-seam` share the number `404` (both provisional, allocated offline). Not a rubric failure, but the mediator must allocate distinct IDs before Supabase `dynamic_task_pool` rows are written. |

## Vote: **APPROVED** (validation slice) — with 2 correction requests for the *next* increment, not blocking this one

### Rubrik 1 — Jalur berkas ✅
Phase 3 is formally opened by this task (`docs/isolation/PHASE-3-OPENING.md`, phase-aware guards), so `crates/**` writes are inside agent-1's Phase-3 role ("Rust port owner — Workflow/Connection/Validation"). `git diff --name-only origin/main...6535009f` shows no `reference/n8n/**` change (`node tools/workflow-reference-manifest.mjs --check` claimed PASS by the author; consistent with my earlier ISSUE-011 verification). No writes into `packages/validation-lego/**` or `tests/reference/agent-4/**` (my area).

### Rubrik 2 — Integritas golden oracle ✅ (re-executed against the TS oracle)
`tests/reference/05-cyclic-invalid/case.json` replayed through the owning TS implementation (`packages/validation-lego/src/rules/workflow-rules.ts`):

```
validateWorkflow(case, {allowCycles:false}) →
  {"valid":false,"errors":[{"code":"CYCLE_DETECTED","node":"A","path":["connections","C","main"],"message":"Cycle detected: A → B → C → A"}]}
validateWorkflow(case)                      → {"valid":true,"errors":[]}      (default allowCycles:true, D6 parity)
```
Both match the fixture README and the Rust assertion `Err(CycleDetected("A → B → C → A"))`. Fixture is a **new** negative case; no existing golden mutated.

Static fidelity checks of `lib.rs` @ `6535009f` against `workflow-rules.ts` / `validation-rust-port-spec.md`:

| Item | Result |
| :--- | :--- |
| `NODE_CONNECTION_TYPES` (n8n-connection) vs `NodeConnectionTypes` of n8n-workflow runtime | 13/13 identical |
| `detect_cycles` main-only edges (spec §7, gap F2) | **FIXED** — `type_key != "main"` skip |
| Unknown sources/targets not followed in cycle DFS | matches TS L138–142 |
| Cycle message = path from grey node joined with ` → ` | matches TS L162 |
| `INVALID_CONNECTION_TYPE` on type key and on `item.type` (spec §6/§8a, gap F4/F7) | **FIXED** — both checks present, message text `Unknown connection type "{t}" on node "{n}"` byte-equal to TS L103/L121 |

### Rubrik 3 — Bukti nyata ⚠ partially reproducible
- `cargo`/`rustc` are **not available in this sandbox** (egress blocked to rust-lang/crates.io — same limitation the author documents). I could not re-run `cargo test --workspace → 45 passed`. The claim is accepted on the strength of (a) the offline-rig record, (b) agent-5's Stage 2b binding, and (c) my independent TS-side replay above, which agrees with every assertion in `cyclic_invalid.rs`.
- Deliverable is physical (Rust source + integration test + fixture + opening record), not a report.

## Correction requests (for the follow-up increment — carried into `validation-rust-port-spec.md` §9 gap table)
1. **Still open, BLOCKING for VERIFIED (spec §10.1):** no `crates/n8n-validation/tests/parity.rs` consuming `tests/reference/agent-4/validation/fixtures/D01…D14.json`. `cyclic_invalid.rs` pins 1 golden; the acceptance oracle is 14. Spec §2 `validate_workflow(&Value, options) -> Report{valid, errors[]}` with `code/node/path/message` is still absent — the three fns remain fail-fast `Result<(), ValidationError>` (gaps F1/F3/F5 unchanged), so `DUPLICATE_NODE_NAME` / `DANGLING_CONNECTION` messages still differ from the frozen TS strings (`Node with name '{0}' is duplicated` vs `Duplicate node name "{0}"`).
2. `validate_dangling_connections` iterates `connections` in map order; with `WorkflowConnections` = `IndexMap` this is insertion order, whereas the contract §11.9 orders sources by `nodes[]` order then unknown sources lexically. Harmless while the API is fail-fast (single error), becomes visible once the report struct lands. Note it in the port.

None of these regress anything shipped in `ebbfa593`; status of `crates/n8n-validation` in my report stays **NON-CONFORMANT → progressing** (F2, F4, F7 closed; F1, F3, F5, F6 open).

## Addendum — TASK-407 (`36075450`, PR #3)
- New `tests/reference/05-cyclic-invalid/workflow.json` replayed through the TS oracle: `{allowCycles:false}` → `CYCLE_DETECTED`, node `A`, path `connections.C.main`, `A → B → C → A`; default → `valid:true`. Consistent with `case.json` and D6/D7. ✅
- Agent-1's merge note ("keep `InvalidConnectionType { node, connection_type }` integrated in `validate_dangling_connections`, not a separate `validate_connection_types()`") is **endorsed by the spec owner**: it is the shape `workflow-rules.ts:89/103` and contract §3 prescribe.
- Vote for PR #3 validation slice: **APPROVED** (unchanged). Open gaps F1/F3/F5/F6 + parity.rs over D01–D14 remain the acceptance bar for VERIFIED.
