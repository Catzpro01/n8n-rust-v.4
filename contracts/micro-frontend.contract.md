# LEGO Frontend Contract: Micro-Frontend Web Components (`LEGO 13`)

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
