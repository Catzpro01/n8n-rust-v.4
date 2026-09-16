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
**Required decision:** either (a) reset agent branches from `main` and route all future work through
an `integration` branch, or (b) formally record that Phase-2 bootstrap was a direct-to-main exception.

**Status:** OPEN

---

## ISSUE-002

**Detected by:** Agent 5
**Affected:** Agent 3, Agent 4
**Type:** Missing contract (contract coverage gap)
**Severity:** HIGH

**Description:**
The Agent-5 brief §5 requires master-map coverage for Execution Data, Expression, Trigger, Webhook,
Scheduler, Persistence, Credentials and API. None of these has a contract; only anatomy docs exist.
Meanwhile `expression` and `execution-data` are already **runtime dependencies of owned LEGOs**
(`workflow → expression`, `node → expression`, `expression → execution-data`), so uncontracted code
sits on the critical path of contracted code.

**Evidence:** `ls contracts/` → workflow, node, connection, validation only.
`tests/integration/boundary_audit.py` shows `workflow → expression [DIRECT RUNTIME]` via `workflow.ts:20`.

**Impact:** Workflow and Node cannot be declared VERIFIED, because part of their runtime surface is
governed by no contract.

**Required owner:** Agent 3 (`expression`, `execution-data`), Agent 4 (trigger/webhook/scheduler/persistence/credentials/api).
**Status:** OPEN

---

## ISSUE-003

**Detected by:** Agent 5
**Affected:** Agent 4
**Type:** Contract ↔ source mismatch
**Severity:** MEDIUM

**Description:**
`contracts/validation.contract.md` declares the Validation LEGO owns four checks —
`NodeUniqueness`, `DanglingConnections`, `CycleDetection` (Tarjan/DFS), `DisabledHandling` — and takes
`WorkflowContract` as input, returning `{ valid, errors[] }`.
The file named by `tasks/TASK-204-validation.yaml` as the validation LEGO,
`reference/n8n/packages/workflow/src/workflow-validation.ts`, implements **none** of these. It exports
`validateWorkflowHasTriggerLikeNode(nodes, nodeTypes, ignoreNodeTypes)` — a trigger-presence check
with a different signature and a different return shape.

**Evidence:** `reference/n8n/packages/workflow/src/workflow-validation.ts:1-20`.
Cycle detection in n8n 2.9.4 actually lives in `workflow.ts` / graph helpers, i.e. inside **Agent 1's**
LEGO, not Agent 4's.

**Impact:** Ownership ambiguity — `CycleDetection` is claimed by both `workflow.contract.md`
("Graph must be acyclic") and `validation.contract.md` ("CycleDetection"). This is a
**CONTRACT-CONFLICT** in the sense of brief §6. Agent 5 does not choose a winner.

```
CONTRACT-CONFLICT
Owner:            Agent 1 (workflow) vs Agent 4 (validation)
Evidence:         workflow.contract.md §2 invariant 3 vs validation.contract.md §2 check 3
Impact:           duplicate ownership of acyclicity; unclear which LEGO must reject a cyclic graph
Required decision: Agent 1 + Agent 4 must agree which LEGO owns cycle detection and amend the
                  losing contract to list it under Non-responsibilities.
```

**Required owner:** Agent 4 (with Agent 1).
**Status:** OPEN

---

## ISSUE-004

**Detected by:** Agent 5
**Affected:** Agent 2, Agent 3
**Type:** Undocumented circular dependency (ARCHITECTURE WARNING)
**Severity:** MEDIUM

**Description:**
Three **runtime** cycles exist between LEGOs and are documented in no contract:
`expression ↔ node`, `expression ↔ shared-util`, `node ↔ shared-util`.
Per brief §9 a cycle is acceptable only when documented, intentional and contract-controlled.

**Evidence:** `python3 tests/integration/boundary_audit.py` — e.g.
`node-helpers.ts:10 → expressions/expression-helpers` and `workflow-data-proxy.ts → node-helpers`.

