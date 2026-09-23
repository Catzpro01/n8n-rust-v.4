# P4.5 — Ingress Admission, Backpressure & Idempotency

> Issue kanonik: [#106](https://github.com/Catzpro01/n8n-rust-v.4/issues/106)
> (parent: [#99](https://github.com/Catzpro01/n8n-rust-v.4/issues/99)),
> mengkonsumsi resource policy [#79](https://github.com/Catzpro01/n8n-rust-v.4/issues/79).
> Modul: `crates/n8n-common/src/admission.rs` (versi P4.5).
> Kontrak nilai beku: `ingress.contracts@0.1.0` (`AdmissionState`/`AdmissionDecision`
> verbatim), lifecycle `activation.rs` (P4.2).

## 1. Janji slice

Satu-satunya pembuat [`AdmissionDecision`] kanonik: hasil mesin receipt
`ACCEPTED, QUEUED, DEFERRED, RATE_LIMITED, REJECTED, DUPLICATE, EXPIRED,
UNAVAILABLE` (verbatim #106). **At-least-once** adalah default yang dijamin
(batasan throughput). Sampai ada bukti end-to-end, **tidak pernah** mengklaim
exactly-once (§ ijazah #106/§99).

```text
ENVELOPE → admit_probe() →
  validitas (P4.1 fail-closed)
  → expiry    (Expired/DEADLINE_EXCEEDED)
  → security  (hanya Allow lolos; Deny/Indeterminate = Rejected/AUTH_DENIED)
  → route/workflow resolve
  → serving + generation fence (Rejected/WORKFLOW_INACTIVE | STALE_GENERATION)
  → dedupe    (Duplicate + duplicate_of, key kanonik)
  → rate limit per-route token bucket (RateLimited + retry_after)
  → overload  (max_in_flight / max_payload_bytes → Unavailable)
  → bounds    (payload > caps → Rejected/BODY_TOO_LARGE)
  → ADMIT     (Accepted + OK) ⇒ host emit ExecutionRequest → P3
```

## 2. Outcome value murni

`AdmissionOutcome::Admitted(AdmissionAccepted{…, envelope})` vs
`AdmissionOutcome::Rejected{admission, retryable}` — deterministic, tanpa
efek eksekusi. `retryable=true` ⇒ host kirim HTTP 429/503 + `retry_after_ms`.

## 3. Bounds & backpressure (deterministik, std-only)

| Kontrol | Mekanisme | Defisiensi |
|---|---|---|
| bounded queue/in-flight | `max_in_flight` (overload → shed Unavailable) | terdefinisi & observabel (`in_flight()`) |
| payload bounds | `max_body_bytes`/`max_payload_bytes` + cap inline P4.1 (`MAX_INLINE_PAYLOAD_BYTES`) | reject BODY_TOO_LARGE |
| per-route limit | token-bucket pure (capacity/refill deterministic, tanpa `rand`) | RateLimited+retry |
| load shedding | overload → Unavailable (preserve health/control, tidak hancur) | — |
| dedupe bounded | `seen_capacity` ring buffer + `dedupe_window_ms` (evict FIFO) | — |
| priority | `Priority` (Low/Normal/High) dibawa envelope; jalur lane khusus = P4.8 | — |
| concurrency | `finish_execution()` melepas slot (host memanggil pasca P3) | — |

Tidak ada queue tak terbatas: semua jendela dihitung dari `AdmissionConfig`
yang divalidasi (config mustahil → `AdmissionError` fail-closed).

## 4. Idempotency

- Default **at-least-once**. Dedupe hanya key kanonik yang eksplisit:
  `canonical_idempotency_key(kind, wf, node, fire_at_ms)` (untuk schedule
  = `sched:{wf}:{node}:{fire_at_ms}`; untuk webhook/event = `{kind}:{wf}:{node}`).
- Replay dengan key sama ⇒ `Duplicate` + `duplicate_of` (receipt lengkap
  untuk audit). Generation-fencing menolak callback lawas (P4.2).

## 5. Batas yang disimpan ke slice berikutnya

- Priority-lane & defer-policy lanjutan, observability detail, dan
  adaptive throughput → P4.8 (innovation, toggleable).
- Recovery journal & crash-recovery → P4.7.
- Resume path (waiting) → P4.6.
