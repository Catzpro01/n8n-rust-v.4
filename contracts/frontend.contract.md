# LEGO Contract: Frontend (`ui-frontend`)

| Field | Value |
| :--- | :--- |
| Component scope | The frontend LEGO — boundary, contract, capability registry, extension points, error boundary, translation readiness |
| Reference implementation | **`n8n-editor-ui@2.9.4`** (prebuilt npm bundle, served verbatim, never patched) |
| Framework posture | Vue remains the current implementation. The contract is framework-neutral; Vue-specific code lives only in the adapter |
| Owner LEGO | `ui-frontend` (`packages/frontend-lego`, owner `agent-01`) |
| Runtime home | `apps/n8n-lego` (serves the UI, mounts `/rest/frontend/bootstrap`) |
| Version | 1.0.0 |
| Status | **IMPLEMENTED (P2.5)** — architecture + contract + registry + tests; no feature or visual change |

Companion documents: `contracts/api.contract.md` (HTTP envelopes, status semantics), `contracts/settings.contract.md`
(`GET /rest/settings`, the boot flag surface), `contracts/localization.contract.md` (backend i18n, locale set),
`contracts/micro-frontend.contract.md` (future Web Component shells), `docs/n8n-lego/FRONTEND_LEGO.md`
(architecture + migration notes), `docs/n8n-lego/FRONTEND_COMPATIBILITY.md` (P1 inventory + P2 compatibility layer).

---

## 1. Purpose

Make the existing n8n frontend a stable, extensible, replaceable LEGO **without changing how it looks or behaves**.

The frontend LEGO answers one question for every future frontend feature, in one place:

> where does this feature declare its identity, its UI surface, the backend contract it consumes, its tests and the
> extension points it attaches to — and how is it shown to the user if something goes wrong?

It does **not** implement features. It defines the boundary that features attach to.

---

## 2. Boundary

```
        ┌──────────────────────────────────────────────────────────────┐
        │ n8n-editor-ui@2.9.4  — the reference UI (Vue, prebuilt)       │  ← never patched, never redesigned
        │  renders unchanged · reads /rest/* · opens /rest/push         │
        └───────────────▲───────────────────────────┬──────────────────┘
                        │ contract + boot payload   │ HTTP/WS (only the documented n8n surface)
        ┌───────────────┴───────────────────────────▼──────────────────┐
        │ FRONTEND LEGO (`packages/frontend-lego`)                     │
        │  contract.mjs   what the UI may expect from any backend       │
        │  registry.mjs   capability/surface registry (discovery)       │
        │  errors.mjs     backend error code → frontend error model     │
        │  i18n.mjs       message slots, key grammar, locale metadata   │
        │  client.mjs     framework-neutral /rest client (envelopes)    │
        │  boot.mjs       boot payload delivery (meta tag + endpoint)   │
        │  adapters/vue.mjs  THE ONLY Vue-aware module                  │
        └───────────────▲───────────────────────────┬──────────────────┘
                        │ consumes                  │ consumes
        ┌───────────────┴───────────────────────────▼──────────────────┐
        │ COMPATIBILITY LAYER (`apps/n8n-lego/src/compat`) — P2         │
        │  {data} envelopes · error shape · 401/403/404/501 semantics   │
        │  scopes · capability 501 for unimplemented features           │
        └──────────────────────────────────────────────────────────────┘
```

Boundary rules (each one is enforced by a test, see §16):

| Rule | Why |
| :--- | :--- |
| **F1** The UI reaches the backend only through the documented `/rest/*` + `/rest/push` surface. | The bundle is stock; anything it reads is part of the compatibility contract (P1 inventory). |
| **F2** Contract modules are framework-neutral: `errors`, `i18n`, `contract`, `registry`, `boot`, `client` import nothing framework-specific and no `node:*` module. | A future implementation (Vue, React, Web Components) consumes the same contract. |
| **F3** Vue-specific assumptions exist only in `src/adapters/` (one file today). | "Replace Vue" becomes an adapter task, not a refactor of backend contracts. |
| **F4** No module of this LEGO imports a backend implementation module (`apps/n8n-lego/src/**`, `crates/**`). | Dependencies point inward: UI → frontend contract → compatibility/API boundary. |
| **F5** The backend never learns that a frontend framework exists: it serves the bundle, the REST surface and the boot descriptor. | Backend contracts stay implementation-agnostic. |
| **F6** Every UI surface is declared in the surface catalog with its backend capability and contract. | A feature cannot "appear" in the UI without a declared owner and contract. |
| **F7** Every backend error is addressable by a stable machine-readable code before it has any display text. | Translation LEGO/Accessibility LEGO need the code, not the sentence. |
| **F8** Extension may only add to a declared extension point and may only mutate its own subtree. | Later features attach without editing unrelated UI code. |

**Unchanged by P2.5 (deliberate):** the visual appearance, the routes, the rendered DOM, the sidebar contents, the
pinned bundle, `reference/n8n/**`, every backend domain implementation, and the P2 browser gate.

---

## 3. Inputs