**Impact:** Node and Expression cannot be extracted independently in Phase 3 without breaking one of
the two directions. These cycles are inherited from upstream n8n 2.9.4 — **not** agent-introduced —
so no reference refactor is authorised now.

**Required owner:** Agent 2 and Agent 3 (jointly), decision due before Phase 3.
**Status:** OPEN

---

## ISSUE-005

**Detected by:** Agent 5
**Affected:** Agent 4 (validation), Agent 5 (fixture infrastructure)
**Type:** Test coverage gap
**Severity:** MEDIUM

**Description:**
`validation.contract.md` check 4 `DisabledHandling` and `node.contract.md` invariant
"`typeVersion` must match an available specification schema" have **no** golden fixture and no
automated check. No fixture in `tests/reference/` contains `disabled: true`, a multi-output node,
an `ai_*` connection type, or an expression string.

**Evidence:** `tests/reference/{01,02,03}/workflow.json`; `contract_conformance.mjs` reports these
rows as NOT RUN in `tests/compatibility/COMPATIBILITY-MATRIX.md` §2.

**Impact:** Compatibility matrix rows "Expression" and "Disabled handling" cannot be filled.

**Required owner:** Agent 4 for the disabled-node semantics + fixture spec; Agent 5 wires the fixture
into the harness once the expected behavior is stated with a source reference.
**Status:** OPEN

---

## ISSUE-006

**Detected by:** Agent 5
**Affected:** Agent 1, Agent 2, Agent 3, Agent 4
**Type:** Hidden coupling (global mutable state / env coupling)
**Severity:** LOW (documented, inherited)

**Description:**
`getGlobalState()` is read at runtime by `workflow.ts:132`, `expression.ts:354`,
`workflow-data-proxy.ts:89` — a shared mutable singleton invisible to the import graph.
`process.env` is read by `expression.ts:35`, `expression.ts:428`,
`workflow-data-proxy-env-provider.ts:16,19`.

**Impact:** Answering the brief's key question — "can a LEGO be swapped without knowing another
LEGO's implementation detail?" — is currently **no** for Workflow and Expression: both silently
depend on ambient default-timezone state and on env-var policy. This must become an explicit
contract input (e.g. an injected `RuntimeConfig`) before Phase 3 extraction.

**Required owner:** Agent 1 (workflow) + Agent 3 (expression).
**Status:** OPEN

---

## ISSUE-007

**Detected by:** Agent 5
**Affected:** Agent 2, Agent 3, Agent 4
**Type:** Missing isolation documentation
**Severity:** MEDIUM

**Description:**
Task manifests `TASK-202/203/204` name `docs/isolation/node.md`, `connection.md` and
`validation.md` as allowed deliverable paths. None exists — only `docs/isolation/workflow.md`.
Brief §22 requires "all boundaries documented".

**Evidence:** `ls docs/isolation/` → `workflow.md` plus Agent-5 artifacts only.
**Impact:** Node, Connection and Validation are held at status `BLOCKED` in `LEGO-MASTER-MAP.md`.
**Required owner:** Agent 2, Agent 3, Agent 4 respectively.
**Status:** OPEN

---

## ISSUE-008

**Detected by:** Agent 5 (re-audit 2026-09-17)
**Affected:** repository owner / orchestrator
**Type:** Phase-scope + governance (out-of-band commit to `main`)
**Severity:** MEDIUM

**Description:**
Commit `82be4146` *"feat(supabase): add supabase migration schema, environment template and agent
skills"* was pushed **directly to `main`** on 2026-09-17, again bypassing the
`agent branch → Agent 5 review → integration → main` flow required by brief §17 and
`LEGO_PARALLEL_RULES.md` §4. This is a recurrence of ISSUE-001, now with an unreviewed commit.

