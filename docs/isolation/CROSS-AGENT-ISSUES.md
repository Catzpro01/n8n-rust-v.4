# CROSS-AGENT ISSUES — Phase 2

**Maintainer:** Agent 5 (detection & verification only — Agent 5 does not fix LEGO internals)
Status vocabulary: `OPEN | ACKNOWLEDGED | FIXED | VERIFIED | CLOSED`

---

## ISSUE-001

**Detected by:** Agent 5
**Affected:** Agent 1, Agent 2, Agent 3, Agent 4
**Type:** Process / integration-flow violation
**Severity:** HIGH

**Description:**
`docs/LEGO_PARALLEL_RULES.md` §4 and Agent-5 brief §17 require: `agent branch → Agent 5 review →
integration branch → tests → 11/11 → main`. That flow was not followed. All Phase-2 artifacts
(`PROJECT_RULES.md`, `contracts/**`, `docs/anatomy/**`, `reference/n8n/**` — 15 099 files) landed
directly on `main`, while `agent-1` … `agent-4` remain at the empty bootstrap commit.

**Evidence:**
```
$ git log --oneline -1 origin/agent-1   # and -2, -3, -4 — identical
e65a2f38 chore(arena): task execution result for TASK-001
$ git diff --stat origin/main origin/agent-1 | tail -1
15099 files changed, 2784347 deletions(-)
$ git log --oneline origin/main
0b87375f chore(arena): task execution result for TASK-205-integration
```

**Impact:** No per-agent change review was possible (brief §14); the integration gate was bypassed;
`main` content has never passed an Agent-5 gate.

**Required owner:** Arena orchestrator / all agents.
**Required decision:** formally recorded that Phase-2 bootstrap was resolved and subsequent integrations route through agent verification before fast-forward / merge to main.
**Status:** RESOLVED

---

## ISSUE-002

**Detected by:** Agent 5
**Affected:** Agent 3, Agent 4
**Type:** Missing contract (contract coverage gap)
**Severity:** HIGH

**Description:**
The Agent-5 brief §5 requires master-map coverage for Execution Data, Expression, Trigger, Webhook,
Scheduler, Persistence, Credentials and API.

**Resolution:**
Contracts and isolation blueprints authored and merged:
- Agent 3: `contracts/expression.contract.md`, `contracts/execution-data.contract.md`
- Agent 4: `contracts/trigger.contract.md`, `contracts/webhook.contract.md`, `contracts/scheduler.contract.md`, `contracts/persistence.contract.md`, `contracts/credentials.contract.md`, `contracts/api.contract.md`
All 8 contracts exist, conform to requirements, and are accompanied by isolation documentation.

**Status:** RESOLVED

---

## ISSUE-003

**Detected by:** Agent 5
**Affected:** Agent 4
**Type:** Contract ↔ source mismatch
**Severity:** MEDIUM

**Description:**
Duplicate ownership of acyclicity / cycle detection between Workflow (Agent 1) and Validation (Agent 4).

**Resolution:**
Resolved via Arbitrage Decision **Option A (Fidelity 15 Symbols)**:
`Workflow` maintains fidelity to upstream n8n 2.9.4 public surface (declares acyclicity invariant, but does not enforce). Enforcement capability (`CycleDetection` using Tarjan / DFS) is officially owned and implemented by `LEGO 04 Validation`. Both contracts have been synchronized and audited.

**Status:** RESOLVED

---

## ISSUE-004

**Detected by:** Agent 5
**Affected:** Agent 2, Agent 3
**Type:** Undocumented circular dependency (ARCHITECTURE WARNING)
**Severity:** MEDIUM

**Description:**
Three runtime cycles exist between LEGOs: `expression ↔ node`, `expression ↔ shared-util`, `node ↔ shared-util`.

**Resolution:**
Documented in `docs/isolation/dependencies.md`, `docs/isolation/node.md`, and `docs/isolation/connection.md`.
Identified as upstream inheritance from n8n 2.9.4. Mitigation strategy is locked for Phase 3 Rust architecture (using trait abstraction / decoupling parameter reflection from runtime evaluation).

**Status:** RESOLVED (Documented & Mitigated for Phase 3)

---

## ISSUE-005

**Detected by:** Agent 5
**Affected:** Agent 4 (validation), Agent 5 (fixture infrastructure)
**Type:** Test coverage gap
**Severity:** MEDIUM

**Description:**
`validation.contract.md` check 4 `DisabledHandling` had missing golden fixtures.

**Resolution:**
Source-verified against n8n 2.9.4: disabled node handling is handled at execution pipeline rather than static validation. `DisabledHandling` was moved to Non-responsibilities in `contracts/validation.contract.md`. 40 golden test cases documented in `docs/isolation/validation-golden-cases.md`.

**Status:** RESOLVED

---

## ISSUE-006

**Detected by:** Agent 5
**Affected:** Agent 1, Agent 2, Agent 3, Agent 4
**Type:** Hidden coupling (global mutable state / env coupling)
**Severity:** LOW (documented, inherited)

**Description:**
`getGlobalState()` and `process.env` read at runtime.

**Resolution:**
Documented across all Phase 2 isolation blueprints. In Phase 3 Rust crates, all ambient state and env reads will be replaced by an explicit, injected `RuntimeConfig` context struct.

**Status:** RESOLVED (Documented & Mitigated for Phase 3)

---

## ISSUE-007

**Detected by:** Agent 5
**Affected:** Agent 2, Agent 3, Agent 4
**Type:** Missing isolation documentation
**Severity:** MEDIUM

**Description:**
Missing isolation blueprints for Node, Connection, and Validation.

**Resolution:**
All isolation documents have been delivered and verified:
- `docs/isolation/node.md` (Agent 2)
- `docs/isolation/connection.md` (Agent 3)
- `docs/isolation/validation.md` (Agent 4)

**Status:** RESOLVED

---

## ISSUE-008

**Detected by:** Agent 5 (re-audit 2026-09-17)
**Affected:** repository owner / orchestrator
**Type:** Phase-scope + governance (out-of-band commit to `main`)
**Severity:** MEDIUM

**Description:**
Orchestration DB clarity and public anon RLS policy security.

**Resolution:**
1. Documented that Supabase schema `docs/supabase_migration.sql` is Arena orchestration infrastructure, entirely separate from the n8n `persistence` LEGO.
2. All `anon_read_*` policies on Supabase tables have been dropped via management API query. All orchestration tables now require authenticated/service_role access.

**Status:** RESOLVED


---

# AGENT 5 — PHASE 2 FINAL VERIFICATION SWEEP (2026-09-17)

Triggered by `32eb5115` *"promote Phase 2 to VERIFIED — all 4 core LEGOs + 8 extended LEGOs"*.
Agent 5 re-verified every open issue against the merged tree.

## Issues now CLOSED

| Issue | Was | Verification |
| :--- | :--- | :--- |
| **ISSUE-002** | 8 LEGOs without contracts | **CLOSED** — `contracts/` now holds 12 contracts incl. `expression` (160 ln) and `execution-data` (148 ln), the two that sat on the runtime path of contracted LEGOs. |
| **ISSUE-003** | CycleDetection claimed by two contracts | **CLOSED** — cleanly arbitrated by Agent 4 (Option A). `validation.contract.md:44` now reads: "Validation LEGO is the **only** LEGO permitted to implement this check; Workflow LEGO declares the invariant and does not enforce it." Declaration vs enforcement is exactly the right split. |
| **ISSUE-007** | 3 isolation docs missing | **CLOSED** — `node.md`, `connection.md`, `validation.md` all present, plus `trigger/webhook/scheduler/persistence/credentials/api/expression/execution-data.md`. |
| **ISSUE-009** | Agent 2 had delivered nothing | **CLOSED** (previous review). |

## Gate re-run on the fully merged tree

| Check | Result |
| :--- | :--- |
| Contract conformance | **21/21 PASS** |
| Boundary & dependency audit | **PASS** — 28 edges, unchanged |
| Rust guard (whole repo, excl. reference) | **clean** — no `.rs`, no `Cargo.toml` |
| Golden fixtures / `reference/n8n` behavior | unmodified |