| Input | Producer | Notes |
| :--- | :--- | :--- |
| Boot descriptor | `GET /rest/frontend/bootstrap` **and** `<meta name="n8n-lego:frontend-bootstrap">` on `index.html` | Same JSON, base64. Contract version, surfaces, extension points, capabilities, locales, message slots, error codes, status semantics. |
| REST responses | Compatibility layer (`src/compat/response.mjs`) | `{data}` envelope, bare `{count,data}` lists, error `{message, code?, meta?}` (api.contract §3). |
| Session context | `n8n-auth` cookie, `GET /rest/login`, `POST /rest/owner/setup` | 401 `{status:'error', message:'Unauthorized'}` is the session-expired signal. |
| Capability discovery | `GET /rest/settings` flags + scopes in the login payload + 501 `{code:'unsupported', meta:{feature,owner,phase}}` | Feature availability is decided by the contract, never by hiding UI (`FRONTEND_COMPATIBILITY.md` §2). |
| Push events | `/rest/push` (WebSocket) | `executionStarted`, `executionFinished`, `nodeExecuteAfter`, `workflowActivated`, `testWebhookReceived` (api.contract §3). |
| Manifests | `packages/frontend-lego/manifest/*.json` | Surface catalog, extension points, LEGO ownership. Data, not code. |

## 4. Outputs

| Output | Shape |
| :--- | :--- |
| Frontend contract descriptor | `CONTRACT_VERSION`, envelopes, list shapes, status semantics, session rules, route conventions, events, versioning rules (`src/contract.mjs`) |
| Boot payload | `buildBootPayload()` → `{ contractVersion, app, ui, contract, locales, messageSlots, errorKinds, errorCodes, surfaces, subLegos, extensionPoints, capabilities }` |
| Capability registry | `register(capability)` / `list()` / `get(id)` / `resolveRoute(path)` / `descriptor()` — validated, deterministic, duplicate-safe |
| Sub-LEGO registry | hierarchical units below this LEGO — `childrenOf` / `descendantsOf` / `resolvePort(id, port)` / `dependentsOf(id)` / `upgrade(id, patch, { acknowledge })`; rules in [`frontend-sub-lego.contract.md`](frontend-sub-lego.contract.md) |
| Error model | `normalizeError(input)` → `FrontendError { kind, status, code, messageKey, params, retryable, meta }`; `toDisplayModel()` → `{ messageKey, fallbackText, severity, actions }` |
| i18n structure | 6-locale metadata model (+`direction`), 13 message slots, key grammar, catalog/translator with the backend's deterministic fallback chain |
| Framework-neutral client | `createRestClient()` — envelope unwrap, list shapes, error normalization, state model (`idle/loading/ready/empty/error`), pagination semantics |
| Adapter | `createVueAdapter()` — boot payload for the current implementation + mounting conventions + the Vue-isolation rule |

## 5. Responsibilities

- Own the frontend boundary, the contract document and the machine-readable half of it (kept in sync by a test).
- Own the surface catalog and the capability registry, including validation of every registration.
- Own the error-code → frontend-error → display-slot chain (no localization implementation).
- Own the message-slot/key structure that future Translation LEGO fills (no dictionaries shipped).
- Own the extension-point catalog and its safety rules.
- Expose the boot descriptor to the browser (meta tag) and to tooling (`/rest/frontend/bootstrap`).
- Own the frontend regression gates listed in §16.

## 6. Non-responsibilities

- **No** visual redesign, **no** Vue replacement, **no** bundler/build change, **no** new frontend framework.
- **No** backend domain implementation (workflow, execution, auth, credentials, node registry, storage, Rust).
- **No** feature implementation: not translation, not accessibility, not theme, not search, not AI assistant.
- **No** translation dictionaries and **no** translated strings — the six locales are *declared*, not shipped.
- **No** patching of the served bundle: the only `index.html` change is one additive `<meta>` tag (§12 of the P1 doc rule: "the UI bundle is never patched").
- **No** new frontend route, component or store inside the stock bundle.

## 7. Dependencies

| Dependency | Direction | Note |
| :--- | :--- | :--- |
| Compatibility layer (`src/compat/**`) | consumed | Envelopes, status semantics, 501 capability contract |
| `GET /rest/settings` flags/scopes | consumed | Capability discovery input (P2) |
| `contracts/localization.contract.md` | consumed (structure only) | Locale set + fallback chain must not diverge |
| `n8n-editor-ui@2.9.4` | pinned, untouched | Reference implementation |
| Vue | **adapter only** | Not part of any other module's vocabulary |
| Backend implementation modules | **forbidden** | F4 |

## 8. Error representation

Machine-readable first, displayable second:

```
backend error (status + code + meta)
      → normalizeError()      FrontendError { kind, status, code, messageKey, params, retryable, meta }
      → toDisplayModel()      { messageKey, fallbackText, severity, actions[] }
      → future Translation LEGO renders messageKey in the active locale (today: fallbackText)
```

| Backend signal | `kind` | `code` | `messageKey` | retryable |
| :--- | :--- | :--- | :--- | :--- |
| `fetch` failure / timeout | `network` | `frontend.network.unreachable` | `backend-errors.network-unreachable` | yes |
| aborted request (`AbortError`) | `aborted` | `frontend.request.aborted` | `backend-errors.request-aborted` | yes |
| `401` (any shape) | `auth` | `frontend.session.expired` | `backend-errors.session-expired` | no (sign-in action) |
| `403` | `forbidden` | `frontend.permission.denied` | `backend-errors.permission-denied` | no |
| `404` | `not-found` | `frontend.resource.missing` | `backend-errors.resource-missing` | no |
| `409` | `conflict` | backend `code` or `frontend.resource.conflict` | `backend-errors.resource-conflict` | yes |
| `400` with `path` (zod issue) | `validation` | backend `code` or `frontend.request.invalid` | `backend-errors.validation-failed` | no |
| `400`/`422` with `message` only | `validation` | `frontend.request.invalid` (or `frontend.validation.failed` when no code is given) | `backend-errors.validation-failed` | no |
| `501` `{code:'unsupported', meta:{feature}}` | `unsupported` | `frontend.capability.unsupported` | `backend-errors.capability-unsupported` | no |
| `5xx` | `server` | `frontend.server.error` | `backend-errors.server-error` | yes |
| anything else | `unknown` | `frontend.error.unknown` | `backend-errors.unknown` | no |

