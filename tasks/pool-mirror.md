# OFFLINE POOL MIRROR (read-only)

**Purpose:** `dynamic_task_pool`, `task_consensus_votes` and `agent_messages` live in the
Supabase project pinned in `.env.example`, but the host is unreachable from the Arena
sandbox (ISSUE-019, HIGH). This file is the in-repo fallback required by ISSUE-019's
Required Action: a read-only mirror of the pool (task id, status, owner) so every
standing worker can still obey `STANDING-WORKER-PROTOCOL.md` offline.

**Rules for workers:**
1. Treat this file as read-only. Update it only as part of a committed task whose
   `allowed_paths` include `tasks/pool-mirror.md`, and regenerate the table from
   `results/*.md` in the same commit (status/owner/commit columns must match the
   result files — no manual status claims).
2. A task is `AVAILABLE` here only if: (a) it appears in the Remote pool when reachable,
   or (b) it has a manifest in `tasks/` and no result in `results/`, and no other
   branch/worker has a result for it in this mirror.
3. Votes (`task_consensus_votes`) cannot be recorded offline — the Votes column stays
   `n/a (offline)` until the orchestration plane is reachable again.

**Generated:** 2026-09-17 15:40 UTC by `arena/01a0afff-n8n-rust-v-4` (TASK-POOL-VERIFY-01)
**Sources:** `results/*.md` (48 files) + `tasks/*.yaml` (33 manifests)

## Completed tasks (result committed)

| Task ID | Status | Owner | LEGO | Commit | Result file |
| :--- | :--- | :--- | :--- | :--- | :--- |
| POOL-001-core-workflow-execute-loop | SUCCESS | arena/01a0aff8 (work-stealing takeover) | execution | 83a77195 | results/POOL-001-core-workflow-execute-loop.md |
| POOL-002-node-execution-context-data-proxy | SUCCESS | arena/01a0aff8 (re-run of FAILED pipeline result) | expression | 83a77195 | results/POOL-002-node-execution-context-data-proxy.md |
| POOL-003-error-retry-handling | SUCCESS | arena/01a0aff8 (work-stealing takeover) | validation | 83a77195 | results/POOL-003-error-retry-handling.md |
| TASK-POOL-VERIFY-01 | SUCCESS | arena/01a0afff (takeover: verify POOL-001..003 on this branch + offline pool mirror) | integration | (this commit) | results/TASK-POOL-VERIFY-01.md |
| TASK-001 | FAILED | agent-1 | — | — | results/TASK-001.md |
| TASK-002 | SUCCESS | agent-2 | — | — | results/TASK-002.md |
| TASK-101 | SUCCESS | agent-1 | — | — | results/TASK-101.md |
| TASK-102 | REJECTED | agent-2 | — | — | results/TASK-102.md |
| TASK-201-workflow | SUCCESS | agent-1 | workflow | — | results/TASK-201-workflow.md |
| TASK-201 | SUCCESS | agent-1 | — | — | results/TASK-201.md |
| TASK-202-node | SUCCESS | agent-2 | node | — | results/TASK-202-node.md |
| TASK-203-connection | SUCCESS | agent-3 | connection | — | results/TASK-203-connection.md |
| TASK-204-validation | SUCCESS | agent-4 | validation | — | results/TASK-204-validation.md |
| TASK-205-integration | SUCCESS | agent-5 | integration | — | results/TASK-205-integration.md |
| TASK-301-workflow-isolation | SUCCESS | agent-1 | workflow | — | results/TASK-301-workflow-isolation.md |
| TASK-302-agent5-gate | SUCCESS | agent-5 | integration | — | results/TASK-302-agent5-gate.md |
| TASK-304-ping | SUCCESS | agent-2 | node | — | results/TASK-304-ping.md |
| TASK-402-connection-spec | SUCCESS | agent-3 | connection | — | results/TASK-402-connection-spec.md |
| TASK-403-execution-engine-spec | SUCCESS | agent-1 | workflow | — | results/TASK-403-execution-engine-spec.md |
| TASK-ENGINE-ERROR-01 | SUCCESS | arena-worker | execution | 937ca1d6 | results/TASK-ENGINE-ERROR-01.md |
| TASK-INIT-AGENT-3 | SUCCESS | agent-3 | connection | — | results/TASK-INIT-AGENT-3.md |
| TASK-INIT-AGENT-4 | SUCCESS | agent-4 | validation | — | results/TASK-INIT-AGENT-4.md |
| TASK-PHASE3-GATE-01 | SUCCESS | arena-worker | integration | cd32dcb4 | results/TASK-PHASE3-GATE-01.md |
| TASK-PIPE-01 | SUCCESS | agent-1 | workflow | — | results/TASK-PIPE-01.md |
| TASK-PIPE-02 | SUCCESS | agent-12 | workflow | — | results/TASK-PIPE-02.md |
| TASK-PIPE-03 | SUCCESS | agent-11 | workflow | — | results/TASK-PIPE-03.md |
| TASK-PIPE-04 | SUCCESS | agent-10 | workflow | — | results/TASK-PIPE-04.md |
| TASK-PIPE-05 | FAILED | agent-9 | workflow | — | results/TASK-PIPE-05.md |
| TASK-PIPE-06 | SUCCESS | agent-2 | node | — | results/TASK-PIPE-06.md |
| TASK-PIPE-07 | FAILED | agent-7 | node | — | results/TASK-PIPE-07.md |
| TASK-PIPE-08 | FAILED | agent-6 | node | — | results/TASK-PIPE-08.md |
| TASK-PIPE-09 | SUCCESS | agent-5 | node | — | results/TASK-PIPE-09.md |
| TASK-PIPE-10 | SUCCESS | agent-4 | node | — | results/TASK-PIPE-10.md |
| TASK-PIPE-11 | SUCCESS | agent-3 | connection | — | results/TASK-PIPE-11.md |
| TASK-PIPE-12 | SUCCESS | agent-4 | expression | — | results/TASK-PIPE-12.md |
| TASK-PIPE-13 | SUCCESS | agent-2 | expression | — | results/TASK-PIPE-13.md |
| TASK-PIPE-14 | SUCCESS | agent-1 | expression | — | results/TASK-PIPE-14.md |
| TASK-PIPE-15 | SUCCESS | agent-5 | connection | — | results/TASK-PIPE-15.md |
| TASK-PIPE-16 | SUCCESS | agent-5 | integration | — | results/TASK-PIPE-16.md |
| TASK-PIPE-17 | SUCCESS | agent-4 | persistence | — | results/TASK-PIPE-17.md |
| TASK-PIPE-18 | SUCCESS | agent-3 | persistence | — | results/TASK-PIPE-18.md |
| TASK-PIPE-19 | SUCCESS | agent-2 | credentials | — | results/TASK-PIPE-19.md |
| TASK-PIPE-20 | SUCCESS | agent-1 | queue | — | results/TASK-PIPE-20.md |
| TASK-PIPE-21 | SUCCESS | agent-5 | api | — | results/TASK-PIPE-21.md |
| TASK-PIPE-22 | SUCCESS | agent-4 | webhook | — | results/TASK-PIPE-22.md |
| TASK-PIPE-23 | SUCCESS | agent-3 | api | — | results/TASK-PIPE-23.md |
| TASK-PIPE-24 | SUCCESS | agent-2 | ui | — | results/TASK-PIPE-24.md |
| TASK-PIPE-25 | SUCCESS | agent-1 | integration | — | results/TASK-PIPE-25.md |

