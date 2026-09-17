# TASK-406-expression-conformance — Result

**Status:** SUCCESS — expression shell ported, all 90 runtime probes audited.
**Branch:** `arena/01a0aff6-n8n-rust-v-4` (Rust campaign; no aff7 porting).

## Scope

`tournament.execute` (third-party JS evaluator) and the `WorkflowDataProxy`
are not portable to pure Rust. Ported instead: the exact first-party SHELL
around them (`expression.ts`, `expression-helpers.ts`) with the evaluator
injected as `Fn(&str) -> Result<EvalValue, EvalFault>` — plus a complete
probe-by-probe audit of `tests/reference/expression/01-06` against the
kept regex backend.

## Changes

- **Fixed**: `is_expression` is now the exact `charAt(0) === '='` gate.
  The old brace-sniffing version wrongly rejected `"="` and wrongly
  accepted brace-bearing plain strings; zero callers outside this
  crate's tests (audited by grep).
- **Ported**: `resolve_leaf` (identity / strip `=` / constructor-regex
  rejection / function-return errors / string passthrough /
  `returnObjectAsString`), `classify_render_outcome` (rethrow /
  `invalid syntax` / else `null`), `convert_object_value_to_string`
  (`[Object: …]` / `[Array: …]`, spacing replacements in order),
  `resolve_value` (recursive walk, order-preserving), `ExpressionError`
  (name/message parity; engine-owned `context` stays out).
- **Kept**: `resolve_template` / `evaluate_simple_json_path` as the
  documented limited backend (`$json.path` interpolation only) behind
  `simple_backend_evaluate` — behaviour-identical, gap-listed, not a
  claim of JS evaluation.
- **Audit** (`crates/n8n-expression/tests/expression_fixtures.rs`): 6
  value matches + 2 shell-error matches (constructor rejections pinned
  name+message vs the runtime oracles) + an 82-row gap table with
  classified per-probe reasons; E1 over all 87 string probes; the 06
  object probes pin walk structure plus per-leaf gaps. The peer suite's
  `assert!(!is_expression("="))` flipped to `true` with its demanded
  caller audit; its gap test generalized from 01-only to all 90.
- No new fixture files; no other crate touched; no reference modification.

## Evidence

- `cargo test --workspace`: 99 passed / 0 failed (90 + 5 lib + 4 fixture)
- `cargo check --workspace --all-targets`: no warnings
- `contract_conformance.mjs`: 43/43; `rust_conformance_audit.py`: PASS 7/7
- `boundary_audit.py`: PASS; `run_gate.sh --offline-only`: offline PASS
  (live 11/11 NOT RUN — no docker, as before)
- `phase3-rust-acceptance.sh --force`: PASS (record refreshed post-commit)
- Doc: `docs/isolation/expression.md` §14; bus:
  `connection-bus-outbox.json` `C3-MSG-05` (NOT_DELIVERED, orchestrator flush)

## Notes for reviewers

- Quirks ported, not fixed: the unanchored constructor regex (`. constructor`
  and `x.constructors` also trip it), the dead `typeof !== 'object'` line,
  unthreaded `siblingParameters`, the frontend-only `TypeError` quirk.
- `undefined` maps to `Value::Null` (TASK-405 N6/P2 convention).
- Two hand-derived expectations needed correction during the run (the
  `,"` spacing only fires before quotes, so `[true,null]` keeps no
  space; both caught by the suite, not shipped).
- Full JS evaluation, the data proxy (runData/graph/pairing/timezone),
  extensions, and `DateTime` stay out of scope — each gap-table reason
  names its blocker.