Error `kind`s (the closed vocabulary a surface branches on): `network`, `aborted`, `auth`, `forbidden`,
`not-found`, `conflict`, `validation`, `unsupported`, `server`, `unknown`.

HTTP status semantics the frontend implements (identical to the compatibility layer):

| Status | Meaning | Retryable |
| :--- | :--- | :--- |
| `200` | answered — an empty collection is an honest empty, not a stub | no (nothing to retry) |
| `400` | the request itself is wrong | no |
| `401` | no session — offer sign-in, do not retry blindly | no |
| `403` | authenticated but not allowed | no |
| `404` | the addressed entity does not exist | no |
| `409` | conflict (e.g. workflow checksum mismatch) — refetch, then retry | yes |
| `422` | understood but not processable | no |
| `501` | capability known but not implemented here (`{ code: 'unsupported', meta: { feature, owner, phase } }`) | no |
| `500` | unexpected server failure | yes |
| `503` | service unavailable (still starting) | yes |

- `message` from the backend is preserved as `fallbackText` — never the only source of a user-visible string (F7).
- `meta.feature`/`meta.owner`/`meta.phase` from the P2 capability contract are preserved in `FrontendError.meta`.
- Every `code` in this table is exported (`ERROR_CODES`) and appears in the boot payload, so a consumer can
  render/patch an error surface without importing the module.

## 9. Loading, empty and list semantics

| State | Rule |
| :--- | :--- |
| `idle` → `loading` → `ready` | The client's state model; consumers never invent their own. |
| `empty` | A `200` with an empty collection is **`empty`**, not an error: `{data:[]}` and `{count:0,data:[]}` are honest empties. |
| Failure | `error` state carries a `FrontendError` (never a raw string, never a thrown exception across the boundary). |
| Lists | Shape is contract data (`LIST_SHAPES`), not per-call guesswork. Declared shapes: `{ count, data: [...] }` (`count-data` — `GET /rest/workflows`), `{ count, results: [...], estimated }` (`count-results` — `GET /rest/executions`), `{ data: [...] }` (`data` — `GET /rest/variables`, the fallback for undeclared endpoints). |
| Pagination | `limit`/`filter` semantics as in api.contract §4; `paginate()` collects without re-implementing the envelope in every caller. |
| `200 {}` quirk | Endpoints that answer `200 {}` for a missing entity (`/rest/executions/:id`, api.contract §11) are declared `allowEmptyBody` so consumers get `not-found`, not a silent `{}`. |

## 10. Event / interaction boundaries

- The UI may open `/rest/push` and listen for the canonical events in api.contract §3. Event names, payload keys and
  the reconnection rule are contract data (`EVENTS`).
- Extension points are **additive**: a consumer may observe (read) contract state, may append its own rendering into a
  declared hook, and may register messages/commands. It may not mutate another extension's subtree, patch the bundle,
  or replace a stock surface (`mutates: 'own-subtree' | 'none'`).
- Ordering is deterministic (declaration order, then stable id) so two LEGOs cannot fight for the same slot.

## 11. Extension points

Catalog: `packages/frontend-lego/manifest/extension-points.json`. Declared today, **not implemented** — this is the
insertion point list, not a feature list.

| Hook | Surface | Payload | Additive mode | Intended consumers |
| :--- | :--- | :--- | :--- | :--- |
| `ui:nav:item` | navigation | `{ id, label?, labelKey?, route, icon?, order?, scope? }` | append | Search, Translation |
| `ui:settings:section` | settings | `{ id, labelKey, route, scope?, order? }` | append | Translation, feature LEGOs |
| `ui:form:field` | settings | `{ id, field, decorate }` | append | Accessibility, Translation, dynamic-form |
| `ui:node:menu-item` | workflow-editor | `{ id, labelKey, appliesTo, command }` | append | AI assistant, node LEGOs |
| `ui:dialog:render` | dialogs | `{ id, dialog, render }` | replace-own | feature LEGOs |
| `ui:notification:render` | notifications | `{ id, kind, render }` | wrap-own | Notification LEGO |
| `ui:error:render` | error-surfaces | `{ id, kinds, render(FrontendError) }` | wrap-own | Translation, Accessibility |
| `ui:message:catalog` | system-messages | `{ namespace, catalog }` | append | **Translation LEGO** |
| `ui:locale:switch` | system-messages | `{ locale, direction }` | read/observe | **Translation LEGO** |
| `ui:theme:tokens` | all | `{ tokens }` | override-named | Theme LEGO |
| `ui:command:register` | navigation | `{ id, titleKey, run }` | append | Search LEGO |
| `ui:assistant:panel` | workflow-editor | `{ id, mount, context }` | append | AI Assistant LEGO |
| `ui:search:provider` | navigation | `{ id, titleKey, kind, query, rank? }` | append | Search LEGO |
| `ui:accessibility:annotate` | error-surfaces | `{ surface, selector, attributes, labelKey }` — whitelisted attributes only (`aria-*`, `role`, `tabindex`, `lang`, `dir`); never text, layout or node structure | wrap (attributes only) | Accessibility LEGO |
| `ui:document:format` | workflow-editor | `{ id, titleKey, mime, direction, parse?\|serialize? }` | append | Import / Export LEGO |

