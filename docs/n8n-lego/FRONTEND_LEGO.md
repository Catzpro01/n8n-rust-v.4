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
| Fifteen declared extension points for future LEGOs | No dictionaries, no translated strings, no locale switch |
| A hierarchical sub-LEGO registry (19 units, 3 levels) with a public/private boundary and a tested upgrade guarantee | No runtime loader that mounts or lazy-loads units |
| A backend-error → frontend-error → display-slot chain | No localization engine |
| Boot descriptor delivery (meta tag + `/rest/frontend/bootstrap`) | No patching of the pinned bundle, no new UI route |
| Architecture/contract tests + a browser boundary gate | No backend domain implementation, no Rust |

The pinned UI (`n8n-editor-ui@2.9.4`) is served verbatim. The only difference in the served
document is one additive `<meta>` tag, and a test asserts the rest is byte-identical (§6).

## 2. Where things live

```
contracts/frontend.contract.md              the normative text (§2 boundary, §8 errors, §11 hooks, §12 i18n, §16.1 P2.6 vocabulary)
contracts/frontend-sub-lego.contract.md     what may be a sub-LEGO, the hierarchy, public/private, upgrades
packages/frontend-lego/
  manifest/ownership.json                   LEGO identity, ports, invariants
  manifest/surfaces.json                    the 12 UI surfaces + their backend capability/contract/status
  manifest/extension-points.json            the 15 hooks + the safety rules + the 7 future consumers
  manifest/sub-legos.json                   the 19 nested units: owner, version, public ports, private area, deps, upgrade policy
  src/contract.mjs                          envelopes, status semantics, session, discovery, events, versioning
  src/errors.mjs                            FrontendError + normalizeError + toDisplayModel (machine-readable first)
  src/i18n.mjs                              6 locales, 13 message slots, key grammar, catalog/translator
  src/registry.mjs                          capability registration (fail-closed) + descriptor
  src/sublegos.mjs                          hierarchical units: validation, dependency resolution, upgrade guarantee
  src/boot.mjs                              boot payload build/encode/decode/extract/validate
  src/client.mjs                            framework-neutral /rest client + state model (idle/loading/ready/empty/error)
  src/adapters/vue.mjs                      THE ONLY framework-aware module (Vue 3 + the pinned bundle)
  src/adapters/index.mjs                    the swap point (lego.mjs imports this, never a framework file)
  src/lego.mjs                              assembly: manifests → registry + sub-LEGO registry → adapter → boot payload
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

A new frontend feature does **five** things and nothing else:

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

5. **Take over (or add) its units in the hierarchy** (`manifest/sub-legos.json`), and keep them
   upgradeable on their own — see §4.1.

### Worked example — the Translation LEGO, when its phase arrives

| Concern | Where it plugs in | Why it is not scattered |
| :--- | :--- | :--- |
| Dictionaries for `id, en, ar, zh, ru, jv` | `ui:message:catalog` + `createMessageCatalog()` | Keys are validated against the 13 slots; no string needs a new file per feature |
| Language switch + RTL | `ui:locale:switch` + `resolveLocale`/`directionOf` | Direction is locale metadata; components never branch on `ar` |
| Navigation / settings / node menu labels | `ui:nav:item`, `ui:settings:section`, `ui:node:menu-item` | Message keys, not literals; the hooks already exist |
| Backend/validation/execution errors | `ui:error:render` + the error model | The backend already answers codes and `meta.feature`; the message key exists before the text |
| Empty states, notifications, dialogs | `ui:notification:render`, `ui:dialog:render`, `empty-states.*` keys | Slots are declared per surface in `surfaces.json` |

### 4.1 Nested units (sub-LEGOs)

The units inside the frontend LEGO are declared in `manifest/sub-legos.json` and published in the boot
payload as `subLegos`. Rules are normative in
[`contracts/frontend-sub-lego.contract.md`](../../contracts/frontend-sub-lego.contract.md); the parts that
matter when you touch one:

* **What is a unit.** A component, button, icon or helper is *not*. A unit exists when it has an
  independently meaningful contract, ownership, dependency boundary, test boundary or upgrade path.
* **Ids are the tree.** `settings.localization.rtl` sits under `settings.localization` under `settings`.
  `parentId` must be the id prefix, parents are declared first, ids are unique.
* **Only public ports may be consumed.** `resolvePort(id, port)` is the only legal coupling; anything else
  is refused by name (`"credentials" reaches into the private internals of "dialogs": …`), and cycles are
  refused.
* **Private areas are never published.** The boot view carries identity, hierarchy, version, status, owner,
  surface and published port names — no internals, no test paths.
* **Upgrades are per unit.** A manifest patch for one unit is validated like a fresh declaration, then
  evaluated against every dependent. A compatible move changes that unit and nothing else; a breaking move
  is refused while a dependent pins the previous major, and only proceeds with an explicit
  `{ acknowledge: ['<dependent>'] }`, which records `acknowledgedUpgrades` on the dependent.
* **One current limit.** `settings.localization` and `workflow-editor.node-panel` are declared
  `acknowledged`, so a major bump needs the acknowledgment; `workflow-editor.parameter-panel` depends on
  `workflow-editor.node-panel#ui:panel:selection` and is the dependent in the upgrade test.

