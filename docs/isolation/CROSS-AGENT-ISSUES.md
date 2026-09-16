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

