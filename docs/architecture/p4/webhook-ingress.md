# P4.3 — Webhook Ingress: Registration, Route Lifecycle, Serving Gate, ACK

> Issue kanonik: [#103](https://github.com/Catzpro01/n8n-rust-v.4/issues/103)
> (parent: [#99](https://github.com/Catzpro01/n8n-rust-v.4/issues/99)).
> Modul: `crates/n8n-common/src/webhook.rs` (versi P4.3).
> Kontrak nilai beku: `ingress.contracts@0.1.0`; lifecycle: `activation.rs` (P4.2).
> Slice ini **tidak mengubah** tipe/invariant kontrak; ia membangun plane webhook
> deterministic di atasnya.

## 1. Janji slice

Memiliki batas produk **webhook ingress** (alur canonical) tanpa menyentuh:
internal eksekusi P3, registry node P6, atau otoritas kredensial P5. Ia
berhenti tepat di handoff `ExecutionRequest → P3` + sebuah ACK HTTP.

```text
INGEST   RawWebhookRequest            (adapter HTTP luar; TIDAK ber-IO di sini)
NORMALIZE normalize_request()         → NormalizedRequest (bounded, deterministic)
RESOLVE  resolve_http()               → RouteResolution::Matched(ResolvedRoute)
SECURITY caller menyetor SecurityDecisionRef (fail-closed: hanya Allow lolos)
SERVING  serving_check()              (state + fence generation, P4.2/P4.1)
EMIT     ExecutionRequest::from_envelope(...)   (P4.5 admission menyempurnakan)
ACK      build_response(plan, …)      → WebhookResponse (status/headers/body)
```

Nilai yang dijamin P4.3:
- **identity prod/test**: prefix `webhook/` ⇄ `webhook-test/` (dan `form*`,
  `webhook-waiting`) dari `RouteKind::default_path_prefix()` P4.1 — 6 prefix n8n.
- **method/path matching** termasuk param `:id` dan wildcard `*`;
  **static mengalahkan dynamic**; tie-break wildcard = `path_depth`
  (analog `pathLength` n8n).
- **route conflicts** = `RouteConflict` fail-closed (registration dibatalkan,
  tidak ada state setengah-jadi — rollback penuh, error tercatat);
- **registration/unregistration** sinkron dengan lifecycle aktivasi
  (register sewaktu `Activating`, commit di `Active`, abort/fail un-register,
  drain/deactivate melepas route);
- **activation coupling + serving gate**: `serving_check` menuntut serving-state
  (test route juga `Activating`) **dan** `fence_generation` exact-match —
  inilah enforcer "route generasi lawas tidak boleh melayani" (anti-replay);
- **response modes** & ACK (`onReceived → 200`, sisanya → 202; `lastNode`/`responseNode`
  menyisakan resolusi data untuk P4.5);
- **normalisasi**: bound body/URI/header/query, klasifikasi payload (JSON inline
  vs string inline vs raw string). Binary-raw difaktorkan oleh adapter;
  inline-string memberi sinyal non-JSON.
- **timeout/body-size limits**: `NormalizeLimits` (body 16 MiB default, URI 16 KiB,
  query param terbatas `MAX_QUERY_PARAMS`).
- **error mapping**: 404 = `NotFound`/`PrefixUnknown`, 405 = `MethodNotAllowed`,
  403 = security, 500 = conflict (deterministik).
- **disabled/unpublished workflow behavior**: tidak ada record aktif → 404
  (perilaku n8n `remove`-after / unpublished truthful → unknown route).
- **stale route cleanup**: `cleanup_stale_routes()` mencabut route yang
  record-nya tidak serving / generation tidak cocok / ter-indeks webhook_id basi.

## 2. Command surface

| Method | Efek |
|---|---|
| `register_workflow(wf, specs, mode, owner, now) -> Generation` | begin activation + mount route prod+test (rollback penuh bila gagal) |
| `commit_workflow` / `abort_workflow` / `fail_workflow` | route prod aktif; abort/fail = unmount |
| `deactivate_workflow(…, kind, …)` | surface idempotent P4.2 + unmount pada boundary non-serving |
| `request_update_workflow` / `apply_pending_update` | drain→teardown→re-register identitas+spec baru (generation baru) |
| `resolve_http(method, raw_path)` | prefix→kind→table→param/wildcard extraction |
| `serving_check(route, activation)` | serving-state + fence exact-match |
| `cleanup_stale_routes()` | cabut route basi; kembalikan route_id yang dilepas |
| `build_response(plan, allowed)` | ACK HTTP deterministik |
| `process_webhook_request(reg, raw, security, limits, now)` | full-flow murni (uji mudah) |
| `normalize_request(raw, limits, now)` | path/query/headers/body → NormalizedRequest |

## 3. Parity n8n 2.9.4 yang diuji

| n8n | P4.3 | Test |
|---|---|---|
| `webhookPath` / method uppercase (6) | `HttpMethod` UPPERCASE wire (P4.1) + `RouteTable` per method | `resolve_returns_not_found_and_method_not_allowed` |
| path params `:id` & wildcard `*` (pathLength) | `:seg`→params, `*`→wildcard tail; static>dynamic; depth tie-break | `resolve_extracts_params_and_wildcard_tail`, `static_beats_wildcard_on_tie` |
| test/dan prod webhook identity | prod+test mounted saat aktivasi (mode Activating) | `register_mounts_test_and_prod_routes` |
| update workflow = deactiv+reactiv | drain→teardown→re-register (gen baru; lama tak melayani) | `generation_fencing_blocks_stale_route_serving` |
| default `responseMode: onReceived` → HTTP 200 | `build_response` 200 + n8n-style body | `full_request_flow_accepts_and_acks` |
| security deny (fail-closed) | 403, tanpa execution handoff | `security_deny_fails_closed` |
| route tidak dikenal → 404 | `NotFound`/`PrefixUnknown` | `resolve_returns_not_found_and_method_not_allowed` |
| generation stale tak boleh dilayani | `ServingDenied::StaleGeneration` | `stale_envelope_is_not_replayed` |

## 4. Batas yang sengaja disimpan untuk slice berikutnya

- **Dedupe/replay idempotency penuh + bounded queues (P4.5)**: fencing stale-generation
  sudah menolak kembali-generasi; dedupe `idempotency_key` replay dari **generasi yang
  sama** = P4.5.
- **Waiting-webhook execution lifecycle + resume (P4.6)**.
- **Journal persistence + recovery crash (P4.7)**.
- **Adapter HTTP sungguhan** (hyper/axum) tetap di luar `n8n-common` (dirancang
  agar source ini bisa di-link tanpa IO).
