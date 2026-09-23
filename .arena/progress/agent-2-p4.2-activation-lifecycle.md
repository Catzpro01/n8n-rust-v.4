# Progress — P4.2 Activation + Generation Lifecycle (Agent 2)

- Branch: `arena/p4.2-activation-lifecycle` (dari `main@d3952379`, pasca-merge P4.1)
- Filosofi: runtime deterministic di atas kontrak frozen P4.1; single-writer sync;
  no journal (P4.7), no HTTP (P4.3), no scheduler (P4.4).

## Yang tersimpan (slice ini)

1. `crates/n8n-common/src/activation.rs` — `ActivationRegistry`:
   - lifecycle commands (begin/commit/abort/fail activation; degraded/recovered/escalated;
     drain chain; deactivation chain, termasuk `fail_deactivation`);
   - surface idempotent parity n8n: `activate()` (AlreadyActive/AlreadyActivating/Started),
     `deactivate()` (Draining/Deactivating/AlreadyDraining/AlreadyDeactivating/
     CancelledActivation/NotActive);
   - race protection: CAS `expected: Option<Generation>` per command
     (`StaleCommand`), serialization boundary, dan gate `may_serve()`
     (serving-state + fence_generation P4.1 exact-match);
   - update flow eksplisit via `request_update` + `take_pending_update` (konsumsi tepat 1×);
   - `reconcile(&[WorkflowIdentity]) -> ReconcilePlan` (murni, deterministik, 4 bucket);
   - invariant fail-closed: `transition()` satu-satunya jalan transisi; record ilegal
     tidak mungkin tersimpan (`validate()` sebelum insert);
   - 22 unit tests; total workspace **203 green**.
2. `crates/n8n-common/src/lib.rs` — re-export API P4.2.
3. `docs/architecture/p4/activation-lifecycle.md` — desain, command table,
   update flow, protokol reconcile, parity mapping, batas scope.
4. `evidence/P4.2-EVIDENCE.md` — coverage #104 + skenario gate F.

## Keputusan & koreksi mid-slice (§2 checklist, internal)

- **Desain awal membocorkan `last_error` ke Draining** (melanggar invariant kontrak):
  ditangkap pada review sendiri sebelum PR → `transition()` kini menegakkan invariant
  secara wilayah (error hanya Failed/Degraded; deadline hanya Draining); test baterai
  `legal_commands_never_store_invalid_records` mengunci.
- **Koreksi kode**: `ActivationTransitionError::Invariant` dijadikan struct-variant
  (thiserror tuple variant + named field placeholder tidak bareng compile) — tidak ada
  perubahan API public terhadap konsumen nyata (variant masih baru per slice ini).
- **Std-only**: BTreeMap (deterministik), nol penambahan dependensi/lockfile.

## Ucapan downstream (untuk P4.3+)

- P4.3 (webhook ingress) wajib memakai `may_serve(wf, gen)` + peta route-nya sendiri;
  `gen` = output `begin_activation/route registration` pada sesi ini.
- P4.7: journal semua command registry (masing-masing langkah atomic murni).

## Lanjutan — P4.3 Webhook ingress (sesi sama)

- Modul `crates/n8n-common/src/webhook.rs`: route table (prod/test/waiting),
  matcher literal/`:param`/`*` (static>wildcard, depth tie-break), registration
  lifecycle sinkron activation (rollback fail-closed + error tercatat), surface
  update via `request_update_workflow`/`apply_pending_update`, `resolve_http`,
  `serving_check` (state+fence), `cleanup_stale_routes`, `normalize_request` bounded,
  ACK `build_response`, `process_webhook_request` full-flow murni.
- 16 test baru → workspace **219 green**; fmt bersih (file slice); nol dependensi,
  nol IO (adapter HTTP tetap di luar n8n-common).
- Koreksi mid-slice: normalizer URL boundary (MAX_URI dari `NormalizeLimits`,
  bukan konstanta imajiner), error `TooManyHeaders`, `HttpMethod`-keyed maps pakai
  `HashMap` (HttpMethod: Hash≠Ord), wildcard_open dead-code dibuang, tes rollback
  (spec-ilegal gagal *sebelum* activation, bukan Failed), rollback konflik membuktikan
  record=Failed+last_error+route kosong.