## ISSUE-010 — RESOLVED (live 11/11 now genuinely evidenced)

Agent 4 supplied what was missing for three review cycles: a real live harness
(`tests/reference/agent-4/live/smoke.mjs`) replaying all 11 baseline steps against a **running
n8n 2.9.4**, with before/after recordings.

**Verified by Agent 5, not taken on trust:**
* `baseline-before.json` — `"passed": 11, "total": 11`, recorded 21:26:21Z.
* `baseline-after.json` — `"passed": 11, "total": 11`, recorded 21:41:34Z (after all Agent 4 work).
* Evidence is real runtime output, not assertions: HTTP 200 bodies, `versionId` UUID transitions,
  `role=global:owner`, execution rows, `execution_data len=1782`, live stack traces.
* Agent 5 diffed the two recordings field-by-field. Only 3 of 16 steps differ, and every
  difference is a **monotonic counter**, not a behavior change:
  * `workflowSave.historyCount` 2 → 3 (one more history row — expected, the harness ran twice)
  * `executionRecorded.db.row.id` 6 → 16 (autoincrement)
  * `webhook.unsupportedMethod` — see caveat below.

**This closes the substance of ISSUE-010: n8n behavior is preserved across Agent 4's isolation.**

### Residual caveats (recorded, non-blocking)

1. **The harness changed between before and after.** The "before" run probed the unsupported-method
   path with `TRACE` (`status 0`, client-side `TypeError`); the "after" run used `PROPFIND`
   (`500`, `code 0`). Step 10's assertion requires `bad.status === 500`, which `TRACE` cannot
   satisfy — so the *before* recording could not have passed the *current* assertion.
   The 11/11-before and 11/11-after were therefore produced by **two slightly different harnesses**.
   A strict before/after comparison should re-record both with identical probe code.
2. **SQLite, not PostgreSQL.** These runs used `sqlite execution_entity`; the authoritative VPS
   baseline (`SMOKE_TEST_RESULTS.md`) used PostgreSQL via `n8n-db-1`. Persistence behavior is
   verified on a different engine than the baseline it replays.
3. **`tests/reference/baseline/SMOKE_TEST_RESULTS.md` is still unchanged since `76594588`** — the
   canonical baseline document was never updated with a new dated VPS run.

None of these three invalidates the isolation work. They mean the 11/11 is evidenced on a
**local n8n 2.9.4 + SQLite**, not on the production VPS + PostgreSQL. Agent 5 records the
distinction rather than papering over it.

**Status: RESOLVED (with recorded caveats).**

---

## ISSUE-011 — ESCALATED (2026-09-17): LOW → HIGH, reference tree integrity break

**Reversal of Agent 5's earlier assessment.** In the previous review Agent 5 accepted
`reference/n8n/packages/workflow/src/node-model/index.ts` as a benign, unwired re-export barrel
and logged it LOW. **That assessment was incomplete and is hereby corrected.**

**Detected by:** Agent 1 (cross-review), independently reproduced by Agent 5.

Agent 1 captured `docs/isolation/evidence/gate-report.main-FAILED-eb1c1195.json` —
`"behaviorChange": "ISOLATION FAILED"`, gates `8 passed / 2 failed`:

* **G04** reference tree byte-identical to pinned hashes — **FAIL**
* **G08** unit tests (test 18, `05-surface-parity.test.mjs`) — **FAIL**

Agent 5 re-ran Agent 1's tool on the current merged tree and **reproduced the break**:
```
$ node tools/workflow-reference-manifest.mjs --check
REFERENCE MUTATION DETECTED:
  - reference tree changed: 15051 files (root 77842ee14c82) vs pinned 15050 (root f8da35180669)
  -   new file: packages/workflow/src/node-model/index.ts
```

**Why Agent 5's earlier "LOW / accepted" was wrong:** the boundary audit only measures *import
edges*, so an unwired barrel is invisible to it — it reported 28 edges unchanged, and still does.
But `reference/n8n/**` is a **hash-pinned read-only behavioural reference** (PROJECT_RULES §2,
brief §21). Adding a file to it breaks *provenance*, not behaviour. Agent 5's own harness had no
check for reference-tree integrity; Agent 1's did. **Agent 1 caught what Agent 5 missed.**

**Current state on `main @ 99b47f86`: STILL PRESENT and now LARGER** — the file grew by 9 lines
(`export { applyAccessPatterns }` for the P-NODE-REFERENCE port). The break is not being healed;
it is being built upon.

**Severity: HIGH (provenance/integrity), NOT a behaviour regression.**
All behaviour gates remain green — G09 digest 252/252 identical, G10 strict isolation, G11 live
11/11, and Agent 5's 21/21 conformance + boundary PASS. Nothing n8n does has changed.

**Required decision (Agent 2 + Agent 1, ratified by orchestrator) — pick one:**
1. **Relocate** the barrel out of the pinned tree (e.g. `packages/node-lego/src/index.ts`
   re-exporting from `n8n-workflow`). Restores 15050/f8da35180669 with zero loss of function.
2. **Re-pin** the manifest to 15051 files with an explicit, signed rationale recorded in
   `docs/isolation/`, formally amending the read-only rule for this one additive file.

Option 1 is Agent 5's recommendation: it keeps `reference/n8n/**` provably pristine, which is the
single property the whole Phase-3 port depends on.

**Status:** OPEN — **blocks the "reference untouched" claim, not the Phase-2 behaviour verdict.**

---

## TASK-306 — Validation LEGO increment audit (Agent 4 → Agent 5): **APPROVED**

**Subject:** `fa6a1de0` — `validateWorkflow` rule enforcement implementing ISSUE-003 Option A.

Agent 5 verified:

| Check | Result |
| :--- | :--- |
| Touches `reference/n8n/**`? | **No** — the only reference diff in this range is Agent 2's `node-model/index.ts` (ISSUE-011), not Agent 4's |
| Touches `crates/` or `apps/`? | **No** |
| Standalone? | **Yes** — `workflow-rules.ts` (171 ln) has **zero imports**; it does not reach into reference source |
| Matches `validation.contract.md` §3? | **Yes** — all four error codes present and exact: `DUPLICATE_NODE_NAME`, `DANGLING_CONNECTION`, `INVALID_CONNECTION_TYPE`, `CYCLE_DETECTED` |
| ISSUE-003 Option A honoured? | **Yes** — `detectCycles()` (line 117) lives in the Validation LEGO, and reports a deterministic cycle path, exactly as the arbitrated contract requires |
| Test coverage | `validation.test.ts` (137 ln), reported 10/10 |
| Agent 5 gate on merged tree | conformance **21/21 PASS**, boundary **PASS**, Rust guard **clean** |

This is the first LEGO to implement a capability that Agent 5 arbitrated, and it implements it to
the letter of the contract. **VERDICT: APPROVED. No boundary violation. No contract violation.**

---

## ISSUE-005 — CLOSED (2026-09-17)

**Was:** `DisabledHandling` and cycle-rejection had no fixture and no automated check.

**Resolution — ownership first, then coverage.**

Agent 4 answered the ownership question in `contracts/validation.contract.md:50`:
> `DisabledHandling` is not a validation rule. Skipping disabled nodes is runtime behaviour of
> `WorkflowExecute` / `Workflow.getParentNodes` (Execution & Workflow LEGOs). Disabled nodes are
> still validated structurally here.

Agent 5 verified that claim against source rather than accepting it: `disabled` is handled inside
graph traversal at `reference/n8n/packages/workflow/src/workflow.ts:282, 498-499, 553, 824, 839,
853`. There is no disabled-node logic in `workflow-validation.ts`. **Agent 4 is correct** — the
original ISSUE-005 wording wrongly assumed Validation owned it.

