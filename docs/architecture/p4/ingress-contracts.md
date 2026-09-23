# P4 Contract: Canonical Ingress Contracts

**Contract id:** `ingress.contracts@0.1.0` — **Status: FROZEN** (per PR P4.1)
**Owner:** Agent 2 (P4 — Ingress + Activation Orchestration Plane)
**Implementasi:** `crates/n8n-common/src/ingress_contract.rs`
**Issues:** #99 (P4 deep design), #109 (canonical contracts + performance gate), parent marathon per P4 Master Prompt
**Compatibility baseline:** n8n 2.9.4 (`reference/n8n`, hash-pinned)

> Perubahan pada kontrak ini wajib menaikkan versi kontrak dan menyertakan
> migration/compat note di dokumen ini. `CONTRACT_VERSION` di kode adalah pin.

---

## 1. Purpose

P4 mengorkestrasi jalur kanonik:

```
EXTERNAL EVENT → INGEST → NORMALIZE → RESOLVE → SECURITY → DEDUPE / IDEMPOTENCY
             → ADMISSION → EXECUTION REQUEST → ACK / RESPONSE
```

Kontrak ini mem-bekukan **value objects** yang mengalir di jalur tersebut, supaya
tiap tahap (dan setiap future slice P4.2–P4.9) berbicara dengan satu kosakata yang
sama, tervalidasi fail-closed, testable, dan wire-stable (serde JSON camelCase).

Target P4.1 (master prompt): `External Request → canonical ingress object` tanpa
coupling kuat ke detail HTTP.

## 2. Non-responsibilities (batas tegas)

