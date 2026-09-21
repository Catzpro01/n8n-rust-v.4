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
| Boot payload | `buildBootPayload()` → `{ contractVersion, app, ui, contract, locales, messageSlots, errorKinds, errorCodes, surfaces, extensionPoints, capabilities }` |
| Capability registry | `register(capability)` / `list()` / `get(id)` / `resolveRoute(path)` / `descriptor()` — validated, deterministic, duplicate-safe |
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

Every hook declares `payload`, `additive`, `mutates`, `requiresCapability`, `consumers`, `status: 'declared'`.
A capability that attaches to a hook must name it in its registration, so the boundary stays explicit.

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

- Owns: surface catalog, extension-point catalog, capability registry, message-slot structure, locale metadata,
  error-code vocabulary, contract descriptor. All of it is static declaration data.
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

## 17. Compatibility requirements (pinned UI)

- The bundle is served verbatim; the only allowed `index.html` addition is the additive boot `<meta>` tag (§4).
- `%CONFIG_TAGS%`, `BASE_PATH`, `{{REST_ENDPOINT}}` and the title templating stay exactly as they are.
- No new `/rest/*` path may shadow an endpoint the UI calls; the discovery endpoint is new and never called by the UI.
- Error envelopes, status codes and the 501 capability contract stay as specified by api.contract §3/§7 and the P2 layer.
- Removing or renaming anything in §2–§12 requires a major contract version and a Manager/Integrator decision.
