# Workforce control plane

Implementation of the Manager workforce specification #259–#267, authorized by #268 (DEC-0001).
There is **one Manager system** plus ten worker slots `AGENT-01..AGENT-10`. The registry, task
graph, reservations, assignment, leases, scheduler, matcher, merge queue, evidence, recovery,
decision register, knowledge promotion, observability and human escalation are all **components
of that system**, not separate agents.

This is governance tooling. It is not product code, and it never appears in the product manifests
(`domains.json`, `ai-lego-set.json`).

## Canonical sources (DEC-0002)

| What | Where |
|---|---|
| Object shape (7 core schemas + Actor, Approval, Command, Event, Handoff, JournalEntry, Request) | `schemas/*.schema.json` |
| State machines, command authorization, SYSTEM allowlist, human approval, reservation compatibility, lease TTLs, scheduler, backpressure, anti-thrash, merge lanes, evidence trust | `policy.json` |
| Manager decisions | `decisions/DEC-nnnn.json` |
| Engine | `tools/workforce/src/` |
| Tests | `tools/workforce/test/` (run in CI by `n8n-lego.yml`) |

Operational state (the object store, event log, heartbeats and leases) lives **outside git** in
`.arena/workforce-state/`, which is gitignored. The Manager memory files are *derived views*
(`cli.mjs render`). Regenerate them instead of editing them by hand. GitHub `main` remains the
only code authority.

A prompt is not policy. Instruction text in commands, issues or tool output never changes
authority. The engine classifies it as `PROMPT_GOVERNANCE_CONFLICT`, denies or flags it, and
records it. Rules change only through a Manager decision that is promoted to `main`.

## Command API

Every mutation is a command envelope:

```json
{ "commandId": "CMD-…", "commandType": "TASK_ASSIGN", "schemaVersion": "1.0",
  "actor": { "type": "MANAGER", "id": "MANAGER-01" },
  "target": { "objectType": "Task", "objectId": "TASK-0001" },
  "expectedRevision": 1, "idempotencyKey": "…", "requestedAt": "…Z",
  "reason": "…", "payload": { "agentId": "AGENT-03" } }
```

Commands pass through this pipeline:

1. schema
2. authenticate (Actor registry)
3. role and SYSTEM allowlist
4. lock
5. idempotency (same payload replays; a different payload returns `IDEMPOTENCY_CONFLICT`)
6. load
7. ownership and scope
8. terminal check
9. exact-matrix precondition
10. CAS (`REVISION_CONFLICT`)
11. lease
12. policy, human approval, dependencies, reservations and evidence
13. transition
14. schema validation of every written object
15. atomic commit (journal, then snapshots, events and idempotency record)
16. structured result

If any step fails, nothing is mutated. The result always carries one of the 20 stable error codes
together with its `retrySafe` flag.

A create uses `objectId: "NEW"` to get an allocated id, or passes an explicit id with
`expectedRevision: 0`.

## Key rules

- **Open slots, shared runners (DEC-0010):** `AGENT-01..10` are capacity, not identities. No task,
  PR or action is bound to a particular slot; the scheduler gives any READY task to any idle eligible
  slot. Slots register with `runnerClass: ANY`, and the 5 Windows + 5 WSL runners are one pool.
  Heavy-build limits count the runner class the task requires (`policy.json#runnerPool`).
  `AGENT_RECONFIGURE` changes an idle slot.
- **Actors:** `MANAGER`, `WORKER`, `HUMAN` and `SYSTEM`. The model fails closed.
  - Workers act only on their own task, lease and evidence, and only while they hold a live
    `TASK_ASSIGNMENT` lease.
  - A worker's evidence trust is capped at `SELF_REPORTED`, and SYSTEM's at `CI_VERIFIED`.
- **Leases:** an expired lease is never revived. Renewal is CAS-protected, only moves the expiry
  forward, and is capped at the maximum lifetime. Merge authorizations last 900s and cannot be
  renewed.
- **Reservations:** scopes are normalized and fingerprinted. Every overlapping dimension is
  evaluated and the most severe verdict wins. Security and governance surfaces always conflict.
  Unknown compatibility is treated as a conflict. `GOVERNANCE_LOCK` is Manager-only.
- **Merge queue:** each item is pinned to repo, PR, base and head.
  - A head change moves the item from READY to HOLD, resets its checks and revokes the
    authorization.
  - SAFE-AUTO is a policy *result* and is granted only when every gate is explicitly clear.
  - IRREVERSIBLE merges require a human approval bound to the exact item.
- **Completion:** a task needs verified COMMIT, CI and MAIN_VERIFICATION evidence, with the last
  at `MAIN_VERIFIED` trust or higher. It also needs a MERGED queue item and completed REQUIRED
  dependencies. MERGED ≠ COMPLETE.
- **Scheduler:** it is pure, and it recommends rather than executes. It combines:
  - capability, capacity and runner class;
  - dependencies and reservations;
  - priority with bounded aging;
  - backpressure;
  - starvation and anti-thrash alerts.
- **Cross-P concurrency (#267):** every pair of in-flight tasks is classified as `SAFE_PARALLEL`,
  `CONDITIONAL_PARALLEL`, `SERIALIZED` or `HOLD`, and the reason is shown. Parallelism is an
  outcome, not a permission.
- **Recovery:** a leftover journal is rolled forward and a torn journal is quarantined.
  - `reconcile` reports integrity problems, event-log/replay mismatches, overdue leases,
    stale heartbeats and claims that were never acknowledged.
  - Only mechanical expiries are auto-applied, as `SYSTEM-RECOVERY`.
  - LOST, transfer and cancel always remain Manager decisions.

## CLI

```sh
node tools/workforce/src/cli.mjs validate-policy
node tools/workforce/src/cli.mjs decisions-check
node tools/workforce/src/cli.mjs bootstrap            # register actor identities (idempotent)
node tools/workforce/src/cli.mjs exec command.json    # one command -> structured result
node tools/workforce/src/cli.mjs plan                 # scheduler + concurrency plan
node tools/workforce/src/cli.mjs reconcile            # read-only recovery report
node tools/workforce/src/cli.mjs recover              # journal roll-forward + safe expiries
node tools/workforce/src/cli.mjs status --main <sha>  # MANAGER STATUS
node tools/workforce/src/cli.mjs render <dir>         # derived Manager memory views
node --test tools/workforce/test/*.test.mjs
```
