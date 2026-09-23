# P4.6 — Event / Manual / Test / Waiting Ingress

> Issue kanonik: [#108](https://github.com/Catzpro01/n8n-rust-v.4/issues/108)
> (parent: [#99](https://github.com/Catzpro01/n8n-rust-v.4/issues/99)).
> Modul: `crates/n8n-common/src/ingress_modes.rs` (versi P4.6).
> Kontrak nilai beku: `ingress.contracts@0.1.0`; lifecycle `activation.rs`;
> admission `admission.rs`.

## 1. Janji slice

Own *non-production ingress modes* (#108) dengan compat n8n kelas satu,
tanpa menembus isolasi P3 (execution internals), P5 (credential), P6 (node registry).

```text
INGEST (mode non-prod)
  → classify intent (NEW vs RESUME vs POLL)
  → mode-specific:
     waiting  → resolve executionId → verdict → 404/409/202 + dedupe key
     manual   → first-emission one-shot (200/409/410)
     test     → one-shot listen (bounded; expired → none)
     event    → verbatim name → action (ActivationLifecycle|Start|Unknown) + fence
  → ModeDecision {execution_mode, http_status, reason_code, admission, dedupe_key}
```

## 2. Distinction new vs resume (kanonik #108)

- `waiting-webhook`/`waiting-form` ⇒ **ResumeExecution** (suspended execution resume);
- semua mode lain (prod/test webhook, form, manual, event, internal, schedule)
  ⇒ **NewExecution**;
- `poll` ⇒ **PollOnce** (legacy, diwakilkan; bukan dijalankan di sini).

## 3. Kompatibilitas referensi (jangkar)

| Spesifikasi #108 | Implementasi | Jangkar n8n |
|---|---|---|
| distinguish new vs resume | `IngressIntent::classify` | waiting-webhooks.ts |
| preserve manual/listen first-emission | `manual_first_emission`, `ListenPool.consume` (one-shot) | test-webhooks.ts |
| test webhook tidak membuat route prod | pool `TestListen` berbatas + expired | test-webhooks.ts |
| waiting resolve executionId + validate state | `resolve_waiting` + `waiting_verdict` | waiting-webhooks.ts (`getExecution`, status checks) |
| duplicate resume protection | dedupe key = executionId + verdict `AlreadyRunning` 409 | waiting-webhooks.ts `ConflictError("running already")` |
| expired/not-found/error states | verdict → 404 (not found), 409 finished/error, 401 signature | waiting-webhooks.ts `NotFoundError`/`ConflictError`/401 `Invalid token` |
| correlation IDs | `ModeDecision` + `ManualTrigger.correlation_id` | — |
| generation checks | watcher fence `STALE_GENERATION` 409 | live-webhooks active-version lookup |
| bounded resource retention | `ListenPool` (MAX 64) + `manual_triggers` + `watchers` bounded | — |
| CORS/security behavior | ACK status 401 untuk signature invalid (host apply CORS) | waiting-webhooks `applyCors` |

## 4. Event ingress

- Nama event verbatim n8n (`n8n.audit.workflow.activated` dsb.;
  `n8n.workflow.started`/`.success`/`.failed`); wraps `EventName` bounded.
- `classify_event` → `ActivationLifecycle` | `StartExecution` | `Unknown`.
- Watcher generation-fenced; event tak dikenal → 404 ignorable.

## 5. Manual/test

- `ManualTrigger` pertama-emisi dilestarikan; kadaluwarsa → 410, duplikat → 409.
- Test webhook `TestListen` first-emission; tidak menetap; `deadline_ms`
  bawaan; ukuran pool ≤ 64 (bounded).

## 6. Batas yang disimpan untuk slice berikutnya

- Journal persistence / replay recovery → P4.7.
- Adaptive policy / lane lanjutan (innovation) → P4.8.
- Kompatibilitas/performance matrix penuh → P4.9.
