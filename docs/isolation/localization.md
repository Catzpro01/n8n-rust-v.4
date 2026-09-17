# Isolation Record — Localization LEGO (Phase 4C)

**Scope:** native multi-language runtime for the reconstructed backend.
**Reference:** n8n `2.9.4` (`reference/n8n`, upstream `b6dc2787c45677a29a9612cd27eb911302961a83`) — **unmodified**.
**Contract:** [`contracts/localization.contract.md`](../../contracts/localization.contract.md)
**Status:** `TESTED` — 33/33 module tests, 9/9 gate checks, mutations M1–M4 detected, surface promoted
(Phase 4D).
**Rust:** none (PROJECT_RULES #1).

---

## 1. Why this line exists

| Phase | Deliverable | Owner | State |
| :--- | :--- | :--- | :--- |
| 4A | `settings-localization-adapter.ts` — which language the operator picked | agent-1 session | landed on `main` |
| 4B | `backend-localization-service.ts` — catalog + 6 dictionaries + `translate()` | orchestrator commit `8f3f1af4` | landed on `main` |
| 4C | `localization-runtime.ts` — resolution → direction → interpolation → engine messages → diagnostics | this session | TESTED |
| **4D** | **surface promotion** — `src/index.ts` re-exports the line; `tools/localization-inspect.mjs` makes it runnable | **this session** | **TESTED** |

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
| Module tests | `node --test packages/workflow-lego/test/06-localization-runtime.test.ts` | **33/33 PASS** (L1–L13) |
| Localization gate | `node tools/localization-gate.mjs` | **9/9 PASS** → `docs/isolation/evidence/localization-gate.json` |
| Surface parity (4D) | gate check G8 | PASS — 23 runtime + 12 type symbols promoted, UI module excluded |
| Runnable surface (4D) | gate check G9 / `npm run localization:inspect` | PASS — `--lang jv --key node.error` → `Gagal dilakokake`; unknown locale exits 2 |
| Catalog ↔ 4B drift | gate check G2/G3 | PASS — 6 locales, 9 keys each, field-identical |
| Dictionary parity | gate check G4 | PASS — 0 missing, 0 extra, 0 empty |
| RTL | gate check G6 | `ar:rtl`, the other five `ltr` |
| Status coverage | gate check G7 | 5 statuses × 6 locales |
| Integration gate stage | `bash tests/integration/run_gate.sh --offline-only` | `STAGE 2d: NATIVE LOCALIZATION GATE` → **PASS (9/9)**; full offline stage now **PASS** (§4.2) |

Real strings for the same key (`settings.title`), produced by the gate:
`id:Pengaturan · en:Settings · jv:Setelan · ar:الإعدادات · zh:设置 · ru:Настройки`

### 4.1 Fail-direction test (a green gate must be able to go red)

Four mutations were applied to the sources, the gate re-run, and the sources restored:

| # | Mutation | Gate | Detected by |
| :--- | :--- | :--- | :--- |
| M1 | `jv` dictionary loses `node.error` | **exit 1** | G1, G4 (missing key) |
| M2 | `ar` direction flipped to `ltr` in Phase 4B | **exit 1** | G1, G2 (drift gate) |
| M3 | catalog loses the `jw` alias | **exit 1** | G1 (30/31 — test L1) |
| M4 | catalog drops the whole `ru` locale | **exit 1** | G1, G2, G3, G7 |
| — | sources restored | **exit 0** | 31/31 + 7/7 |

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

## 5. Known limitations

* `L1`/`L2`: ergonomic locates only tags the catalog knows — an unknown tag is *reported*, never
  guessed; adding a language therefore requires touching the catalog (contract §11.1) by design.
* The engine overlay ships three statuses (`running`, `waiting`, `cancelled`) that Phase 4B does not
  carry; product labels and engine messages are deliberately kept in separate owners (contract §4.6).
* `tsc --noEmit` could not be executed in this sandbox (no registry access, `node_modules` absent for
  `packages/workflow-lego`). The module is erasable-syntax-only and is executed by Node's type-stripping
  loader in every gate run; a typed CI run remains the stronger check.
* No live n8n instance was involved (offline sandbox, `docker` unavailable), so the live 11/11 stage
  of `tests/integration/run_gate.sh` is reported `NOT RUN` here, exactly as the gate itself states.

## 6. Next

1. **Phase 4E (proposed):** consume the promoted surface from the API envelope and the execution
   logger — `runtime.snapshot()` into run data, `runtime.tStatus()` into per-node status lines —
   then extend the dictionaries beyond the 9 product keys.
2. Extend the dictionaries: `packages/workflow-lego/src/backend-localization-service.ts` ships 9
   product keys; engine strings live in this module's overlay, so a dictionary refresh cannot silently
   un-translate a status (contract §4.6).
3. The ZERO RUST guard finding is closed (§4.2). The only stage that cannot run from this sandbox is
   the live 11/11 regression, which needs a running n8n + PostgreSQL.
