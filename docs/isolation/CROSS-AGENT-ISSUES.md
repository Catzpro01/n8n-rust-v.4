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