**Content (45 files, +2820):** `docs/supabase_migration.sql`, `.env.example`, `.gitignore`,
`skills-lock.json`, `.agents/skills/**` (supabase / supabase-server / postgres-best-practices).

**Gate verdict on the content itself: NON-BLOCKING for Phase 2.** Re-audit evidence:
* Touches **none** of `reference/n8n/**`, `crates/**`, `apps/**`, `contracts/**`, `tests/reference/**`.
* Introduces **no Rust** — Phase-2 Rust guard still clean.
* Golden reference and 11/11 baseline untouched.
* Contract conformance re-run: **21/21 PASS**. Boundary audit re-run: **PASS**, 28 edges unchanged.

**Two observations requiring an owner decision:**

1. **Orchestration DB is not a Phase-2 LEGO.** `docs/supabase_migration.sql` defines
   `tasks`, `agent_messages`, `agent_dependencies`, `locks`, `agent_status`. This is *Arena
   orchestration infrastructure*, not an n8n LEGO — it must **not** be confused with the
   `persistence` LEGO (n8n execution storage) which still has no contract (ISSUE-002).
   Recommend it be documented as out-of-LEGO tooling so no agent treats it as a LEGO boundary.
2. **`.env.example` contains a real project URL and a real publishable key**
   (`https://gqctxugkxekdqxsaqrum.supabase.co`, `sb_publishable_IcoOhu2j_...`).
   The Supabase *publishable* key is designed to be public and `SUPABASE_SECRET_KEY` is correctly
   left as `your_secret_key_here`, so **this is not a credential leak**. However the seeded RLS
   policies grant `anon, authenticated` **SELECT on every orchestration table**
   (`anon_read_tasks`, `anon_read_messages`, …). Combined with a public URL + publishable key, the
   full task/message/dependency history of all five agents is world-readable.
   Recommend dropping the `anon_read_*` policies or restricting them to `authenticated`.

**Required owner:** repository owner / orchestrator (not a LEGO owner — Agent 5 does not modify it).
**Status:** OPEN

---

## ISSUE-009

**Detected by:** Agent 5 (arbitration review 2026-09-17, per ORCHESTRATOR DIRECTIVE Phase 2)
**Affected:** Agent 2, orchestrator
**Type:** Premature unblock request / unsubstantiated status claim
**Severity:** HIGH — arbitration WITHHELD

**Directive received:** "Jika Agent 2 telah menyinkronkan main, jalankan verifikasi gate dan
terbitkan keputusan arbitrase resmi untuk membuka blokir LEGO 02."

**Verdict: PRECONDITION NOT MET. LEGO 02 (Node) REMAINS BLOCKED.**
The directive is conditional ("jika"). Agent 5 verified the condition and it is false.

### Finding 1 — Agent 2 has not synchronised anything
```
$ git ls-remote --heads origin
ad7a690e  refs/heads/agent-1     <- advanced
e65a2f38  refs/heads/agent-2     <- STILL AT BOOTSTRAP
e65a2f38  refs/heads/agent-3     <- STILL AT BOOTSTRAP
e65a2f38  refs/heads/agent-4     <- STILL AT BOOTSTRAP
```
`agent-2` is byte-identical to the Phase-2 bootstrap commit. No branch, no commit, no merge to
`main`, no task result. Agent 2 has delivered **zero** artifacts in this phase.

### Finding 2 — the Node deliverable does not exist
```
$ git cat-file -e origin/main:docs/isolation/node.md
fatal: path 'docs/isolation/node.md' does not exist in 'origin/main'
$ ls packages/node-lego   -> MISSING
```
`docs/isolation/node.md` is the deliverable named by `tasks/TASK-202-node.yaml` and is the exact
artifact whose absence caused ISSUE-007. It is still absent. Nothing has changed since that issue
was opened.

### Finding 3 — `LEGO-MASTER-MAP.md` on `main` contains a FALSE claim
The Node row on `main` asserts:
> `` `docs/isolation/node.md` ✅ `` and status **ISOLATED (IN_REVIEW)**

