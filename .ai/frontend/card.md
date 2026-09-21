# L1 — Frontend domain card

One page on how the frontend LEGO is built. Everything here is derivable from the
manifests and the tests; the card exists so an agent does not have to read them.

## What this LEGO is

`ui-frontend` — the frontend LEGO Foundation. It owns the UI architecture, the
compatibility boundary, the UI capability registry and the frontend regression
gates. It does **not** own workflow, execution, auth, credentials, storage, the
node registry or Rust, and it implements no feature of its own.

The application (`apps/n8n-lego`) serves the stock editor bundle unchanged and asks
this LEGO for one thing: the boot descriptor. The LEGO never renders, never injects
markup beyond one additive `<meta>` tag, and never rewrites the bundle.

## Where things live

```
packages/frontend-lego/
  index.mjs                 the public surface: catalogs, registries, lifecycle, impact, adapter
  manifest/
    surfaces.json           12 UI surfaces + the backend capability/contract behind each
    extension-points.json   15 hooks (v1.1.0) + 7 declared future consumers
    sub-legos.json          19 nested units: hierarchy, owners, ports, tests, upgrade policy
    ownership.json          who owns which area
    capabilities.json       declared (not installed) frontend capabilities
  src/
    contract.mjs            contract version, boot payload keys, published vocabulary
    registry.mjs            capability registry: fail-closed validation, availability vs activation
    sublegos.mjs            nested registry: hierarchy, ports, depth bound, atomic upgrades
    lifecycle.mjs           capability states, criticality, trust levels, degradation
    envelope.mjs            the operation envelope: identity, deadline, cancellation, idempotency
    impact.mjs              impact graph, selective test map, dry-run plan
    profiles.mjs            device profiles and the four support states
    i18n.mjs                locales, message slots, translation coverage
    errors.mjs              semantic error codes and kinds
    boot.mjs                boot descriptor + the additive <meta> tag
    client.mjs              REST client, state store
    manifests.mjs           catalog loading (the only Node-only module)
    adapters/               the framework adapter boundary (the current one is Vue)
  test/                     01-contract 02-registry 03-errors 04-client 05-boundary 06-sublegos
                            07-lifecycle 08-envelope 09-impact 10-profiles 11-registry-maturity
```

## Boot flow

1. `apps/n8n-lego` resolves the LEGO (checkout → sibling package, tarball → vendored copy).
2. `createFrontendLego({ app, ui })` loads the catalogs, builds the capability
   registry and the sub-LEGO registry, and validates the declared capability
   catalog **without registering it**.
3. The adapter encodes the boot payload twice from one source: the
   `<meta name="n8n-lego:frontend-bootstrap">` tag on `index.html` and
   `GET /rest/frontend/bootstrap`.
4. Failure at any step is **fail-soft**: the app logs a warning and serves the stock
   editor without the descriptor. The UI must never depend on this LEGO to render.
   A *broken declaration* (invalid manifest) is fail-closed at the LEGO boundary —
   it stops the descriptor, not the UI.

## Numbers that matter

| Thing | Value |
| ----- | ----- |
| Surfaces | 12 (`manifest/surfaces.json`) |
| Extension hooks | 15, version `1.1.0`, 7 declared future consumers |
| Sub-LEGO units | 19 in a 3-level hierarchy (11 roots, max depth 2) |
| Boot payload | ~19 KB JSON / ~26 KB base64, budget **32 KB** (test-enforced) |
| Browser-visible delta | the one `<meta>` tag (24,268 B on the served page) |
| Runtime dependencies | none |
| Locales | `id, en, ar, zh, ru, jv`; Arabic is RTL |
| Message slots | 13 |
| Declared capabilities | 1 (`translation`), installed: 0 |

## Rules the card wants you to remember without reading the code

- A capability attaches only to a surface declared in `surfaces.json` (fail-closed).
- Registration is metadata: `activation: 'lazy' | 'manual'` must name an `entry`
  module path once the capability is installable — and registering it still does not
  load it.
- Trust is inherited: a unit nested under a `feature` capability is a feature and
  may only be *lowered*, never promoted by nesting.
- `criticality: 'core'` may not declare a fallback — absence must stay visible.
- Device support is one of `supported | degraded | remote | unsupported`, decided
  from declared budgets; core code never branches on platform identity.
- Impact and test selection come from declaration data (`impactOf`, `planChange`),
  never from reading source: a private change gets a private test set.
- The framework name appears only in `src/adapters/` — a test enforces that.

## Evidence commands

```bash
npm run frontend-lego:test                                     # 114 tests, the architecture surface
node --test apps/n8n-lego/test/*.test.mjs                      # app-side boundary + boot tag
node apps/n8n-lego/scripts/capture-frontend-evidence.mjs       # 18-check evidence JSON
python3 tools/sublego-audit/audit.py                           # nested-LEGO + agent boundary audit
npm run verify:fast                                            # repo-wide fast gate
```

The browser gate (`tests/e2e/frontend-boundary.mjs`) needs Chromium and
`n8n-editor-ui`; it runs in CI, not in a bare checkout.
