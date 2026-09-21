# Frontend LEGO (P2.5) — architecture and migration notes

**Question this document answers**

> How does a future frontend feature (translation, accessibility, theme, search, AI assistant,
> notifications) attach to the real n8n UI **without** scattered edits, hard-coded strings and
> backend coupling — while the UI itself keeps looking and behaving exactly as it does today?

**Baseline:** `cb71dbb2` (P2 merged, CI green). **Phase:** P2.5 — foundation only.
**Normative contract:** [`contracts/frontend.contract.md`](../../contracts/frontend.contract.md).
**Implementation:** [`packages/frontend-lego`](../../packages/frontend-lego) + the wiring in
`apps/n8n-lego/src/{frontend.mjs,frontend/routes.mjs,ui.mjs,server.mjs}`.

---

## 1. What P2.5 built (and what it deliberately did not)

| Built | Not built (on purpose) |
| :--- | :--- |
| A frontend boundary: contract, registry, extension points, error model, i18n structure | No visual change, no redesign |
| A machine-readable contract with a doc↔code consistency test | No Vue removal, no framework migration |
| A capability registry that refuses incomplete declarations | No feature implementation (translation, a11y, theme, search, AI) |
| Twelve declared extension points for future LEGOs | No dictionaries, no translated strings, no locale switch |
| A backend-error → frontend-error → display-slot chain | No localization engine |
| Boot descriptor delivery (meta tag + `/rest/frontend/bootstrap`) | No patching of the pinned bundle, no new UI route |
| Architecture/contract tests + a browser boundary gate | No backend domain implementation, no Rust |

The pinned UI (`n8n-editor-ui@2.9.4`) is served verbatim. The only difference in the served
document is one additive `<meta>` tag, and a test asserts the rest is byte-identical (§6).

## 2. Where things live

```
contracts/frontend.contract.md              the normative text (§2 boundary, §8 errors, §11 hooks, §12 i18n)
packages/frontend-lego/
  manifest/ownership.json                   LEGO identity, ports, invariants
  manifest/surfaces.json                    the 12 UI surfaces + their backend capability/contract/status
  manifest/extension-points.json            the 12 hooks + the safety rules + the 6 future consumers
  src/contract.mjs                          envelopes, status semantics, session, discovery, events, versioning
  src/errors.mjs                            FrontendError + normalizeError + toDisplayModel (machine-readable first)
  src/i18n.mjs                              6 locales, 13 message slots, key grammar, catalog/translator
  src/registry.mjs                          capability registration (fail-closed) + descriptor
  src/boot.mjs                              boot payload build/encode/decode/extract/validate
  src/client.mjs                            framework-neutral /rest client + state model (idle/loading/ready/empty/error)
  src/adapters/vue.mjs                      THE ONLY framework-aware module (Vue 3 + the pinned bundle)
  src/adapters/index.mjs                    the swap point (lego.mjs imports this, never a framework file)
  src/lego.mjs                              assembly: manifests → registry → adapter → boot payload
apps/n8n-lego/src/frontend.mjs              runtime resolution (repo package → vendor/ → node_modules) + fail-soft load
apps/n8n-lego/src/frontend/routes.mjs       GET /rest/frontend/bootstrap
apps/n8n-lego/src/ui.mjs                    injects the boot meta tag (additive, standalone-safe)
```

## 3. The boundary in one picture

```
n8n-editor-ui@2.9.4 (pinned, verbatim)          ← the reference experience, unchanged
        │  HTTP/WS only the documented /rest surface
        ▼
FRONTEND LEGO — contract / registry / errors / i18n / client / boot   ← framework-neutral
        ▲                            │
        │  src/adapters/** (Vue)     │  contract facts
        │                            ▼
apps/n8n-lego (+ src/compat compatibility layer, P2) → domain LEGOs (workflow, auth, credentials, …)
```

Rules that hold mechanically (each one has a test): the backend never learns a framework exists;
the frontend LEGO never imports backend implementation modules; only the adapter directory may
name the framework; contract modules are browser-safe (no `node:*`).

## 4. How a future frontend feature LEGO attaches (migration notes)

A new frontend feature does **four** things and nothing else:

1. **Register a capability** with the registry (at boot, or via `lego.register(...)`):

   ```js
   {
     id: 'translation',
     lego: 'translation',
     title: 'Translation',
     status: 'declared',                     // declared | available | partial | unsupported
     surfaces: ['navigation', 'settings', 'error-surfaces'],   // must exist in manifest/surfaces.json
     contracts: ['contracts/frontend.contract.md', 'contracts/localization.contract.md'],
     extensionPoints: ['ui:message:catalog', 'ui:locale:switch'],
     messages: 'translation',                // its own message namespace (one capability, one namespace)
     tests: ['packages/translation-lego/test/*.test.mjs'],
   }
   ```

   An unknown surface, an undeclared hook, a missing test path or a duplicate id/namespace is
   refused with a precise error (`RegistryError.errors`) — the boundary is enforced, not suggested.

2. **Attach to declared extension points** (`manifest/extension-points.json`), additive by default,
   own subtree only, deterministic order, failure-isolated.

3. **Add messages** through `ui:message:catalog` using keys in the `<slot>.<name>` grammar, with the
   slot taken from the 13 declared message slots. RTL comes from the locale model (`direction`), never
   from a component special case.

4. **Render errors through the error model**: `normalizeError()` → `FrontendError` →
   `toDisplayModel()` (`messageKey` + `params` + `fallbackText` + `severity` + `actions`). A surface
   never parses a sentence to decide what happened.

### Worked example — the Translation LEGO, when its phase arrives

