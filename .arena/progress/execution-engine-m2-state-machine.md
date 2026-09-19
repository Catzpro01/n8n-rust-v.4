# ARENA AGENT PROGRESS — execution-engine / m2-state-machine

- **Agent**: Arena Agent 2 (Execution Engine) — specialization `execution-engine`
- **Task**: `m2-state-machine` (canonical: `execution-engine/m2-01-state-machine`, Milestone M2, bobot 2.0, Level L1)
- **Task branch (Control Plane)**: `execution-engine/m2-m2-state-machine`
- **Actual session branch**: `arena/01a0ba47-n8n-rust-v-4` — see §5 Branch note
- **Base commit**: `6c82838209465065750c715e2dfd2740359afa4c` (main)
- **Last Updated**: 2026-09-19T15:45:00+00:00

---

## 1. Objective (from decomposition doc §2 M2-01)

FSM penentu status node (`Pending`, `Running`, `Succeeded`, `Failed`, `Skipped`, `Waiting`)
di `crates/n8n-workflow/src/runtime/executor.rs`.

Acceptance criteria:
1. Tidak ada invalid state transition.
2. Status immutable setelah terminal state tercapai.

## 2. Pre-work audit

- `executor.rs` sebelum task ini hanya berisi trait `NodeExecutor` (16 baris) — tidak ada
  state machine di seluruh workspace (`grep` untuk `NodeExecutionStatus|StateMachine` kosong).
  Dekomposisi melabeli M2 `COMPLETE` sebagai status baseline label; kode FSM belum ada →
  implementasi riil dilakukan di task ini.
- `runner.rs` (M1 / `runtime-kernel`) sudah mengeksekusi top-down tanpa tracking status.
  **Tidak disentuh** — integrasi runner = konsumen task M2 berikutnya (`m2-02-task-scheduler`).
- Boundary check: hanya file yang di-allow Control Plane (`executor.rs`) yang dimodifikasi;
  `mod.rs` / `lib.rs` tidak diubah (tipe baru reachable via
  `n8n_workflow::runtime::executor::*`; tidak ada re-export = tidak ada file lintas-boundary).
  Nama baru tidak menabrak symbol lain di 8 crates.

## 3. Implementasi

`crates/n8n-workflow/src/runtime/executor.rs` (+424 baris, trait `NodeExecutor` tak berubah):

- `enum NodeExecutionStatus` — 6 status kanonik, `Copy+Eq+Hash`, serde `snake_case`.
- Tabel transisi (satu-satunya sumber kebenaran legalitas, `can_transition_to`):
  ```text
  Pending  -> Running | Skipped | Failed
  Running  -> Succeeded | Failed | Waiting
  Waiting  -> Running | Failed
  Succeeded | Failed | Skipped -> (terminal, tanpa transisi keluar, self-transition invalid)
  ```
- `InvalidStateTransition { from, to, terminal }` (thiserror). Sengaja **bukan** varian
  `ExecutionError`: `runtime/error.rs` di luar boundary m2-01, dan transisi ilegal adalah
  bug scheduler, bukan node failure.
- `NodeStateMachine` — guard mutasi tunggal `transition()`; rejection = zero mutation
  (status, attempts, last_error tidak tersentuh); `attempts` menghitung entri `Running`
  (dipakai retry-policy m2-04 nanti); `fail(reason)` merekam alasan hanya saat transisi
  sukses; convenience API `start/succeed/fail/skip/wait`; Send+Sync+'static.

## 4. Tests & evidence (2026-09-19, `tools/rust-offline-rig` + /tmp runner variant, §6)

| Perintah | Hasil |
| :--- | :--- |
| `run-m2.sh check` (=`cargo check --offline --workspace --all-targets`) | **PASS** — Finished dev profile |
| `run-m2.sh test` (=`cargo test --offline --workspace`) | **PASS — 123 passed, 0 failed** |
| n8n-workflow lib | 65 passed (53 existing + **12 baru** di `runtime::executor::tests`) |
| Suite lain (common/connection/execution-data/expression/node-model/validation + 4 integration) | semuanya hijau, 0 regresi |
| `run-m2.sh test -p n8n-workflow --lib runtime::executor` | **12 passed, 0 failed** |