Fifteen hooks, seven declared future consumers (Translation, Accessibility, Theme, Search, AI Assistant,
Notification, Import/Export). Every hook declares `payload`, `additive`, `mutates`, `requiresCapability`,
`consumers`, `status: 'declared'`. A capability that attaches to a hook must name it in its registration, so the
boundary stays explicit.

Hooks are attachment points for future capabilities; a **port** (§ sub-LEGO contract) is a contract another unit may
depend on. The two share the `ui:<area>:<name>` grammar but must not share an id — the registry refuses a collision,
so "where I attach" and "what I may couple to" cannot be confused.

### 11.1 Nested units

The units *inside* this LEGO (dashboard, settings and its children, the workflow-editor panels, node picker,
credentials, executions, notifications, dialogs, error surfaces, auth, navigation) are declared in
`manifest/sub-legos.json` and published in the boot payload as `subLegos`. Their rules — what may be a unit, the
hierarchy, the public/private boundary, ownership and the upgrade guarantee — are normative in
[`frontend-sub-lego.contract.md`](frontend-sub-lego.contract.md).

## 12. Translation readiness (structure only)

- **Message slots** (the 13 surfaces every future catalog must cover): `navigation`, `settings`, `dashboard`,
  `node-menu`, `node-descriptions`, `forms`, `dialogs`, `notifications`, `validation-errors`, `backend-errors`,
  `execution-errors`, `empty-states`, `system-messages`.
- **Key grammar**: `<namespace>.<slot>.<name>` — validated (`buildMessageKey`/`parseMessageKey`), namespace must be a
  registered capability's namespace or a declared system namespace. Slots are a closed set, so a new hard-coded
  string has an obvious correct home instead of becoming debt.
- **Locale model**: `id`, `en`, `jv`, `ar`, `zh`, `ru` (aligned with `contracts/localization.contract.md`), each with
  `englishName`, `nativeName`, `direction` (`ar` → `rtl`), `status: 'declared'`. `resolveLocale('ar_SA')` normalizes
  BCP-47 tags the same way the backend does.