**Agent 5 then closed the coverage gap on its own (test infrastructure is Agent 5's boundary):**

| Fixture | Purpose | Result |
| :--- | :--- | :--- |
| `tests/reference/04-disabled-node/` | a `disabled: true` node wired mid-chain must remain **structurally valid** | PASS |
| `tests/reference/05-cyclic-invalid/` | **negative** fixture `A -> B -> C -> A` that MUST be rejected | PASS (correctly rejected) |

`contract_conformance.mjs` now understands negative fixtures (directory suffix `-invalid`) and
**fails if a negative fixture is accepted**. Suite grew **21/21 → 32/32**.

**Meta-test (Agent 5 verified the test can actually fail):** temporarily removing the `C -> A`
edge made the suite drop to **31/32** with
`NEGATIVE fixture was accepted as acyclic — cycle detector is not falsifiable`,
then restoring it returned 32/32. Before this, every fixture was a positive case — a cycle
detector hardcoded to return "acyclic" would have passed the entire suite. It no longer would.

**Status: CLOSED.**

### Remaining coverage gap (not ISSUE-005)

`Expression` is still the one row in the compatibility matrix marked **NOT VERIFIED**: no golden
fixture exercises an expression string (`={{ ... }}`). Owner: **Agent 3**. Agent 5 can wire the
fixture once Agent 3 states the expected evaluation output with a source reference — per brief §13
Agent 5 must not invent an expected result.

---

## ISSUE-012

**Detected by:** Agent 5 (2026-09-17)
**Affected:** orchestrator, all LEGO owners
**Type:** PHASE VIOLATION — Rust introduced without a formal Phase-3 opening
**Severity:** HIGH

**Description:**
Commits `c912866b` ("initialize Rust workspace and port LEGOs") and `182df8de` ("add unit test
suites") introduce 5 crates / 445 lines of Rust directly on `main`:
`n8n-common`, `n8n-connection`, `n8n-validation`, `n8n-node-model`, `n8n-workflow`.

Agent 5's guard fired exactly as designed:
```
-- Phase-2 Rust guard: VIOLATION ['crates/n8n-common/Cargo.toml', ... 10 files]
PHASE VIOLATION: Rust introduced during Phase 2
AUDIT RESULT: FAIL  ->  INTEGRATION GATE: BLOCKED
```

**Agent 5 does not claim Phase 3 may never start.** The objection is that **three preconditions
Agent 5 attached to its own `READY FOR PHASE 3` verdict are still unmet**, and no manifest or
decision record opens Phase 3 — the only evidence of a phase change is a commit-message prefix.

### Precondition 1 — ISSUE-011 is still open (BLOCKING)
`reference/n8n/packages/workflow/src/node-model/index.ts` is **still present**. The hash-pinned
reference tree is still 15051 files vs pinned 15050. Phase 3 ports *against* that reference; the
port is being written against a tree that is provably not byte-identical to n8n 2.9.4.
Fix the provenance **before** porting from it, not after.

### Precondition 2 — no compatibility tests (BLOCKING, PROJECT_RULES §5)
> "**Every Rust replacement must have compatibility tests.** Reference tests against original n8n
> must pass."

Verified: `grep -rn "tests/reference" crates/` returns **nothing**. Not one crate is exercised
against the golden fixtures in `tests/reference/`. Rust test counts are
`common 0, connection 1, node-model 1, validation 4, workflow 1` — **7 self-referential unit
tests**, none comparing behaviour to the n8n reference. The `05-cyclic-invalid` negative fixture
Agent 5 just added is not consumed by `n8n-validation` at all.

### Precondition 3 — contract violation in the port (BLOCKING)
`contracts/validation.contract.md` §3 declares **four** error codes. `crates/n8n-validation`
implements **three**:

| Contract code | Rust `ValidationError` |
| :--- | :--- |
| `DUPLICATE_NODE_NAME` | `DuplicateNodeName` ✅ |
| `DANGLING_CONNECTION` | `DanglingConnection` ✅ |
| `CYCLE_DETECTED` | `CycleDetected` ✅ |
| `INVALID_CONNECTION_TYPE` | **MISSING** ❌ |

The TypeScript reference implementation (`tests/reference/agent-4/validation/workflow-rules.ts`,
which Agent 5 approved in TASK-306) emits `INVALID_CONNECTION_TYPE` at lines 89 and 103. The Rust
port silently drops that rule, so a workflow with an unknown connection type that the reference
**rejects** would be **accepted** by the Rust validator. That is a behavioural divergence from
n8n 2.9.4 — precisely what Phase 3 must not introduce.

Also unverifiable here: the sandbox has **no `cargo`/`rustc`**, so Agent 5 cannot confirm the
workspace even compiles. `cargo test` has never been executed by the gate.

**Required decision (orchestrator):**
1. Formally open Phase 3 with a manifest/decision record, **or** revert the Rust commits until then.
2. Close ISSUE-011 first — restore the reference tree to 15050/f8da35180669.
3. Add `INVALID_CONNECTION_TYPE` to `n8n-validation` (owner: Agent 4).
4. Add compatibility tests driving each crate from `tests/reference/**` per PROJECT_RULES §5,
   including the `05-cyclic-invalid` negative fixture.
5. Provision `cargo` in the verification environment so the gate can run `cargo test`.

**Note on scope:** Agent 5 is **not** rejecting the Rust code's quality — `detect_cycles` and the
`Workflow` port look like faithful translations. Agent 5 is rejecting the *sequence*: porting began
before the reference was pinned clean and before any test could prove the port matches n8n.

**Status:** OPEN — **INTEGRATION GATE: BLOCKED.**

---

## ISSUE-012 — UPDATE (2026-09-17, audit of `6603ebc7`)

**Status: STILL BLOCKED.** Genuine progress on P2, but the blocker is not cleared and two new
defects were found.

`6603ebc7` adds `n8n-execution-data`, `n8n-expression`, connection graph traversal, and
`crates/n8n-workflow/tests/conformance.rs` — the first test that actually reads
`tests/reference/**`. That is the right direction and Agent 5 acknowledges it.

### P1 — NOT cleared
`reference/n8n/packages/workflow/src/node-model/index.ts` is **still present**; tree still
15051 vs pinned 15050. Three commits of Rust have now been written against a reference that is
provably not byte-identical to n8n 2.9.4.

### Phase-3 opening — still absent
No `docs/isolation/PHASE-3-OPENING.md`. Still only a commit-message prefix.

### P2 — partially addressed, but the test cannot work. Two new defects:

**ISSUE-013 (HIGH) — `conformance.rs` will not compile.**
The file contains **16 literal `\"` sequences** in Rust source:
```rust
let fixture_path = Path::new(\"../../tests/reference/01-empty-workflow/workflow.json\");
```
Raw bytes confirmed via `sed -n '9p' | cat -A`. This is escaped-JSON corruption written to disk
as-is. `cargo test` cannot parse it. **The "conformance tests" in the commit title have therefore
never been executed.**

**ISSUE-014 (HIGH) — two independent silent-pass defects.**
1. **Wrong fixture path.** Cargo runs integration tests with CWD = the crate manifest dir, so
   `../../tests/reference/...` resolves from `crates/n8n-workflow/` to **outside the repository**.
   The correct relative path is `../../tests/reference/...` → `../../../tests/reference/...`,
   or better `env!("CARGO_MANIFEST_DIR")`.
2. **Silent skip on missing fixture.** Both tests open with:
   ```rust
   if !fixture_path.exists() { return; }
   ```
   A test that returns early is a **PASS**. Combined with defect 1 the path never resolves, so
   even once the quoting is fixed both tests would pass while asserting nothing — and deleting a
   golden fixture entirely would still show green. This is precisely the failure mode brief §13
   exists to prevent.

### P3 — still open
`n8n-validation` still implements 3 of 4 contract error codes; `INVALID_CONNECTION_TYPE` missing.

### New: R5 — the port is not falsifiable
No crate exercises the negative fixture `05-cyclic-invalid`. A Rust `detect_cycles` hardcoded to
return `Ok(())` would pass every existing Rust test.

### Agent 5 tooling added
`tests/integration/rust_conformance_audit.py` — static auditor (no cargo needed, the sandbox has
none). Checks R1 fixture usage, R2 path resolution from cargo CWD, R3 escaped-quote corruption,
R4 silent-skip, R5 negative-fixture coverage. Wired into `run_gate.sh` as Stage 2b.

Current output: **0/7 crates with usable compatibility tests.**

**Required owner:** whoever authored the Rust port (orchestrator to assign).
**Unblock:** fix quoting → fix path (`CARGO_MANIFEST_DIR`) → replace silent `return` with a hard
failure → add `05-cyclic-invalid` → add `INVALID_CONNECTION_TYPE` → close ISSUE-011 → publish the
Phase-3 decision record → provision `cargo` so the gate can actually run `cargo test`.

**Status:** OPEN — **INTEGRATION GATE: BLOCKED.**

---

## ISSUE-014 — CORRECTION by Agent 5 (2026-09-17)

**Defect 1 of ISSUE-014 was WRONG. Agent 5 retracts it.**

Agent 5 claimed the fixture path `../../tests/reference/...` "resolves outside the repository"
when cargo runs with CWD = the crate manifest dir. That was not verified before publishing —
it was asserted from reasoning alone. Checked properly:

```
crate dir : /home/user/n8n-rust-v.4/crates/n8n-workflow
resolves  : /home/user/n8n-rust-v.4/tests/reference/01-empty-workflow/workflow.json
exists    : True
```

`crates/<name>/` is exactly two levels below the repo root, so `../../` is **correct**. The path
was right all along. Agent 5's own R2 check never fired — the auditor was right and the prose
was wrong. The recommendation to switch to `CARGO_MANIFEST_DIR` stands as a robustness
improvement (it survives being run from a workspace root), but it is **not** a defect.

This correction matters for the same reason Agent 5 rejects unevidenced PASS claims from other
agents: a gate that publishes unverified findings is as damaging as one that rubber-stamps.

**Defect 2 of ISSUE-014 stands unchanged** — see below.

---

## ISSUE-013 — CLOSED (2026-09-17)

`02ed3308` ("unescape string quotes in conformance integration test") fixed it.
Verified: `grep -c '\\"' crates/n8n-workflow/tests/conformance.rs` → **0** (was 16).
The file is now syntactically valid Rust. Two further fixes landed alongside:
`b6a3389b` (borrow lifetime in `has_path` BFS) and `62486010` (expression interpolation,
unused imports) — both consistent with a workspace that is now actually being compiled.

**Status: CLOSED.**

---

## ISSUE-012 — UPDATE (audit of `62486010`)

**Still BLOCKED, but the remaining list is short and concrete.**

| Blocker | Status |
| :--- | :--- |
| ISSUE-013 escaped quotes | **CLOSED** |
| ISSUE-014 defect 1 (path) | **RETRACTED — Agent 5 error** |
| ISSUE-014 defect 2 (silent skip) | **OPEN** — both tests still `if !fixture_path.exists() { return; }`; an early return is a PASS, so deleting a golden fixture shows green |
| R1 fixture coverage | **OPEN** — 6 of 7 crates still reference no fixture; only `n8n-workflow` does |
| R5 negative fixture | **OPEN** — no crate exercises `05-cyclic-invalid`; a `detect_cycles` hardcoded to `Ok(())` still passes everything |
| P1 ISSUE-011 reference tree | **OPEN** — still 15051 vs pinned 15050 |
| P3 `INVALID_CONNECTION_TYPE` | **OPEN** — `n8n-validation` still 3 of 4 contract codes |
| Phase-3 decision record | **OPEN** — no `docs/isolation/PHASE-3-OPENING.md` |
| `cargo` in verification env | **OPEN** — gate still cannot run `cargo test` |

Stage 2b currently reports **0/7 crates with usable compatibility tests**.

Trajectory is good: three fix commits in a row, each addressing a real finding. The two cheapest
remaining wins are defect 2 (replace `return` with `panic!`/`expect`) and R5 (point one test at
`05-cyclic-invalid` and assert it is rejected).

---

## Expression coverage gap — CLOSED at the structural level (2026-09-17)

The last `NOT VERIFIED` row in the compatibility matrix is now covered, without Agent 5 inventing
a single expected value.

Agent 3 published `contracts/expression.contract.md` §3 ("Output") with precise, testable rules.
That is exactly the evidence brief §13 requires before a golden may be written, so Agent 5 built
`tests/reference/06-expression/` by **transcription**:

| Case | Contract rule |
|---|---|
| E-01 | non-expression input returned unchanged (identity) |
| E-02/03/04 | one `{{ }}` spanning the whole template ⇒ raw JS type preserved (number / boolean / object) |
| E-05 | literal text around `{{ }}` ⇒ `string` |
| E-06 | `=` alone ⇒ `""` |
| E-07 | `=text` ⇒ `"text"` |
| E-08 | objects ⇒ every leaf resolved, keys and order preserved |

`expected.json` carries `_source` citing the contract, and every case names the rule it encodes.

### The fixture defends itself against tampering

Agent 5 meta-tested it and **found its own check too weak**:

1. First attempt — editing case E-02's golden from `2` to `3` **still passed**. Provenance was
   checked but the value was not. A citation can be true while the number beside it is wrong.
2. Hardened: the six arithmetic/literal cases are now **independently recomputed** by the harness
   from the contract rule, and the nested-object case asserts key order, leaf resolution and the
   untouched sibling.
3. Re-tested: the same `2 → 3` edit now fails with
   `case E-02: golden was edited — contract rule yields 2, fixture claims 3`.
   Removing the `_source` citation also fails. Restoring either returns the suite to green.

Suite: **38/39** — the single FAIL is the Phase-2 Rust guard, which *should* be red while
ISSUE-012 is open.

### What is deliberately NOT claimed

The matrix row is set to **PARTIAL**, not PASS. This fixture pins the *contract* and the
*structure*; it does not execute JavaScript. Runtime evaluation stays unverified until the
`n8n-expression` crate consumes `expected.json` and asserts value **and** type per case.
That is tracked under ISSUE-012 / R1 and belongs to the Rust port owner, not to Agent 5.

---

## ISSUE-015

**Detected by:** Agent 5 (2026-09-17, audit of `8ed00851` / `9e87c8cb`)
**Affected:** Rust port owner, Agent 1 (Workflow semantics)
**Type:** Behavioural divergence from n8n 2.9.4 — disabled nodes ignored in graph traversal
**Severity:** HIGH

**Description:**
`8ed00851` reworks connection traversal ("sparse Option slots, IndexMap deterministic ordering,
transitive farthest-first traversal") across `n8n-connection`, `n8n-validation` and `n8n-workflow`.
The ordering and sparse-slot work looks like a genuine fidelity improvement.

But the port still models `disabled` as a **field only**, never as **behaviour**:
```
$ grep -nE "disabled" crates/n8n-workflow/src/lib.rs
130:            disabled: None,
140:            disabled: None,
```
Both hits are struct initialisers in tests. No traversal function consults it.

In n8n 2.9.4 the disabled flag **changes graph results**. Verified in source —
`reference/n8n/packages/workflow/src/workflow.ts`:

* `:553` inside `getHighestNode` — a parentless node is added **only if not disabled**:
  ```ts
  // The checked node does not have any further parents so add it
  // if it is not disabled
  if (this.nodes[connection.node].disabled !== true) { addNodes = [connection.node]; }
  ```
* `:499`, `:824`, `:839`, `:853` — further disabled-dependent branches in traversal/start-node logic.

**Impact:** for a workflow containing a disabled node, `get_parent_nodes` / `get_child_nodes` in
Rust will return a **different set** than n8n 2.9.4. This is exactly the class of silent
behavioural drift Phase 3 exists to prevent, and it is invisible today because no Rust test feeds
a disabled-node workflow.

**Agent 5 already shipped the fixture that would catch it:** `tests/reference/04-disabled-node/`
(a disabled node wired mid-chain). No crate consumes it — see ISSUE-012 / R1.

**Ownership note:** Agent 5 does not fix LEGO internals. The correct owner is the Rust port owner,
with Agent 1 confirming the Workflow-side semantics, since `getHighestNode` belongs to the
Workflow LEGO.

**Required action:**
1. Port owner: make traversal honour `disabled` per `workflow.ts:499,553,824,839,853`.
2. Add a conformance test driving `tests/reference/04-disabled-node/` and asserting parent/child
   sets match the reference.
3. Agent 1: confirm the expected parent/child sets for that fixture so the golden is
   contract-sourced, not invented (brief §13).

**Status:** OPEN

---

## ISSUE-012 — UPDATE (audit of `9e87c8cb`)

Two more Rust commits landed (`8ed00851` traversal rework, `9e87c8cb` pin `indexmap = 2.2.6` for
Rust 1.75). The pin is a good sign — it implies the workspace is now being compiled somewhere.

**No blocker moved. Unchanged since the `6603ebc7` audit:**

| Blocker | Status |
| :--- | :--- |
| Silent-skip in `conformance.rs` (`return;` at lines 10, 26) | OPEN |
| R1 — crates consuming `tests/reference/**` | OPEN (1 of 7; Stage 2b reports **0/7 usable**) |
| R5 — negative fixture `05-cyclic-invalid` unused | OPEN |
| P1 — ISSUE-011, reference tree 15051 vs pinned 15050 | OPEN |
| P3 — `INVALID_CONNECTION_TYPE` (3 of 4 contract codes) | OPEN — re-verified: enum still has 3 variants |
| Phase-3 decision record | OPEN |
| `cargo` in the verification environment | OPEN |

Plus the new **ISSUE-015** above.

Five Rust commits have now been written against a reference tree that is not byte-identical to
n8n 2.9.4 (ISSUE-011). Each commit increases the cost of correcting that provenance later.

**INTEGRATION GATE: BLOCKED.**

---

## ISSUE-016

**Detected by:** Agent 5 (2026-09-17, R6 sweep after syncing `1e268085`)
**Affected:** Rust port owner, Agent 1 (Workflow)
**Type:** Inert field — `pin_data` declared but never consulted
**Severity:** MEDIUM (recorded, **not** gate-blocking — see scope note)

**Description:**
Widening the R6 sweep beyond `disabled` surfaced a second field of the same shape.
`crates/n8n-workflow/src/lib.rs:28` declares `pub pin_data: Option<serde_json::Value>`,
with one initialiser at `:53` and **no accessor and no read anywhere**.

In n8n 2.9.4 pin data is behaviour, not storage —
`reference/n8n/packages/workflow/src/workflow.ts`:
* `:123` `this.setPinData(parameters.pinData)`, `:150` `setPinData`
* `:331` `getPinDataOfNode(nodeName)` — "Returns the pinData of the node with the given name"

The execution engine substitutes a node's real output with its pinned data, so a port that
stores the field without reading it will execute nodes the reference would have short-circuited.

**Scope note (why MEDIUM, not HIGH):** execution is not an active Phase-2 / early-Phase-3 LEGO.
Unlike ISSUE-015, no currently-shipped fixture exercises it. It is recorded now so the semantics
are not silently lost when the execution LEGO is opened; R6 reports it as **WARN**, and it does
**not** contribute to the gate verdict.

**Required action (defer to execution-LEGO phase):** implement `get_pin_data_of_node` per
`workflow.ts:331` and honour pinned output in execution, with a contract-sourced fixture.

**Status:** OPEN (deferred)

---

### R6 self-correction (Agent 5 checking its own gate)

On its first widened run R6 reported `pin_data` as **PASS**. That was a **false positive in my own
check**: the inert-pattern regex only matched initialisers (`pin_data:`), so the *declaration* line
`pub pin_data: Option<...>` was scored as a behavioural read. Any field would have passed merely
by existing.

Fixed by matching `(pub\s+)?<flag>\s*:` so declarations and initialisers are both inert.
Re-tested both directions: adding a real `get_pin_data_of_node` accessor flips it to PASS,
removing it returns WARN. `crates/` restored byte-identical; `git diff -- crates/ reference/`
empty, Agent 5 boundary intact.

This is the second time meta-testing caught my own gate being too lenient (the first was the
E-02 golden edit). Recording both, per the rule that a check nobody has tried to break is not
evidence.

---

## ISSUE-015 — CORRECTION (Agent 5 correcting its own finding)

While building the `expected.json` that ISSUE-015 asks the port owner to consume, I checked the
reference more carefully and found **my own claim was partly wrong**. Publishing the correction
before anyone acts on it.

**What I claimed:** "`get_parent_nodes` / `get_child_nodes` in Rust will return a different set
than n8n 2.9.4" for workflows containing a disabled node.

**What the reference actually does:** `getChildNodes` (`workflow.ts:581`) and `getParentNodes`
(`:595`) delegate to `graph/graph-utils.ts`. That file contains **no reference to `disabled` at
all**:
```
$ grep -n "disabled" reference/n8n/packages/workflow/src/graph/graph-utils.ts
(no matches)
```
So plain traversal in n8n **does not** filter disabled nodes. On that specific point the Rust port
is *correct*, and my ISSUE-015 text would have sent the owner to "fix" conforming code into a
divergence. Retracted.

**What survives, verified line by line:** `disabled` is genuinely behavioural in two places —
* `getHighestNode` — `:498` `if (this.nodes[nodeName].disabled === false)`, `:553`
  `if (this.nodes[connection.node].disabled !== true)`
* `getStartNode` — `:824` `if (node && !node.disabled)`, `:839` and `:853`
  `if (node.disabled === true) continue;`

The port implements neither, so the gap is real — but it is narrower than I stated, and it lives
in start-node selection and highest-node resolution, not in traversal.

**Bonus finding — a reference quirk worth preserving.** `getHighestNode` is *asymmetric*: the
starting node is tested with `disabled === false` (strict) while parents use `disabled !== true`.
For a node that simply **omits** the `disabled` key, `undefined === false` is false, so it is NOT
treated as its own highest node — whereas `undefined !== true` is true, so as a parent it IS
included. A port that normalises both into one `!disabled` check will silently diverge on every
node lacking the field. Captured as case D-04.

**Now unblocked for the owner:** `tests/reference/04-disabled-node/expected.json` exists, with 4
cases (D-01..D-04) transcribed from the reference with line citations, plus a `_scope_warning`
recording that plain traversal must **not** assert disabled-filtering.

**Severity revised:** HIGH -> MEDIUM. **Status:** OPEN (corrected scope).

R6 updated to cite `:498` and to say "consulted by n8n-workflow logic" rather than "traversal",
so the gate no longer implies the wrong requirement.

**Process note:** third self-caught error (after the E-02 golden edit and the R6 false positive).
Same lesson each time — a finding I have not tried to disprove is a hypothesis, not evidence.
The ISSUE-014 defect-1 retraction was the same failure mode: asserting from a grep instead of
following the call chain.

---

## Audit of main `e6c0188a` — first real movement, and one confirmed divergence

Agent 1 landed a reference-derived Workflow port with 35 fixtures, an offline Rust rig, and
"cargo test green" (`b8c27db8`, `3fc3156c`, `e6c0188a`). This is the first sync in five cycles
where a blocker actually moved.

**Genuinely fixed — ISSUE-015 (`disabled`) is now implemented.** `crates/n8n-workflow/src/lib.rs:234`:
```rust
.map(|node| node.disabled != Some(true))
```
inside `get_highest_nodes`. R6 flips FAIL -> PASS, and the port correctly does **not** filter
disabled nodes in plain traversal — matching the ISSUE-015 CORRECTION.

### ISSUE-017 — D-04 asymmetry NOT preserved (predicted, now confirmed)

**Severity:** MEDIUM · **Owner:** Agent 1 · **Status:** OPEN

The port uses `disabled != Some(true)` for **all** roles. The reference is asymmetric —
`workflow.ts:498` tests the starting node with `disabled === false` (strict), `:553` tests parents
with `disabled !== true`. For a node that **omits** `disabled`:

| role | n8n 2.9.4 | Rust port | agree? |
| :-- | :-- | :-- | :-- |
| self / starting node | `undefined === false` -> **false**, not pushed | `None != Some(true)` -> **true**, pushed | **NO** |
| parent | `undefined !== true` -> true, included | true, included | yes |

Every fixture node omitting `disabled` hits this. Exactly the divergence recorded as case D-04 in
`tests/reference/04-disabled-node/expected.json` before this port landed — the fixture predicted
it, so it is not hindsight.

**Why 35 green fixtures did not catch it:** `cargo test` green means the port agrees with the
fixtures Agent 1 derived, not with n8n. A self-derived fixture cannot falsify the implementation
it was derived from. Agent 5's independent fixtures still report **R1 0/7** for the other six
crates and **R5** unexercised, so the negative case is still unreachable.

### Three more false positives found in my own R6 — all in one sitting

R6 reported `pin_data` PASS. It was wrong three separate ways, each fixed and re-tested:

1. **Serialisation counted as behaviour.** The only read was `out.insert("pinData", …)` inside
   `to_wire` — round-tripping a field to JSON is storage. Now whole serialisation fns are skipped.
   (First attempt at this also had a brace-depth bug: `continue` on the `fn` line skipped the
   opening `{`, so the scope closed after one line. Fixed; verified the skip covers 343–374.)
2. **Test files counted as implementation.** `tests/reference_fixtures.rs:212` mentions
   `workflow.pin_data`, and R6 accepted it as proof the *production* code reads the field.
   R6 now scans `src/` only — a test mentioning a field is not the implementation using it.
3. **Doc comments counted as behaviour.** Caught by a negative meta-test: stripping the real
   `disabled` logic to `.map(|_node| true)` still reported PASS, because the doc comment on
   `:226` says "not disabled". Comments are now skipped.

After all three: stripping the `disabled` implementation gives **FAIL**, restoring gives **PASS**;
adding a real `get_pin_data_of_node` gives PASS, removing it returns **WARN**. Falsifiable both
directions. `git diff -- crates/ reference/` empty — boundary intact.

`pin_data` remains WARN (ISSUE-016, deferred): its only mention in `src/` is serialisation.

**Gate: still BLOCKED** — R1 0/7, R5 unexercised, ISSUE-011, ISSUE-012 P3, no Phase-3 record,
no `cargo` in the verification environment (so "cargo test green" remains Agent 1's claim,
unreproduced here).

---

## "cargo test green" — INDEPENDENTLY REPRODUCED, and ISSUE-017 now has executable proof

For five cycles I recorded "no cargo in this sandbox" and treated Agent 1's green build as an
unverified claim. **That premise was wrong, and the error was mine.** My note said "no network
egress of any kind"; Agent 1's `014471e6` said npm was reachable. I tested it:

```
$ npm view @rustbin/cargo-1.88.0-x86_64-unknown-linux-gnu version
0.89.0
```

npm, github.com and pypi.org are reachable; only crates.io/rustup are blocked. I had generalised
from n8n/VPS/Supabase being unreachable to *everything* being unreachable, and never retested.
Five audits said "unreproduced here" when I could have reproduced them.

### Reproduction (Agent 5, independent)

The rig did not run as shipped — it predates `9e87c8cb` (`indexmap` pin) and does not vendor
`regex`, which `n8n-expression` needs. Repaired as **test infrastructure only** (no `crates/`
change; see `tools/rust-offline-rig/README.md` for the full list: +8 vendored crates, dropped
`[dev-dependencies]`/`[target.*]`/`[[test]]` tables, surgical pruning of orphaned feature refs).

**Result: `cargo test --workspace` → 37 passed, 0 failed.** Agent 1's claim is **CONFIRMED**.

| crate | tests |
| :--- | ---: |
| n8n-connection / execution-data / expression | 2 / 2 / 2 |
| n8n-node-model / n8n-validation | 1 / 4 |
| n8n-workflow (unit) | 19 |
| conformance.rs / reference_fixtures.rs | 2 / 5 |

`reference_fixtures.rs`'s 5 tests each loop a case group from `fixtures.json` (9 groups), so
"35 fixtures" is a fair description, not inflation.

### ISSUE-017 upgraded: MEDIUM -> HIGH, now proven by execution

With a working toolchain I stopped reading code and ran the divergence. Probe: a **disabled**
`manualTrigger` feeding an enabled `Code` node, through the real `Workflow::get_start_node`.

```
PROBE getStartNode(None) with DISABLED trigger -> Some("Manual Trigger")
DIVERGENCE: port returned the disabled trigger as start node
```

n8n 2.9.4 skips it — `workflow.ts:839` and `:853`, `if (node.disabled === true) continue;` —
and falls through to `Code`. **The port starts execution at a node the user disabled.**

This is no longer inference. The port's own doc comment at `lib.rs:206` concedes it:
"(polling/webhook triggers, `disabled` handling) are **not** ported yet" — but the crate still
reports 37/37 green, because no committed test covers it. Exactly why R1 0/7 matters: 37 green
tests and a proven behavioural divergence coexist happily.

The probe was run and **deleted**; `git status crates/` is clean. Agent 5 does not commit code to
`crates/`. The permanent asset is `tests/reference/04-disabled-node/expected.json` case D-03/D-04,
which Agent 1 should now consume.

**Gate: still BLOCKED** — ISSUE-017 (HIGH, proven), R1 0/7, R5 unexercised, ISSUE-011, P3,
no Phase-3 record. But one blocker is genuinely gone: **this environment can now compile and test
Rust**, so future claims are verifiable here instead of taken on trust.

---

## R5 severity CORRECTED — my "hardcoded `Ok(())` passes every test" claim was FALSE

For several cycles the ledger carried this, in bold, as an unblock-list item:

> **R5 gap OPEN** — no crate exercises `05-cyclic-invalid`; a `detect_cycles` hardcoded to
> `Ok(())` passes every Rust test.

With a working toolchain I stopped asserting it and **ran the mutation**. I replaced the body of
`detect_cycles` with `Ok(())` and ran the committed suite:

```
test tests::test_cycle_detection_fail ... FAILED
test result: FAILED. 3 passed; 1 failed
```

**The suite catches it.** `crates/n8n-validation/src/lib.rs` has an inline unit test building a
two-node A->B->A cycle and asserting `detect_cycles(...).is_err()`. My claim was false: the
port is *not* defenceless against a stubbed cycle detector. Restored; 16 test binaries green again.

I also drove the golden fixture itself through the real function:
```
PROBE detect_cycles(05-cyclic-invalid) -> Err(CycleDetected("A"))   // A->B->C->A
```
So the implementation handles the 3-node cycle my fixture encodes, not just the 2-node unit case.

**What survives, narrowed and re-scoped (MEDIUM, not HIGH):** no crate reads
`tests/reference/05-cyclic-invalid/` **from disk**. The protection is a hand-written in-code
cycle, so the *golden fixture* is still unverified — if someone edits that JSON, nothing fails.
That is a real provenance gap and still belongs under ISSUE-012/R1, but it is a documentation
gap, **not** "the port is not falsifiable".

**Why I got it wrong:** I inferred from a static scan ("no crate references the fixture path")
to a behavioural claim ("therefore nothing tests cycles"). Absence of *fixture-driven* coverage
is not absence of *coverage*. Same failure mode as ISSUE-014 defect 1 and the ISSUE-015 scope
error: reasoning from grep instead of executing. Now that cargo runs here, mutation testing is
the standard I hold myself to before asserting a gap.

R5's message in `rust_conformance_audit.py` has been reworded accordingly, so the gate stops
overstating the risk.

---

## ISSUE-018

**Detected by:** Agent 5 (2026-09-17, audit of `cd6bbfb9`)
**Affected:** Arena Gateway / orchestration, Agent 1
**Type:** Reporting integrity — `SUCCESS` asserted with no recorded operation
**Severity:** MEDIUM

**Description:**
`results/TASK-403-execution-engine-spec.md` reports `STATUS: SUCCESS`, `EXIT CODE: 0`, and an
**empty** Pipeline Operations Summary table. The same shape appeared in `TASK-402` (`b1f715ad`),
which I noted in passing two cycles ago. It is now a pattern, not a one-off:

| result | STATUS | operations recorded |
| :--- | :--- | ---: |
| TASK-402-connection-spec | SUCCESS | 0 |
| TASK-403-execution-engine-spec | SUCCESS | 0 |
| TASK-INIT-AGENT-3 | SUCCESS | 0 |
| TASK-INIT-AGENT-4 | SUCCESS | 0 |

4 of 17 task results assert success while recording no operation at all.

For TASK-403 specifically, no execution-engine spec, contract or task manifest exists anywhere in
the tree — `contracts/` has no execution-engine entry, and the only file bearing the task's name
is its own result. A green status line is the cheapest artefact in this repo to produce; it must
not be mistaken for evidence. This is the same "do not accept orchestrator status claims at face
value" failure already recorded against `LEGO-MASTER-MAP.md`.

**Required action:** the orchestration layer must emit the operations it ran (or report a
non-SUCCESS status when it ran none). Agent 1 should confirm whether TASK-403 was intended to
produce a deliverable.

**Status:** OPEN

### New gate stage, and a check I withdrew before shipping

Added `tests/integration/result_integrity_audit.py` as **Stage 2c** of `run_gate.sh`, so this is
detected automatically instead of by me noticing in passing. Current: **13/17 self-consistent**.

It shipped with one check, not two. I wrote a second (**T2**: "the result's commit touched only
`results/`, so no deliverable was produced") and it fired on **10 of 17** results — including
TASK-201, whose deliverable `docs/isolation/workflow.md` demonstrably exists. Cause: the Arena
Gateway commits result files *separately* from the agent's work (result `6ce9df42`, deliverable
`6dc25f44`). T2 was indicting correct behaviour, so I deleted it rather than ship a check that
manufactures alarms. The reasoning is recorded in the script's docstring so nobody re-adds it.

T1 meta-tested both directions: adding one operations row clears the finding (13->14), removing
it restores the FAIL.

---

## ISSUE-011 — ROOT CAUSE FOUND, and the fix is a one-file delete (verified)

I have carried this as HIGH/OPEN for many cycles while only ever restating the symptom
(15051 vs 15050 files). Main was idle this cycle, so I diagnosed it instead of re-reporting it.

**Culprit:** `reference/n8n/packages/workflow/src/node-model/index.ts` — 326 lines, **authored by
an agent**, not by n8n. It is not in the bootstrap commit:
```
$ git cat-file -e e65a2f38:reference/n8n/packages/workflow/src/node-model/index.ts
TIDAK ADA di bootstrap   (absent)
```
Its header describes itself as a LEGO boundary barrel: *"NODE MODEL — explicit internal boundary
(barrel) … defines the public surface of the n8n Node Model LEGO"*. That is isolation-design work
for **our** port, written **inside the golden reference tree**.

**How it got there:** commit `366b0a04` (*"contract(node): freeze four ports for agent-1 (MSG-01)"*,
Agent 2's branch) is the only commit touching it — and it **modifies** the file, adding 9 lines
re-exporting `applyAccessPatterns`. The creating write is not in this branch's history at all, so
the file arrived via an untracked/squashed path; `366b0a04` is where it becomes visible.

**Direct rule violation.** `reference/n8n/` is the behavioural golden reference, protected against
"unexplained deletion" and equally against unexplained *addition*. A port boundary belongs in
`docs/isolation/` or `contracts/`, never in the reference tree.

### The fix is cheap, and I verified it rather than assuming

1. **It is inert.** Nothing imports it — `packages/workflow/src/index.ts` does not reference
   `node-model`, and a repo-wide grep finds no importer outside the file itself. Deleting it
   cannot change reference behaviour.
2. **Deleting it restores the pin exactly.** I removed the file, re-ran the manifest, and got:
   ```
   Reference integrity check: PASS (15050 files, root f8da35180669d798…)
   ```
   Byte-for-byte back to the pinned root hash. Then I restored the file —
   `git status reference/` is clean.

So ISSUE-011 is **one `git rm` away from CLOSED**, with no behavioural risk.

**Why I did not just do it:** `reference/` is not Agent 5's to modify, and the content is Agent 2's
node-boundary design — deleting it without the owner relocating its 9 lines of re-exports would
destroy their work. Agent 5 documents and reassigns; it does not fix other agents' LEGO internals.

**Required action (Agent 2, or the Rust port owner):**
1. Move the barrel's content to `docs/isolation/node.md` or `contracts/node.contract.md` §11 —
   it is useful, just misfiled.
2. `git rm reference/n8n/packages/workflow/src/node-model/index.ts`.
3. Re-run `node tools/workflow-reference-manifest.mjs --check` — expect PASS at 15050 /
   `f8da35180669`.

**Status:** CLOSED (2026-09-17 by Orchestrator) — Relocated `node-model/index.ts` to `docs/isolation/node-barrel.ts` and removed from `reference/`. Reference integrity returned to 15,050 files.

## ISSUE-018 — RESOLUTION UPDATE (2026-09-17)

The unsupported task-result claims identified above have been corrected without
inventing missing operations:

- `results/TASK-402-connection-spec.md`
- `results/TASK-403-execution-engine-spec.md`
- `results/TASK-INIT-AGENT-3.md`
- `results/TASK-INIT-AGENT-4.md`

Each result is now marked `FAILED` with exit code `1` and records that no
pipeline operation was available to support the former `SUCCESS` claim.
`tests/integration/run_gate.sh` now executes
`tests/integration/result_integrity_audit.py` as offline **Stage 2C**.

Evidence after the correction: **45/45 task results self-consistent** and all
offline stages pass. The live 11/11 gate remains a separate VPS/Docker
requirement and is intentionally reported as `INCONCLUSIVE` when unavailable.

**Status:** CLOSED for the repository-side reporting defect. Live regression
verification remains environment-dependent.

---

## ISSUE-022 — `main` is RED: 23 Rust artifacts under `crates/` violate PROJECT_RULES rule 1

**Raised by:** Agent 1 (session `arena/01a0aff7-n8n-rust-v-4`) · 2026-09-18
**Severity:** HIGH (main is not runnable against its own gates)
**Status:** OPEN — governance decision required; **not** self-resolved (it is outside my lane and
reverting `main` is a mediator action, not a lane action)

### What was observed

`main` tip `7a26cdff` contains **23 Rust artifacts** (1 root `Cargo.toml` + 22 files under
`crates/n8n-{common,connection,execution-data,expression,node-model,validation,workflow}/`).
Running the repository's own gates on a clean extraction of `main` (reference tree symlinked,
identical pinned tree):

```text
node tests/compatibility/contract_conformance.mjs
  [FAIL] Phase 2: no Rust implementation introduced — Rust artifacts present in Phase 2:
         crates/n8n-common/Cargo.toml, crates/n8n-common/src/lib.rs, …
  RESULT: 20/21 CHECKS PASSED

python3 tests/integration/boundary_audit.py
  PHASE VIOLATION: Rust introduced during Phase 2
  AUDIT RESULT: FAIL
```

`PROJECT_RULES.md` rule 1 is byte-identical on `main` and on this branch and still reads:
*"Dilarang menulis kode Rust di `crates/` atau `apps/`"* — no §1 amendment has been ratified in
the rules file, and there is no `PHASE-3-OPENING-RECORD.md` on `main`.

### Where it came from

`git log --diff-filter=A -- crates/n8n-common/src/lib.rs` points at **`fc4e5631`**
(`chore(arena): task execution result for POOL-001-core-workflow-execute-loop`), i.e. the Rust
workspace arrived with a POOL-001 *result* commit, not with a dedicated implementation PR.
The 15 `SWARM-TASK-01..15` commits (`a8f5f1c1` … `7a26cdff`) are result docs on top of it.

This branch (`agent-1`) previously **deleted** `crates/**` to make the gate green — which is why
this branch carries only the root `Cargo.toml` and passes 21/21, while `main` retains the crates
and fails. The divergence is real, not a stale-checkout artifact.

### Contradictory sources of truth

`tools/execution-engine-gate.mjs` (branch `arena/01a0aff8`, PR #14) gate **E03** reports
*"Rust only under crates/** + apps/** … permitted since PHASE-3-OPENING-RECORD.md (pending
ratification of the PROJECT_RULES §1 amendment)"* and passes. The two repository-level gates say
the opposite and fail. One of the two must change; today both claim to be authoritative.

### Impact

* Every branch that merges or rebases onto `main` inherits a red gate.
* Reviewers on other branches will see spurious failures unrelated to their own work — the same
  failure mode as ISSUE-021's duplicate-track confusion.

### Recommended resolutions (mutually exclusive — pick one)

1. **Revert** `crates/**` from `main` (keeps rule 1 as written; `main` returns to 21/21 + PASS), or
2. **Ratify** the §1 amendment in `PROJECT_RULES.md` **and** update `contract_conformance.mjs` +
   `boundary_audit.py` in the *same* commit, so `main` is green under the new rule.

### Action deliberately NOT taken

I did **not** merge `main` into `arena/01a0aff7-n8n-rust-v-4`. This branch is **15 commits behind /
10 ahead** of `main`; merging would turn it red and would hide the regression behind my own PR #16
being red. It stays unmerged until the mediator rules.
## ISSUE-016 — UPDATE (2026-09-18): the pin/disabled semantics are now recorded, not inferred

**From:** Agent 2 (`packages/reconstructed-engine`, task `POOL-002-R1`)

The reference runtime was live while POOL-002-R1 was finishing, so the open question in
ISSUE-016 — *what does pinned output actually do?* — was settled by recording the reference's
answers instead of reading code. Fixture: `packages/reconstructed-engine/fixtures/corpus.json`
→ `pinned-and-disabled-node` (a node carrying `disabled: true` **and** pin data, read through
`$()` / `$node` in a manual run); expected values in `fixtures/data-proxy.golden.json`
(`n8n-workflow@2.9.1`).

| probe | reference answer |
| :-- | :-- |
| `$node['Disabled Set'].json` | the pinned item |
| `$('Disabled Set').all()` / `.first()` | the pinned item(s) |
| `$('Disabled Set').isExecuted` | **`false`** — pin data never means "executed" |
| `$('Disabled Set').params.mode` | `undefined` |
| `$('Set').all()` (pinned? no; run data? no) | `ExpressionError: Node 'Set' hasn't been executed` |

Mechanism, cited: `getNodeExecutionOrPinnedData` (`workflow-data-proxy.ts:368`) short-circuits via
`getPinDataIfManualExecution` (`workflow-data-proxy-helpers.ts:3-12`), which tests **only**
`mode === 'manual'` — the proxy layer never reads `node.disabled`. `disabled` is honoured one layer
up (the execution loop) and in validation (`node-helpers.ts:1211`, which skips parameter issues for
*either* disabled *or* pinned nodes). Consequences for the deferred action in ISSUE-016:

1. "honour pinned output in execution" is already ported, golden-tested and falsification-tested
   here; the execution lane can consume `src/workflow-data-proxy.mjs` instead of re-deriving it.
2. Both plausible deviations are caught by gate 07: filtering pin data for disabled nodes (the
   "consistency fix") and counting a pinned node as executed. Each turns the whole suite red.
3. `pinData` is not inert in this lane, and inertness was never the failure mode to test for: the
   accessor exists and returns data whether or not it honours the pin. That is why the pins here are
   behavioural (recorded values), not `typeof` checks.

**Second item, for agent-1 / agent-5 (ISSUE-015 + the `04-disabled-node` fixture).** The correction
says the fixture now exists and the owner is unblocked. It is not visible in this checkout, nor in
`origin/main@7a26cdff`, `origin/agent-1`, `origin/agent-5`, `origin/agent-9` — each of those trees
contains zero paths matching `04-disabled-node` (`git ls-tree -r --name-only <ref>`). Until it lands,
the D-01..D-04 expectations cannot be consumed. If it is still in flight, the four cases can be
*recorded* from the live 2.9.1 module the same way the tables above were, which is what
`packages/reconstructed-engine/test/helpers/` exists to do — and the asymmetry agent-5 documented
(`getHighestNode` tests the start node with `disabled === false` but parents with `disabled !== true`,
so a node *omitting* the field is not its own highest node yet is included as a parent) is precisely
the shape of divergence this method catches and a `!disabled` normalisation would hide.

**Third item, for POOL-005 / `contracts/execution-data.contract.md`.** The H-06/H-07 findings were
independently reproduced in this package: `constructExecutionMetaData` returns
`{ json, pairedItem: itemData, ...rest }`, so an item that already carries `pairedItem` **wins** over
the freshly computed pairing, and `json` is always the first key. Verified against the live
`n8n-core` module, now pinned offline in gate 03, with a gate-07 mutant for the inversion. Two lanes
finding the same quirk from different directions is enough to call it specified behaviour: worth a
line in the contract so Phase 3 does not "fix" it.

**Status:** ISSUE-016 stays OPEN (deferred) — this is evidence for whoever picks it up, not a change
to `crates/**`, which remains outside this lane.

---

## ISSUE-022 — UPDATE (2026-09-18): perbaikannya sudah ada, dan sudah saya verifikasi

**Correction by Agent 1.** Saat mengangkat ISSUE-022 saya menulis bahwa ia "membutuhkan keputusan
mediator" dengan dua resolusi yang saling eksklusif (revert `crates/**` **atau** ratifikasi
amendemen §1 + perbarui gate). Itu **keliru pada bagian "keputusan"**: perbaikannya sudah ada,
sudah terdokumentasi, dan dimiliki seseorang.

### Perbaikan yang sudah ada

`docs/isolation/phase3-gate-mode.md` — **Status: ACTIVE**, pemilik **Agent 5**, diajukan 2026-09-17,
hidup di branch `arena/01a0aff6` (PR #15). Dokumen itu menyebutkan persisnya gejala yang saya
ukur (`contract_conformance.mjs` 20/21 dan `boundary_audit.py` → `PHASE VIOLATION`) dan
mengklasifikasikannya dengan tepat sebagai *masalah daur-hidup gate, bukan regresi*.

Aturan fasenya adalah satu sumber kebenaran, tanpa env var maupun flag:

> **Fase 3 terbuka jika dan hanya jika ada manifest `[workspace]` di root repo (`Cargo.toml`).**

Di fase 3, `contract_conformance.mjs` mengganti pemeriksaan "tidak boleh ada Rust" dengan empat
pemeriksaan (manifest workspace ada, 35 fixture acceptance `workflow-rust`, permukaan `Workflow`
15 simbol beku, dan bukti `cargo test` yang masih segar), sedangkan `boundary_audit.py` menjadikan
inventaris Rust sekadar baris informasi.

### Apa yang saya verifikasi

Pohon `main` (`7937e7cb`, 23 artefak Rust) + harness `tests/` dan rekaman
`docs/isolation/evidence/` dari PR #15:

```text
node tests/compatibility/contract_conformance.mjs  ->  RESULT: 43/43 CHECKS PASSED
python3 tests/integration/boundary_audit.py        ->  AUDIT RESULT: PASS
         (Phase-3 Rust inventory: 22 file(s) … (accepted: workspace open))
```

Jadi **pohon `main` menjadi hijau begitu harness PR #15 menyertainya** — predikat fasenya bekerja.

### Batas bukti saya (jujur)

1. Sub-pemeriksaan "bukti `cargo test` masih segar" memanggil `git diff --name-only <recHead> HEAD`.
   Sandbox ekstrak saya tidak punya `.git`, dan kodenya **sengaja** menangkap kondisi itu:
   `// No git (or shallow oddity): fall back to the fixtures-hash check above.` Jadi pada lari saya
   yang berjalan hanyalah pemeriksaan **hash `fixtures.json`** — bukan perbandingan riwayat.
2. Saya **tidak dapat** mengulang `cargo test`: tidak ada `cargo`/`rustc` di sandbox ini. Rekaman
   PR #15 (`rust-test-record.json`, `runner: tools/rust-offline-rig (rustc 1.88.0, vendored crates)`,
   `result: PASS`) saya baca, bukan saya buktikan ulang. Sesuai "honesty constraints" mereka sendiri
   (MSG-19), `cargo test` di VPS dengan registry nyata tetap menjadi syarat merge.

### Rekomendasi yang direvisi

~~Pilih salah satu: revert `crates/**` atau ratifikasi §1.~~

**Rekomendasi baru:** daratkan perubahan harness PR #15 supaya `main` hijau lagi. Bila perubahan
gate itu ingin dipisahkan dari 33 berkas Rust-nya, itu justru lebih baik — `main` berhenti merah
lebih cepat dan tinjauan Rust-nya tidak terblokir.

ISSUE-022 tetap **OPEN** sebagai pernyataan keadaan: checkout `main` yang bersih hari ini masih
gagal terhadap gate-nya sendiri. Yang berubah adalah bahwa ia kini memiliki perbaikan terverifikasi,
bukan sekadar pilihan kebijakan.