| Concern | Where it plugs in | Why it is not scattered |
| :--- | :--- | :--- |
| Dictionaries for `id, en, ar, zh, ru, jv` | `ui:message:catalog` + `createMessageCatalog()` | Keys are validated against the 13 slots; no string needs a new file per feature |
| Language switch + RTL | `ui:locale:switch` + `resolveLocale`/`directionOf` | Direction is locale metadata; components never branch on `ar` |
| Navigation / settings / node menu labels | `ui:nav:item`, `ui:settings:section`, `ui:node:menu-item` | Message keys, not literals; the hooks already exist |
| Backend/validation/execution errors | `ui:error:render` + the error model | The backend already answers codes and `meta.feature`; the message key exists before the text |
| Empty states, notifications, dialogs | `ui:notification:render`, `ui:dialog:render`, `empty-states.*` keys | Slots are declared per surface in `surfaces.json` |

### Known pre-existing debt this phase makes visible (not fixed here)

`packages/reconstructed-engine/src/workflow-canvas-text-translator.ts` and
`universal-locale-enforcer.ts` (earlier agent lineages) translate a handful of canvas strings with
their own ad-hoc maps. They are outside Agent 1's ownership and outside P2.5's scope. When the
Translation LEGO lands, those literals should move into catalogs keyed by the declared slots — the
structure to receive them now exists.

### Boot descriptor size

The payload is ~14 KB of JSON (~19 KB base64) and rides in the served `index.html`, which is sent
with `cache-control: no-store`. That is a deliberate trade: one self-describing document instead of
a discovery endpoint per future LEGO. A test enforces a 24 KB base64 budget so it cannot quietly
grow into a second application bundle.

## 5. Capability discovery

| Source | What it tells a consumer |
| :--- | :--- |
| `GET /rest/settings` | boot flags (feature availability, e.g. `hideUsagePage`) |
| `GET /rest/login` → `globalScopes` | what the session is allowed to reach |
| `501 { code: 'unsupported', meta: { feature, owner, phase } }` | a real capability this instance does not implement |
| `GET /rest/frontend/bootstrap` / the boot `<meta>` tag | the frontend's own surfaces, extension points, registered capabilities, locales, message slots, error codes, contract version |

Everything above is additive: nothing the pinned UI calls changed shape or status.

## 6. Verification

| Gate | Command | What it proves |
| :--- | :--- | :--- |
| Contract + architecture (54 tests) | `npm run frontend-lego:test` | doc↔code agreement, registry fail-closed, error model, i18n structure, framework/backend isolation |
| App boundary (9 tests) | `N8N_LEGO_CATALOG_DIR=… node --test apps/n8n-lego/test/*.test.mjs` | descriptor served + auth-guarded, meta tag == endpoint payload, **UI byte-identical apart from the tag**, 501 → machine-readable error, fail-soft load |
| Browser gate | `node tests/e2e/frontend-boundary.mjs <url>` | the boundary in a real page: tag present, payload valid, sessions work, stock shell still renders, no page errors, no leaked bridge global |
| P0/P2 regression | `node tests/e2e/lego-smoke.mjs <url> --mode=create\|verify`, `node tests/e2e/settings-compat.mjs <url>` | nothing user-visible changed |

CI: the frontend LEGO suite runs in the `gate` job; the browser gate runs in `clean-clone` after the
P2 gate. Workflow path filters include `packages/frontend-lego/**` and `contracts/frontend.contract.md`,
so the gates cannot be bypassed by touching only the new package.

## 7. Integration points for P2.6 (backend contracts) and Manager/Integrator

1. **New REST path**: `GET /rest/frontend/bootstrap` (authenticated, `{data}` envelope, 501
   `frontend-bootstrap` when the LEGO is unavailable). It is additive and never called by the pinned
   UI — Agent 2's contract work may reference it, but no existing route changed.
2. **Boot `<meta>` tag**: `n8n-lego:frontend-bootstrap` on `index.html`. If P2.6 changes document
   templating, the tag must stay additive and optional.
3. **Error vocabulary**: `ERROR_CODES` (`frontend.*`) and the message keys in `backend-errors.*` are
   now contract data; a backend that emits new codes should extend `contracts/frontend.contract.md`
   §8 rather than let a surface invent a string.
4. **Legend/registry**: the LEGO self-describes in `packages/frontend-lego/manifest/ownership.json`
   (the `packages/*-lego` convention). It is **not** added to `.arena/registry/lego.yaml` in P2.5 —
   that registry is agent-05's and the audit tool validates it bidirectionally; registering
   `ui-frontend` should be a Manager/Integrator decision, not a side effect of this phase.
5. **Shared files touched (minimal, documented)**: root `package.json` (one test script),
   `.github/workflows/n8n-lego.yml` (path filters + two steps), `scripts/release.sh` (vendor the
   frontend LEGO into the tarball beside the engine), `contracts/frontend.contract.md` (new),
   `docs/n8n-lego/ROADMAP.md` (one row). No other shared file changed.

## 8. Limitations (honest list)

* The stock bundle does not read the boot descriptor; the payload is *produced and published*, and a
  future extension mechanism consumes it. That is the seam, not the feature.
* Extension points are declared, not executed: no runtime hook bus exists yet. Implementing it is a
  later phase (it needs the page-side loader, which implies a design decision about how extension
  scripts are delivered).
* `ui:theme:tokens`, `ui:command:register`, `ui:assistant:panel` are contracts for features that are
  not scheduled; they are declared because the catalog must be able to represent them.
* No localization: English fallback text ships for error kinds (labelled as temporary).
* The browser gate runs in CI only (this sandbox has no Chromium); locally the HTTP/contract-level
  boundary is covered by the app suite.
