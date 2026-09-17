# TASK-EXP-A1..A5 — Integration record & cross-review (Agent 5)

**Role:** Agent 5 — Integration & Verification Guardian
**Branch:** `arena/01a0b16c-n8n-rust-v-4` — integrated on top of the branch's Phase-6 commit `40e79e81`
(base `agent-5` @ `9f231b0f`; `agent-5` head at audit time `832b4d14`)
**Reference:** n8n `2.9.4` (`reference/n8n`, upstream `b6dc2787c45677a29a9612cd27eb911302961a83`)
**Audit date:** 2026-09-18
**Task round audited:** `TASK-EXP-A1` … `TASK-EXP-A5` (results landed on `main` @ `821fb4a7`)

---

## 1. What the round actually delivered

Each agent wrote self-contained TypeScript modules into `packages/reconstructed-engine/src/`
(i18n dictionaries + small guards). The results (`results/TASK-EXP-A*.md`) reached `main`;
**the modules did not** — `main` still contains only `runner.mjs` and `test-run.mjs` for that
package. This is the recurring `ISSUE-001` pattern: the `agent → Agent 5 → integration → main`
flow was bypassed, only the receipts were merged.

This branch performs the missing integration step: all 16 peer modules are copied in verbatim,
with the provenance table below acting as the audit trail.

## 2. Provenance of the integrated modules

| module (`packages/reconstructed-engine/src/`) | owner | source commit | LOC | sha256[:12] |
| :--- | :--- | :--- | ---: | :--- |
| `canvas-node-locales.ts` | agent-3 (dictionary, kept as data) | `07da615a` | 33 | `0d4c1bf72885` |
| `dag-cycle-detector.ts` | agent-4 | `ce32a391` | 46 | `ff891b1da2f0` |
| `enterprise-feature-unlimited.ts` | agent-4 | `ce32a391` | 24 | `443d8459f020` |
| `expression-error-handler.ts` | agent-2 | `bd55d4b0` | 21 | `d412314f3a01` |
| `lego-frontend-contract.ts` | agent-4 | `ce32a391` | 21 | `fb521d5048a0` |
| `memory-leak-auditor.ts` | agent-5 | `9f231b0f` / `832b4d14` | 21 | `090606b71736` |
| `merge-node-validator.ts` | agent-4 | `ce32a391` | 8 | `4568ae8d893c` |
| `natural-error-pipeline.ts` | agent-3 | `07da615a` | 17 | `dc4cd99df849` |
| `node-catalog-dictionary.ts` | agent-1 | `69613564` | 91 | `fd367fdb0e37` |
| `node-parameter-label-sanitizer.ts` | agent-2 | `bd55d4b0` | 96 | `491173e7d4c7` |
| `persistence-integrity.ts` | agent-5 | `9f231b0f` / `832b4d14` | 14 | `e6110232affe` |
| `rtl-layout-boundary.ts` | agent-2 | `bd55d4b0` | 17 | `4ef30bffec73` |
| `schema-persistence-guard.ts` | agent-5 | `9f231b0f` / `832b4d14` | 5 | `9d240384b509` |
| `settings-locale-persistence.ts` | agent-1 | `69613564` | 20 | `f0c874d857c5` |
| `settings-localization.ts` | agent-1 | `69613564` | 37 | `fbfa0e215e17` |
| `settings-personal-view-bridge.ts` | agent-1 | `69613564` | 12 | `9e2bdfd1af29` |
| `unicode-utf8-sanitizer.ts` | agent-3 | `07da615a` | 18 | `0df238aa9cf6` |
| `universal-locale-enforcer.ts` | agent-5 (**this cycle**) | — | 210 | `459774b03a08` |
| `update-banner-filter.ts` | agent-2 | `bd55d4b0` | 6 | `da548905b22d` |
| `webhook-sanitizer.ts` | agent-3 | `07da615a` | 22 | `8974c8d54812` |
| `workflow-canvas-text-translator.ts` | branch (Phase-6 function form) | `40e79e81` | 14 | `d3fb83071e4f` |

`workflow-canvas-text-translator.ts` already existed on this branch in a *function* form
(`translateCanvasNodeSubtitle`), while agent-3's `TASK-EXP-A3` increment is the *dictionary* form.
Both are kept — the branch implementation is untouched, the dictionary is integrated as
`canvas-node-locales.ts` so the leak gate can audit it.

