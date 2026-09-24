# Issue #241 — Frontend LEGO Migration Foundation & Parity Harness (Agent 4)

**Baseline SHA:** `be89b3dd8991ade72470a25193459ccc3ff0298a` (protected main at slice start)  
**Branch:** `arena/agent4-issue-241-fe-migration`  
**Parent requirement:** #240 (full UI → isolated LEGO; durable target, not authorized as big-bang)  
**Non-scope confirmed:** no P5, no canvas/editor rewrite, no second registry/transport/i18n, no merge by Agent 4.

## Scope delivery

| Scope | Artifact | Result |
| :--- | :--- | :--- |
| A — Surface inventory | `packages/frontend-lego/manifest/surface-migrations.json` + `src/surface-migration.mjs` | 15 entries, 14 required categories, schema-validated against `manifest/surfaces.json` |
| B — Migration contract | `src/surface-contract.mjs` | Closed shape; reuses lifecycle / interaction / transport / i18n / error vocabularies |
| C — Parity harness | `src/parity.mjs` | Closed statuses: `equivalent \| compatible \| migration-required \| breaking` |
| D — Single pilot | `src/pilot-status-region.mjs` | Status region (loading/empty/error/ready); view-model only |
| E — Integration seam | `manifest/capabilities.json` → `status-region` + registry validation + `ui:error:render` | Registers via existing `createFrontendRegistry`; original UI remains primary |

## Inventory summary

- **inventoryVersion** `1.0.0` — references surface ids only (not a second surface catalog).
- **Migration statuses (closed):** `reference-only | contract-ready | pilot-available | parity-pending | lego-primary`.
- **Exactly one** `pilot-available`: `ui.primitives.status-region` (`rollbackStrategy: pilot-not-primary`).
- Categories covered: shell/nav, dashboard, editor, canvas, node picker, NDV, executions, credentials, settings, projects, import/export, AI, localization, loading/empty/error primitives, a11y primitives.

## Pilot

- **Id:** `ui.primitives.status-region` · capability id `status-region` · mode `pilot` · lifecycle `available`.
- Occupies surfaces `error-surfaces` + `dashboard`; extension point **`ui:error:render` only** (does not claim `ui:notification:render` without occupying `notifications`).
- Authority: `declare-request-render` · transport `local` · interaction `event`.
- Error display flows through existing `FrontendError` → `toDisplayModel()`.
- Rollback: `pilot-not-primary`, reference `n8n-editor-ui@2.9.4`.

## Parity evidence (focused)

For each region state (`loading`, `empty`, `error`, `ready`):

- candidate observation from `createStatusRegion().observe()`
- reference fixture from `referenceStatusObservation({ state })`
- `compareObservations` → **`compatible` or `equivalent`** (never `migration-required` / `breaking`)

Determinism: same inputs → identical status and diffs (`test/38`).

## Focused tests (new)

```text
node --test packages/frontend-lego/test/37-surface-migration.test.mjs \
            packages/frontend-lego/test/38-parity-harness.test.mjs \
            packages/frontend-lego/test/39-pilot-status-region.test.mjs
→ 33/33 pass
```

## Existing frontend gates

```text
npm run frontend-lego:test
→ tests 452 · pass 451 · fail 0 · skipped 1
```

(Baseline before slice: 419 tests / 418 pass / 0 fail / 1 skip.)

## Performance / resource impact (Node 22, mean per op)

| Operation | Mean | Notes |
| :--- | :--- | :--- |
| Inventory `JSON.parse` (11 666 B) | **0.027 ms** | once at tooling/boot if loaded |
| Inventory validate (15 entries) | **0.126 ms** | fail-closed schema |
| Inventory describe | **0.004 ms** | metadata only |
| Pilot contract validate | **0.008 ms** | |
| Pilot `observe()` | **0.002 ms** | |
| Parity compare | **0.012 ms** | pure function |
| `loadManifests()` | **0.46 ms** | existing Node-only loader |

- Pilot contract JSON ≈ **1.5 KB**; inventory ≈ **11.7 KB** — not added to browser boot payload (not in `BOOT_PAYLOAD_KEYS`).
- `.ai` pack total kept **≤ 80 KB** (test/12 budget): capabilities index entry for `status-region` kept minimal; card module list +1 line.

## Shared files touched (and why)

| File | Why |
| :--- | :--- |
| `packages/frontend-lego/manifest/capabilities.json` | Declare pilot capability (integration seam; registry validates it) |
| `packages/frontend-lego/index.mjs` + `package.json` exports | Publish new modules on the package boundary |
| `.ai/index/capabilities.json` | Existing test requires index ↔ declared catalog parity |
| `.ai/frontend/card.md` | Existing test requires every `src/*.mjs` module named in the card |

**Not touched:** contract-lock, domains.json, `reference/n8n`, editor bundle, P5 modules, manifests other than capabilities, generated `.ai/master/**`.

## Safety checklist

- [x] Frontend LEGO boundary intact; no second architecture  
- [x] No second capability/security authority  
- [x] Surface contract framework-neutral; vocabulary reuse verified  
- [x] Inventory machine-readable + validated; all major categories  
- [x] Reusable deterministic parity harness; loading/empty/error covered  
- [x] Exactly one low-risk reversible pilot behind Frontend LEGO boundary  
- [x] Original UI remains default/reference (`pilot-not-primary`)  
- [x] No P5 changes; no credential/secret leakage (diff grep clean)  
- [x] No full UI rewrite; no microservice-per-component; JS retained (no forced Rust)  
- [x] Focused tests PASS; frontend gates PASS; evidence + performance recorded  

## STOP

Issue #241 complete → **STOP**. Next surface requires separate Manager authorization. No P2.28 / P5 / P7 / canvas work started.
