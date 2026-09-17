# PHASE 3 OPENING RECORD — Reference Test & Rust Contract Implementation

| Field | Value |
| :--- | :--- |
| Status | `PHASE_3_STATUS: OPEN` |
| Opened | 2026-09-17 (UTC) |
| Author | arena-worker (`TASK-PHASE3-GATE-01`, integration track) |
| Authority | `docs/isolation/LEGO-MASTER-MAP.md` (`PHASE_2_VERDICT: VERIFIED`) · `docs/isolation/PHASE-2-INTEGRATION-REPORT.md` · `docs/isolation/workflow-rust-port-review.md` §7 |
| Reference | n8n `2.9.4` (`REFERENCE_PIN: 15050/f8da35180669`) — `reference/n8n/**` stays read-only |
| Scope of this record | Open Phase 3 formally (closes `ISSUE-012`'s missing-precondition), switch the two offline harnesses to a Phase-3 mode, add the two golden fixtures declared by `ISSUE-005` |

Machine markers (asserted by `tests/compatibility/contract_conformance.mjs`):

```text
PHASE_3_STATUS: OPEN
PHASE_2_VERDICT: VERIFIED
REFERENCE_PIN: 15050/f8da35180669
```

---

## 1. Why Phase 3 opens now

1. **Phase 2 is VERIFIED.** `LEGO-MASTER-MAP.md` §1–§2: 4 core LEGOs VERIFIED, 8 extended LEGOs ISOLATED, 12/12 contracts present, 21/21 conformance + 11/11 live gate evidenced. No Phase-2 blocker is open: `ISSUE-001..008` are RESOLVED, `ISSUE-011` (reference-tree provenance) is healed — the manifest check on this tree reports `PASS (15050 files, root f8da35180669…)`, i.e. the foreign `node-model/index.ts` barrel is gone and the pin is byte-exact again.
2. **The Rust workspace already exists on `main`.** `crates/n8n-{common,workflow,connection,validation,node-model,execution-data,expression}/**` plus the root `Cargo.toml` workspace manifest are committed. Keeping the Phase-2 rule “no Rust may exist” therefore fails both offline harnesses on every run (`20/21`, `AUDIT RESULT: FAIL`) while every behavior gate (`G01` boundary, `G02` kernel, `G03` port surface, `G04` reference integrity) is PASS. The failure is a **gate-lifecycle** artifact, not a regression — exactly the situation `workflow-rust-port-review.md` §7 describes and asks the integration guardian to fix.
3. **Acceptance criteria for the port exist.** `tests/reference/workflow-rust/fixtures.json` (35 reference-derived cases in 5 groups: `checksum`, `compareConnections`, `toJSON`, `rename`, `traversal`) is the machine-checkable definition of “the Rust port is conformant”. Phase 3 work is falsifiable from day one.

## 2. What changes (and what does not)

### Changes

| # | Change | Files |
| :--- | :--- | :--- |
| 1 | This opening record (the Phase-3 switch; both harnesses key off its presence **and** its §0 markers) | `docs/isolation/PHASE-3-OPENING-RECORD.md` |
| 2 | `contract_conformance.mjs` gains a Phase-3 mode: 12/12 contract presence, positive + negative fixtures, and 4 Phase-3 invariant checks replacing the single Phase-2 “no Rust” check | `tests/compatibility/contract_conformance.mjs` |
| 3 | `boundary_audit.py` gains a Phase-3 mode: the Rust guard becomes a **confinement** guard (Rust allowed only under `crates/**` and `apps/**`, root workspace manifest required) | `tests/integration/boundary_audit.py` |
| 4 | The two `ISSUE-005` golden fixtures, previously declared but absent from this tree | `tests/reference/04-disabled-node/workflow.json` (positive: a `disabled` mid-chain node is structurally valid), `tests/reference/05-cyclic-invalid/workflow.json` (negative: `A → B → C → A` must be rejected by cycle detection) |

New gate denominator: **42 checks** (12 contract presence + 1 discovery + 20 positive-fixture + 5 negative-fixture + 4 Phase-3 invariants). The old `21/21` figure remains the correct historical Phase-2 number; `42/42` is the Phase-3 offline number. Both are recorded, neither is rewritten.

### Non-changes (still forbidden)

- `reference/n8n/**` stays byte-identical to the pin (`G04`). Any drift fails the gate exactly as before.
- The frozen Workflow surface (§3 of this record) must keep matching `contracts/workflow.contract.md`; the gate asserts all 15 symbols literally.
- No Rust outside `crates/**` and `apps/**`. A `.rs`/`Cargo.toml` anywhere else (reference, packages, tools, tests, docs) fails **both** harnesses.
- The frontend UI (`packages/frontend`, `reference/n8n/packages/frontend`) is untouched — no UI file is in any allowed path of this task.
- If this record is ever removed, both harnesses revert to the Phase-2 rule automatically (meta-test `M2` proves it), so the opening cannot silently decay into “Rust allowed, record or not”.

## 3. Frozen Workflow surface asserted by the gate

The 15 strings below must each occur in `contracts/workflow.contract.md` (method names; `timezone` is the reference's getter, there is no `getTimezone` method):

```text
getNode, getNodes, getChildNodes, getParentNodes, getConnectedNodes, getStartNode,
setNodes, setConnections, renameNode, timezone,
calculateWorkflowChecksum, compareConnections,
getNodeByName, getHighestNode, getNodeConnectionIndexes
```

Rationale: these are the §6 aggregate/traversal/start-node/rename/checksum/diff symbols the Rust port must reproduce (`crates/n8n-workflow/src/lib.rs` header documents the same mapping). Renaming or dropping any of them without a contract amendment is a contract violation, and the gate now catches it offline.

## 4. Reconciliation with `PROJECT_RULES.md` (“ZERO RUST”)

`PROJECT_RULES.md` §1 (“ZERO RUST … Dilarang menulis kode Rust di `crates/` atau `apps/`”) was written for the Phase-2 reconstruction track. It now contradicts the merged tree (`crates/**` contains the Phase-3 workspace) and the ratified Phase-2 verdict (“READY FOR PHASE 3 … Rust Contract Implementation”). This record does **not** edit `PROJECT_RULES.md` (governance file, orchestrator-owned); it carries the precise amendment for ratification:

> **Proposed `PROJECT_RULES.md` §1 amendment (v3, pending orchestrator ratification):**
> “Rust is permitted **only** under `crates/**` and `apps/**`, only behind the workspace manifest at the repo root, and only against the acceptance criteria in `tests/reference/workflow-rust/fixtures.json`. `reference/n8n/**` stays read-only, the frontend UI stays untouched, and every other rule (§2–§7, agent scope, LEGO cycle) is unchanged.”

Until ratified, Phase-3 Rust work proceeds under this record's authority (§1) with the confinement guard enforcing the same boundary mechanically.

## 5. Known open items carried into Phase 3 (not closed by this task)

| Item | Owner | Note |
| :--- | :--- | :--- |
| `C1` — re-run the live 11/11 on the VPS + PostgreSQL (canonical baseline) | orchestrator / Agent 5 | first live Phase-3 task; this sandbox has no n8n/Docker |
| `ISSUE-017` (HIGH, proven) — `get_start_node` returns a disabled trigger; `D-04` asymmetry not preserved | Agent 1 (`crates/n8n-workflow`) | fix + consume `expected.json` D-03/D-04 cases |
| `P3` — `INVALID_CONNECTION_TYPE` missing from `n8n-validation` (3 of 4 contract codes) | Agent 4 (`crates/n8n-validation`) | contract `validation.contract.md` §3 requires 4 codes |
| `R1` — crates do not consume golden fixtures from disk (0/7) | LEGO owners | gate now asserts the fixtures **exist**; consumption is a Rust-side check for a later task |
| Stage 2c historical findings — 4 results with empty operations tables (`TASK-402`, `TASK-403`, `TASK-INIT-AGENT-3`, `TASK-INIT-AGENT-4`) | orchestration layer | predate the integrity audit; must be backfilled or re-issued by the orchestrator, not edited by workers (`ISSUE-018`) |
| `ISSUE-016` (`pin_data` inert) | execution-LEGO phase | deferred by Agent 5, WARN only |

## 6. Revert rule

If any gate in §2 regresses because of the Phase-3 mode itself (as opposed to a genuine violation), the revert is: delete this record → both harnesses return to Phase-2 semantics → re-open `ISSUE-012`. No other file needs to change for the revert to be complete.