## 3. Cross-review — 3 rubrics

The standing protocol (`docs/isolation/STANDING-WORKER-PROTOCOL.md` §3) requires a review against
three written rubrics; they are stated here explicitly so the vote is reproducible:

| # | Rubric | Pass condition |
| :-- | :--- | :--- |
| R1 | **Boundary** | touches only `allowed_paths`; no `reference/n8n/**`, no `crates/`, no `apps/`, no `editor-ui`/Vue/SCSS assets; additive-only |
| R2 | **Contract & behaviour** | no contract violated; module is self-contained (no hidden runtime coupling); the engine still executes end-to-end |
| R3 | **Evidence** | machine-verifiable evidence exists for the claimed behaviour (tests, audits, exit codes) |

### Verdicts

| task | owner | R1 boundary | R2 contract | R3 evidence | verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `TASK-EXP-A1` | agent-1 | PASS — 4 files, `packages/reconstructed-engine/src/**` only, 0 imports | PASS — additive, pure data + pure functions | **FAIL** — `TRIGGER_PANEL_LOCALES` covers 14/21 keys per non-reference locale (28 gaps) | `NEEDS_CORRECTION` |
| `TASK-EXP-A2` | agent-2 | PASS — 4 files, same scope | PASS — additive, pure | **FAIL** — `NODE_ACTIONS_AND_PARAMS` covers 13/30 keys per non-reference locale (68 gaps) | `NEEDS_CORRECTION` |
| `TASK-EXP-A3` | agent-3 | PASS — 4 files, same scope | PASS — additive, pure | PASS — `CANVAS_NODE_LOCALES` rectangular (4/4 in all 5 locales) | `APPROVED` |
| `TASK-EXP-A4` | agent-4 | PASS — 4 files, same scope | PASS — additive, pure | PARTIAL — parse-clean, import-free and behaviour-plausible, but no dedicated unit tests exist for these 4 modules (this cycle adds none for them) | `APPROVED` (advisory, see ISSUE-012) |
| `TASK-EXP-A5` | agent-5 (self) | PASS — 1 rewritten file, same scope | PASS — public API `UniversalLocaleEnforcer.enforceLocale()` unchanged | PASS — 10/10 tests + frozen evidence JSON | *self-work, not self-approved* |

Anti-self-approval rule honoured: the `TASK-EXP-A5` increment is recorded as evidence only; it
carries no vote from this session.

## 4. Zero Cross-Language Leak — the finding

The `TASK-EXP-A5` mandate ("Penegakan Konsistensi Bahasa Tunggal / Zero Cross-Language Leak") was
previously a 10-line locale resolver that could not observe a leak. It is now a real gate:

```
node --experimental-strip-types packages/reconstructed-engine/audit-locales.mjs        # regenerate evidence
node --experimental-strip-types packages/reconstructed-engine/audit-locales.mjs --check  # drift guard
node --experimental-strip-types packages/reconstructed-engine/audit-locales.mjs --strict # merge-blocking
```

Result (frozen in `docs/isolation/evidence/locale-leak-audit.json`):

| dictionary | locales | keys (`id` / others) | missing | untranslated | blank | clean |
| :--- | :--- | :--- | ---: | ---: | ---: | :--- |
| `node-catalog-dictionary.TRIGGER_PANEL_LOCALES` | ar, id, jv, ru, zh | 21 / 14 | 28 | 0 | 0 | no |
| `node-parameter-label-sanitizer.NODE_ACTIONS_AND_PARAMS` | ar, id, jv, ru, zh | 30 / 13 | 68 | 0 | 0 | no |
| `canvas-node-locales.CANVAS_NODE_LOCALES` | ar, id, jv, ru, zh | 4 / 4 | 0 | 0 | 0 | **yes** |

**Totals: 3 dictionaries, 5 locales, 179 keys, 96 findings** — all 96 are coverage gaps
(a non-reference locale lacks a key the reference `id` locale has), so at runtime the UI renders
Indonesian inside an Arabic / Javanese / Russian / Chinese session. No blank and no
identical-prose values exist, i.e. everything that *is* translated looks genuinely translated.

