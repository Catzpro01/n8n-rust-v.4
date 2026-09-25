# P4-S01 Evidence — Ingress Efficiency Remainder (Issue #111 items 2, 9, 10; #225 item 1)

Slice: **P4-S01** · Program: P4 (Ingress) · Modul: `crates/n8n-common/src/innovation.rs`
(+ re-export surface `crates/n8n-common/src/lib.rs`, capability registration
`apps/n8n-lego/src/lego/manifest/domains.json`).

Scope delivered — the four items P4.8 explicitly deferred:

| # | Issue | Item | Status |
|---|---|---|---|
| 1 | #111 | item 2 — predictive admission controller (**full**) | delivered |
| 2 | #111 | item 9 — shadow compatibility path | delivered |
| 3 | #111 | item 10 — P4 self-profiling | delivered |
| 4 | #225 | item 1 — dedicated webhook/ingress plane | delivered |

## Hasil test (rig offline, exit 0)

- **321 tests green** workspace, 0 failures, 0 warnings
  (293 baseline → **+28 P4-S01**, all inside `innovation::tests`).
- `cargo fmt --all -- --check` clean (rustfmt 1.8.0-stable).
- `cargo check --workspace` clean, no warnings.
- JS side unchanged in behaviour: `lego:arch` OK, `lego:arch:selftest` 26/26,
  `lego:capabilities` 22 REST features vs **101** registered capabilities OK,
  `lego:foundation` OK, `lego:foundation:selftest` 15/15, `lego:scaleout` OK,
  `lego:ai:check` in sync (101 files).
- `apps/n8n-lego` suite: **2662 pass / 3 fail** — byte-identical to the
  pre-change baseline (the 3 failures are pre-existing node-catalog REST tests,
  confirmed by re-running with the delivery changes stashed).

## Coverage

### (1) Predictive admission controller (full) — #111 item 2

| Behaviour under test | Test |
|---|---|
| Default = canonical n8n limits (feature off) | `admission_defaults_are_canonical_and_zero_pressure` |
| Calm telemetry never backs off | `admission_calm_telemetry_never_backs_off` |
| Monotone in **every** observed signal (latency, error rate, CPU, memory, queue depth, burst, completion rate, admission rate) | `admission_pressure_is_monotone_in_every_observed_signal` |
| Reacts to the worst single signal | `admission_pressure_reacts_to_the_worst_signal` |
| Never exceeds hard ceilings (64 randomised pressure steps) | `admission_backoff_never_exceeds_hard_ceilings` |
| `AdmissionTargets` carries **no** security/permission/auth field (structural proof) | `admission_targets_carry_no_security_or_permission_surface` |
| Stale telemetry ⇒ conservative fallback | `admission_stale_telemetry_falls_back_conservatively` |
| Stale is never more aggressive than calm | `admission_stale_is_not_more_aggressive_than_calm` |
| Queue budget bounded by the **observed** capacity | `admission_queue_budget_is_bounded_by_observed_capacity` |
| Hysteresis prevents target flapping; big jumps still land | `admission_controller_hysteresis_prevents_flapping` |
| Disabled controller stays canonical across 8 observations | `admission_controller_disabled_stays_canonical_across_observations` |
| Legacy `adapt_limits` shrink branch is no longer a no-op | `admission_clamp_fix_keeps_adapt_limits_within_bounds` |

### (2) Shadow compatibility path — #111 item 9

| Behaviour under test | Test |
|---|---|
| `Disabled` is the default; candidate never invoked | `shadow_disabled_is_default_and_runs_canonical_only` |
| All six dimensions compared (route, status, shape, admission, error, ordering) | `shadow_compares_all_six_dimensions` |
| Candidate side effects always suppressed — no duplicated external effect | `shadow_never_duplicates_real_external_side_effects` |
| Report round-trips through serde | `shadow_reports_are_round_trip_serializable` |

### (3) P4 self-profiling — #111 item 10

| Behaviour under test | Test |
|---|---|
| Disabled by default; records nothing (zero cost) | `profiler_is_disabled_by_default_and_records_nothing` |
| Records all six signals (lookup, admission, wait, copy, allocation, worst) | `profiler_records_all_six_signals` |
| Flags slow route patterns, worst-first | `profiler_flags_slow_route_patterns` |
| Hard-bounded; overflow counted, never stored | `profiler_is_bounded_and_drops_beyond_the_hard_limit` |
| Reset clears derived state | `profiler_reset_clears_derived_state` |
| eBPF is complementary only; internal profile still records | `profiler_ebpf_is_only_complementary` |

### (4) Dedicated webhook/ingress plane — #225 item 1

| Behaviour under test | Test |
|---|---|
| Intake is structurally separate from control plane | `plane_kinds_separate_intake_from_control_plane` |
| 1000-request webhook burst cannot starve editor/API | `webhook_overload_cannot_starve_control_plane` |
| Admission follows the QoS policy | `plane_admission_uses_qos_policy` |
| Response streaming/offload releases the intake buffer | `plane_offloads_responses_out_of_the_intake_buffer` |
| Offload is opt-in | `plane_response_offload_is_opt_in` |
| Plane stats observable (admitted/deferred/rejected/buffered/offloaded) | `plane_stats_are_observable` |

## Bugs found and fixed while delivering this slice