- **Fallback chain** (identical to the backend's): requested locale → `en` → raw key. Missing placeholders are left
  intact (`{error}`), never `"undefined"`.
- **Not in P2.5**: no dictionaries, no language switching, no translated strings, no `i18n` framework.

## 13. Versioning rules

1. `CONTRACT_VERSION` is `MAJOR.MINOR`; the boot payload carries it.
2. Within a major: fields may be **added**; existing field names, envelope shapes, status codes, message keys and
   error codes are never removed or repurposed.
3. A field is retired only by a major version, and only after two minors of `deprecated: true` in the catalog.
4. Unknown fields must be ignored by consumers (forward compatibility); unknown enum values must degrade to `unknown`.
5. The pinned UI version (`n8n-editor-ui@2.9.4`) is part of the contract identity: a different bundle is a new
   compatibility baseline, not a patch.

## 14. Lifecycle

```
boot   app starts → loads manifests → builds registry → validates → boot payload
       ├── index.html: <meta name="n8n-lego:frontend-bootstrap" content="<base64 json>">
       └── GET /rest/frontend/bootstrap  (authenticated, {data: payload})
serve  stock bundle served verbatim (ui.mjs templating: BASE_PATH/REST_ENDPOINT/CONFIG_TAGS/title + the meta tag)
run    UI → contract (client/errors/i18n) → compatibility layer → domain LEGOs
extend future LEGO registers a capability + attaches to declared hooks; registry rejects undeclared surfaces/hooks
```

Boot is **fail-soft**: if the frontend LEGO cannot be loaded or validated, the app logs it and serves the UI without
the meta tag — the stock editor must never depend on the descriptor to render.

## 15. Data / state ownership

- Owns: surface catalog, extension-point catalog, capability registry, sub-LEGO hierarchy, message-slot structure,
  locale metadata, error-code vocabulary, contract descriptor. All of it is static declaration data.
- Owns no user data, no session state, no workflow/execution/credential state.
- Reads no store directly; all data arrives through `/rest/*`.

## 16. Invariants and their tests

| # | Invariant | Test |
| :--- | :--- | :--- |
| I1 | Contract document and machine-readable contract agree (codes, slots, statuses) | `packages/frontend-lego/test/01-contract.test.mjs` |
| I2 | A capability cannot register without a real surface, a contract ref, tests, and a declared hook | `…/02-registry.test.mjs` |
| I3 | The registry is deterministic and duplicate-safe | `…/02-registry.test.mjs` |
| I4 | Every backend error shape maps to exactly one kind + code + message key (machine-readable first) | `…/03-errors.test.mjs` |
| I5 | Message keys are slot-validated; the fallback chain never throws; `ar` is `rtl` | `…/04-i18n.test.mjs` |
| I6 | Only `src/adapters/**` mentions Vue; contract modules import no framework and no `node:*` (F2/F3) | `…/05-boundary.test.mjs` |
| I7 | No frontend-LEGO module imports backend implementation modules; the app imports only the package entry (F4/F5) | `…/05-boundary.test.mjs` |
| I8 | The boot descriptor is served, decodes to the same payload the registry produces, and the stock UI HTML is otherwise byte-identical | `apps/n8n-lego/test/frontend.boundary.test.mjs` |
| I9 | `501 {code:'unsupported'}` from a real endpoint becomes a machine-readable `unsupported` error in the client | `apps/n8n-lego/test/frontend.boundary.test.mjs` |
| I10 | The boundary is visible in a real browser page, and the UI still renders (unchanged) | `tests/e2e/frontend-boundary.mjs` |
| I11 | P0/P2 behavior is not regressed | `tests/e2e/lego-smoke.mjs`, `tests/e2e/settings-compat.mjs`, `apps/n8n-lego/test/*.test.mjs` |
| I12 | The lifecycle vocabulary is closed: only `loaded`/`active`/`idle` may serve, and every unlisted transition is refused | `…/07-lifecycle.test.mjs` |
| I13 | `core` may not declare a fallback; unknown criticality degrades as `fail-loud` | `…/07-lifecycle.test.mjs`, `…/11-registry-maturity.test.mjs` |
| I14 | Trust is inherited and never promoted by nesting; each level's permissions are published as data | `…/07-lifecycle.test.mjs` |
| I15 | The envelope carries an authorization *context*, never a credential; a command needs an idempotency key; local execution serializes nothing | `…/08-envelope.test.mjs` |
| I16 | The observation record is boundary-level and payload-free (no subject, no scopes) | `…/08-envelope.test.mjs` |
| I17 | Impact and risk come from declaration data; a foreign contract or a dependent escalates to the full tier, a private root change does not | `…/09-impact.test.mjs` |
| I18 | Device support is a declared budget: over budget is `unsupported`, a thin client is `remote`, and no support state lacks a reason | `…/10-profiles.test.mjs` |
| I19 | The declared capability catalog is validated but never registered: the boot payload's capability list stays empty | `…/11-registry-maturity.test.mjs`, `apps/n8n-lego/test/frontend.boundary.test.mjs` |
| I20 | The `.ai/` pack agrees with the manifests, stays inside its size budgets, and never carries implementation | `…/12-knowledge.test.mjs` |

## 16.1 Shared vocabulary with the backend LEGO (P2.6 / P2.7) — and one open arbitration

P2.6 owns the backend LEGO foundation. This contract does **not** define a second backend registry; it consumes
what the compatibility layer already publishes and pins the shared vocabulary:

| Shared concept | Where it is defined | What the frontend does |
| :--- | :--- | :--- |
| Capability availability | `apps/n8n-lego/src/compat/capability.mjs` (`UNSUPPORTED_FEATURES`) → `501 { code:'unsupported', meta:{ feature, owner, phase } }` | maps `meta.feature` to a message key; never inspects backend modules |
| Error codes | `contracts/api.contract.md` §4 taxonomy, surfaced through `code` + HTTP status | `normalizeError()` turns code + status into `kind` + `messageKey`; **the machine-readable code is the identity, the sentence is not** |
| Envelopes / list shapes | `contracts/api.contract.md`, §9 of this document | `createRestClient()` unwraps `{ data }` / `{ count, results, estimated }` / `{ count, data }` |
| Contract versions | `CONTRACT_VERSION` (this LEGO, `MAJOR.MINOR`) and the backend contract's own version string in the boot payload (`app.referenceVersion`) | major mismatch ⇒ the boot payload is refused (`validateBootPayload`) |
| Ownership | `manifest/ownership.json` + the owner table in `manifest/sub-legos.json` | a unit's owner is declarative data; no cross-domain change happens implicitly |
| Frontend/backend boundary | this document §2, `frontend-sub-lego.contract.md` §3 | frontend → contract → compatibility layer; a frontend module importing a backend implementation is a defect |

**Legacy spec — resolved by marking superseded (P2.8-F), still Manager-confirmable.** `contracts/micro-frontend.contract.md`
(LEGO 13, "CONTRACT SPECIFIED") declares a Web-Components decomposition (`<n8n-canvas>`, `<n8n-node-settings>`,
`<n8n-expression-editor>`, `<n8n-i18n-provider>`, `<n8n-app-shell>`) and a six-language set `id, en, es, fr, de, ja`.
It is now marked **SUPERSEDED** in place (the original text is kept below a banner), on two grounds that do not depend
on this document's authority:

1. **Locales.** The authoritative set is owned by `contracts/localization.contract.md` (agent-9 lineage, **TESTED**):
   `id, en, ar, zh, ru, jv`, with Arabic as the only RTL locale. The frontend mirrors that set and never redefines it;
   the legacy `id/en/es/fr/de/ja` list is wrong, not alternative.
2. **Mechanism.** The reference implementation is the pinned Vue bundle (`n8n-editor-ui@2.9.4`, adapter `vue`); no
   custom elements are used, and replacing the UI is out of scope. The legacy *decomposition* survives as nested
   sub-LEGO units — the module-to-unit mapping is recorded in `.ai/maps/dependencies.md` §6.

What remains a Manager decision is bookkeeping, not architecture: whether the superseded file stays in `contracts/`
(marked), is archived, or is deleted, and whether the Web-Components direction is revived as a new task. Recorded as
`.ai/cards/decisions.md` **D22** and `docs/isolation/CROSS-AGENT-ISSUES.md` **ISSUE-024**. Until the Manager answers,
no code may assume the legacy spec governs anything.

## 17. Compatibility requirements (pinned UI)

- The bundle is served verbatim; the only allowed `index.html` addition is the additive boot `<meta>` tag (§4).
- `%CONFIG_TAGS%`, `BASE_PATH`, `{{REST_ENDPOINT}}` and the title templating stay exactly as they are.
- No new `/rest/*` path may shadow an endpoint the UI calls; the discovery endpoint is new and never called by the UI.
- Error envelopes, status codes and the 501 capability contract stay as specified by api.contract §3/§7 and the P2 layer.
- Removing or renaming anything in §2–§12 requires a major contract version and a Manager/Integrator decision.

## 18. Maturity model (P2.8-F) — declared, enforced, not built

The foundation is hardened by *declaration and enforcement*, not by features. Everything in this section is data with a
validator and a test; nothing here loads code, and the browser payload is byte-identical to what P2.5 shipped.

### 18.1 Availability is not activation

```
available ──▶ installed ──▶ loaded ──▶ active ──▶ idle
     ▲            │            │          │         │
     └── disabled ◀────────────┴──────────┴─────────┴──▶ unloaded
```

- Only `loaded`, `active` and `idle` may serve a request (`RUNNABLE_STATES`); every transition outside the table is
  refused by name with the allowed set in the message (`frontend.lifecycle.invalid-transition`).
- `activation` is `eager | lazy | manual`. A non-eager capability must name an `entry` module path **once it is
  installable** (`status !== 'declared'`); a declared capability owes none, because no code exists yet.
- Registering a capability never loads it, and the registry refuses any declaration containing implementation
  (`load`, `render`, `mount`, `install`, `activate`, `handler`, `component`) — metadata must not require code.

### 18.2 Criticality, degradation and trust

| Criticality | Absence means | Behaviour |
| :--- | :--- | :--- |
| `core` | the instance is broken | `fail-loud`, and a fallback declaration is **refused** |
| `optional` | normal | `fallback` to the declared behaviour (e.g. `fallback-locale`) |
| `enhancement` | nothing to report | `continue` |

```text
core (0) > feature (1) > extension (2) > untrusted (3)      # lower rank = more trusted
```

A child unit or capability may be **less** trusted than its parent, never more; an unknown trust level is refused
rather than treated as trusted. `mayPerform(level, action)` answers what a level may do (`own-routes`, `read-session`,
`call-declared-endpoints`, `attach-hooks`, `render-own-subtree`, …), so a policy question has one answer in one place.

### 18.3 Device profiles

Six declared budgets: `desktop`, `laptop`, `low-memory`, `android`, `termux-companion`, `remote-only`. A capability
declares `requirements` (`memoryMb`, `storageMb`, `requiresLocalExecution`, `requiresNetwork`, `heavy`, `input`) and
receives one of four answers — `supported`, `degraded`, `remote`, `unsupported` — each with a reason. Core UI never
branches on platform identity; it branches on the support state. A `remote-only` profile reaches what it cannot run
locally instead of dropping it.

### 18.4 The operation envelope

One semantic context per boundary crossing: `capability`, `operation` (`<domain>.<name>`), `contractVersion`,
`correlationId`, `authorization` (`{ subject, scopes }`), `deadlineMs`, `cancellation` (`AbortSignal`), `idempotencyKey`.

- The authorization field is a **context, never a credential**: `token`, `password`, `apiKey`, `cookie`, `jwt`, … are
  refused by name.
- A `command` operation without an idempotency key is refused — a retry that duplicates work is a defect, not bad luck.
- `toTransportHints()` is empty for `local` and `none`: a local call pays no metadata tax.
- `observationRecord()` emits boundary-level observability (identity, outcome, duration, error code) and deliberately
  omits the subject and the scope list.

### 18.5 Impact graph, selective tests and the dry-run plan

`impactOf(target)` answers "if this changes, what must be tested?" from declaration data: ancestors, descendants,
dependents, surfaces, contracts, risk and the recommended test set per tier
(`fast-contract → boundary → browser → integration → full`).

- **Risk is blast radius**: a dependent, a **foreign** contract (owned by another LEGO), or extension/untrusted
  authorship ⇒ `high`; a nested unit ⇒ `medium`; a private root ⇒ `low`.
- **Arbitration is consent**: adding a unit is `low` risk but always `requiresArbitration`, because the hierarchy is
  shared.
- `planChange()` returns the dry-run plan — target, owner, sub-LEGO identity, files, contracts affected (with their
  owners), dependencies, test impact, risk, and whom to arbitrate with — as JSON, before anything is touched.

### 18.6 Stable identities and the `.ai/` pack

- Observability identity is `capability:operation@contractVersion`, plus the unit id and the capability id. Boundary
  level only — no per-component tracing.
- The `.ai/` pack carries L0 constitution → L1 frontend card → L2 contract card → L3 task recipe → L4 source, with
  `contextFor({ kind })` returning the smallest file set for a task shape. Indexes are generated from the manifests and
  a test fails with the exact difference when they age; every file has a size budget.

### 18.7 What P2.8-F deliberately does not do

No loader, no dynamic module resolution, no service worker, no daemon, no runtime dependency, no framework change, no
UI change, no feature. Lazy activation is **permitted by the model** (activation mode + entry + lifecycle + states) and
is not implemented — a loader is a later, separately-justified task. The boot payload grew by **zero bytes**; the
maturity layer is visible to tooling and to the registry, not to the browser.

## 19. Hardening rules (compatibility and parity foundation) — machine-readable

The rules below are **data, not prose**. They live in
`packages/frontend-lego/src/conformance.mjs` and are checked against a live assembly by
`frontend.conformance()`. The JSON block at the end of this section is the same list, so a
reader, a test and the contract document cannot drift apart: `test/19-conformance.test.mjs`
parses the block and requires the ids to match exactly.

Each rule names the runtime vocabulary that enforces it (`vocabulary`, in the module) and the
suite that proves it (`enforcedBy`). A rule whose suite has been deleted, or whose id is
missing from this document, fails the conformance test.

### 19.1 Capability access — placement grants nothing

A unit may use a capability only because (a) the unit's own surface binds that capability, or
(b) the capability explicitly declares that surface. **Nesting never grants access**: a child
does not inherit what its parent may reach. A consumer that was not granted a capability is
not told whether it exists, what version it is, or how it would have behaved — the refusal
names the unit, the capability and the reason, and nothing else. Fail closed, always.

Capability discovery reports the **origin** of what it finds — `frontend-registered`,
`frontend-declared` or `backend-advertised` — because a backend capability name that collides
with a frontend one is a vocabulary conflict, not a synonym. Lifecycle reasons apply only to
frontend-origin capabilities.

### 19.2 Transport neutrality

A business contract names **operations**, never transports. The kinds are declared —
`local`, `rest`, `event`, `stream`, `ipc`, `remote` — with declared relative costs, and the
cheapest capable transport wins. For same-process work that is a direct call with
serialization `none`: **no HTTP between local modules**, and no envelope is serialized for a
local hop. An operation no transport can carry is refused by name (`NoTransportError`), not
routed somewhere slower. Transports that are declared but not implemented are listed as such
and are never selected. The existing REST client remains the backend compatibility boundary;
it is not a transport this LEGO imposes on local work.

### 19.3 One version vocabulary

`versions.mjs` is the only place versions are parsed, compared, ranged or classified. Rules:
a major difference is never compatible (`major-mismatch`); a compatible variant is reported as
a state (`compatible`, `minor-ahead`, `major-mismatch`, `invalid`) with a human-readable
detail — never as a bare boolean; an unparseable version is `invalid`, never assumed;
`^`-ranges are major-bounded and `~`-ranges are minor-bounded. Declarations elsewhere
(unit manifests, capability manifests, the contract version) are checked against this module.

### 19.4 Replacement and upgrade safety

`registry.replace(unitId, { id, kind, language })` swaps **what implements** a unit while
keeping its contract, its version and every consumer's declaration byte-identical. Refused:
a replacement whose contract differs from the unit's, one that would move the version, and a
no-op replacement. A refusal is atomic — the catalog is untouched. Both outcomes are
observable (`frontend.replacement.applied` / `frontend.replacement.rejected`).

Replacement and upgrade are distinct operations: upgrading a unit does not undo its
replacement, and a downgrade remains refused. Every unit's implementation identity is
derived when not declared: `{ id, kind: 'reference', contract: <the unit's contract>,
status: 'declared', language: null }`.

### 19.5 Boundary observability

Events are emitted at the architecture boundary — capability registered/rejected/degraded,
unit registered/rejected, lifecycle transition, contract mismatch, upgrade applied/rejected,
downgrade rejected, replacement applied/rejected, operation completed/rejected, negotiation
decided. The vocabulary is **closed**: an undeclared event id is refused. Events are
**payload-free** — `payload`, `token`, `authorization`, `subject`, `scopes`, `cookie`,
`password`, `secret` and `content` are rejected by name, because they belong to the session,
not to telemetry. The buffer is bounded (default 200) and a throwing sink is counted and
swallowed; telemetry never breaks a user flow. This is a vocabulary and a buffer, not a
telemetry framework.

### 19.6 Frontend readiness vs backend availability

The frontend never probes the backend. What the backend advertises is derived from
declarations — `override`, `compat-unsupported-map`, or the surface catalog — and every
answer carries its `source`, so an inferred state is never mistaken for a measured one.
Backend states are `available`, `partial`, `unsupported`, `unknown`; `unknown` means "not
declared", not "broken". Readiness (frontend) and availability (backend) are reported side by
side; neither is allowed to silently stand in for the other.

### 19.7 Extension points are surface-owned

An extension point belongs to the **surface** that declares it. A capability may add to the
hooks of the surfaces it occupies — `manifest/extension-points.json` is the authority — and
claiming a hook on a surface the capability does not occupy is refused at registration with
the owning surface named. This is what makes "an extension may not patch an implementation it
does not own" checkable instead of aspirational. The upstream hook rules (additive
declarations, `mutates: 'attributes-only'`, an attribute whitelist and a non-empty `never`
list) are unchanged; this rule only closes who may reach the hook at all.

