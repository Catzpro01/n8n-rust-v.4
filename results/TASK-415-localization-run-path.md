# TASK RESULT: TASK-415-localization-run-path

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-5`
- **LEGO COMPONENT**: `localization` (Phase 4F — the run path consumes the envelope)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18 UTC`
- **BASE**: `3e6e3fc5` (Phase 4E tip)

---

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | :--- |
| `write_file` (`localization-vocabulary.ts`) | ✓ SUCCESS | `0` |
| `write_file` (`execution-log-record.ts`) | ✓ SUCCESS | `0` |
| `write_file` (`api-error-response.ts`) | ✓ SUCCESS | `0` |
| `write_file` (`test/08-localization-run-path.test.ts`) | ✓ SUCCESS | `0` |
| `edit_file` (`localization-runtime.ts` — additive exports) | ✓ SUCCESS | `0` |
| `edit_file` (`src/index.ts` — additive export block) | ✓ SUCCESS | `0` |
| `edit_file` (`tools/localization-gate.mjs` — G1/G8 widened, G12–G14 added) | ✓ SUCCESS | `0` |
| `edit_file` (`tools/localization-inspect.mjs` — `--record`, `--api-error`) | ✓ SUCCESS | `0` |
| `run_tests` (localization 77/77) | ✓ SUCCESS | `0` |
| `run_gate` (`localization-gate.mjs` 15/15) | ✓ SUCCESS | `0` |
| `run_gate` (`contract_conformance.mjs` 22/22) | ✓ SUCCESS | `0` |
| `run_gate` (`boundary_audit.py` PASS) | ✓ SUCCESS | `0` |
| `run_gate` (`isolation:check` 4/4) | ✓ SUCCESS | `0` |
| `run_gate` (`run_gate.sh --offline-only`) | ✓ SUCCESS | `0` (gate itself exits `2` = INCONCLUSIVE by design) |
| `mutation_test` (M9–M12, restore) | ✓ SUCCESS | red → green |

### Detailed Logs

#### Operation: `run_tests` — the run path is machine-verified

```text
node --test packages/workflow-lego/test/{06,07,08}-*.test.ts
# tests 77
# pass 77
# fail 0
  06-localization-runtime.test.ts   33  (L1–L13)
  07-localization-envelope.test.ts  17  (E1–E10)
  08-localization-run-path.test.ts  27  (F1–F11)   ← new in Phase 4F
```

`08` was written **before** the gate was extended, and it immediately found a real defect: the first
`runSummary()` design appended a noun ("2 node **node**") on top of an already-localized label. The
design was corrected, not the assertion: the templates now render complete labels, all three parts are
required, and `droppedParts`/`isSummary` tell a caller what was missing (contract §4.10).

#### Operation: `run_gate` — 15/15 checks

```text
NATIVE LOCALIZATION GATE: PASS (15/15 checks) — evidence docs/isolation/evidence/localization-gate.json
  G1  77/77 PASS in 565ms
  G2/G3/G4/G5/G6/G7  catalog · keys · parity · real strings · rtl · status coverage
  G8  57 runtime + 26 type symbols promoted (UI module still excluded)
  G9  22 symbols loadable, unknown locale rejected with exit 2
  G10 14 engine/API keys x 6 locales      G10b envelope shape + 5 API error codes
  G11 envelope imports exactly ./localization-runtime.ts + ./backend-localization-service.ts
  G12 execution-log record: derived duration, localized summary/trigger, deterministic
  G13 5 codes x 6 locales + success/health + golden login payload
  G14 12 product keys x 6 locales, no 4B/4E collision, 3 modules in-package only
```

#### Operation: `run_cli` — the surface is runnable from a checkout

```text
$ node tools/localization-inspect.mjs --lang ar --record --status error --mode schedule
execution record — ar (rtl)
  line        : EX-DEMO-01 SMOKETEST001TEST [schedule] فشل بعد 25 م.ث — 2 عقدة، 3 عنصر
  trigger     : تم التشغيل بالجدولة
  duration    : 25 ms (from timestamps)
  diagnostics : 0 missing key(s)

$ node tools/localization-inspect.mjs --lang ru --api-error unauthorized
api error   — ru  HTTP 401
  body        : {"code":"unauthorized","message":"Не авторизовано","hint":"Проверьте используемые учётные данные"}
  success     : 200 {"data":{"executionId":"EX-DEMO-01"}}
  health      : 200 {"status":"ok","label":"Работает"}

$ node tools/localization-inspect.mjs --lang zh --api-error teapot
api error   — zh  HTTP 500   body: {"code":0,"message":"服务器内部错误"}   rawCode: teapot
```

#### Operation: `golden_parity` — the recorded reference payloads, field-for-field

