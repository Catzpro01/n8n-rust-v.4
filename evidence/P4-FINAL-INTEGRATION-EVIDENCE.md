# P4 FINAL INTEGRATION EVIDENCE — Issue #99 acceptance (canonical)

- **Baseline frozen:** `66c43ffe09e58db32eb4b210c1d3d9e8474fb281` (main saat perintah finalisasi)
- **Finalization branch:** `p4-finalization` (remediation: ownership gate + cookie sanitizer + benchmark) → merged to protected main
- **Raw benchmark:** `evidence/p4-perf-benchmark.json` (dihasilkan langsung oleh example; tidak diedit tangan)

## 1. P4.1–P4.9 → merge SHAs (integrasi ke main)

| Slice | PR | Merge SHA | Evidence file |
| :--- | :--- | :--- | :--- |
| P4.1 | #117 | UNKNOWN | `docs/architecture/p4/evidence/P4.1-EVIDENCE.md` |
| P4.2 | #131 | UNKNOWN | `evidence/P4.2-EVIDENCE.md` |
| P4.3 | #137 | UNKNOWN | `evidence/P4.3-EVIDENCE.md` |
| P4.4 | #145 | `b4fc673b4721fde50b6a859a87b9ac2d36f039b3` | `evidence/P4.4-EVIDENCE.md` |
| P4.5 | #156 | `26acc10ff1a5ec196697f02c54289a818d7a2556` | `evidence/P4.5-EVIDENCE.md` |
| P4.6 | #158 | `677c714260d1e401be908c571534fc958068c8a7` | `evidence/P4.6-EVIDENCE.md` |
| P4.7 | #161 | `a7ec39e059674434c0b5f736060136e3d9163f7b` | `evidence/P4.7-EVIDENCE.md` |
| P4.8 | #164 | `57c473a5012f5bcbedb6079f6b70e7e99a291e0f` | `evidence/P4.8-EVIDENCE.md` |
| P4.9 | #166 | `7dbbf2c663b607d5d1ffcd030da72a385ac10a84` | `evidence/P4.9-EVIDENCE.md` + `docs/architecture/p4/FINAL-ACCEPTANCE.md` |

P4 PR stale sudah ditutup dengan komentar SHA integrasi; issue subdomain #103–#109 ditutup dengan pointer evidence. Tidak ada P4.10 (scope #4: exactly P4.1–P4.9).

## 2. Audit hasil — desain & runtime vs Issue #99

### A. Trigger lifecycle (§7) — VERIFIED
- 7 state (`ActivationState`: Inactive/Activating/Active/Degraded/Failed/Draining/Deactivating) via `CANONICAL_TRANSITIONS`.
- Tests (22): idempotent activate/deactivate, serialisasi `activate_on_activating`, update flow + `pending_update` exactly-once, generasi monotonic + CAS stale rejection, rollback parsial (`ACTIVATING → INACTIVE`), graceful drain ber-deadline, startup reconcile (`reconcile_*`), failure visibility (`last_error`), retry FAILED→ACTIVATING.

### B. Webhook (§8) — VERIFIED (runtime, bukan sekadar tipe)
- Production/test/waiting route table terpisah; form kinds ada (`RouteKind` 6 varian).
- Tests (16+2 sanitizer): mount+rollback, collision fail-closed, static>wildcard deterministik, params+wildcard, method-not-allowed, normalize+size-limit, deactivate unmount, stale-route cleanup, generation fencing, full flow ACK, security deny fail-closed, stale envelope, aborted workflow tidak serve.
- `ResponseMode` verbatim n8n 2.9.4: `onReceived|lastNode|responseNode|streaming` + `ResponsePlan` (status/headers/body; binary via `responseData=firstEntryBinary`).