### 19.8 Degradation situations and required permissions

Seven situations are declared data (`DEGRADATION_SITUATIONS`), and each one produces a
verdict with a state, at least one reason and a declared behaviour — never a silent
"available":

| Situation | State | Trigger |
| :--- | :--- | :--- |
| unavailable | `unavailable` | nothing declares or advertises the capability |
| disabled | `disabled` | a declared lifecycle state of `disabled` |
| unsupported | `unavailable` | the instance does not implement the capability |
| incompatible | `version-mismatch` | a required version differs in its major component |
| degraded | `degraded` | the instance is partial, or a required operation is missing |
| not installed | `degraded` | the frontend declares the capability but has not installed it |
| migration-required | `migration-required` | a declared migration gate has not run |

`unsupported`/`unavailable`/`version-mismatch`/`disabled`/`migration-required` carry
`degradation = { behavior: 'fallback', fallback: 'native-behavior' }`; `degraded` carries
`{ behavior: 'degrade', fallback: 'declared-behaviour' }`. The behaviour is a declaration the
surface renders, not a decision it improvises.

**Required permissions** are declared data too: a capability may list `permissions` as
`<domain>:<action>` names, the verdict reports them as `requiredPermissions`, and a consumer is
told what it must be allowed to do before it asks. A permission is a name, never a credential —
no token, key or cookie is representable in the declaration, and an undeclared or malformed
permission is refused at registration. Permissions are never inferred from a route, a menu entry
or a nested position.

