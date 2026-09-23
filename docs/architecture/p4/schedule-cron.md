# P4.4 — Schedule / Cron Semantics & Duplicate-Tick Control

> Issue kanonik: [#105](https://github.com/Catzpro01/n8n-rust-v.4/issues/105)
> (parent: [#99](https://github.com/Catzpro01/n8n-rust-v.4/issues/99)).
> Modul: `crates/n8n-common/src/schedule.rs` (versi P4.4).
> Kontrak nilai beku: `ingress.contracts@0.1.0`; lifecycle: `activation.rs` (P4.2).
> Slice ini **tidak mengubah** tipe/invariant kontrak; ia membangun *kontrak
> jadwal* deterministic — **tanpa mengambil alih implementasi scheduler**
> (baris keras Issue #105).

## 1. Janji slice

```text
HOST CLOCK → on_tick(wf,node,now,scan_interval,resolver) → TickDecision
             ↑ cron parse → next_fire (kebijakan DST) → misfire/overlap/
             duplicate rules → ScheduleExecution {generation, deadline, idem-key}
```

Empat keputusan tick yang deterministik: `Fire` / `NotDue` / `Disabled` /
`NotActive` / `SkipOverlap` / `DuplicateTick` / `MisfireDeferred`.

Kebijakan yang **tidak** boleh diam-diam: setiap perilaku dinyatakan eksplisit
di [`ScheduleSpec`] dan [`CronExpr`] — tidak ada heuristik tersembunyi.

## 2. Timezone / DST (tanpa dependensi baru)

Data IANA hidup di host melalui [`TzResolver`] (dua fungsi). Kontrak
menentukan kebijakan yang wajib dijaga implementasi host:

| Peristiwa | Kebijakan | Perilaku |
|---|---|---|
| **gap** (jam hilang, spring-forward) | `gap_policy` | `ShiftForward` (default): tick dilayani pada menit riil pertama setelah gap; `SkipTick`: occurrence dilewati |
| **fold** (jam ganda, fall-back) | (kontrak `local_to_utc`) | host wajib mengembalikan occurrence **terakhir** → tick dilayani tepat sekali, tanpa duplikat |

## 3. Cron (n8n kompatibilitas)

- 5-field standar `minute hour dom month dow`; 6-field diterima **hanya** bila
  detik `0`/`*`/`*/1` (n8n menjadwalkan pada resolusi menit); detik
  non-trivial → [`CronError::UnsupportedSeconds`] fail-closed.
- Nama bulan & hari, list `,`, range `-`, step `/`.
- Semantik DOM/DOW klasik: keduanya non-wildcard ⇒ **OR**; salah satu
  wildcard ⇒ yang lain yang menentukan.
- `*`/`?` edge ditolak eksplisit; domain diuji (menit 0–59, jam 0–23, dom 1–31,
  bulan 1–12, dow 0–7 dengan 7=0).

## 4. next_fire

- Algoritma kalender [days-from-civil] publik (std-only; no chrono) —
  presisi epoch-menit UTC, deterministik.
- Horizon pencarian `HORIZON_DAYS` = 8×366 hari; pola mustahil (mis. "31 April")
  → `None` fail-closed, tanpa loop.

## 5. Lifecycle (paritas dengan P4.2/P4.3)

`register_workflow` (begin + generation baru) → `commit_workflow`/`abort`/
`fail` (abort/fail = buang schedule) → `deactivate_workflow` (permukaan
idempotent + buang schedule) → `request_update_workflow` +
`apply_pending_update` (drain→teardown→generation baru, tanpa duplikasi).
Setiap schedule `generation`-fenced: tick dari schedule lawas tertolak
fail-closed.

## 6. Duplicate-tick / misfire / overlap / jitter / deadline

| Kontrol | Implementasi | Catatan |
|---|---|---|
| **duplicate-tick suppression** | `last_fired_at_ms` (anchor) maju → occurrence tidak pernah dihitung ulang; lapisan kedua `fired_ticks` (window bounded `FIRED_WINDOW=256`) menolak instant identik bila clock regresi | kunci idempoten `sched:{wf}:{node}:{fire_at_ms}` ikut dibawa di handoff |
| **misfire** | `MisfirePolicy::Skip` (default n8n, backlog tidak dikejar) / `BackfillOnce` (satu occurrence tertinggal terdekat) | deteksi = occurrence lebih tua satu periode scan |
| **overlap** | `OverlapPolicy::Allow` (default) / `Skip` / `QueueOnce` (maks 1 tertunda) | `finish_execution` membebaskan slot |
| **jitter** | `jitter_ms` cap `MAX_JITTER_MS=60s` (host menerapkan random; kontrak menyimpan cap) | — |
| **deadline propagation** | `deadline_ms` dibawa ke `ScheduleExecution` (cap `MAX_DEADLINE_MS=7 hari`) | — |
| **leader ownership/failover** | `owner_instance` dicatat di aktivasi (P4.2); failover penuh = P4.7 | tidak membuat election baru |

## 7. Rekonsiliasi

`reconcile_orphans(desired)` / `remove_orphans` — schedule yang workflow-nya
tidak desired / tidak serving / generation tidak cocok dibuang; kembalikan
id yang dilepas.

## 8. Batas yang disimpan untuk slice berikutnya

- **Journal persistence / recovery crash / leader failover** → P4.7.
- **Eksekusi trigger oleh scheduler sungguhan (waker/job-queue)** → host/adapter;
  modul ini mengeluarkan `ScheduleExecution` (handoff murni).
- Admission bounded queue per tick → P4.5.