## Manifests with no result file yet (audit / arbitration class)

These are mediator / Agent-5 verdict or audit-request tasks. Their verdicts, where
issued, are recorded in `docs/` — no worker may claim one until the Remote pool or the
mediator marks it `AVAILABLE`.

| Task ID (manifest) | Class | Verdict recorded in |
| :--- | :--- | :--- |
| TASK-301-connection | connection LEGO merge | `tasks/TASK-301-connection.yaml` header: VERIFIED (agent-5 merge da39a5b6, 21/21) |
| TASK-301-gate | gate request | docs/isolation/workflow-verification.md |
| TASK-302-arbitration | arbitration | docs/isolation/CROSS-AGENT-ISSUES.md |
| TASK-303-connection / TASK-303-validation / TASK-303-workflow-handoff / TASK-303-arbitration-lego02 | arbitration / handoff | docs/isolation/CROSS-AGENT-ISSUES.md, docs/isolation/workflow-handoff.md |
| TASK-304-arbitration-lego02-verdict | arbitration verdict | docs/isolation/PHASE-2-INTEGRATION-REPORT.md |
| TASK-305-node-audit-request / TASK-305-phase2-final-verdict | audit / final verdict | docs/isolation/PHASE-2-INTEGRATION-REPORT.md (Phase 2 = VERIFIED) |
| TASK-306-node | node LEGO deliverable (branch arena/01a0ac04, since deleted) | docs/isolation/node.md, contracts/node.contract.md |
| TASK-306-validation-audit-request | validation audit (commit fa6a1de0) | docs/isolation/validation.md, validation-golden-cases.md |

## Known open decisions (orchestrator, not worker-actionable)

- **ISSUE-019** — orchestration plane unreachable from sandbox (this mirror is the
  partial mitigation; allow-listing the Supabase host remains open).
- **ISSUE-021** — two engine tracks (`packages/reconstructed-engine/` prototype vs
  `packages/execution-engine/` Phase-3 reconstruction); consolidation decision is
  pre-Phase-3-exit and belongs to the orchestrator.
