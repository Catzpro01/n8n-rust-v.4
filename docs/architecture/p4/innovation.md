# P4.8 — Advanced Ingress Efficiency (Innovation, Issue #111)

> Issue kanonik: [#111](https://github.com/Catzpro01/n8n-rust-v.4/issues/111).
> Modul: `crates/n8n-common/src/innovation.rs` (versi P4.8).

## Aturan keras yang dipegang

Setiap fitur:
- **optional/toggleable**, **disableable**, **observable**, **rollbackable**;
- **default = perilaku n8n canonical** (tak ada perubahan semantik senyap);
- **tidak memperlebar keamanan**, **tidak mem-bypass auth**, **tidak membuat
  queue tak terbatas**, **telemetri basi ⇒ conservative fallback**.

## Fitur diterapkan

| #111 | Nama | Implementasi | Default |
|---|---|---|---|
| 1 | Route Atlas | kompilasi immutable + pointer generation + `AtlasSwap` (atomic hot-swap; atlas lama drains-retired; derived state rebuildable) | kosong (derived on demand) |
| 2 | Predictive/Adaptive (amannya: clamp) | `adapt_limits` — hanya sesuaikan dalam hard ceilings; stale ⇒ min+defer | tak aktif tanpa telemetri |
| 3 | Payload Capsule | handle capability-scoped (`seal`/`assert_access`), tenancy+generation, TTL bounded; tanpa global content-addressable store | — |
| 4 | Burst Fusion | `coalesce_events` — opt-in hanya untuk source terdeklarasi; window+max-aggregate; deterministik; audit merged-count | **enabled=false** |
| 5 | Brownout/QoS | `next_brownout` (NORMAL→…→CRITICAL) + `qos_decide` (Admit/DeferLowPriority/RejectOptional/Unavailable) | NORMAL |
| 6 | Flight recorder | ring bounded 1024 metadata ter-sanitize; `promote` untuk diagnostik | kosong |

## Deferred → P4.9 (didokumentasikan eksplisit)

- **#8 Deterministic Ingress Replay** — alat verifikasi kompatibilitas
  (admission-only / route-resolution-only / dry-run / compat-comparison)
  akan diterapkan sebagai bagian dari matrix kompatibilitas P4.9 (bukan
  fitur runtime tersendiri).
- **#2 adaptive controller** penuh (multi-input loop) terikat ke hardware
  observability #107 — clamp-nya sudah di sini, loop-nya di P4.9.