Adding a unit is a manifest entry plus a test; there is no code path that adds one implicitly.

### Known pre-existing debt this phase makes visible (not fixed here)

`packages/reconstructed-engine/src/workflow-canvas-text-translator.ts` and
`universal-locale-enforcer.ts` (earlier agent lineages) translate a handful of canvas strings with
their own ad-hoc maps. They are outside Agent 1's ownership and outside P2.5's scope. When the
Translation LEGO lands, those literals should move into catalogs keyed by the declared slots — the
structure to receive them now exists.

### Boot descriptor size

The payload is ~18 KB of JSON (~24 KB base64) and rides in the served `index.html`, which is sent
with `cache-control: no-store`. That is a deliberate trade: one self-describing document instead of
a discovery endpoint per future LEGO. A test enforces a 32 KB base64 budget so it cannot quietly
grow into a second application bundle; the size is recorded in the evidence file, so a jump is visible
in review rather than discovered in production.

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
| Contract + architecture (123 tests) | `npm run frontend-lego:test` | doc↔code agreement, registry fail-closed, error model, i18n structure, sub-LEGO hierarchy/ownership/upgrade, capability lifecycle/criticality/trust, envelope, impact + test map, device profiles, `.ai/` pack drift, framework/backend isolation |
| App boundary (11 tests) | `N8N_LEGO_CATALOG_DIR=… node --test apps/n8n-lego/test/*.test.mjs` | descriptor served + auth-guarded, meta tag == endpoint payload, **UI byte-identical apart from the tag**, 501 → machine-readable error, fail-soft load |
| Browser gate | `node tests/e2e/frontend-boundary.mjs <url>` | the boundary in a real page: tag present, payload valid, sessions work, stock shell still renders, no page errors, no leaked bridge global |
| P0/P2 regression | `node tests/e2e/lego-smoke.mjs <url> --mode=create\|verify`, `node tests/e2e/settings-compat.mjs <url>` | nothing user-visible changed |

Evidence is regenerated — not hand-written — with

```bash
node apps/n8n-lego/scripts/capture-frontend-evidence.mjs      # → docs/n8n-lego/evidence/frontend-boundary-p25.json
```

which starts the app in-process, signs the owner in and records **25 checks** at HTTP level — including
`PASS: hierarchy is walkable in declaration order`, `PASS: private areas never reach the payload`,
`PASS: UI byte-identical apart from the additive tag — delta=24268 bytes (the tag only)` and, from P2.8-F,
`PASS: declared capability catalog is validated but not registered — 1 declared, 0 registered`,
`PASS: impact: a private root change stays low risk — risk=low tiers=fast-contract,boundary,browser` and
`PASS: boot payload is byte-identical to the P2.5 baseline — 18126 bytes vs pinned P2.5 baseline 18126`.

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
5. **Legacy micro-frontend spec — resolved by marking, still confirmable.** `contracts/micro-frontend.contract.md`
   (LEGO 13) declared a Web-Components decomposition and the locale set `id, en, es, fr, de, ja`. As of
   P2.8-F it carries a **SUPERSEDED** banner (original text kept below it): the locale set is owned and tested
   by `contracts/localization.contract.md` (`id, en, ar, zh, ru, jv`, Arabic RTL) and the reference
   implementation stays the pinned Vue bundle. The legacy *decomposition* survives as nested units — mapping in
   `.ai/maps/dependencies.md` §6. What remains for the Manager is bookkeeping (keep marked / archive / delete,
   and whether to revive the Web-Components direction as a new task): `.ai/cards/decisions.md` **D22**,
   `contracts/frontend.contract.md` §16.1, `docs/isolation/CROSS-AGENT-ISSUES.md` **ISSUE-024**.