```text
tests/reference/agent-4/golden/api.golden.json
  healthz           200 {status:'ok'}                  → our body keeps status verbatim, adds `label`
  readiness         200 {status:'ok'} / 503            → 503 body carries status:'error'
  unauthenticated   401 {status:'error', message}      → same 401 + same English text; the envelope
                                                          never grows the middleware's `status` field
  loginWrongPassword 401 {code:401, message:'Wrong…'}  → reproduced byte-for-byte via the reference's
                                                          own rule `code: <errorCode || httpStatusCode>`
  loginValidationError 400 raw zod issue               → validator-owned body, recorded by contract §3
```

`buildApiErrorResponse()` therefore has three documented paths: known code → localized envelope,
unknown string code → `500 { code: 0 }` with the raw code kept in `localized.rawCode`, numeric code →
passed through untouched (which is what makes the golden payload reproducible). Also asserted by gate
check G13 so the golden cannot silently drift.

#### Operation: `mutation_test` — a green gate must be able to go red

```text
M9  `unauthorized` → HTTP 403                    exit 1  failed=[G13]
M10 `ru` `api.hint.payload` emptied              exit 1  failed=[G14]
M11 `execution-log-record.ts` imports node:fs    exit 1  failed=[G14]
M12 record trigger stops following input.mode    exit 1  failed=[G12]      ← tests stayed green
--- sources restored                             exit 0  failed=[]         ← 77/77 + 15/15
```

M12 is the useful one: no test in `08` asserted a non-manual trigger **on the record**, so only the
gate's end-to-end check caught it. That is the division of labour the gate exists for.

#### Operation: `boundary` — nothing outside the LEGO moved

```text
contract_conformance : 22/22 CHECKS PASSED
boundary_audit       : AUDIT RESULT: PASS (all edges documented) · Phase-2 Rust guard: clean
isolation:check      : boundary PASS · kernel PASS · port-surface PASS · reference 15050 / f8da35180669d798
run_gate --offline   : OFFLINE STAGES: PASS | LIVE 11/11: NOT RUN (no docker/VPS — INCONCLUSIVE by design)
4B catalogue         : untouched (12 new product keys live in PRODUCT_DICTIONARY_EXTENSION)
4E overlay           : untouched (read-only for 4F)
reference/n8n        : untouched · UI module `settings-localization-adapter.ts` still not promoted
```

### Files Changed

| File | Change |
| :--- | :--- |
| `packages/workflow-lego/src/localization-vocabulary.ts` | new — `PRODUCT_DICTIONARY_EXTENSION` (12 × 6), `createProductRuntime()`, `runSummary()`, `triggerLabel()`, `nodeStateLabel()` |
| `packages/workflow-lego/src/execution-log-record.ts` | new — `buildExecutionLogRecord()`, `durationBetween()`, `formatExecutionLogLine()`, `relocalizeNodeLine()`, `nodeLinesOf()` |
| `packages/workflow-lego/src/api-error-response.ts` | new — `buildApiErrorResponse()`, `buildApiSuccessResponse()`, `buildHealthResponse()`, status/hint maps |
| `packages/workflow-lego/src/localization-runtime.ts` | additive — `PLACEHOLDER_SOURCE`, `firstPlaceholderIndex()` (one placeholder definition for the whole line) |
| `packages/workflow-lego/src/index.ts` | additive — 4F exports (3 modules + 2 helpers) |
| `packages/workflow-lego/test/08-localization-run-path.test.ts` | new — 27 tests (F1–F11) |
| `tools/localization-gate.mjs` | G1 runs three suites · G8 covers 4F · new G12/G13/G14 (incl. golden case) |
| `tools/localization-inspect.mjs` | `--record`, `--api-error <code>` modes |
| `contracts/localization.contract.md` | §2/§3 rows · §4.10/§4.11 responsibilities · §5.7 · §10 table · §11.8–§11.10 |
| `docs/isolation/localization.md` | phase table, evidence rows, M9–M12, §4.4 run-path diagram, §5/§6 |
| `docs/isolation/evidence/localization-gate.json` | regenerated — 15/15 |
| `tests/integration/run_gate.sh` | stage 2d label: Phase 4C–4F |
| `README.md`, `package.json` | status row + `localization:record` / `localization:api` scripts |

### Known Limitations (carried forward honestly)

* No live verification: `docker`/VPS are unavailable in this sandbox, so the live 11/11 stage is
  `NOT RUN` and the integration gate stays `INCONCLUSIVE` **by design**.
* `tsc --noEmit` is still not executable here (no `node_modules` for the package); the modules are
  erasable-syntax-only and are executed by Node's type-stripping loader on every gate run.
* Route-level wiring (endpoints actually calling these shapers) is the proposed Phase 4G; this task
  delivers the shapes and their machine-checked invariants, not a router.
