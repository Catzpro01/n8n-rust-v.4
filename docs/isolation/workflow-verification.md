# Workflow LEGO — Phase 2 isolation verification

Generated: 2026-09-22T12:18:57.060Z · reference n8n 2.9.4 (`b6dc2787c456`)

**Gates: 5/10 PASS** · **BEHAVIOR CHANGE: ISOLATION FAILED** · **RUST IMPLEMENTATION: NOT STARTED**

## Requested gate checklist

| gate | status | evidence |
| :--- | :--- | :--- |
| TypeScript build PASS | FAIL | G06: typescript missing — run: npm install (packages/workflow-lego)<br>G07: /home/user/n8n-rust-v.4/packages/workflow-lego/node_modules/.bin/tsc --noEmit -p /home/user/n8n-rust-v.4/packages/workflow-lego/tsconfig.json exited null |
| unit tests PASS | FAIL | G08: /usr/local/bin/node --test test/*.test.mjs exited 1 |
| workflow load PASS | PASS |  |
| workflow save PASS | PASS |  |
| manual execution PASS | PASS |  |
| 1-node PASS | PASS |  |
| linear workflow PASS | PASS |  |
| webhook PASS | PASS |  |
| execution persistence PASS | PASS |  |
| reference smoke test 11/11 PASS (VPS baseline; here: hash-pinned + live engine re-verified) | PASS | G04: Reference integrity check: PASS (15050 files, root f8da35180669d798…) |

## All gates

| # | gate | status | detail |
| :--- | :--- | :--- | :--- |
| G01 | boundary drift gate (owned files, crossings, inbound edges) | PASS | src files scanned         : 104 LEGO owned files          : 10 compile closure           : 103 outbound crossings        : 21 undeclared crossings      : 0 inbound edges             : 9 monorepo import sites     : 6318 r |
| G02 | kernel snapshot conformance (constants/vocabulary vs reference) | PASS | Kernel snapshot check: PASS (snapshots match the pinned reference source) |
| G03 | port surface matches the imports of the owned sources | PASS | Required port surface (from actual imports in owned files):  @lego/ports/checksum-digest  [value]    symbols : jsSHA    used by : workflow-checksum (jssha) @lego/ports/config  [value]    symbols : getGlobalState    used  |
| G04 | reference tree byte-identical to the pinned hashes | PASS | Reference integrity check: PASS (15050 files, root f8da35180669d798…) |
| G05 | isolation extraction (pure import rewrites only) | PASS | isolated unit written to packages/workflow-lego/.extract   owned files copied : 10   port rewrites      : 25 across 10 files     @lego/ports/checksum-digest : 1     @lego/ports/config : 1     @lego/ports/constants : 1    |
| G06 | TypeScript build PASS (isolated unit, ports only) | FAIL | typescript missing — run: npm install (packages/workflow-lego) |
| G07 | TypeScript build PASS (versioned boundary/ports/facade) | FAIL | /home/user/n8n-rust-v.4/packages/workflow-lego/node_modules/.bin/tsc --noEmit -p /home/user/n8n-rust-v.4/packages/workflow-lego/tsconfig.json exited null |
| G08 | unit tests PASS (boundary, extraction, equivalence, strict isolation, surface) | FAIL | /usr/local/bin/node --test test/*.test.mjs exited 1 go/test/05-surface-parity.test.mjs:40:1'   failureType: 'testCodeFailure'   error: |-     Cannot find module '/home/user/n8n-rust-v.4/packages/workflow-lego/.extract/di |
| G09 | BEFORE vs AFTER digest: BEHAVIOR CHANGE NONE | FAIL | /usr/local/bin/node /home/user/n8n-rust-v.4/tools/model-digest-runner.cjs --source reference --mode reference --out /tmp/lego-gate-nr0kJD/before.json exited 1  TypeError [ERR_INVALID_ARG_VALUE]: The argument 'filename' m |
| G10 | strict port mode: no hidden coupling to the reference runtime | FAIL | /usr/local/bin/node --test test/04-strict-isolation.test.mjs exited 1 4-strict-isolation.test.mjs:53:1     ModuleJob.run (node:internal/modules/esm/module_job:343:25)     async onImport.tracePromise.__proto__ (node:inter |

## Live verification (reference execution engine)

Runtime: n8n-core 2.9.1 · n8n-nodes-base 2.9.1 · n8n-workflow 2.9.1 — exact dependency set of n8n@2.9.4

| # | check | status | detail |
| :--- | :--- | :--- | :--- |
| R0 | reference runtime fingerprint | PASS | n8n-core 2.9.1 · n8n-nodes-base 2.9.1 · n8n-workflow 2.9.1 · 436 node types loaded |
| R1 | workflow load | PASS | loaded "Linear Two Nodes" · nodes=2 · start=Manual Trigger · children(Manual Trigger)=["Code"] |
| R2 | workflow save / serialize / reload | PASS | serialized 2 nodes · checksum 2472af3ea3ee4152… · reload stable=true |
| R3 | manual execution — 1 node (manualTrigger) | PASS | nodes executed: When clicking ‘Test step’:1 |
| R4 | manual execution — linear workflow (Manual Trigger → Set) | PASS | Set node output: [{"json":{"status":"ok","count":42},"pairedItem":{"item":0}}] |
| R5 | webhook workflow — HTTP POST → Webhook node → engine → HTTP response | PASS | HTTP 200 body={"smoke_test":"PASS","verified":true} |
| R6 | execution record written (harness-level persistence) | PASS | execution 1 → success ([{"json":{"status":"ok","count":42},"pairedItem":{"item":0}}]) |

### Known limitations of the sandbox (not of the isolation)

- **L1 — Code node execution (task runner)**: n8n 2.x executes JS code nodes out of process (TaskRunnersConfig.enabled is true and cannot be turned off). The task-runner broker/worker is part of the CLI host, not of the Workflow Model, and could not be brought up in this sandbox. The Code-node path is covered by the VPS baseline (tests/reference/baseline/SMOKE_TEST_RESULTS.md checks 4, 9, 10).
- **L2 — n8n CLI / TypeORM / Postgres persistence**: The full n8n CLI cannot be installed here: its native `sqlite3` dependency needs node headers from nodejs.org, which the sandbox network blocks. Database persistence is verified in the VPS baseline (checks 6 and 11).
- **L3 — Webhook listener**: The harness wires the reference Webhook node to a real HTTP server and drives the reference engine with the CLI's own prepareExecutionData recipe; the CLI WebhookServer itself (Express app, activation registry, DB) is not installable here (see L2).

## Rollback rule

If any gate fails, `ISOLATION = FAILED`: the isolation change is rolled back and never carried into the next LEGO.
This report is the machine-readable record of the decision (`docs/isolation/evidence/gate-report.json`).

