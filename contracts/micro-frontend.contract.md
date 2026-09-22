# LEGO Frontend Contract: Micro-Frontend Web Components (`LEGO 13`)

> ## ⚠️ SUPERSEDED (P2.8-F, 2026-09-22) — preserved for traceability, not for work
>
> This specification is **not implemented and must not be implemented**. It proposed a
> Shadow-DOM Web Components decomposition for the editor UI; the shipped frontend is the
> pinned Vue bundle `n8n-editor-ui@2.9.4`, and replacing it is explicitly out of scope.
>
> What governs frontend work instead:
>
> | Area | Governing document |
> | :--- | :----------------- |
> | Frontend architecture, boundaries, capability registry, extension points | `contracts/frontend.contract.md` |
> | Nested sub-LEGO hierarchy, ports, atomic upgrades | `contracts/frontend-sub-lego.contract.md` |
> | Locales, dictionaries, translation fallback chain, RTL | `contracts/localization.contract.md` (TESTED) |
>
> Two of the statements below are **known to be wrong** and are resolved as follows:
>
> 1. **Locale set.** The six languages are `id, en, ar, zh, ru, jv` — not
>    `id, en, es, fr, de, ja`. The official set is owned by `contracts/localization.contract.md`
>    and mirrored by `packages/frontend-lego/src/i18n.mjs`; Arabic is the RTL locale.
> 2. **Component mechanism.** The editor UI is not decomposed into custom elements. The
>    *decomposition* survives as nested sub-LEGO units (`manifest/sub-legos.json`); the
>    mapping from the five proposed modules to current units is recorded in
>    `.ai/maps/dependencies.md` §6.
>
> The "60 FPS / 500 nodes / Pixel-perfect mirroring" targets are not measured by this
> project and are not acceptance criteria. Deletion or revival of this file is a Manager
> decision (flagged in `.ai/cards/decisions.md` D22 and ISSUE-024).


| Field | Value |
| :--- | :--- |
| Component Scope | Shadow DOM Custom Elements (`<n8n-canvas>`, `<n8n-node-settings>`, `<n8n-expression-editor>`) |
| Pixel Standard | 100% Pixel-Perfect Mirroring n8n v2.9.4 UI via Design Tokens |
| Performance Target | 60 FPS Canvas Rendering (Up to 500+ Active DAG Nodes) |
| Owner LEGO | LEGO 13 (`ui-frontend`) |
| Version | 1.0.0 |
| Status | CONTRACT SPECIFIED |

---

## 1. Dekomposisi 5 Modul Antarmuka (UI Micro-LEGO)

1. `<n8n-canvas>`: Kanvas penempatan node, routing kurva Bezier, zoom/pan, dan mini-map (target percepatan Wasm).
2. `<n8n-node-settings>`: Panel pengaturan parameter dinamis yang dibuat otomatis dari JSON schema `INodeProperties`.
3. `<n8n-expression-editor>`: Editor ekspresi inline `{{ ... }}` dengan live preview evaluasi.
4. `<n8n-i18n-provider>`: Provider lokalisasi reaktif 6 bahasa (id, en, es, fr, de, ja) tanpa kebocoran bahasa.
5. `<n8n-app-shell>`: Header navigasi, breadcrumbs, tombol Simpan/Eksekusi, dan manajemen workspace.