6. **Shared files touched (minimal, documented)**: root `package.json` (one test script),
   `.github/workflows/n8n-lego.yml` (path filters + two steps), `scripts/release.sh` (vendor the
   frontend LEGO into the tarball beside the engine), `contracts/frontend.contract.md` (new),
   `docs/n8n-lego/ROADMAP.md` (one row). No other shared file changed.

## 8. Limitations (honest list)

* The stock bundle does not read the boot descriptor; the payload is *produced and published*, and a
  future extension mechanism consumes it. That is the seam, not the feature.
* Extension points are declared, not executed: no runtime hook bus exists yet. Implementing it is a
  later phase (it needs the page-side loader, which implies a design decision about how extension
  scripts are delivered).
* Sub-LEGOs are declared, not mounted: there is no loader that pulls one unit in or out at runtime, and no
  per-unit bundling — the pinned bundle is served whole. What is proven is the *boundary and the upgrade
  rule*, not a micro-frontend runtime.
* `ui:theme:tokens`, `ui:command:register`, `ui:assistant:panel` are contracts for features that are
  not scheduled; they are declared because the catalog must be able to represent them.
* No localization: English fallback text ships for error kinds (labelled as temporary). The declared
  `translation` capability records what must happen when the Translation LEGO is absent (fallback chain owned by
  `contracts/localization.contract.md`), but no dictionaries are shipped from this LEGO.
* The capability catalog declares **one** capability and installs none — by design. Availability tooling
  (`availability()`, device support, degradation) describes what *would* happen; nothing is loaded, so nothing
  can be observed running.
* Impact/risk and the `.ai/` pack are computed in-process from declarations. They are not a CI job of their own
  yet: the pack is drift-checked by `test/12`, and the selective test map is advice a human or agent follows
  (the CI jobs still run the full frontend set).
* The browser gate runs in CI only (this sandbox has no Chromium); locally the HTTP/contract-level
  boundary is covered by the app suite.

## 9. Maturity layer (P2.8-F) — declared, enforced, invisible to the browser

`contracts/frontend.contract.md` §18 is normative; this is what it means in practice.

| Concern | Where it lives | What enforces it |
| :--- | :--- | :--- |
| Capability lifecycle (`available → installed → loaded → active | idle | unloaded | disabled`) | `src/lifecycle.mjs` | `test/07`, `test/11` — only `loaded/active/idle` serve; unlisted transitions refused by name |
| Criticality + degradation (`core` may not have a fallback) | `src/lifecycle.mjs` | `test/07`, `test/11` |
| Trust tiers with inheritance (never promoted by nesting) | `src/lifecycle.mjs`, `src/sublegos.mjs` | `test/07`, `test/06` |
| Device profiles and `supported/degraded/remote/unsupported` | `src/profiles.mjs` | `test/10` — every answer carries a reason |
| Semantic operation envelope (no credentials, no local payload tax) | `src/envelope.mjs` | `test/08` |
| Impact graph, selective test map, dry-run plan | `src/impact.mjs` | `test/09` — risk = blast radius, arbitration = consent |
| Declared capability catalog (validated, never registered) | `manifest/capabilities.json` | `test/11`, evidence check `1 declared, 0 registered` |
| `.ai/` knowledge pack (L0–L4, drift-checked, size-budgeted) | `.ai/**`, `src/knowledge.mjs` | `test/12` — indexes compared against the manifests |

Two deliberate properties worth stating:

* **The maturity layer adds zero bytes to what the browser receives.** The boot payload is byte-identical to
  the P2.5 baseline (18,126 bytes JSON → 24,168 base64), asserted by the evidence script against that pinned
  number. Policy (trust, criticality, lifecycle) and the backend capability of a unit stay in the in-process
  descriptor; the browser gets identity, hierarchy and published ports.
* **Nothing here is a loader.** Lazy activation is *permitted* by the model (activation mode, entry path,
  lifecycle states) and not implemented — no dynamic import, no service worker, no plugin runtime. A loader is
  a later task with its own justification, and the pack records it as such (`.ai/cards/decisions.md` D12/D13).

### How to use it when you touch the frontend

```bash
# what would this change touch, and what must be tested?
node -e "import('./packages/frontend-lego/index.mjs').then(m=>{
  const l=m.createFrontendLego({app:{name:'n8n-lego',version:'0.1.0'}});
  console.log(JSON.stringify(l.planChange({target:'settings.localization'}),null,1));})"

# what can this frontend offer, and what happens when it is absent?
node -e "import('./packages/frontend-lego/index.mjs').then(m=>{
  const l=m.createFrontendLego({app:{name:'n8n-lego',version:'0.1.0'}});
  console.log(JSON.stringify(l.availability(),null,1));})"
```
