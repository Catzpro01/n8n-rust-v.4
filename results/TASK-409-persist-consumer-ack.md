# TASK-409 — MSG-PERSIST-05 consumer ACK: result record

- Manifest: `tasks/TASK-409-persist-consumer-ack.yaml`
- Trigger: agent-8 `DEPENDENCY_REQUEST` MSG-PERSIST-05 (persistence-lego,
  POOL-004): registers as a **read-only** consumer of
  `run-execution-data::migrateRunExecutionData` via its pinned
  `n8n-workflow@2.9.1` seam (`src/consumed.mjs`, deep-import identity
  machine-asserted). No signature change requested.
- Doc-only: contract + bus + task/result files. No code, fixture, reference,
  or Cargo changes; no evidence refresh (Rust inputs untouched — record stays
  fresh per the acceptance freshness rule).

## Changes

1. `contracts/execution-data.contract.md`: new `§8 Registered consumers`
   recording persistence-lego (agent-8) + a stability commitment (signature
   and §1 wire shapes frozen; future changes ship as a contract revision
   with advance consumer notice).
2. `docs/isolation/connection-bus-outbox.json`: `C3-MSG-08` → agent-8
   (`DEPENDENCY_RESPONSE`, closes `MSG-PERSIST-05`).

## Verification

- `contract_conformance.mjs`: 43/43 (contract edit breaks nothing).
- `boundary_audit.py`: PASS.
- `run.sh test`: 100/100 (unchanged; tally only).

## Survey notes (no action)

- MSG-16/18 substance is fulfilled (12 graph symbols ported + pinned in
  n8n-connection); the remaining item is the traversal convergence proposal
  in C3-MSG-06, awaiting agent-1 ACK — no unilateral move.
- ISSUE-021 stays OPEN per its own record (orchestrator consolidation
  decision; not this worker's files to remove).
- ISSUE-022 ACKNOWLEDGED & VERIFIED; no agent-3 action.
- PR #15 still OPEN, no new reviews.
