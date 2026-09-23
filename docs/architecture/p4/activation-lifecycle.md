# P4.2 — Activation + Generation Lifecycle

> Issue canonik: [#104](https://github.com/Catzpro01/n8n-rust-v.4/issues/104)
> (parent: [#99](https://github.com/Catzpro01/n8n-rust-v.4/issues/99)).
> Modul: `crates/n8n-common/src/activation.rs` (versi P4.2).
> Kontrak nilai beku: `ingress.contracts@0.1.0` (P4.1) — slice ini **tidak
> mengubah satu pun tipe/invariant kontrak**; ia membangun runtime
> deterministic di atasnya.

## 1. Janji slice

Master prompt P4.2: *"aktivasi lama tidak boleh terus memproses request
setelah generation baru aktif."* Registry menegakkannya dua lapis:

1. **`may_serve(workflow_id, observed_generation)`** — gate serving yang
   fail-closed: state harus serving (`Active`/`Degraded`) **dan**
   fence generation exact-match (lihat P4.1). Generation baru commit ⇒
   request yang tertangkap pada generation lama selalu tertolak — tanpa
   kecuali, tanpa time-out heuristik.
2. **CAS per command** — setiap command mutasi menerima
   `expected: Option<Generation>` ("saya memutuskan ini berdasarkan
   generation X"). Ketidakcocokan = `StaleCommand`, state tidak disentuh.
   Ini memberikan kontrol deterministik pada host multi-writer
   (lock eksternal tetap milik host; registry sync menurut kontrak batas).

## 2. Mesin state (target → state)

Semua transisi melewati satu fungsi `transition()` yang:

- menolak transisi di luar `CANONICAL_TRANSITIONS` (`IllegalTransition`);
- memberlakukan invariant: `last_error` hanya hidup pada `Failed`/`Degraded`,
  `drain_deadline_ms` wajib tepat pada `Draining` (boundary membersihkan
  riwayat fault & deadline);
- memvalidasi record (`ActivationRecord::validate`) **sebelum** simpan —
  registry tidak dapat memegang state ilegal (fail-closed by construction).

```
                begin_activation
        ┌───────────────────────────────┐ (generation baru, monotonic)
        ▼                               │
   INACTIVE ──► ACTIVATING ──► ACTIVE ──┤ ► DEGRADED ► (recover) ACTIVE
                 │       (abort)        (escalate) ▼
                 └──► INACTIVE ═ reset     FAILED
        ACTIVATING ──► FAILED ──► ACTIVATING  (retry = generation baru)
   ACTIVE/DEGRADED ──► DRAINING ──► DEACTIVATING ──► INACTIVE
                  DEACTIVATING ──► FAILED (teardown gagal → rekonsiliasi)
```

(Diagram ringkas; tabel transisi otoritatif tetap `CANONICAL_TRANSITIONS`
milik `ingress.contracts@0.1.0` — tidak ada satu pun edge baru di slice ini.)

### Command surface (ringkas)

| Method | Transisi | Catatan |
|---|---|---|
| `begin_activation` | `Inactive|Failed → Activating` | generation **next** monotonic per workflow; mengembalikan generation baru |
| `commit_activation` / `abort_activation` / `fail_activation` | `Activating → Active/Inactive/Failed` | commit membersihkan error (≈ deregister pada sukses) |
| `mark_degraded` / `mark_recovered` / `escalate_failure` | `Active ⇄ Degraded → Failed` | degraded tetap serving |
| `begin_drain` (deadline wajib) / `finish_drain` / `begin_deactivation_immediate` | `Active|Degraded → Draining → Deactivating` / langsung `Deactivating` | drain bounded |
| `finish_deactivation` / `fail_deactivation` | `Deactivating → Inactive/Failed` | failed-teardown siap direkonsiliasi |
| `activate()` | composite idempotent: `None/Inactive/Failed → Started`; `Active → AlreadyActive`; `Activating → AlreadyActivating`; sisanya error strict | **parity surface n8n** |
| `deactivate()` | composite idempotent: `Active/Degraded → Draining|Deactivating`; `Activating → CancelledActivation (→Inactive)`; duplikat → `AlreadyDraining/AlreadyDeactivating`; unknown/Inactive/Failed → `NotActive` | parity surface n8n (≈ HTTP 200 idempotent) |
| `request_update` / `take_pending_update` | `Active|Degraded → Draining` + antrian identitas baru, diambil tepat sekali sebelum `begin_activation` | update = flow eksplisit, bukan magic |
| `reconcile(desired)` | murni: hasilkan `ReconcilePlan` | lihat §4 |
| `prune_inactive` | hapus `Inactive` bersih saja | bounded housekeeping |

### Durability note

Records in-memory adalah **projection operasional** canonical-nya P4
(slice ini tidak pernah membiarkan record ilegal tersimpan); persistensi
antar-restart diikat oleh journal P4.7. Sampai P4.7, host diwajibkan mendorong
records/durability melalui `reconcile()` pada startup (lihat §4).

## 3. Update flow (jalur kanonik `activationMode: "update"`)

```
Active(gen=g) ──request_update(target=v2, deadline)──► Draining
   (PendingUpdate{target:v2} ter-antri; request baru ditolak;
    in-flight diselesaikan hingga deadline)
──finish_drain──► Deactivating ──finish_deactivation──► Inactive
   pending = take_pending_update(wf_id)   // konsumsi tepat sekali
──begin_activation(pending.target, Update)──► Activating(gen=g+1)
──commit_activation──► Active(gen=g+1)
```

Aborsi tiket tua seluruhnya terjadi di fence `may_serve`:
`may_serve(wf, g)` setelah commit `g+1` ⇒ `StaleGeneration` (Invariant).

## 4. Rekonsiliasi startup (deterministic)

`reconcile(&[WorkflowIdentity desired]) -> ReconcilePlan` (value murni,
urutan leksikografik di tiap bucket):

- `to_resume_drain` — records terputus di `Draining/Deactivating` (selesaikan
  teardown dulu; tidak ada request baru selama itu);
- `to_deactivate` — serving/aktif yang **tidak** di-desired (route basi);
- `to_retry_failed` — `Failed` yang masih desired;
- `to_activate` — desired yang belum punya record apa pun.

Protokol eksekusi host: `to_resume_drain` → `to_deactivate` → `to_retry_failed`
→ `to_activate`. Semua idempotent menurut command surface di atas.
Counterpart crash-recovery (ney, journal replay) ada di P4.7.

## 5. Parity n8n 2.9.4 yang diuji

| n8n surface | P4.2 perilaku | Test |
|---|---|---|
| `POST /workflows/:id/activate` idempotent | `activate()` → `AlreadyActive`, generation tak berubah | `activate_surface_is_idempotent_like_n8n` |
| activate ulang pada `Activating` diserialkan | `AlreadyActivating` | `activate_on_activating_is_serialized` |
| `ActiveWorkflows.remove` unknown → warning + sukses | `deactivate()` → `NotActive` | `deactivate_unknown_is_not_active_like_n8n` |
| workflow update → deactiv lalu reactiv (graceful) | `request_update` → drain chain → begin baru | `old_activation_cannot_serve_after_new_generation_commits` |
| activation error terekspos (`GET /rest/active-workflows/error/:id`) | `record.last_error`, dibersihkan saat commit | `failed_activation_retries_with_new_generation` |
| graceful shutdown = remove semua | per-wf `deactivate(Graceful)` + teardown chain | `graceful_deactivation_walks_drain_chain` |

## 6. Yang sengaja TIDAK ada di sini (batas maraton)

- **Journal transaksi / recovery crash / leader failover** → P4.7 (modul ini
  merancang setiap command sebagai langkah atomic murni yang dapat di-journal).
- **Registrasi route HTTP** → P4.3; **scheduler/cron** → P4.4; **admission
  per-request** → P4.5. P4.2 mengatur state dan menerbitkan niat — ia tidak
  pernah memanggil trigger/engine (single-writer sync).
- Multi-instance election: `owner_instance` hanya dicatat; keputusan
  leadership bukan scope P4.2 (ℹ `trigger.contract.md` `ActivationPolicy`).