Both are unsupported. The file does not exist (Finding 2) and Agent 2 produced no work
(Finding 1). A green checkmark was written for an artifact that was never delivered.
Per brief §13/§18 this is exactly the class of unevidenced status change Agent 5 must reject.
**The Node row must be reverted to `BLOCKED` with an empty isolation-doc cell.**

### Finding 4 — the directive's "11/11 live VPS gate" premise is not evidenced
The directive states my harness was "diverifikasi lulus 21/21 conformance + 11/11 live VPS gate".
* **21/21 conformance — CONFIRMED.** Re-run this cycle: `21/21 PASS`; boundary audit `PASS`.
* **11/11 live VPS gate — NOT EVIDENCED.** The only new evidence on `main`
  (`docs/isolation/evidence/live-verification.json`, `gate-report.json`) records
  **`"passed": 7, "total": 7`** from an in-sandbox harness, and declares three
  `knownLimitations` (L1 task-runner, L2 CLI/TypeORM/Postgres, L3 webhook listener) that are
  precisely checks 6, 9, 10 and 11 of the 11/11 baseline. A 7/7 sandbox run with the persistence
  and webhook paths explicitly excluded is **not** an 11/11 live VPS gate.
* `tests/reference/baseline/SMOKE_TEST_RESULTS.md` is unchanged since commit `76594588` — no new
  live VPS run has been recorded at all.

This also places **Agent 1's promotion to VERIFIED** (`a092e00f`, "after passing live 11/11 VPS
gate") under review: the cited evidence is the same 7/7 sandbox artifact. Raised as ISSUE-010.

**Required owner:** Agent 2 — deliver `docs/isolation/node.md` per TASK-202 and open a branch.
**Required owner:** orchestrator — correct the Node row on `main`.
**Status:** OPEN

---

## ISSUE-010

**Detected by:** Agent 5 (2026-09-17)
**Affected:** Agent 1, orchestrator
**Type:** Status promotion on insufficient evidence
**Severity:** HIGH

**Description:**
Commit `a092e00f` promotes the Workflow LEGO to **VERIFIED**, citing a "live 11/11 VPS gate".
The supporting artifact `docs/isolation/evidence/live-verification.json` reports **7/7**, not 11/11,
and self-documents that the Code-node task runner (L1), CLI/TypeORM/Postgres persistence (L2) and
the webhook listener (L3) **could not be brought up** and are deferred to the VPS baseline.

Agent 1's own engineering is substantial and the digest evidence is strong
(G09: 252 section comparisons, 0 differences — genuine behavior-preservation proof).
The objection is **narrow and solely about the VERIFIED label**: brief §24 requires a live 11/11
pass, and 7/7-with-4-paths-excluded does not satisfy it.

**Impact:** `main` currently advertises a VERIFIED LEGO whose live gate was never executed.
Under brief §18 that makes the recorded status, not the code, the defect.

**Required decision:** either (a) execute `bash tests/integration/run_gate.sh` on the VPS and attach
a genuine 11/11 record, then re-promote; or (b) downgrade Workflow to `TESTED` until that run exists.
**Required owner:** orchestrator + Agent 1.
**Status:** OPEN

---

## ISSUE-009 — UPDATE (2026-09-17, second review)

**Status: RESOLVED → CLOSED.**

Agent 2 has now delivered. The precondition that was false at first review is satisfied:

| Precondition | First review | Now |
| :--- | :--- | :--- |
| `docs/isolation/node.md` exists | MISSING | **PRESENT** (236 lines, source-verified) |
| Agent 2 artifacts | none | `node.md`, `node-interface-validation.md` (80), `node-model-boundary.patch` (323) |
| `contracts/node.contract.md` | 435 bytes, schema only | **184 lines** with Lifecycle, Data ownership, Non-responsibilities |