### C. Schedule/cron (§9) — VERIFIED + REMEDIATED
- 20 tests: cron parse/6-field/validation, DST gap (shift/skip), DST fold fire-once, leap-day, duplicate-tick suppression, overlap skip/queue, misfire skip+backfillOnce, jitter+deadline bound, deactivation cleanup, orphan recovery, timezone form.
- **REMEDIATION (ownership/leader):** `on_tick` kini menganalisis `owner_instance` vs `set_local_instance(host)` → `TickDecision::NotOwner` (pemilik lama berhenti emit setelah failover; pemilik baru lolos; host-tanpa-identitas = kompatibel mundur). Tests: `owner_matching_local_identity_fires`, `owner_mismatch_returns_not_owner_after_failover`, `without_local_identity_ownership_gate_is_inert`.
- **Tidak ada scheduler kedua:** grep seluruh `apps/` + `crates/n8n-nodes-rust` — tanpa engine cron alternatif; satu-satunya di `crates/n8n-common/schedule.rs`.

### D. Admission (§10) — VERIFIED
- `AdmissionState` **8 negara kanonik** di `ingress_contract.rs`: Accepted/Queued/Deferred/RateLimited/Rejected/Duplicate/Expired/Unavailable + `is_admitting()`.
- Tests (13): admitted, expired+DEADLINE_EXCEEDED, security deny, duplicate suppress, stale generation, inactive workflow, rate limit+retryable, overload shed `max_in_flight`, oversized payload, malformed fail-closed, config impossible rejected, finish release, kanonik idempotency key.
- Bounds config: in-flight 128 default, body 16MiB, dedupe 512/60s, route token 1000/200 per dtk (semua terbukti terukur di benchmark).

### E. Event/manual/waiting (§11) — VERIFIED
- Tests (10): intent **new vs resume terbedakan** (`intent_classification_distinguishes_new_vs_resume` — bukan kebingungan start-vs-resume), waiting path extraction, verdict 404/409 seperti n8n, test-listen fire-once + expiry, manual first-emission, event names verbatim, generation fence, bounded name.

### F. Recovery/race (§12) — VERIFIED + REMEDIATED
- Race matrix → test mapping: act×act (serialized), act×deact (cancels cleanly), act×update (pending once), deact×webhook (unmount), deact×tick (schedules removed), version×delayed-event (event fence + stale generation), restart×activation (recovery plan deterministik + stalled detection), **leader×callback (ownership gate — remediation ini)**, dup webhook (admission), dup tick (suppression), delayed old-gen (CAS + `old_activation_cannot_serve`), mid-registration failure (rollback test).
- Journal: append-only **bounded** (`MAX_JOURNAL_ENTRIES` — terukur: 10K append → replay window 1024, dropped 8976) + replayable; LeaderLease acquire/renew/expire/assert tested.