Test baru: exhaustive transition matrix (dijadwalkan terhadap tabel harapan independen,
6×6), self-transition-invalid, happy path, Pending→Skipped/Failed pra-dispatch, Waiting
round-trip + timeout→Failed, rejected-transition-tanpa-mutasi, terminal immutability
(dari semua 6 status sumber, 3 terminal), Waiting↛Skipped & Pending↛Succeeded,
fail-hanya-merekam-saat-berhasil, nama snake_case stabil, serde round-trip, Send/Sync/'static.

12 FSM test baru: `exhaustive_transition_matrix_matches_contract`,
`self_transitions_are_always_invalid`, `happy_path_pending_running_succeeded`,
`pending_can_be_skipped_or_failed_before_dispatch`, `waiting_round_trip_and_timeout_to_failed`,
`rejected_transition_never_mutates`, `terminal_states_are_immutable_from_every_status`,
`waiting_cannot_skip_and_pending_cannot_succeed_directly`, `fail_records_reason_only_on_success`,
`status_names_are_stable_snake_case`, `serde_round_trip_snake_case`, `machine_is_send_sync_static`.

## 5. Control Plane / lifecycle notes

- Task **sudah di-claim** oleh orchestrator sebelum sesi ini (in briefing).
- `start_task` / `submit_commit` RPC **tidak dapat dipanggil dari sandbox ini**: tidak ada
  `.env` kredensial dan `AGENT_CONNECT_GUIDE.md` §1 mewajibkan zero-credential di sisi agent;
  koordinasi RPC adalah hak Arena Bridge di VPS. Percobaan via `tools.orchestration.control_plane
  .ControlPlaneClient` terdokumentasi mengembalikan `Missing Supabase URL or Service Key`.
  Bukti SHA commit di-push agar Bridge menjalankan `submit_commit`.
- **Branch note**: sesi Arena Agent Mode terkunci ke branch
  `arena/01a0ba47-n8n-rust-v-4` (platform track per-session-branch; push ke branch lain
  tidak diasosiasikan dengan sesi). Nama task branch kanonik
  `execution-engine/m2-m2-state-machine` valid per `task_manager.BRANCH_REGEX`; orchestrator
  dapat me-rename/fast-forward branch yang di-push ke nama tersebut sebelum CI boundary-guard
  berjalan. Tidak ada merge ke main yang dilakukan dari sesi ini.

## 6. Known issues (pre-existing, bukan dari task ini)

- `tools/rust-offline-rig` tidak meng-vendor `tokio` yang kini menjadi dev-dependency
  `n8n-workflow` (masuk di `6c828382`, bersama `tests/runtime_runner_test.rs`), sehingga
  `run.sh test` gagal resolusi di sandbox. `tokio-macros 2.7.2` tidak memiliki tag upstream
  dan `pin-project-lite` tak tercapai dari jaringan sandbox. Workaround sesi ini:
  `/tmp/rig-m2/run-m2.sh` (clone dari `run.sh` DI LUAR repo, tanpa mengubah file repo):
  strip baris `tokio` dari salinan manifest + keluarkan `runtime_runner_test.rs`
  (satu-satunya konsumen tokio, 4 test async M1). CI/VPS dengan registry asli menjalankan
  suite lengkap termasuk file tersebut. Sebaiknya rig owner (infra/orchestrator)
  meng-update PLAN vendor atau meng-exclude file tsb secara resmi.
- Dekomposisi menandai seluruh M1–M10 `COMPLETE` padahal beberapa artefak (mis. state
  machine ini) baru ada setelah task ini — label status baseline tidak sinkron dengan kode;
  Progress Engine menghitung DONE dari bukti, bukan dari kolom status dokumen ini.

## 7. Next immediate actions (BUKAN scope m2-01 — task lain)

- `m2-02-task-scheduler` (owner `execution-engine`): konsumsi `NodeStateMachine` di ready
  queue runner loop (`Running` pada dispatch, `Waiting` untuk await-resume, terminal guard
  sebelum menulis output). `m2-04-retry-policy-engine`: pakai `attempts()`.
- `submit_commit` oleh Bridge dengan commit SHA = HEAD branch ter-push (lihat pesan commit
  terstruktur `feat(execution-engine): ...`), lalu PR → main oleh flow CI.
