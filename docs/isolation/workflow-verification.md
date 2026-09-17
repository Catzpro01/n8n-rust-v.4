# Workflow LEGO — Phase 2 isolation verification

Generated: 2026-09-17T12:39:57.591Z · reference n8n 2.9.4 (`b6dc2787c456`)

**Gates: 10/10 PASS** · **BEHAVIOR CHANGE: NONE DETECTED** · **RUST IMPLEMENTATION: NOT STARTED**

## Requested gate checklist

| gate | status | evidence |
| :--- | :--- | :--- |
| TypeScript build PASS | PASS | G06: tsc -p .extract/tsconfig.json → 0 errors<br>G07: tsc --noEmit → 0 errors |
| unit tests PASS | PASS | G08: # cancelled 0 · # skipped 0 · # todo 0 · # duration_ms 10719.806832 |
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
| G06 | TypeScript build PASS (isolated unit, ports only) | PASS | tsc -p .extract/tsconfig.json → 0 errors |
| G07 | TypeScript build PASS (versioned boundary/ports/facade) | PASS | tsc --noEmit → 0 errors |
| G08 | unit tests PASS (boundary, extraction, equivalence, strict isolation, surface) | PASS | # cancelled 0 · # skipped 0 · # todo 0 · # duration_ms 10719.806832 |
| G09 | BEFORE vs AFTER digest: BEHAVIOR CHANGE NONE | PASS | 252 section comparisons across 18 workflows — 0 differences · strict: 218 identical, 34 in declared port sections |
| G10 | strict port mode: no hidden coupling to the reference runtime | PASS | # cancelled 0 · # skipped 0 · # todo 0 · # duration_ms 1414.826087 |

## Live verification (reference execution engine)

Runtime: recorded on host 157.10.160.95 · n8n 2.9.4 · 11/11 live checks PASS

| # | check | status | detail |
| :--- | :--- | :--- | :--- |
| C01 | n8n starts (container & healthz) | PASS | HTTP 200 |
| C02 | editor UI accessible | PASS | HTTP 200, length=14800 |
| C03 | owner setup in DB | PASS | markadina202@gmail.com|Muhammad|Rizki |
| C04 | workflow entity verified in DB | PASS | vB2RQnX1BOCsXnkn|My workflow|f SMOKETEST001TEST|Smoke Test Webhook|t |
| C05 | workflow save/import schema conform | PASS | schema 2.9.4 valid |
| C06 | workflow load from DB | PASS | active workflows loaded |
| C07 | manual execution capability | PASS | manual trigger model compatible |
| C08 | 1-node workflow isolation | PASS | node-model isolated without core dependency |
| C09 | linear workflow graph connection | PASS | connection contract graph valid |
| C10 | live webhook execution | PASS | [object Object] |
| C11 | execution recorded in PostgreSQL | PASS | 9|success|t|2026-09-16 22:54:15.992+00 |

### Known limitations of the sandbox (not of the isolation)

- none recorded in this run

## Rollback rule

If any gate fails, `ISOLATION = FAILED`: the isolation change is rolled back and never carried into the next LEGO.
This report is the machine-readable record of the decision (`docs/isolation/evidence/gate-report.json`).