### G. P4.8 Innovation (§13) — CLASSIFIED HONEST
| Fitur (#110) | Status | Bukti |
| :--- | :--- | :--- |
| Route Atlas / ingress compiler | **IMPLEMENTED** optional+bounded | `atlas_*` tests + hard-bound 4096 terukur |
| Generation-swapped activation | **IMPLEMENTED** | `atlas_hot_swap_keeps_old_readers` |
| Payload capsule | **IMPLEMENTED** TTL+digest+token | `capsule_*` tests |
| Burst fusion | **IMPLEMENTED** off-by-default bounded | `burst_fusion_*` tests |
| Brownout/QoS | **IMPLEMENTED** escalates | `brownout_*`, `qos_*` |
| Flight recorder + replay | **IMPLEMENTED** bounded promotable + compat replay | `flight_recorder_*`, `replay_*` |
| Self-profiling (adaptive limits) | **IMPLEMENTED** conservative/stale-guarded | `adaptive_stale_telemetry_is_conservative` |
| Predictive admission | **PLANNED / DEFERRED (#110)** — tidak ada di kode; tidak diaku COMPLETE | grep kosong |
| Shadow compatibility path | **PLANNED / DEFERRED (#110)** — tidak ada di kode | grep kosong |
`innovation_distinguishes_default_vs_enabled` membuktikan optional/disableable.

### H. Compatibility (§14) — VERIFIED
- `compat.rs` 8 tests: default matrix ≥12 kasus (manual/webhook/polling/schedule/event/activation/retries/dupes/restart/response modes/parsing/disabled/route conflicts/timing), run+pass/fail tracking, cap, replay route/admission, acceptance suite, route-kind prefix verbatim.
- Reference pinned di repo: `reference/n8n` (sanitizer diambil dari `packages/cli/src/webhooks/webhook-request-sanitizer.ts`).

### I. Security (§16) — VERIFIED + REMEDIATED
- **REMEDIASI:** `normalize_request` sebelumnya meneruskan **seluruh header termasuk cookie ke input workflow** — sekarang menyaring cookie terlarang paritas-n8n (`SANITIZED_COOKIE_NAMES = ["n8n-auth", "n8n-browserId"]`; header tetap ada, nilai tersaring, semua-terlarang → string kosong = identik reference). Tests: `sensitive_cookies_are_stripped_like_n8n_reference`, `cookie_header_with_only_sensitive_cookies_becomes_empty_like_n8n`.
- Fail-closed: malformed envelope/URI/body/headers ditolak; security Deny ditolak; stale generation diblokir sebelum admission; tidak ada penyimpanan kredensial di P4 (boundary P5 dikonsumsi via `SecurityDecisionRef`).

### J. Resource bounds (§17) — VERIFIED
- Konstanta: MAX_ID 128, inline payload 64KiB, headers 64×8KiB, query 64×4KiB, route path 512, uri 16KiB, body 16MiB (default), journal 1024, atlas 4096, fired-window dedupe, in-flight 128, dedupe 512.
- Tidak ada map/queue/list tak-terbatas di hot path (semua ditolak/dibatalkan fail-closed; dibuktikan test + benchmark RSS).

### K. Boundary (§18) — VERIFIED
- P3/P6/P9 imports di `n8n-common`: **tidak ada**; P9 `observability.*` rows tidak disentuh; `innovation::TelemetrySample` = tipe internal (bukan dependensi P9); cron engine tunggal; `node-acceptance` (P6) hanya inventaris filename read-only.

## 3. Performance — MEASURED (#99 §T/§U/§W)

- **Runner:** `cargo run --release -p n8n-common --example p4_perf_bench` (std-only + allocator counter), output = `evidence/p4-perf-benchmark.json`.
- **Environment:** Intel(R) Xeon(R) Processor @ 2.60GHz · 2 cores · 1984 MiB RAM · kernel 6.1.158+ · rustc 1.98.1 · release · 2026-09-24.

| Metric | p50 | p95 | p99 | Catatan |
| :--- | --: | --: | --: | :--- |
| Atlas lookup @1 route | 56 ns | 58 ns | 67 ns | warm, 50K samples, 1.0 alloc/op (path String) |
| Atlas lookup @1K | 227 ns | 292 ns | 334 ns | **target sub-ms: PASS** |
| Atlas lookup @4096 (ceiling) | 307 ns | 424 ns | 500 ns | plafon hard-bound |
| Atlas @10K | — | — | — | **`AtlasFull max=4096` fail-closed (by design)** |
| Webhook resolve @1K | 425 ns | 656 ns | 813 ns | authoritative two-stage, 9.0 alloc/op |
| Webhook resolve @10K | 757 ns | 1064 ns | 1298 ns | **sub-ms: PASS** |
| Admission steady (50K admitted) | 524 ns | 709 ns | 914 ns | config ukur capacity 1M (dicatat di JSON) |
| Admission duplicate | 205 ns | 327 ns | 382 ns | 50.000/50.000 Duplicate, 0 lolos |
| Activation register+commit | 3728 ns | 6223 ns | 8720 ns | n=2000 workflow |
| Normalize tiny JSON | 359 ns | — | 733 ns | 7-byte payload |
| Normalize JSON 64KiB | 10533 ns | — | 33810 ns | 65547 bytes |

**Burst (default config):** issued 20000 dalam 13.2 ms (~1515635/s) · **admitted 128 = persis limit 128** · shed 19872 (RateLimited/overload) · max-in-flight 128 ≤ 128 **PASS (hard bound)** · **pemulihan setelah drain: 1024 ms** (901 attempts, state terakhir `RateLimited` — refill window default 200/s) **PASS**.

**Recovery:** journal append 97 ns/entry (10K) · replay window 1024 + dropped_by_bound 8976 (bounded ✓) · replay total 45 µs · orphan reconcile 1000 schedule 157 µs · cleanup 788 µs.

**Resources (whole run):** CPU 590 ms · **VmHWM 47 MiB** · alloc calls 6,197,402 · alloc bytes 850 MiB.

### Gate §W (performance) — hasil
1. Indexed warm lookup sub-ms: **PASS** (p99 334 ns @1K; 1298 ns @10K fallback)
2. Bounded allocation/memory/queues/dedupe: **PASS** (konstanta + hard-bound terbukti; RSS 47 MiB utuh seluruh run)
3. No full workflow load di hot path: **PASS** (resolve/admit tidak memuat workflow definition — hanya route/envelope structs)
4. Measured p50/p95/p99: **PASS** (tabel di atas)
5. Overload tetap terkendali: **PASS** (admitted=128=limit; shed tertutup; pemulihan terukur)

## 4. Test ledger (angka terukur final, cabang remediation)

| Suite | Hasil | Klasifikasi |
| :--- | :--- | :--- |
| 7 governance gates (arch+2 selftest, foundation+2 selftest, capabilities, scaleout, ai:check) | **7/7** | PASS |
| cargo workspace | **21 suites · 293 passed · 0 failed** (P4 = 142 di n8n-common: 107 lama + 10 contract + 25 activation… termasuk +3 ownership, +2 sanitizer) | PASS |
| backend (`apps/n8n-lego`) | **1664 · 1661 pass · 3 fail** = `GET /rest/types/nodes.json`, `GET /rest/types/node-versions.json`, `POST /rest/node-types` (rest.test 404) | **PRE_EXISTING_FAILURE** |
| frontend | **419 · 418 pass · 0 fail · 1 skipped** | PASS |
| P3 regression | gate `lego:*` + focused suites tetap hijau (tidak ada perubahan `apps/n8n-lego` di perbaikan ini) | PASS |
| P6 regression | contract-lock 75 rows + pins ×7 tidak diubah; BE hijau | PASS |
| Benchmark run | exit 0, semua gate §W PASS | PASS |

## 5. Known limitations / classified failures

- **PRE_EXISTING:** 3× rest.test 404 (catalog node types) — sudah ada sebelum P4 finalization; bukan regresi P4.
- **By-design bounds (bukan bug):** atlas 4096; journal window 1024; dedupe window 512/60 s; rate window pemulihan ~1 s pada beban burst default (diukur 1024 ms).
- **ENVIRONMENTAL:** sandbox 2 cores / 2 GiB — angka adalah reference-hardware lokal; tidak ada klaim hardware lain.
- **Planned/deferred (bukan COMPLETE):** predictive admission, shadow compatibility (#110 planning-only); orkestrasi multi-instance leader election penuh (primitif `LeaderLease` + ownership gate sudah ada; orchestrator eksternal di luar scope P4 single-instance §S).
- Evidence historis P4.1–P4.9 tidak diubah; dokumen ini adalah lapisan penerimaan final.

## 6. P9 firewall

Tidak ada operasi pada PR/branch/row/evidence `observability.*` / `arena/agent4-p9.*` (open PR #176–#179 dibiarkan). Satu-satunya interaksi: pembacaan baris contract untuk audit kepemilikan.
