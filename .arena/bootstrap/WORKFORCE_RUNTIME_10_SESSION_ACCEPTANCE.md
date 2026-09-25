# Workforce runtime — 10-session acceptance evidence (#295)

**Acceptance status: `PARTIAL`, not `READY`.** The runtime bridge is implemented and has been exercised
with real processes on one host. **0 live Arena sessions are attached.** The §20 live gate has **not**
been run against Arena sessions, and nothing below claims it has.

| Field | Value |
|---|---|
| Main SHA (base, verified) | `7d1203676f7f45ab2ca34c6355d1df79d6096d05` |
| Implementation commit | `c9b594b987f401c29533ac586128fc9477bc33ac` (branch `arena/manager/workforce-session-runtime`) |
| Runtime version / protocol | `1.0.0` / protocol `1` |
| Live Arena sessions attached | **0** |
| Local-harness sessions observed | 11 (10 initial + 1 replacement), `sessionKind: local-harness` |
| Live gate (`runtime-gate`) | `NOT_MET`: 0/10 criteria met. Local-harness sessions are excluded by design |
| Status model | `NOT_BOOTSTRAPPED -> BOOTSTRAPPING -> PARTIAL -> READY` (+ `DEGRADED`, `FAILED`) |

Evidence classes used below: **tested** (automated tests), **observed-local** (local harness with real
processes, not Arena), **not observed** (requires live Arena sessions).

## 1. What was built

