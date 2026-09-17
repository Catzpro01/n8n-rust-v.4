# TASK-GATE-VERIFY-01 — close the live 11/11 gap: the integration gate can now return PASS

**Agent:** 5 (`arena/01a0aff6-n8n-rust-v-4`)
**Date:** 2026-09-18
**Ledger:** ISSUE-029 (HIGH, found and fixed)

## Summary

Every result file and commit message in this repository cites an "11/11 live regression gate", and
every gate run I had done reported it as `NOT RUN` with the gate `INCONCLUSIVE`. The cause was not
a missing environment: `run_gate.sh` Stage 3 was titled `11/11 LIVE REGRESSION GATE` but ran
`tests/integration/regression_gate.py`, which sets `total_checks = 5` and probes a running n8n on
`127.0.0.1:5678` plus `docker exec n8n-db-1 psql`. The real 11/11 is gate **G11 of 11** in
`tools/workflow-isolation-gate.mjs`, which needs the pinned reference runtime and not docker at
all. Because Stage 3 was gated on `command -v docker`, the success state was unreachable — the
gate could only ever exit 2. Fixing the label, adding a provenance-checked Stage 3b that consumes
the real evidence, and recording git provenance in that evidence produced the first
`>>> INTEGRATION GATE: PASS <<<` (exit 0) with `LIVE 11/11 : PASS`.

## What was wrong

```text
docker absent  ->  Stage 3 SKIPPED  ->  live="NOT RUN"  ->  exit 2 INCONCLUSIVE, always
```

Meanwhile `npm run verify` was reporting `gates: 11/11 PASS`. The two were never connected.

A second, quieter defect: **none** of the 8 files in `docs/isolation/evidence/` carried any git
provenance (checked each one — `git keys: NONE` across `gate-report.json`,
`live-verification.json`, `model-digest.comparison.json`, `rust-test-record.json`,
`persistence-lego-gate.json`, `live-execution-record.json` and both archived gate reports). An
undated report was therefore indistinguishable from a fresh one, so consuming it as evidence
would have been exactly the "SUCCESS verdict with nothing behind it" failure of ISSUE-020.

## Fix

| change | file |
| :-- | :-- |
| Stage 3 renamed to `DOCKER + POSTGRES SMOKE (5 checks)`, reported on its own line | `tests/integration/run_gate.sh` |
| New **Stage 3b** consumes `gate-report.json`: requires `totals 11/11`, `behaviorChange NONE DETECTED`, `G11 PASS` | `tests/integration/run_gate.sh` |
| Evidence accepted only when attributable to the tree: `git diff --quiet <recorded> HEAD -- <inputPaths>` **and** `git status --porcelain -- <inputPaths>` | `tests/integration/run_gate.sh` |
| Records `git.headCommit / branch / dirtyInputs / inputPaths` | `tools/workflow-isolation-gate.mjs` |
| `OFFLINE STAGES` snapshotted before the live stages | `tests/integration/run_gate.sh` |

`inputPaths` = `packages/workflow-lego`, `tools/live`, `tests/reference`,
`reference/n8n/packages/workflow` — the paths the 11 gates actually read. This is the same
freshness rule `tools/phase3-rust-acceptance.sh` already established for Stage 2b, so the gate now
has one consistent notion of "this evidence belongs to this tree".

## Evidence

Environment first: the sandbox had been re-provisioned without `.runtime` and without
`packages/workflow-lego/node_modules`. In that state `npm run verify` reports **5/11 PASS** with
failures that look like code defects (`typescript missing`, `reference runtime not found`) but are
not. `bash scripts/setup-all.sh` → exit 0, 886 runtime packages (n8n-workflow/core/nodes-base
2.9.1, flatted 3.2.7, nanoid 3.3.8) + 92 workflow-lego packages.

```console
$ npm run verify
[PASS] G01 … G11
gates: 11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED          (exit 0)

$ bash tests/integration/run_gate.sh
RESULT: 43/43 CHECKS PASSED                                 # Stage 1
AUDIT RESULT: PASS (all edges documented)                   # Stage 2
RESULT: 7/7 crates with usable compatibility tests          # Stage 2c
RESULT: 8/8 CHECKS PASSED                                   # Stage 2d
RESULT: 11/11 CHECKS PASSED                                 # Stage 2e self-test
OFFLINE STAGES : PASS
LIVE 11/11     : PASS (11/11 at f694e493, G11 live verified)
DOCKER SMOKE   : NOT RUN
>>> INTEGRATION GATE: PASS <<<                              exit 0
```

G11 live detail (`docs/isolation/evidence/live-verification.json`, 7/7):

| id | check |
| :-- | :-- |
| R0 | reference runtime fingerprint (n8n-core/nodes-base/workflow 2.9.1) |
| R1 | workflow load |
| R2 | workflow save / serialize / reload (checksum `2472af3ea3ee4152…`) |
| R3 | manual execution — 1 node (`manualTrigger`) |
| R4 | manual execution — linear (Manual Trigger → Set) |
| R5 | webhook workflow — HTTP POST → Webhook node → engine → HTTP response |
| R6 | execution record written (harness-level persistence) |

## Negative cases (each confirmed to exit 1 BLOCKED, not pass silently)

| injected fault | Stage 3b output |
| :-- | :-- |
| `headCommit` patched to `0000…0000` | `STALE/FAILED (inputs changed since 00000000 — re-run: npm run verify)` |
| evidence generated before provenance existed | `STALE/FAILED (evidence carries no headCommit — regenerate with: npm run verify)` |
| `// probe` appended to `packages/workflow-lego/package.json` **after** the run | `STALE/FAILED (gate inputs have uncommitted changes now: ['M packages/workflow-lego/package.json'])` |

The third row was a genuine hole in my first implementation: `dirtyInputs` records the tree as it
was when the report was *written*, so an edit made afterwards was accepted as fresh evidence — I
watched it print `PASS` with a dirty `package.json`. Found by running the negative case rather
than assuming it, then fixed and re-verified.

## Correction to an earlier claim of mine

In `results/TASK-POOL-VERIFY-02.md` I wrote, three times, that the live 11/11 "cannot run in this
sandbox (no live n8n / PostgreSQL)". That was wrong. The docker/Postgres **smoke** cannot run here;
the 11/11 live gate never needed it. `LIVE 11/11 : NOT RUN` was a labelling defect in the gate, not
an environment limit — which is exactly why it went unchallenged for so long.

## Still open

* `DOCKER SMOKE : NOT RUN` — the 5-check docker/Postgres smoke genuinely cannot run here (no
  docker, no `n8n-db-1` container). It is now reported separately rather than masquerading as the
  live regression, and it does not block the gate.
* Known limitation L1 in the live evidence stands: n8n 2.x executes Code nodes out of process and
  the task-runner broker could not be brought up in-sandbox, so Code-node execution is not covered
  by R0–R6.
* Orchestrator decisions unchanged: ISSUE-021 (two engines, one path), ISSUE-027 (PR #16 deletes
  `crates/`), ISSUE-028 (vote transport unusable on a shared App identity).