### 19.9 Rule block (machine-readable)

```json
[
  {
    "id": "A1",
    "statement": "A capability is declared, installed, loaded and active as four different states; only loaded, active or idle may serve.",
    "contract": "§18.1",
    "enforcedBy": "07-lifecycle.test.mjs"
  },
  {
    "id": "A2",
    "statement": "Criticality decides degradation, and a core capability may not declare a fallback.",
    "contract": "§18.2",
    "enforcedBy": "07-lifecycle.test.mjs"
  },
  {
    "id": "A3",
    "statement": "Trust is inherited and never promoted by nesting; an unknown trust level is refused.",
    "contract": "§18.2",
    "enforcedBy": "07-lifecycle.test.mjs"
  },
  {
    "id": "A4",
    "statement": "Placement grants no capability: access comes from a unit’s own surface binding or from a capability that declares that surface.",
    "contract": "§19.1",
    "enforcedBy": "14-negotiation.test.mjs"
  },
  {
    "id": "A5",
    "statement": "Business contracts name operations, never transports; the cheapest capable transport wins and nothing is routed implicitly.",
    "contract": "§19.2",
    "enforcedBy": "15-transport.test.mjs"
  },
  {
    "id": "A6",
    "statement": "One version vocabulary: a major difference is never compatible, and compatibility is reported as a state rather than a boolean.",
    "contract": "§19.3",
    "enforcedBy": "13-versions.test.mjs"
  },
  {
    "id": "A7",
    "statement": "An implementation may be replaced behind its contract without moving the contract, the version or any consumer.",
    "contract": "§19.4",
    "enforcedBy": "16-replacement.test.mjs"
  },
  {
    "id": "A8",
    "statement": "Nested units are hierarchical, bounded at three levels, and a unit may only consume another unit’s published ports.",
    "contract": "§19.4",
    "enforcedBy": "06-sublegos.test.mjs"
  },
  {
    "id": "A9",
    "statement": "Degradation is explicit and machine-readable: availability, support and criticality are declared, never improvised per surface.",
    "contract": "§18.3",
    "enforcedBy": "10-profiles.test.mjs"
  },
  {
    "id": "A10",
    "statement": "Observability is boundary level and payload free: no payload, token, subject or scope may enter an event.",
    "contract": "§19.5",
    "enforcedBy": "17-observability.test.mjs"
  },
  {
    "id": "A11",
    "statement": "Selective test tiers reduce iteration cost; the full set still runs in CI and is never replaced by a green selective run.",
    "contract": "§18.5",
    "enforcedBy": "18-impact-plan.test.mjs"
  },
  {
    "id": "A12",
    "statement": "The knowledge pack is machine-derived, drift-checked and small enough to retrieve by level rather than read in full.",
    "contract": "§18.6",
    "enforcedBy": "12-knowledge.test.mjs"
  },
  {
    "id": "A13",
    "statement": "Frontend readiness and backend availability are separate declarations, shown side by side; the frontend never probes the backend.",
    "contract": "§19.6",
    "enforcedBy": "14-negotiation.test.mjs"
  },
  {
    "id": "A14",
    "statement": "A registration may reference implementation by path only: code and framework detail stay out of the metadata registries.",
    "contract": "§18.1",
    "enforcedBy": "11-registry-maturity.test.mjs"
  },
  {
    "id": "A15",
    "statement": "Device support is a declared budget, never a platform check; a thin client reaches what it cannot run locally.",
    "contract": "§18.3",
    "enforcedBy": "10-profiles.test.mjs"
  },
  {
    "id": "A17",
    "statement": "Every degradation situation (unavailable, disabled, unsupported, incompatible, degraded, not installed, migration-required) is a declared state with a reason and a fallback — never silent availability.",
    "contract": "§19.8",
    "enforcedBy": "23-degradation.test.mjs"
  },
  {
    "id": "A16",
    "statement": "An extension point is owned by a surface: a capability may only add to the hooks of the surfaces it occupies, never to a neighbour’s.",
    "contract": "§19.7",
    "enforcedBy": "21-security.test.mjs"
  }
]
```
