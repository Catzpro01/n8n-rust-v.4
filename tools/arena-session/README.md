# Arena worker session runtime (#295)

This directory holds the **transport** and **worker client** that attach live worker sessions to the
workforce control plane. They are the missing bridge between the scheduler and real sessions:

```
READY task -> scheduler (pure) -> Manager TASK_ASSIGN -> TASK_ASSIGNMENT lease -> assignment envelope (OFFERED)
  -> session ACK -> heartbeat / lease renewal -> WORKING -> READY_FOR_REVIEW (slot released) -> refill
  loss: heartbeat timeout -> session LOST -> AGENT_MARK_LOST -> unclaim | handoff + TASK_TRANSFER -> replacement
```

The runtime does **not** duplicate the engine. Task, AgentState, Reservation, Lease, Evidence, Handoff,
CAS, the scheduler and recovery all stay in `tools/workforce/src/engine.mjs` and friends. The runtime
adds only:

| Module | Role |
|---|---|
| `tools/workforce/src/session-runtime.mjs` | durable session registry, session/assignment state machines, registration checks, short-lived session credentials (digest-only), secret guard |
| `tools/workforce/src/assignment-runtime.mjs` | Manager loop (assign-ready, reconcile/recovery, status, live gate) and the session protocol (register, ready, heartbeat, poll, claim, reject, report, drain) — every mutation is a `ControlPlane.execute()` command |
| `tools/arena-session/transport.mjs` | replaceable transport: `http` (localhost / VPS polling) and `inproc`; unknown kinds fail closed |
| `tools/arena-session/worker.mjs` | `arena worker start --agent AGENT-0X` session client |

Sessions are **not** identities and **not** the `arena-executor` subprocess. A slot (`AGENT-01..10`) is
durable capacity; a session is one live attachment to it, and a slot can get new sessions after a loss
(`generation` increments). `tools/arena-bridge` (GitHub events -> executor queue) is unrelated and unchanged.

## Session states

`ONLINE -> IDLE -> ASSIGNED -> WORKING -> IDLE ...`, plus `DRAINING -> OFFLINE`, and `LOST` (terminal).
Only a live, recently heartbeating `IDLE` session is ever offered work. Registration files and bootstrap
bundles never make a slot ONLINE.

## Assignment envelope

`assignmentId, taskId, agentId, sessionId, leaseId, reservationIds, taskRevision, mainSha, branch,
taskManifestDigest, createdAt, expiresAt, status, idempotencyKey, policyDigest` (+ `ackDeadline`,
`resume`, `handoffId`, `manifest`). States: `OFFERED, ACKED, REJECTED, RUNNING, WAITING_EXTERNAL,
READY_FOR_REVIEW, FAILED, EXPIRED, CANCELLED, COMPLETED`. `assignmentId = ASN-<leaseId>`: one lease per
assignment by construction. Envelopes are screened for credentials and rejected (fail closed) if any
secret-like value or credential-named field is present.

## Authority

| Actor | May |
|---|---|
| Session (engine `WORKER` identity of its slot) | ACK its own offer, report progress / state / READY_FOR_REVIEW (exact head SHA), renew **its own** lease via heartbeat, publish a failure handoff, drain |
| Manager loop (`MANAGER`) | TASK_ASSIGN from scheduler recommendations, TASK_UNCLAIM, AGENT_MARK_LOST, HANDOFF_PUBLISH + TASK_TRANSFER for recovery, AGENT_RECOVER, AGENT_ACTIVATE |

Error contract (engine codes): wrong agent/session/lease `FORBIDDEN`; bad credential `UNAUTHORIZED`;
expired lease or ACK deadline `LEASE_EXPIRED`; stale task revision `REVISION_CONFLICT`; duplicate ACK is an
idempotent success; same idempotency key with a different payload `IDEMPOTENCY_CONFLICT`.

## Operating it

```bash
# Manager host (holds the control-plane store; never hands out GitHub/owner credentials)
node tools/workforce/src/cli.mjs worker-bootstrap --url http://127.0.0.1:8795 --out <bundle-dir>
node tools/workforce/src/cli.mjs runtime-serve --host 127.0.0.1 --port 8795 \
     --manager-loop-ms 5000 --main <verified-main-sha> --fill 10
node tools/workforce/src/cli.mjs runtime-status            # slot/session/task/lease matrix + acceptance status
node tools/workforce/src/cli.mjs assign-ready --fill 10 --main <sha>   # one Manager pass by hand
node tools/workforce/src/cli.mjs runtime-reconcile --main <sha> [--dry-run true]
node tools/workforce/src/cli.mjs runtime-gate [--record true]          # live acceptance gate (observed events only)

# Worker host / Arena session (bundle copied to <workspace>/.arena-session/bootstrap.json, mode 0600)
npm run arena:worker -- start --agent AGENT-03                # register -> heartbeat -> poll -> claim -> execute -> report
npm run arena:worker -- report --agent AGENT-03 --status READY_FOR_REVIEW --head <sha> --pr <n>
npm run arena:worker -- drain --agent AGENT-03
```

`start` writes the claimed envelope to `<workspace>/.arena-session/assignment.json` so the live session
reads its task directly (no manual copy-paste). With `--exec "<cmd>"` the client runs the command with
`ARENA_ASSIGNMENT_FILE / ARENA_TASK_ID / ARENA_BRANCH / ARENA_BASE_SHA / ARENA_WORKSPACE` and reports
`READY_FOR_REVIEW` from a `HEAD=<sha>` (and optional `PR=<n>`) line, or `FAILED` otherwise.

Defaults: heartbeat every 30 s; session LOST after the policy LOST-candidate age (1800 s) unless the
Manager configures `--lost-after`; lease renewed by heartbeat only when less than half its TTL remains;
the slot heartbeat is mirrored into the engine at most every 300 s. Polling waits never exceed 1 s.

## Acceptance status

`NOT_BOOTSTRAPPED -> BOOTSTRAPPING -> PARTIAL -> READY`, plus `DEGRADED` and `FAILED`. `READY` requires
ten live sessions **and** a recorded live gate `PASS`, computed only from observed runtime events of
sessions registered over `http` as `sessionKind: arena-session`. Local-harness sessions never satisfy
the gate. `sessionKind` is declared by the session at registration (attestation, not proof); evidence
must name the sessions.

## Limitations

- Transport security is the network boundary plus per-session credentials; run `runtime-serve` on
  localhost or behind TLS. There is no mTLS.
- Each engine command (including the throttled slot heartbeat) leaves an idempotency record in the
  control-plane store; long-running operation needs engine idempotency retention (not part of this change).
- A lost slot's work transfers to a *different* slot (TASK_TRANSFER forbids the same owner); if the only
  live session is the lost slot's replacement, recovery waits (`WAITING_SESSION`).
- `READY_FOR_REVIEW` releases the session; merge, verification and completion stay with the Manager.