| Bukan di sini | Milik |
| :--- | :--- |
| Server/router HTTP aktual (hyper/axum/…), melepas prefix `/webhook/` dll. | adapter P4.3 |
| Runtime activation (transaksi, transisi nyata, great journal) | P4.2 / P4.7 |
| Queue, prioritas, dedupe store, retry runtime | P4.5 |
| Eksekusi workflow, graph internals, IR, checkpoint | P3 (#97, #75) |
| Scheduler/cron engine | P3 runtime / trigger-LEGO (P4.4 hanya ingress semantics) |
| Kredensial & proses autentikasi | security/credential contract di luar P4 (#85) |
| Node registry | P6 (#100) |
| Telemetry backend | P9 (#101); P4 hanya menjamin field observable ada |

Kontrak ini tidak mengandung logika transport/runtime; invariant di-enforce di
konstruktor dan `validate()` yang murni (pure).

## 3. Type inventory (single vocabulary)

| Type | Peran | Kunci invariant |
| :--- | :--- | :--- |
| `RequestId`, `CorrelationId`, `IdempotencyKey` | identitas bounded (≤128 B, non-empty) | ditolak saat construct **dan** deserialisasi |
| `WorkflowIdentity` | `workflowId` + `workflowVersionId` (n8n `workflow_entity.versionId`) | id non-empty bounded |
| `Generation` | token epoch activation (u64 monotonic) | fencing hanya exact-match (`fence_generation`) |
| `ActivationState` + `CANONICAL_TRANSITIONS` | state machine 7-state (#99 §B) | transisi di luar tabel = ilegal, tanpa self-loop |
| `ActivationRecord` | snapshot activation (proyeksi) | `drain_deadline_ms` ⇔ `Draining`; `last_error` hanya `Failed`/`Degraded` |
| `RouteKind` (6) | keluarga route HTTP | prefix default verbatim n8n (lihat §5) |
| `HttpMethod` (6) | metode webhook node | verbatim `DELETE GET HEAD PATCH POST PUT` |
| `WebhookAuth` (4) | skema auth yang diminta node | verbatim `basicAuth headerAuth jwtAuth none` |
| `RouteRecord` | route terdaftar | path relatif (tanpa `/` awal), `pathDepth ≥ 1`, specificity statis>dinamis |
| `SecurityDecisionRef` | referensi keputusan auth eksternal | `must_admit()` benar hanya untuk `allow` |
| `PayloadRef` | payload inline (≤64 KiB terukur) / external (uri+sha256 lowercase) | binary **hanya** external |
| `MetadataRef` | header/query ternormalisasi | ≤64 entri, nama header lowercase, nilai ≤8 KiB/4 KiB |
| `IngressSourceKind` (11) | pintu masuk | HTTP ⇄ `RouteKind` 1:1; security wajib untuk edge + `event` |
| `IngressEnvelope` (`version: 1`) | objek kanonik pusat | `validate()` penuh; versi asing ditolak |
| `AdmissionState` (8) | kosakata #99 §D verbatim | `accepted/queued` saja yang admit |
| `AdmissionDecision` | keputusan immutable | `duplicate` wajib `duplicateOf`; `retryAfterMs` hanya untuk deferred/rateLimited/unavailable |
| `ResponsePlan` | rencana jawaban HTTP | `responseData` hanya untuk `lastNode`; status 100–599 |
| `ExecutionMode` (10) | verbatim `WorkflowExecuteMode` zod union | termasuk `evaluation`, `chat` |
| `ExecutionRequest` | hand-off P4→P3 | `from_envelope` menolak unresolved/expired |
| `IngressContractError` | error terstruktur, tanpa panic | tiap invariant punya varian alasan |

### Batas eksplisit (§2.4 master prompt)

| Konstanta | Nilai | Motivasi |
| :--- | :--- | :--- |
| `MAX_ID_LEN` | 128 B | identitas tak pernah unbounded |
| `MAX_INLINE_PAYLOAD_BYTES` | 64 KiB | envelope bukan buffer body; besar → `External` |
| `MAX_HEADERS` / `MAX_HEADER_VALUE_BYTES` | 64 / 8 KiB | metadata bounded |
| `MAX_QUERY_PARAMS` / `MAX_QUERY_VALUE_BYTES` | 64 / 4 KiB | metadata bounded |
| `MAX_REASON_CODE_LEN` | 64 B | kode alasan machine-grepable |
| `MAX_ROUTE_PATH_LEN` | 512 B | path route terbatas |

## 4. Lifecycle activation (kanvas P4.2)

```
              ┌─────────────── retry / cleared ───────────────┐
              ▼                                               │
        INACTIVE → ACTIVATING → ACTIVE ⇄ DEGRADED             │
                       │           │        │                 │
                       ├──▶ FAILED ├────────┴─────▶ FAILED ───┘
                       ▼           ▼
                   (rollback)   DRAINING → DEACTIVATING → INACTIVE
                                                └──▶ FAILED
```

Sumber kebenaran transisi = tabel `CANONICAL_TRANSITIONS` di kode (16 transisi).
Catatan desain yang sengaja dipilih:

* `ACTIVE → FAILED` **dilarang langsung** — eskalasi wajib lewat `DEGRADED`
  (kecuali teardown fault: `DEACTIVATING → FAILED`).
* `DRAINING → ACTIVE` dilarang: setelah drain dimulai, jalan keluar hanya
  `DEACTIVATING` (update memakai generation baru).
* `ACTIVATING` punya dua exit bersih: `ACTIVE` (commit) atau `FAILED`/`INACTIVE`
  (rollback parsial selesai — sejalan rollback activation n8n yang menutup
  kembali trigger yang sempat start; contract `trigger.contract.md` §7).

## 5. Jangkar kompatibilitas n8n 2.9.4 (verbatim)

| Kosakata | Nilai | Sumber referensi ter-pin |
| :--- | :--- | :--- |
| `ExecutionMode` | `cli, error, integrated, internal, manual, retry, trigger, webhook, evaluation, chat` | `packages/workflow/src/execution-context.ts:33` (`WorkflowExecuteModeSchema`) |
| `ActivationMode` | `init, create, update, activate, manual, leadershipChange` | `packages/workflow/src/interfaces.ts:2929` |
| Route prefixes (default) | `/webhook/ /webhook-test/ /webhook-waiting/ /form/ /form-test/ /form-waiting/` | `packages/@n8n/config/src/configs/endpoints.config.ts:97-119` |
| `HttpMethod` | `DELETE GET HEAD PATCH POST PUT` | `packages/nodes-base/nodes/Webhook/description.ts:84-104` |
| `WebhookAuth` | `basicAuth, headerAuth, jwtAuth, none` | ibid `:58-70` |
| `ResponseMode` | `onReceived, lastNode, responseNode, streaming` | ibid `:131-171` |
| `ResponseDataKind` | `allEntries, firstEntryJson, firstEntryBinary, noData` (default `firstEntryJson`, hanya mode `lastNode`) | ibid `:190-220` |
| `RouteRecord.pathDepth` | analog `pathLength` (segmen non-prefix) — tie-break specificity | `packages/cli/src/webhooks/webhook.service.ts:94` |
| `AdmissionState` | `accepted, queued, deferred, rateLimited, rejected, duplicate, expired, unavailable` | Issue #99 §D (kosakata P4 baru, disahkan di sini) |
| Activation states | `inactive, activating, active, degraded, failed, draining, deactivating` | Issue #99 §B + P4 Master Prompt §P4.2 |

Prefix endpoint **dapat dikonfigurasi** di n8n (env); kontrak menyimpan path
relatif dan hanya mem-fungsikan prefix default sebagai `default_path_prefix()`.

## 6. Relasi dengan kode existing (tidak ada sumber kebenaran ganda)

| Existing (agent-01 / P3) | P4.1 | Relasi |
| :--- | :--- | :--- |
| `n8n-workflow/src/trigger.rs::ExecutionMode` (4-nilai subset) | `ingress_contract::ExecutionMode` (10 nilai penuh) | subset ⊆ penuh; adapter eksplisit datang bersama P4.2 (tidak ada cast diam-diam); dua tipe sengaja terpisah karena beda layer (internal trigger-LEGO vs kanonik ingress) |
| `trigger.rs::ExecutionRequest` (per-emit, data-first) | `ingress_contract::ExecutionRequest` (identitas end-to-end + fence + payload-ref) | layer berbeda: trigger-LEGO internal vs batas P4→P3. Konvergensi lewat adapter eksplisit di slice konsumen |
| `trigger.rs::ActivationMode` | `ingress_contract::ActivationMode` | string serde identik; kanonik activation P4 hidup di P4.2 memakai tipe ini |
| `contracts/trigger.contract.md`, `webhook.contract.md`, `scheduler.contract.md` (Phase-2, read-only) | dokumen ini | tidak memodifikasi; mendekomposisi kosakata P4 di atasnya |

`Cargo.toml` root, `Cargo.lock`, `contracts/**`, dan file milik agent lain: **tidak
disentuh** (lihat evidence §A).

## 7. Error behaviour

Seluruh pelanggaran kontrak muncul sebagai `IngressContractError` terstruktur.
Semantik global: **fail-closed** — nilai di luar kontrak ditolak; tidak pernah
dipetakan diam-diam ke perilaku lain. Tidak ada `panic!`/`unwrap` di kode
non-test. Deserializer wire memvalidasi hal yang sama dengan konstruktor (bounded
ids, digest sha256, dsb.) sehingga JSON jahat tidak dapat membentuk nilai ilegal.
`IngressContractError` dapat dipetakan 1:1 ke `admission_reason::*` codes oleh
P4.5 (mis. `MissingSecurityDecision → AUTH_DENIED`, `StaleGeneration →
STALE_GENERATION`, `InlinePayloadTooLarge → BODY_TOO_LARGE`).

## 8. Versioning & rollout

* `ingress.contracts@0.1.0` — beku per PR P4.1; konsumen pertama: P4.2
  (activation lifecycle runtime) dan P4.3 (webhook adapter).
* Perubahan *additive* (field baru `Option`, varian baru) → bump minor +
  catat di sini. Perubahan semantik nilai yang sudah beku → kontrak baru.
* `ENVELOPE_VERSION` di kode menjaga wire envelope; kenaikannya mengikuti
  versi kontrak envelope, bukan otomatis mengikuti versi dokumen.

## 9. Known limitations (jujur, dicatat saat pembekuan)

1. Belum ada runtime apa pun: atlas route, admission queue, dan scheduler
   sengaja tidak ada di 0.1.0 — kontrak dulu (P4.1), mesin menyusul (P4.2+).
2. Performance gate #109 (p50/p95 lookup, allocs/request dsb.) **belum
   diklaim apa pun** — baru bisa diukur saat route atlas (P4.3) dan admission
   (P4.5) ada; kontrak sengaja membawa field yang dibutuhkan pengukuran
   (`pathDepth`, `priority`, batas byte eksplisit).
3. `tenant_id` adalah placeholder string Options — model tenant penuh mengikuti
   keputusan #78 (single-tenant-first).
4. Prefix path non-default (konfigurasi env n8n) menjadi tanggung jawab adapter
   P4.3; kontrak menyimpan path relatif agar aman terhadap perbedaan prefix.