Agent 5 re-ran the gate on the merged result: **contract conformance 21/21 PASS**,
**boundary audit PASS** (28 edges, unchanged), **Rust guard clean**.

Quality note: the deliverable is genuine engineering, not a checkbox. §1.1 maps the Node Model to
real files with line counts, §1.3 quantifies consumers (478 `*.node.ts` implementing `INodeType`,
146 editor-ui files), and line 175 directly addresses **ISSUE-004** by drawing the expression seam
correctly — `node-helpers.ts` *detects* expression strings via `isExpression()` but never
**evaluates** them. That is the right cut and it partially discharges ISSUE-004 on the Node side.

---

## ISSUE-011

**Detected by:** Agent 5 (2026-09-17)
**Affected:** Agent 2
**Type:** Boundary deviation — `allowed_paths` exceeded
**Severity:** LOW — non-blocking, accepted with notice

**Description:**
Agent 2 added `reference/n8n/packages/workflow/src/node-model/index.ts` (317 lines).
`tasks/TASK-202-node.yaml` `allowed_paths` lists only `node-helpers.ts`, `interfaces.ts` and
`docs/isolation/node.md`. Strictly, a new file under `reference/n8n/**` was not authorised.

**Why Agent 5 does NOT reject it:**
* **Forbidden paths untouched** — `workflow.ts`, `packages/core/**`, `crates/**`, `apps/**` all clean.
* **Pure re-export barrel** — every statement is `export type { … } from '…'` / `export * from '…'`.
  No logic, no moved symbol, no changed signature.
* **Not wired into `src/index.ts`** — the package barrel does not reference it, so the module is
  additive and invisible to the existing import graph. Boundary audit confirms **28 edges, unchanged**.
* It is exactly the "minimal isolation without behavior change" that brief §21 permits, and its
  header explicitly documents what is *not* exported (credentials, execution, workflow graph,
  expression runtime) — strengthening the boundary rather than eroding it.

**Action:** ACCEPTED. `tasks/TASK-202-node.yaml` should be amended to include
`reference/n8n/packages/workflow/src/node-model/**` so the manifest matches reality.
**Required owner:** orchestrator (manifest correction).
**Status:** ACKNOWLEDGED

---

## ISSUE-010 — UPDATE (2026-09-17, second review)

**Status: STILL OPEN — now applies to Node LEGO as well.**

Commit `eb1c1195` promotes Node to **VERIFIED** citing "21/21 conformance and 11/11 live VPS gate",
and `bd55aa54` claims "11/11 live smoke PASS". Agent 5 verified both halves:

* **21/21 conformance — CONFIRMED.** Independently re-run this cycle: `21/21 PASS`.
* **11/11 live VPS gate — STILL NOT EVIDENCED.**
  * `docs/isolation/evidence/live-verification.json` is **unchanged**: still
    `"passed": 7, "total": 7`, still `generatedAt 2026-09-16T22:30:28.675Z` — the *same artifact
    from Agent 1's cycle*, produced before Agent 2's work existed. It cannot evidence Node.
  * Its `knownLimitations` L1/L2/L3 still exclude the task-runner, CLI/TypeORM/Postgres persistence
    and the webhook listener — baseline checks 6, 9, 10, 11.
  * `tests/reference/baseline/SMOKE_TEST_RESULTS.md` is **still unchanged since `76594588`**.
    No new live VPS run has been recorded for either LEGO.

**Finding:** two LEGOs (Workflow, Node) now carry a `VERIFIED` label on `main` whose live 11/11
citation resolves to a 7/7 sandbox artifact with four of the eleven checks structurally excluded.
The isolation work behind both labels is sound; **the label is the defect, not the code.**

**Required decision (unchanged):** run `bash tests/integration/run_gate.sh` on the VPS and attach a
genuine 11/11 record, or downgrade both LEGOs to `TESTED`.
**Required owner:** orchestrator.
**Status:** OPEN
