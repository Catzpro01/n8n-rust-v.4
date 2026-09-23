# P4.7 — Recovery, Reconciliation & Race Safety

> Issue kanonik: [#107](https://github.com/Catzpro01/n8n-rust-v.4/issues/107)
> (matrix compatibility/security/race) + sisa lifecycle #104 (crash recovery,
> leader change). Modul: `crates/n8n-common/src/recovery.rs` (versi P4.7).

## 1. Janji slice

Melengkapi `ActivationRegistry` (P4.2) dengan instrumen daya-tahan yang selama
ini sengaja ditunda:

1. **Journal bounded** — log kejadian lifecycle replayable (append-only, drop-oldest);
2. **Leadership lease** — guard deterministik (instance-id/epoch/expiry) yang
   menolak command holder-basi (failover/leader change);
3. **Recovery plan murni** — state terputus dipetakan ke aksi konkret,
   urutan canonical, rekonsiliasi (via `ReconcilePlan` P4.2).

Batas: bukan scheduler kedua / sistem terdistribusi. Pemilihan pemimpin milik
host; modul ini hanya menyediakan **bukti** replay & penolakan basi.

## 2. Journal

`Journal.append(wf, event, generation, at_ms)` → `JournalEntry{seq,…}`.
- `MAX_JOURNAL_ENTRIES = 1024` (drop-oldest; `dropped_entries()` observabel).
- replay: `replay_from(after_seq)` — host menerapkan transisi pada registry
  baru (semua command P4.2 idempotent/atomic murni).

## 3. Lease

`LeaderLease { ttl_ms, holder, epoch, expires_at_ms }`:
- `acquire` (kosong/kadaluwarsa ⇒ epoch++); `renew`; `release` — hanya pemilik.
- `assert_held_by(caller, now)` — command dari holder lain / expired / vacant
  ditolak (`HeldByOther`/`Expired`/`Vacant`) — fail-closed.

## 4. Recovery plan

```text
recovery_plan(registry, desired, now, activating_grace_ms) → RecoveryPlan
  actions (urut canonical):
    ResumeDrain          (Draining/Deactivating terputus → selesaikan teardown)
    DeactivateOrphan     (serving tapi tidak desired)
    ActivatingStalled    (Activating > grace → host abort/retry)
    RetryActivation      (Failed & desired)
    ReactivateDesired    (desired tanpa record)
  reconcile: ReconcilePlan (P4.2)
```

Deterministik (sort key), replayable.

## 5. Race matrix (#107) yang tertutup P4.7

| Lomba | Pertahanan |
|---|---|
| leader change | lease epoch — command holder lama gagal |
| delai callback generasi lama | fence P4.2 + watcher fence P4.6 |
| restart vs activation | recovery plan ResumeDrain/ActivatingStalled + journal replay |
| partial route registration failure | rollback fail-closed (P4.3) + journal StaleRouteRemoved |
| duplicate delivery | dedupe key P4.5/P4.6 |

Sisa (adaptive/innovation) → P4.8; matrix penuh + perf → P4.9.