Remediation payloads (exact key lists per locale) are queued for their owners in
`docs/isolation/locale-leak-outbox.json` (`A5-MSG-01` → agent-1, `A5-MSG-02` → agent-2).
This session does **not** edit agent-1/agent-2 modules — one agent owns one LEGO.

## 5. Execution evidence

| check | command | result |
| :--- | :--- | :--- |
| locale enforcer unit + drift tests | `node --experimental-strip-types --test packages/reconstructed-engine/test/locale-enforcer.test.ts` | **10/10 PASS** |
| reconstructed engine smoke | `node packages/reconstructed-engine/test-run.mjs` | **PASS** — `finalResult: "PASS"`, 3 nodes, 1 item |
| all integrated modules parse | `node --experimental-strip-types --check` × 20 files | **20/20 OK**, 0 imports, 0 forbidden-path references |
| integration gate (offline) | `bash tests/integration/run_gate.sh --offline-only` | **OFFLINE STAGES PASS**, live 11/11 **NOT RUN** → `INCONCLUSIVE` |
| contract conformance | `node tests/compatibility/contract_conformance.mjs` | **21/21 PASS** |
| boundary & dependency audit | `python3 tests/integration/boundary_audit.py` | **PASS** |
| phase-6 gate (queue × events × realtime) | `node tools/phase6-isolation-gate.mjs` | **8/8 PASS** (G01–G08, incl. G05: queue 17/17, events 14/14, realtime 14/14) |
| live 11/11 regression | `python3 tests/integration/regression_gate.py` | **NOT RUN** — no n8n instance / no Docker in this sandbox. Per brief §12 an unexecuted gate is never counted as a pass. |

## 6. Issues recorded

| ID | issue | status |
| :--- | :--- | :--- |
| **ISSUE-011** | Zero-Rust violation: `crates/` held 23 Rust files (2 740 LOC, 7 crates) while `PROJECT_RULES.md` §1 mandates ZERO Rust, and both `tests/integration/boundary_audit.py` and `tests/compatibility/contract_conformance.mjs` failed on it. The workspace was also **unbuildable here**: `tools/rust-offline-rig/run.sh test` → `error: no matching package named indexmap found` (`indexmap` and `petgraph` are not in the 12-crate vendored set) and no `cargo` exists in this sandbox. | **CLOSED — not by this turn.** The Phase-6 commit `40e79e81` on this branch archived the Rust port read-only under `docs/archive/phase3-rust`; `crates/` and `apps/` are clean again and gate G06 reports `crates/ + apps/ clean`. Re-verified this turn: offline integration gate **PASS**, contract conformance **21/21**. |
| **ISSUE-012** | `DAGCycleDetector` (agent-4, `TASK-EXP-A4`) re-implements cycle detection, which `ISSUE-003` Option A assigned to the Validation LEGO. It is standalone and unwired, so nothing is broken today; ownership must be declared before it is wired into any execute path. | **OPEN — advisory** |
| **ISSUE-013** | 96 cross-language coverage gaps in the i18n dictionaries of agent-1 (28) and agent-2 (68). Every non-reference locale renders the Indonesian fallback for those keys. | **OPEN — owner action required** (exact key lists: `docs/isolation/locale-leak-outbox.json`) |
| **ISSUE-001** (recurring) | results merged to `main`, modules left on agent branches. | **OPEN** |

## 7. Verdict for this round

`TASK-EXP-A3` **APPROVED**, `TASK-EXP-A4` **APPROVED (advisory)**, `TASK-EXP-A1`/`A2`
**NEEDS_CORRECTION** (ISSUE-013, 96 coverage gaps, exact lists handed to their owners), and
`TASK-EXP-A5` delivered as evidence without a self-vote.

The branch is healthy after integrating this round: phase-6 gate **8/8**, offline integration gate
**PASS**, engine smoke **PASS**, locale suite **10/10**. The only thing standing between this branch
and `main` is the **live 11/11 regression gate**, which cannot be executed here (no n8n instance, no
Docker) — per brief §12 an unexecuted gate is never counted as a pass, so the merge verdict stays
`INCONCLUSIVE` until it is re-run on a host with n8n + PostgreSQL.
