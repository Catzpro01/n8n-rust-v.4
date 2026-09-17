# Isolation Record — Localization LEGO (Phase 4C)

**Scope:** native multi-language runtime for the reconstructed backend.
**Reference:** n8n `2.9.4` (`reference/n8n`, upstream `b6dc2787c45677a29a9612cd27eb911302961a83`) — **unmodified**.
**Contract:** [`contracts/localization.contract.md`](../../contracts/localization.contract.md)
**Status:** `TESTED` — 79/79 module tests, 16/16 gate checks, mutations M1–M14 detected, surface
promoted (Phase 4D), run-data/API envelope (Phase 4E), consumed by the run path (Phase 4F:
execution-log record + localized HTTP payloads) and **merge-tested against the parallel 4B hub**
(Phase 4G: catalogue ownership, cross-branch diff, simulation with proven promotion recipe).
**Rust:** none (PROJECT_RULES #1).

---

## 1. Why this line exists

| Phase | Deliverable | Owner | State |
| :--- | :--- | :--- | :--- |
| 4A | `settings-localization-adapter.ts` — which language the operator picked | agent-1 session | landed on `main` |
| 4B | `backend-localization-service.ts` — catalog + 6 dictionaries + `translate()` | orchestrator commit `8f3f1af4` | landed on `main` |
| 4C | `localization-runtime.ts` — resolution → direction → interpolation → engine messages → diagnostics | this session | TESTED |
| 4D | surface promotion — `src/index.ts` re-exports the line; `tools/localization-inspect.mjs` makes it runnable | this session | TESTED |
| 4E | consumer seam — `localization-envelope.ts`: run envelope, node status lines, API errors, engine/API vocabulary | this session | TESTED |
| 4F | run path — `localization-vocabulary.ts` (product vocabulary + composed runtime), `execution-log-record.ts` (persisted record), `api-error-response.ts` (reference-exact localized payloads) | this session | TESTED |
| **4G** | **merge intel** — catalogue ownership rule, `tools/localization-hub-diff.mjs`, simulation against PR #21's 27-key hub, provenance in `docs/isolation/CROSS-AGENT-ISSUES.md` ISSUE-023 | **this session** | **TESTED** |

Phase 4A gave the project a two-language settings toggle, Phase 4B gave it six dictionaries and a
lookup function. Neither could answer the questions an executing backend actually asks: *which*
language applies to this run, in which direction is it written, how are placeholders filled, what
does a failed node say, and how do we notice a translation that silently went missing? Phase 4C is
that seam — and it is the first piece of the i18n line with machine-checked invariants.

## 2. X-Ray — what the module is made of

`packages/workflow-lego/src/localization-runtime.ts` (no imports, pure TypeScript):

```text
public surface (src/index.ts, Phase 4D)
   │  re-exports 23 runtime + 12 type symbols (no new import edges)
   ▼
LOCALE_CATALOG ──► RESOLUTION_TABLE ──► normalizeLocale() ──► resolveLocale(explicit→source→fallback)
   (6 locales,        (codes+aliases)        (null, never        │
    aliases,                                  a guess)           ▼
    direction)                                          LocalizationRuntime
                                                          ├─ t()       overlay → dictionary → en → key
                                                          ├─ tStatus() 5 statuses × 6 locales
                                                          ├─ getDirection()  ar = rtl
                                                          ├─ snapshot()  per-run audit payload
                                                          └─ diagnostics (missing keys, deduped)
```

Consumed through **ports only** (no imports, therefore no hidden LEGO edge):

| Port | Real binding | Wired by |
| :--- | :--- | :--- |
| `DictionaryPort.translate(key, locale?)` | Phase 4B `NativeLocalizationService` | `tools/localization-gate.mjs`, tests, caller |
| `LocaleSourcePort.getLocale()` | Phase 4A `SettingsLocalizationAdapter` via `fromSettingsState()` | settings read path |
| `LocaleSourcePort` (env) | `fromEnvironment(env)` — caller passes the map, the module never reads `process.env` | worker/CLI bootstrap |
| `overlay` | engine strings owned by this module (`ENGINE_STATUS_OVERLAY`) | constructor |

## 3. Boundary

**Owns:** catalog table, alias resolution, resolution chain, direction, interpolation, engine status
messages, diagnostics.
**Does not own:** dictionaries (4B), settings persistence (4A — see the surface note: the UI module
is deliberately *not* promoted), UI bundles (`editor-ui`,
`@n8n/i18n` — untouched), reference behavior (no n8n module is replaced or wrapped), execution
semantics (this module phrases outcomes, it never decides them).

Structural proof, re-run in this session:

```text
Boundary check: PASS (no drift vs packages/workflow-lego/manifest/boundary.expectations.json)
Kernel snapshot check: PASS (snapshots match the pinned reference source)
Port surface check: PASS (manifest ports == consumed ports)
Reference integrity check: PASS (15050 files, root f8da35180669d798…)
```

`src/index.ts` and `manifest/port-surface.json` are intentionally untouched (the 4A/4B modules are
equally unexported); promoting the line into the public LEGO surface is a later phase with its own
manifest update — see contract §11.6.

## 4. Evidence

| Check | Command | Result |
| :--- | :--- | :--- |
| Module tests | `node --test packages/workflow-lego/test/{06,07,08}-*.test.ts` | **79/79 PASS** (L1–L13, E1–E10, F1–F13) |
| Localization gate | `node tools/localization-gate.mjs` | **16/16 PASS** → `docs/isolation/evidence/localization-gate.json` |
| Surface parity (4D/4E/4F) | gate check G8 | PASS — 57 runtime + 26 type symbols promoted, UI module excluded |
| Runnable surface (4D) | gate check G9 / `npm run localization:inspect` | PASS — `--lang jv --key node.error` → `Gagal dilakokake`; unknown locale exits 2 |
| Vocabulary (4E) | gate check G10 | PASS — 14 engine/API keys × 6 locales, identical key sets, 0 empty |
| Run envelope (4E) | gate check G10b / `npm run localization:envelope` | PASS — run block + 2 node lines + 5 API error codes, Arabic envelope `rtl` |
| Envelope boundary (4E) | gate check G11 | PASS — imports exactly `./localization-runtime.ts` + `./backend-localization-service.ts` |
| Run record (4F) | gate check G12 / `npm run localization:record` | PASS — derived duration, localized summary + trigger, 0 missing keys, deterministic |
| API payloads (4F) | gate check G13 / `npm run localization:api` | PASS — 5 error codes × 6 locales + `{ data }` success + health 200/503 |
| Reference golden (4F) | test 08 F11 + gate G13 | PASS — `tests/reference/agent-4/golden/api.golden.json`: health `status` verbatim, unauthenticated text/status agree, `loginWrongPassword` body reproduced byte-for-byte (`{code:401, message}`) |
| Run-path boundary (4F) | gate check G14 | PASS — 12 product keys × 6 locales, no 4B/4E collision, 3 modules in-package only |
| Catalogue ownership (4G) | gate check G15 | PASS — 0 overlaps with the current 4B; the rule (catalogue wins, divergence reported) is proven against a grown stub |
| Cross-branch hub diff (4G) | `npm run localization:hub-diff -- --their-ref 7fba8a6d --base d357e6e5` | **COMPATIBLE** — 6/6 locales, 35 vs 27 keys, **66 identical value pairs / 0 divergent**, 6 file collisions, 0 script collisions |
| Merge simulation (4G) | clean worktree + PR #21's 4B hub | **79/79 + 16/16 PASS** after the 18-symbol promotion recipe → `docs/isolation/evidence/merge-simulation-pr21.json` |
| Catalog ↔ 4B drift | gate check G2/G3 | PASS — 6 locales, 9 keys each, field-identical |
| Dictionary parity | gate check G4 | PASS — 0 missing, 0 extra, 0 empty |
| RTL | gate check G6 | `ar:rtl`, the other five `ltr` |
| Status coverage | gate check G7 | 5 statuses × 6 locales |
| Integration gate stage | `bash tests/integration/run_gate.sh --offline-only` | `STAGE 2d: NATIVE LOCALIZATION GATE` → **PASS (15/15)**; full offline stage now **PASS** (§4.2) |

Real strings for the same key (`settings.title`), produced by the gate:
`id:Pengaturan · en:Settings · jv:Setelan · ar:الإعدادات · zh:设置 · ru:Настройки`

### 4.1 Fail-direction test (a green gate must be able to go red)

Twelve mutations were applied to the sources, the gate re-run, and the sources restored — the gate
must be able to go red before it is allowed to mean anything green:

| # | Mutation | Gate | Detected by |
| :--- | :--- | :--- | :--- |
| M1 | `jv` dictionary loses `node.error` | **exit 1** | G1, G4 (missing key) |
| M2 | `ar` direction flipped to `ltr` in Phase 4B | **exit 1** | G1, G2 (drift gate) |
| M3 | catalog loses the `jw` alias | **exit 1** | G1 (30/31 — test L1) |
| M4 | catalog drops the whole `ru` locale | **exit 1** | G1, G2, G3, G7 |
| — | sources restored | **exit 0** | 33/33 + 9/9 |
| M5 | `jv` vocabulary loses `execution.failed` | **exit 1** | G1, G10 (parity) |
| M6 | `ru` `run.items` emptied | **exit 1** | G1, G10 (empty value) |
| M7 | envelope module imports `node:fs` (boundary breach) | **exit 1** | G1, G11 (import list) |
| M8 | `index.ts` stops promoting the envelope module | **exit 1** | G8 (surface parity) |
| — | sources restored | **exit 0** | 50/50 + 12/12 |
| M9 | `unauthorized` maps to HTTP 403 instead of 401 | **exit 1** | G1, G13 (reference status map) |
| M10 | `ru` `api.hint.payload` emptied | **exit 1** | G1, G14 (empty value) |
| M11 | `execution-log-record.ts` imports `node:fs` | **exit 1** | G1, G14 (module boundary) |
| M12 | record trigger stops following `input.mode` | **exit 1** | G12 (trigger label) |
| M13 | `withoutCatalogueOwnedKeys()` stops dropping catalogue-owned keys | **exit 1** | G15 (catalogue must win the lookup) |
| M14 | `index.ts` stops promoting `catalogueOverlaps` | **exit 1** | G8 (surface parity) |
| — | sources restored | **exit 0** | 79/79 + 16/16 |

M12 is the interesting one: the test suite stayed green (nothing in test 08 asserted a non-manual
trigger on the *record*), and only the gate's end-to-end G12 caught it — which is exactly why the
gate exists next to the tests.

### 4.2 The ZERO RUST guard finding — found pre-existing, RESOLVED in this branch

When Phase 4C was written, `tests/compatibility/contract_conformance.mjs` reported **20/21** and
`tests/integration/boundary_audit.py` reported **FAIL**, both for one reason:

```text
-- Phase-2 Rust guard: VIOLATION ['crates/n8n-common/Cargo.toml', … 22 files …]
PHASE VIOLATION: Rust introduced during Phase 2
```

PROJECT_RULES #1 mandates *ZERO RUST* (`crates/`, `apps/`) while the Phase-3 Rust workspace
(root `Cargo.toml` + 7 crates) sat at the repository root, where cargo auto-discovers it. The
baseline was identical **before and after** the localization work, so Phase 4C neither introduced
nor worsened it — and the same baseline was inherited by every branch in the repository.

**Resolution (same branch, later commit):** the track was archived with `git mv crates
legacy/rust-port/crates && git mv Cargo.toml legacy/rust-port/Cargo.toml` — reversible, history
preserved, no file deleted (`legacy/rust-port/README.md` is the archive record; the offline rig now
reads `legacy/rust-port/` and a `RUST_LEGACY=…` override exists for a restored track).

| | before | after |
| :--- | :--- | :--- |
| `contract_conformance.mjs` | 20/21 (Rust guard) | **22/22 PASS** (new check: archive documented & inert) |
| `boundary_audit.py` | FAIL (PHASE VIOLATION) | **PASS** + dedicated archive audit line |
| `run_gate.sh --offline-only` | OFFLINE STAGES: **FAIL** (BLOCKED) | OFFLINE STAGES: **PASS**, exit 2 INCONCLUSIVE *only* because the live stage is not runnable here |

Evidence: `docs/isolation/evidence/rust-guard-restoration.json`. Neither guard accepts a silent
return: restoring the crates to the root fails them unless the archive README disappears and the
repository-root `Cargo.toml` comes back — a decision that belongs to the orchestrator, not a commit.

### 4.3 What the envelope layer consumes

```text
execution logger ─┐
API error path  ──┼─► localization-envelope.ts ──► { locale, direction, message, messages,
run log lines   ──┘        (4E, data in)            labels, nodeLines, diagnostics }
                                                        │
                                        persisted run data / HTTP payload  (transport stays
                                        in the persistence & API LEGOs — 4E shapes, never sends)
```

### 4.4 What the run path does with it (Phase 4F)

```text
                       ┌─ buildExecutionLogRecord ─► { id, workflowId, workflowName, mode, status,
run envelope (4E) ─────┤                              startedAt, stoppedAt, durationMs, totalItems,
  labels + nodeLines   │                              nodeRuns[], localized: { locale, direction,
                       │                              message, summary, trigger, labels, nodeLines,
                       │                              missingKeys } }   ◄── resolved at write time
                       └─ relocalizeNodeLine ─────► the same node line in another locale (read path)

API error code ─► buildApiErrorResponse ─► HTTP 400/401/404/409/500  { code, message, hint?, meta?,
                                            stacktrace? }        unknown code ─► 500 { code: 0, … }
                                            numeric code ─► code passed through: { code: 401,
                                            message: rawMessage } == golden login payload
data ──────────► buildApiSuccessResponse ─► 200 { data }        (no field added, none renamed)
probe ─────────► buildHealthResponse ────► 200 { status:'ok', label }  /  503 { status:'error', label }
```

Three properties are worth stating because they are the ones a reviewer would otherwise have to
trust:

1. **The localized block is frozen at write time.** A record keeps the text the operator saw when the
   run happened; `relocalizeNodeLine()` exists precisely so a *view* (re-opening a stored run in
   another language) does not require rewriting the stored record.
2. **Nothing leaves the process as half a sentence.** `runSummary()` needs duration, node count and
   item count; without all three it returns the localized lifecycle message (`isSummary: false`,
   `droppedParts` naming what was missing) instead of "Failed after" or a leaked `{items}`.
3. **The reference shape wins.** `buildHealthResponse()` never translates the machine field
   (`ok`/`error`), `buildApiSuccessResponse()` never adds a field, an unknown error code becomes the
   generic `{ code: 0, message }` while `localized.rawCode` keeps the original for the logs, and a
   numeric code is passed through — which is how the recorded `loginWrongPassword` golden payload is
   reproduced byte-for-byte (test F11, gate G13).

### 4.5 Merge intelligence (Phase 4G) — two branches, one LEGO line

While this line grew 4C→4F, a parallel branch (`arena/01a0b104`, PR #21) rewrote the Phase 4B module
into a 27-key hub. Neither branch could see the other, so Phase 4G made the *composition* predictable
instead of trusting luck:

```text
tools/localization-hub-diff.mjs --their-ref <rev> [--base <rev>] [--check]
      │
      ├── key sets       35 ours / 27 theirs / 11 shared   (6/6 locales identical on both sides)
      ├── value pairs    66 identical / 0 divergent        ← the only real blocker would live here
      ├── surface gap    8 runtime + 6 type symbols not re-exported yet (mechanical)
      ├── file collisions  README · docs/isolation/localization.md · package.json ·
      │                   backend-localization-service.ts · index.ts · SMOKE_TEST_RESULTS.md
      └── verdict        COMPATIBLE   (RECONCILIATION REQUIRED on divergence / script clash)
```

The rule that makes a *superset* catalogue safe is in the code, not in a reviewer's head: the
catalogue owns its keys (`withoutCatalogueOwnedKeys()`), so a grown 4B keeps its own text instead of
being shadowed by an overlay written against a smaller one; `catalogueOverlaps()` reports any overlap
with both texts and an `identical` flag, and G15 asserts agreement against the live catalogue *and*
against a deliberately grown stub (so the check can go red). Simulation in a clean worktree proves the
end state: with PR #21's hub adopted, adding the 8+6 symbols to the promotion block yields
**79/79 + 16/16 PASS** — no translation value had to be reconciled.

## 5. Known limitations

* `normalizeLocale` resolves only tags the catalog knows: an unknown tag is *reported*, never
  guessed, so adding a language requires touching the catalog by design (contract §11.1).
* The engine overlay ships three statuses (`running`, `waiting`, `cancelled`) that Phase 4B does not
  carry; product labels and engine messages are deliberately kept in separate owners (contract §4.6).
* `tsc --noEmit` could not be executed in this sandbox (no registry access, `node_modules` absent for
  `packages/workflow-lego`). The module is erasable-syntax-only and is executed by Node's type-stripping
  loader in every gate run; a typed CI run remains the stronger check.
* A run summary intentionally requires all three parts (duration, node count, item count): a run
  that reports only some of them gets the lifecycle message instead of a truncated sentence. That is
  a deliberate trade (contract §4.10) — a caller that wants a partial sentence must build it itself
  and take responsibility for the wording.
* The reference API golden (`tests/reference/agent-4/golden/api.golden.json`) pins five payloads;
  four of them are reproduced or superset-verified by test F11 (health/readiness, the unauthenticated
  middleware body, `loginWrongPassword` byte-for-byte, and the contract row that assigns the raw zod
  issue to the validator). The remaining route-specific payloads of n8n 2.9.4 are covered by
  `contracts/api.contract.md` §3 shapes, not by captured fixtures — a route-by-route golden sweep is
  the natural next step, not something this LEGO can prove offline.
* No live n8n instance was involved (offline sandbox, `docker` unavailable), so the live 11/11 stage
  of `tests/integration/run_gate.sh` is reported `NOT RUN` here, exactly as the gate itself states.
* The counterpart gate of the parallel branch (`tools/localization-hub-check.mjs`, `i18n:check`)
  could not be executed here: its loader compiles TypeScript with the pinned `typescript` from
  `packages/workflow-lego/node_modules`, which this sandbox cannot install. This line's gate needs no
  dependencies at all (Node type stripping), which is exactly why it runs in a bare checkout — but it
  also means the *other* gate's verdict on the merged tree is unknown from here.
* Phase 4G produces merge intelligence, not a merge: `docs/isolation/localization.md` is an add/add
  conflict with the parallel branch, the two Rust dispositions differ (`legacy/rust-port/` archive vs
  `.gitkeep`), and `contract_conformance` means 22 checks here vs 21 there. Those are orchestrator
  decisions, recorded in `docs/isolation/CROSS-AGENT-ISSUES.md` ISSUE-023.

## 6. Next

Phase 4F closed the loop this document asked for: the envelope is now consumed by a real run path
(persisted record + HTTP payloads), and the vocabulary grew beyond Phase 4B's 9 keys (14 engine/API +
12 product keys, three owners, no key collisions — contract §4.10).

1. **Phase 4G (proposed): route-level wiring.** A localized router/controller layer that *calls*
   `buildApiErrorResponse()` / `buildApiSuccessResponse()` from actual endpoints (including auth and
   validation failures), plus a golden sweep that captures every reference payload shape into
   `tests/reference/` instead of relying on four fixtures (§5).
2. **Phase 4G (proposed): the write side of `redacted`.** The record reserves the field; the
   persistence LEGO still has to fill it with its redaction policy, and that policy should be
   verified against `contracts/execution-data.contract.md` before any real payload is stored.
3. Extend the dictionaries: `backend-localization-service.ts` ships 9 product keys, engine/API
   strings live in the 4E overlay, run-path strings in the 4F overlay — a dictionary refresh cannot
   silently un-translate a status (contract §4.6), but a *new* product string still needs an owner
   decision between 4B and 4F.
3. The ZERO RUST guard finding is closed (§4.2). The only stage that cannot run from this sandbox is
   the live 11/11 regression, which needs a running n8n + PostgreSQL.
