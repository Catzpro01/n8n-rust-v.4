# PRE_TASK_REPORT

- **AGENT**: `agent-4`
- **LEGO COMPONENT**: `expression`
- **TASK**: Replace Rust placeholder in `crates/n8n-expression/` with a 1:1 JavaScript/TypeScript port of n8n v2.9.4 Expression evaluator (Expression + WorkflowDataProxy) under `packages/`, satisfying all 6 expression reference golden cases.
- **BRANCH**: `arena/01a0b206-n8n-rust-v-4`
- **TIMESTAMP (UTC)**: `2026-09-18T01:05:00Z`
- **STATUS**: `RUNNING`

## Scope (Isolasi Modul — LEGO expression milik Agent-4)
- ✅ Create `packages/expression-lego/` (TS + JS, ZERO Rust).
- ✅ Implement `isExpression`, `Expression#getParameterValue`, `Expression#resolveSimpleParameterValue`, `WorkflowDataProxy` semantics covering the 6 reference cases (01-json-access … 06-expression-inside-parameter).
- ✅ Sandbox guard for `.constructor` (E9), `$env` denial when no provider (E10), `ExpressionError` / `ApplicationError` hierarchy (§6 contract).
- ✅ Provide a test harness that runs the 6 `tests/reference/expression/*` golden cases against the port and asserts 100% match with `expected.json`.
- ❌ Tidak menyentuh: `crates/**` (tidak menulis Rust), `packages/workflow-lego/**` (milik Agent-1), `packages/nodes-base`, core/connection/persistence modules milik agent lain.

## Verification Plan (Bukti Mesin)
1. `node --check` setiap file JS/TS yang ditambahkan.
2. Node `node:test` runner mengeksekusi 6 golden expression cases dan membandingkan dengan `expected.json` — target 6/6 PASS.
3. Tidak ada referensi Rust yang ditambahkan; tidak ada lintasan lintas-bahasa yang bocor.

## Zero Cross-Language Leak
- Semua pesan error & konstanta mengikuti enum/descriptionKey n8n asli (Inggris teknis) sesuai n8n v2.9.4; modul locale/l10n milik Agent-1/A5 tidak dimodifikasi.