1. **`adapt_limits` shrink branch was a no-op.** The pressure path computed
   `hard.min_route_concurrency.max(hard.min_route_concurrency)` — identical to
   `min_route_concurrency` — so the "adaptive" controller was a binary clamp
   between min and max with no gradient at all. Now it backs off proportionally
   to the queue overshoot, clamped to `[min, max]`. Regression-locked by
   `admission_clamp_fix_keeps_adapt_limits_within_bounds`.
2. **Queue budget could exceed the observed queue capacity.** When
   `queue_capacity < min_queue_budget`, the clamp floor forced the budget *above*
   the real queue bound — an unbounded-queue shape. Both `predict_admission` and
   `AdmissionController::observe` now derive the floor from
   `min(min_queue_budget, effective_queue_cap)`.
3. **Hysteresis swallowed the first observation.** `last_pressure_permille`
   started at `0`, so any first reading inside the deadband was discarded. It is
   now `Option<u64>`: the first observation always applies, the deadband only
   suppresses subsequent jitter.
4. **`QosAction` lacked serde derives**, which blocked the shadow path from
   serialising the admission dimension. Derives added in-file.

## Acceptance anchors (Issue #111 / #225) and where each is met

| Anchor | Where |
|---|---|
| Observes latency, queue depth, CPU/memory pressure, admission rate, completion rate, error rate, recent burst shape | `AdmissionTelemetry` — all eight fields mandatory, no `Option` |
| Adjusts **only** per-route concurrency, per-workflow concurrency, queue budget, low-priority admission, defer threshold | `AdmissionTargets` — exactly five fields |
| Safety limits are immutable hard ceilings | `AdmissionCeilings`; `admission_backoff_never_exceeds_hard_ceilings` |
| Cannot widen security permissions / cannot bypass authentication | Structural: no such field exists on `AdmissionTargets`; `admission_targets_carry_no_security_or_permission_surface` |
| Cannot create unbounded queues | `queue_budget <= min(queue_capacity, max_queue_budget)`; `admission_queue_budget_is_bounded_by_observed_capacity` |
| Stale telemetry ⇒ conservative fallback, not aggressive admission | `predict_admission` early-return; `admission_stale_telemetry_falls_back_conservatively`, `admission_stale_is_not_more_aggressive_than_calm` |
| Shadow compares route selection, status, response shape, admission, errors, observable ordering | `compare_shadow` — six dimensions; `shadow_compares_all_six_dimensions` |
| Shadow never duplicates real external side effects | `run_shadow` always executes only the reference's declared effects; `shadow_never_duplicates_real_external_side_effects` |
| Self-profiling optional and low-overhead | `ProfileConfig.enabled` defaults `false`; `record` returns immediately; `profiler_is_disabled_by_default_and_records_nothing` |
| Self-profiling records route lookup, admission, queue wait, payload-copy cost, allocation pressure, slow route patterns | `ProfileSample` + `RouteProfile`; `profiler_records_all_six_signals`, `profiler_flags_slow_route_patterns` |
| eBPF only complementary on Linux, never a P4 runtime dependency | `ProfilerBackend::{Internal, EbpfComplement}`; `profiler_ebpf_is_only_complementary` |
| Dedicated plane separates webhook intake from editor/API and execution workers | `PlaneKind` + `PlaneTopology`; `plane_kinds_separate_intake_from_control_plane` |
| Bounded request buffering | `IngressPlane::admit` rejects when `buffered >= capacity`; `webhook_overload_cannot_starve_control_plane` |
| Admission control | `IngressPlane::admit` delegates to `qos_apply`; `plane_admission_uses_qos_policy` |
| Response streaming/offload | `IngressPlane::offload_response` (opt-in); `plane_offloads_responses_out_of_the_intake_buffer`, `plane_response_offload_is_opt_in` |
| UI/API stay responsive under sudden overload | Per-plane budgets; `webhook_overload_cannot_starve_control_plane` |
| Explicit storage/memory bound | `P4Profiler` `max_samples` + `dropped` counter; `profiler_is_bounded_and_drops_beyond_the_hard_limit`; `FlightRecorder`/`RouteAtlas` bounds retained from P4.8 |

## Batasan & kompatibilitas

- Nol perubahan kontrak publik lama; **nol** dependensi baru; nol IO; std-only.
- Semua empat subsistem **opt-in**: default = perilaku n8n kanonical, tanpa
  perubahan semantik pada workflow JSON.
- Tidak ada execution engine kedua, tidak ada workflow definition kedua, tidak
  ada microservice-per-route, tidak ada dependensi wajib pada sistem terdistribusi
  atau Redis, tidak ada AI decision-maker, tidak ada hidden semantic optimizer
  (non-goals Issue #111 dihormati).
- State turunan (profil, atlas, plane buffer) selalu dapat dibuang dan dibangun
  ulang — `P4Profiler::reset`, `PlaneTopology` re-creatable.
- Ownership P3/P5/P6/P9 tidak disentuh: modul ini hanya membaca
  `crate::ingress_contract` dan tidak menulis ke domain lain.

## Artefak

- Implementasi: `crates/n8n-common/src/innovation.rs` (853 → 2708 lines, 11 → 39 `#[test]`)
- Re-export: `crates/n8n-common/src/lib.rs`
- Capability registration: `apps/n8n-lego/src/lego/manifest/domains.json`
  (`webhook.admission-controller`, `webhook.shadow-compatibility`,
  `webhook.self-profiling`, `webhook.ingress-plane`)
- Projections regenerated: `.ai/capabilities.md`,
  `.ai/master/CURRENT_STATUS.md`, `.ai/master/PROJECT_MASTER_PLAN.md`