| Chain step (#295 §5) | Where | Class |
|---|---|---|
| reconcile and reap expired leases | `WorkforceRuntime.reconcile` -> `applySafeRecovery` + session and envelope sync | tested, observed-local |
| load READY tasks, discover IDLE sessions | `assignReady`: only slots with a fresh live `IDLE` session are passed to the pure `plan()` | tested, observed-local |
| TASK_ASSIGN -> lease -> envelope | Manager `TASK_ASSIGN`, then envelope `ASN-<leaseId>` (OFFERED) plus durable inbox file | tested, observed-local |
| ACK / heartbeat / WORKING | session `claim`, `heartbeat` (own-lease `LEASE_RENEW`), `report` | tested, observed-local |
| loss / recovery / release / refill | session LOST -> `AGENT_MARK_LOST` -> `TASK_UNCLAIM` or `HANDOFF_PUBLISH` + `TASK_TRANSFER` -> `AGENT_RECOVER` / `AGENT_ACTIVATE`; `READY_FOR_REVIEW` releases the slot -> next `assign-ready` refills it | tested, observed-local |

No second authority: every Task / AgentState / Lease / Reservation / Handoff mutation is a
`ControlPlane.execute()` command. A session acts as its slot's `WORKER` identity; the Manager loop acts
as `MANAGER`. The scheduler is unchanged.

## 2. Local harness run (observed-local, NOT Arena sessions)

Command: `node tools/arena-session/local-harness.mjs --main 7d1203676f7f45ab2ca34c6355d1df79d6096d05 --dir <scratch>`
at commit `c9b594b9`. The run used:
- 1 `runtime-serve` process (Manager loop every 1 s);
- 10 `worker.mjs start` processes over HTTP, each committing in its own git repo inside the slot workspace;
- heartbeat 3 s, loss threshold 15 s, lease renewal below 3595 s (harness settings, so a 30 s run exercises renewal).

The same result was reproduced in three runs.

### 10-worker matrix (final state of the run)

| Slot | Session (final) | Gen | Session state | Tasks offered (in order) | Slot state |
|---|---|---|---|---|---|
| AGENT-01 | harness-agent-01-g2-mugqiqlr | 2 | IDLE | TASK-0001 (session g1, SIGKILLed) | AVAILABLE |
| AGENT-02 | harness-agent-02-g1-mugqibzn | 1 | IDLE | TASK-0002, TASK-0012 | AVAILABLE |
| AGENT-03 | harness-agent-03-g1-mugqibzo | 1 | IDLE | TASK-0003, TASK-0015 | AVAILABLE |
| AGENT-04 | harness-agent-04-g1-mugqibzs | 1 | IDLE | TASK-0004, TASK-0011 | AVAILABLE |
| AGENT-05 | harness-agent-05-g1-mugqibzu | 1 | IDLE | TASK-0005, **TASK-0001 (resume)** | AVAILABLE |
| AGENT-06 | harness-agent-06-g1-mugqic06 | 1 | IDLE | TASK-0006, TASK-0014 | AVAILABLE |
| AGENT-07 | harness-agent-07-g1-mugqic0e | 1 | IDLE | TASK-0007, TASK-0013 | AVAILABLE |
| AGENT-08 | harness-agent-08-g1-mugqic0y | 1 | IDLE | TASK-0008 | AVAILABLE |
| AGENT-09 | harness-agent-09-g1-mugqic16 | 1 | IDLE | TASK-0009 | AVAILABLE |
| AGENT-10 | harness-agent-10-g1-mugqic1t | 1 | IDLE | TASK-0010 | AVAILABLE |

Runner class `ANY` and workspace `<scratch>/ws/AGENT-XX` apply to every row.

### Counts (from the runtime event log and the scratch control-plane store)

| Item | Observed-local |
|---|---|
| Sessions registered / first heartbeat | 11 / 11 |
| Assignments offered / ACKed | 16 / 16 (15 fresh + 1 recovery resume) |
| Maximum concurrent ACKed assignments | 10 |
| Lease renewals through heartbeat | 15 |
| Tasks delivered `READY_FOR_REVIEW` with a real commit head | 15 / 15 (none `COMPLETED`: completion stays with the Manager) |
| Refills (slot received new work after delivering) | 6: 5 new tasks (AGENT-04 TASK-0011, AGENT-02 TASK-0012, AGENT-07 TASK-0013, AGENT-06 TASK-0014, AGENT-03 TASK-0015) + 1 recovery resume (AGENT-05 TASK-0001) |
| Runtime integrity findings / engine reconcile findings | 0 / 0 |

### Loss -> recovery -> replacement (event sequence)

| Seq | Event | Detail |
|---|---|---|
| t+3.1 s | worker process group of AGENT-01 `SIGKILL`ed mid-task | session `harness-agent-01-g1-mugqibzl`, TASK-0001 WORKING |
| 97 | `SESSION_LOST` | reason `HEARTBEAT_TIMEOUT`, heartbeat age 16 s |
| 98 | `ASSIGNMENT_ENDED` | `ASN-LEASE-0001` RUNNING -> EXPIRED (`SESSION_LOST`) |
| 99 | `SLOT_MARKED_LOST` | Manager `AGENT_MARK_LOST AGENT-01`: TASK_ASSIGNMENT lease revoked, reservations preserved |
| 101 | `RECOVERY_TRANSFERRED` | Manager `HANDOFF_PUBLISH` HND-0001 + `TASK_TRANSFER` TASK-0001 -> AGENT-05; envelope `ASN-LEASE-0013` (resume) |
| 102 | `SLOT_RECOVERED` | AGENT-01 LOST -> STOPPED |
| t+20 s | AGENT-01 worker restarted | new session `harness-agent-01-g2-mugqiqlr` (generation 2) |
| 110 | `SLOT_ACTIVATED` | Manager `AGENT_ACTIVATE AGENT-01` (STOPPED -> AVAILABLE) |

TASK-0001 was resumed by AGENT-05 from its preserved state and head, and delivered READY_FOR_REVIEW. It
was never auto-completed. The generation-2 session of AGENT-01 was activated, but it received **no** new
task in the run window: the scheduler's fairness sent the three wave-2 tasks to longer-idle slots. That
slot receiving work again is **tested** (`assignment-runtime.test.mjs`, "a new session on a lost slot
reactivates it"), but it was not observed-local.

## 3. Automated tests (tested)

`node --test tools/workforce/test/*.test.mjs`: **140/140** (104 existing + 36 new) on the implementation
commit. The same tree also gave: backend 2422/2422, frontend 451/0 (1 skipped), gates 7/7 and
sublego-audit PASS.

| #295 §19 group | Covered by |
|---|---|
| Registration: 10 valid, duplicate, invalid agent / protocol / workspace, plus branch, capability, runner, enrollment | `session-runtime.test.mjs` |
| Assignment: READY, non-READY, no session, stale revision, reservation conflict, double assignment | `assignment-runtime.test.mjs` |
| Authorization: cross-agent / cross-session claim, worker creating an assignment, worker governance commands, expired lease, foreign-lease heartbeat | both files |
| Idempotency: ACK, heartbeat (no double renewal), key conflict | both files |
| Recovery: timeout, LOST, lease expiry, ACK timeout, requeue, transfer + resume, replacement session, failure handoff, reject | `assignment-runtime.test.mjs` |
| Concurrency: 10 sessions / 10 distinct planned tasks, 10 concurrent WORKING, backpressure on the 11th | `assignment-runtime.test.mjs` |
| Transport: HTTP two-worker concurrent run, fail-closed transport, bearer-only credential, CLI | `runtime-transport.test.mjs` |

### Negative proofs (tested)

| Attempt | Result |
|---|---|
| Claim of another slot's or another session's assignment, or with a foreign lease | `FORBIDDEN` |
| Claim after the lease expired or after the ACK deadline | `LEASE_EXPIRED` |
| Claim with a task revision older than the current one | `REVISION_CONFLICT` |
| Same idempotency key with a different payload (ACK, heartbeat) | `IDEMPOTENCY_CONFLICT` |
| Heartbeat carrying another session's assignment or lease; direct `LEASE_RENEW` of a foreign lease | `FORBIDDEN` |
| Worker `TASK_ASSIGN`, `AGENT_REGISTER`, `AGENT_MARK_LOST` or `TASK_UNCLAIM` through the engine | `FORBIDDEN` / `GOVERNANCE_REQUIRED` |
| Registration: `AGENT-11`, `agent-01`, protocol `2`, another slot's workspace, `..`, branch `main`, self-granted capability, foreign or expired enrollment | rejected; no session is created |
| Task or report containing a credential-shaped value | `POLICY_DENIED` before `TASK_ASSIGN`; the value is never echoed or stored |
| Unknown transport kind; body token without `Authorization` header | fail closed / `401` |

## 4. Live acceptance (§20): not observed

| Criterion | Status |
|---|---|
| 10 Arena sessions registered and ONLINE | **not observed** (0 attached) |
| ≥2 concurrent assignments on Arena sessions | not observed (observed-local: 10) |
| Real Arena session IDs | not observed |
| ACK / heartbeat / lease renewal on Arena sessions | not observed (observed-local: 16 / 11 / 15) |
| Session loss, recovery and replacement on Arena sessions | not observed (observed-local: 1 / 1 / 1) |
| Refill on Arena sessions | not observed (observed-local: 5 new + 1 resume) |

To pass, each Arena chat session runs `npm run arena:worker -- start --agent AGENT-0X` with its bundle,
against a `runtime-serve` endpoint it can reach. Then `runtime-gate --record true` must return `PASS`.
Only then can `runtime-status` report `READY`.

## 5. Limitations

- **Session kind is declared, not proven.** `sessionKind: arena-session` is self-declared at
  registration. The gate additionally requires the `http` transport, and the evidence must name the sessions.
- **Reachability is unverified.** Arena chat sandboxes need a reachable runtime endpoint (localhost
  inside the same host, or a VPS with TLS). This was not verified from an Arena session.
- **Engine idempotency growth.** Each engine command, including the slot heartbeat throttled to at most
  one per 300 s, leaves an idempotency record in the control-plane store. Long-running operation needs a
  retention policy in the engine (follow-up).
- **Same-slot resume.** A lost slot's work transfers only to a *different* slot. If the replacement
  session of the same slot is the only one live, recovery waits (`WAITING_SESSION`).
- **Harness timing.** The harness used short timings (heartbeat 3 s, loss 15 s, renewal below 3595 s).
  The defaults follow the policy: heartbeat 30 s, loss 1800 s, renewal below half the TTL.
- **Not merged.** Per #295, the author does not merge. Completion (§24) requires the live gate plus
  merge and main re-verification.
