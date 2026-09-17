# TASK RESULT: TASK-ENGINE-ACTIVATION-01

- **STATUS**: `SUCCESS`
- **AGENT**: `arena-worker`
- **LEGO COMPONENT**: `execution` (activation lifecycle)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18 (UTC) — see git log`

---

### Summary (3–5 kalimat)

Sisi *aktivasi* dari execution LEGO direkonstruksi 1:1 dari n8n 2.9.4: `ActiveWorkflows`
(add/remove/closeTrigger/createPollExecuteFn), `TriggersAndPollers` (runTrigger dengan
`manualTriggerResponse` + override emit/emitError/saveFailedExecution, dan runPoll), `TriggerContext`
(default emit yang melempar, `getActivationMode`, batas `getCredentials`), `ExecutionLifecycleHooks`
(penyimpan 8 hook dengan `addHandler`/`runHook`), `toCronExpression`, dan `ScheduledTaskManager`
tanpa dependensi `cron`. Sebelumnya loop hanya bisa *memanggil* `nodeType.trigger`/`poll` di dalam
sebuah run; sekarang sebuah workflow bisa benar-benar diaktifkan, dijadwalkan ulang oleh cron
adapter, dan dideaktivasi dengan penutupan trigger yang benar. Suite baru `05-activation.test.mjs`
(20/20) diport dari dua berkas oracle referensi (`triggers-and-pollers.test.ts`,
`active-workflows.test.ts`) plus pin quirk yang tidak diuji oracle (`saveFailedExecution` →
reject, pemetaan `cause` `WorkflowActivationError`, hook yang melempar menghentikan sisanya).
Gate naik ke `10/10` (`E10` baru) dan `E08` kini menutup 60 simbol; `verify:all` exit 0, konformansi
`42/42`, boundary `PASS`. Tidak ada berkas `reference/n8n/**`, `crates/**`, `apps/**`, frontend, atau
paket peer (connection/expression/reconstructed-engine/workflow-lego) yang disentuh.

### Evidence

- `node --test packages/execution-engine/test/*.test.mjs` → `# tests 60, # pass 60, # fail 0`
  (POOL-001 14, POOL-002 7, POOL-003 12, sandbox 7, **ACTIVATION 20**)
- `node tools/execution-engine-gate.mjs` → `Execution LEGO gate: 10/10 PASS`
  (`E08 … 60 exported symbols documented`, `E10 activation lifecycle … 20 pass / 0 fail`)
- `npm run verify:all` → exit `0` (`isolation:check` + `reconstructed-engine:test` 28/28 + `execution:gate` 10/10 + `connection-lego:test` 52/52)
- `node tests/compatibility/contract_conformance.mjs` → `RESULT: 42/42 CHECKS PASSED` (exit 0)
- `python3 tests/integration/boundary_audit.py` → `AUDIT RESULT: PASS` (exit 0)
- `node tools/workflow-reference-manifest.mjs --check` → `PASS (15050 files, root f8da35180669)`

### What was reconstructed (all read-only against the reference)

| File | Reference | Lines |
| :--- | :--- | :--- |
| `src/lifecycle-hooks.mjs` | `execution-lifecycle-hooks.ts` (handlers table, `addHandler`, `runHook`) + `workflow/src/deferred-promise.ts` | L88-134, L10-17 |
| `src/triggers-and-pollers.mjs` | `triggers-and-pollers.ts` (`runTrigger` incl. manual mode, `runPoll`) | L29-111 |
| `src/active-workflows.mjs` | `active-workflows.ts` (whole class), `scheduled-task-manager.ts` (cron-free parts), `workflow/src/cron.ts` (`toCronExpression`) | L53-288, L40-161, L52-72 |
| `src/trigger-context.mjs` | `node-execution-context/trigger-context.ts` | L14-63 |
| `src/errors.mjs` (+4 classes) | `errors/{workflow-activation,workflow-deactivation,trigger-close}.error.ts`, `errors/base/user.error.ts` | full |
| `src/workflow.mjs` (+3 methods) | `workflow/src/workflow.ts` (`queryNodes`, `getTriggerNodes`, `getPollNodes`, `timezone`) | L132, L254-295 |

Pinned behaviours beyond the two oracle suites:

* `saveFailedExecution(error)` rejects the manual response (`triggers-and-pollers.ts` L84-86) — no data is resolved.
* The missing-`hooks` failure surfaces as a **rejected `manualTriggerResponse`**, because the reference `assert.ok` runs inside the promise executor; the emit overrides are never installed (pinned by test).
* `WorkflowActivationError` copies an `ApplicationError` cause into a **plain Error** keeping name/message/stack (`workflow-activation.error.ts` L19-27), and derives `level` from the message (timeout/refused/auth ⇒ `warning`). The `UserError` for a too-short interval therefore reaches `add()`'s wrapper as a *named* plain Error, not as a `UserError` instance — asserted explicitly.
* A `TriggerCloseError` during `closeFunction` is logged + reported and does **not** fail the deactivation; any other error becomes `WorkflowDeactivationError` (L224-249).
* Poll activation order: initial test run **first**, then the `*`-interval check, then one registration per trigger time — so an invalid interval never registers a cron.

### Deliberate boundaries (documented in `contracts/execution.contract.md` §7 deltas 10-12)

1. **Cron scheduling is an adapter.** The reference wraps the `cron` package; gate `E01` forbids runtime dependencies, so `registerCron(ctx, onTick)` / `deregisterCrons(workflowId)` is the boundary and `ScheduledTaskManager` reproduces keying, summaries and the duplicate guard, with the timer injectable.
2. **TriggerContext helpers**: only `createDeferredPromise` + `returnJsonArray`; the SSH-tunnel/request/binary/scheduling families belong to other LEGOs.
3. **`getCredentials()`** uses an injected credentials adapter when supplied, otherwise raises the existing boundary warning error.
4. **Webhook HTTP servers** (`packages/cli/src/webhooks/**`) remain out of scope — the activation LEGO stops at the node-function boundary, as the reference does.

---

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | :--- |
| `read_reference` (triggers-and-pollers.ts, active-workflows.ts, scheduled-task-manager.ts, execution-lifecycle-hooks.ts, cron.ts, workflow.ts, 4 error classes) | ✓ SUCCESS | `0` |
| `read_reference` (oracle suites: triggers-and-pollers.test.ts, active-workflows.test.ts) | ✓ SUCCESS | `0` |
| `write_file` (src/lifecycle-hooks.mjs, src/triggers-and-pollers.mjs, src/active-workflows.mjs, src/trigger-context.mjs) | ✓ SUCCESS | `0` |
| `edit_file` (src/errors.mjs +4 classes, src/workflow.mjs +queryNodes/getTriggerNodes/getPollNodes/timezone, src/index.mjs +12 exports) | ✓ SUCCESS | `0` |
| `write_file` (test/05-activation.test.mjs, 20 tests) | ✓ SUCCESS | `0` |
| `edit_file` (tools/execution-engine-gate.mjs: gate E10 + report pool entry) | ✓ SUCCESS | `0` |
| `run_shell` (`node --test packages/execution-engine/test/*.test.mjs` 60/60) | ✓ SUCCESS | `0` |
| `run_shell` (`node tools/execution-engine-gate.mjs` 10/10) | ✓ SUCCESS | `0` |
| `run_shell` (`npm run verify:all`) | ✓ SUCCESS | `0` |
| `run_shell` (`contract_conformance.mjs` 42/42) | ✓ SUCCESS | `0` |
| `run_shell` (`boundary_audit.py` PASS) | ✓ SUCCESS | `0` |
| `edit_file` (contracts/execution.contract.md: surface + §6b + deltas 10-12 + ownership) | ✓ SUCCESS | `0` |
| `edit_file` (README, docs/isolation/execution.md, LEGO-MASTER-MAP, CROSS-AGENT-ISSUES note) | ✓ SUCCESS | `0` |
| `write_file` (results/TASK-ENGINE-ACTIVATION-01.md) | ✓ SUCCESS | `0` |

### Detailed Logs

#### Operation: `run_shell` (suite)

```text
$ node --test packages/execution-engine/test/*.test.mjs
# tests 60
# pass 60
# fail 0
  01-execution-loop 14 · 02-node-context-data-proxy 7 · 03-error-retry 12 · 04-expression-sandbox 7 · 05-activation 20
```

#### Operation: `run_shell` (gate)

```text
$ node tools/execution-engine-gate.mjs
[PASS] E01 … E09 (unchanged)
[PASS] E10 activation lifecycle: triggers, pollers, lifecycle hooks — 20 pass / 0 fail
Execution LEGO gate: 10/10 PASS
```

#### Operation: contract conformance + boundary

```text
$ node tests/compatibility/contract_conformance.mjs
RESULT: 42/42 CHECKS PASSED
$ python3 tests/integration/boundary_audit.py
AUDIT RESULT: PASS (all edges documented)
```

---

### Dual-phase review sweep (offline — Supabase `task_consensus_votes` unreachable, ISSUE-019)

| Phase | Target | Action | Verdict |
| :--- | :--- | :--- | :--- |
| 1 (before starting) | `results/TASK-405-phase3-connection-lego.md` (peer) | read-only re-run of every claim after a fresh clone: `connection-lego:test` 52/52, `expression-lego` 46/46 (after ISSUE-022 script fix), conformance 42/42, boundary PASS | EVIDENCE VALID — the "script missing" symptom I hit first was a **fresh-clone** artefact (`npm install` per package), not a defect; recorded here so the next worker does not re-diagnose it |
| 1 (before starting) | pool statuses | found `TASK-ENGINE-DIFF-01/02`, `TASK-ENGINE-CONSOLIDATE-01`, `TASK-ENGINE-DISABLED-01`, `TASK-ENGINE-ERROR-01` still advertising `AVAILABLE` although their result files were already merged (root cause of three concurrent runs on the same divergence set) | NEEDS_CORRECTION → FIXED earlier this session (`dcc78326`, peer merge `49885156`); no new correction needed |
| 2 (after finishing) | `contracts/execution.contract.md` | gate `E08` fails until every new export is documented — ran it *before* writing the contract (deliberate failing-first evidence) | PASS after the contract update: 60 symbols |
| 2 (after finishing) | `tools/execution-engine-gate.mjs` | new gate `E10` added for the activation suite | PASS 20/0; suite counts in the map/README refreshed |
| 2 (after finishing) | `docs/isolation/LEGO-MASTER-MAP.md` | stale POOL-003 cell said `11/11` while the suite has 12 tests since DIFF-02 | FIXED (12/12) |

No self-approval: the phase-1 targets are other workers' artefacts, every verdict is a re-run
command, and the gate that failed before my own contract edit was fixed by that edit — not waived.
