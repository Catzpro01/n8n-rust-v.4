# n8n editor UI compatibility — inventory (Phase 1) + contract layer (Phase 2)

**Question this document answers**

> The real n8n editor UI is pinned and running on our backend, but only part of the
> menus/features appear. Why exactly, and which endpoints/contracts must the backend
> provide so the UI shows and works as close to stock n8n as possible?

**Status:** Phase 1 (inventory, §1–§9) delivered the findings; **Phase 2 (§10)
implemented the Compatibility Contract Layer** — the findings R1, R2 and R7 are
fixed and R3/R5 now answer with explicit unsupported semantics instead of a fake
success. §1–§9 below are preserved as the P1 evidence trail, with P2 outcomes
annotated into the findings table (§6).

**Baseline:** commit `812bed72` (P0 PASS), Phase 1 merged at `93078360`, Phase 2 on
this branch. Pinned frontend: `n8n-editor-ui@2.9.4`,
catalog `n8n-nodes-base@2.9.1`, reference source `reference/n8n` (n8n `2.9.4`).

---

## 1. How this inventory was produced (evidence, not reading)

The audit drives the **running UI**, not the backend route list:

```bash
# instance under audit (fresh data dir, catalog bootstrapped on first start)
N8N_LEGO_USER_FOLDER=/tmp/p1/audit-data N8N_LEGO_PORT=6210 N8N_LEGO_LOG_LEVEL=debug \
  node apps/n8n-lego/bin/n8n-lego.mjs start

# walk every route the pinned UI declares, then click the deep controls
CHROME_PATH=/tmp/chromium node tests/e2e/compat-inventory.mjs http://127.0.0.1:6210 --deep
```

`tests/e2e/compat-inventory.mjs` (new, this phase) records per UI page:

* every `/rest/*` call the frontend made (method, real path, status) and a **shape summary**
  of the JSON it received (top-level keys, `data` shape, item keys);
* where the page ended up (redirect target — a redirect is the strongest signal of a
  missing contract);
* which menu items rendered (`data-test-id` such as `main-sidebar-*`,
  `settings-sidebar-*`, `project-*-menu-item`);
* console/page errors and any non-2xx REST response;
* a `--deep` pass that clicks workflow history, the workflow menu, a project card, the
  credentials modal, the executions tab and the node creator.

Raw evidence of the run quoted below: `/tmp/p1/inventory.json` (21 pages, 8 deep steps,
19–21 endpoints depending on which optimised fetches the UI issues), screenshots `/tmp/p1/shots/*.png`, server trace `/tmp/p1/audit.log`
(`[rest:todo]` lines are the stubs the UI actually hit).

Source of truth for *expected* contracts is the pinned frontend/backend pair itself:
`reference/n8n/packages/frontend/editor-ui/src/**` (routes, stores, guards) and
`reference/n8n/packages/cli/src/**` (controllers, services). File and line references are
given inline.

---

## 2. FRONTEND LEGO — boundary definition

```
n8n-editor-ui@2.9.4 (npm, prebuilt dist, never patched)
        │  HTTP + WebSocket, only the documented n8n surface
        ▼
COMPATIBILITY LEGO  ── /rest/* routing, payload envelope {data}, error shape, status codes,
        │              scopes, feature flags (GET /rest/settings), sessions/cookies, /rest/push
        ▼
  auth · workspace · workflow · execution · credentials · node-registry · dynamic-parameters
        │
        ▼
STORAGE LEGO (collection/blob contract; JSON implementation today)
```

Boundary rules that follow from the audit:

| Rule | Why it is required (evidence) |
| :--- | :--- |
| The UI bundle is never patched; all divergence is fixed on the backend. | `dist/index.html` carries `%CONFIG_TAGS%` and reads `/rest/settings` on boot (`src/ui.mjs` serves it verbatim). Any UI edit would fork the frontend and break the "real n8n UI" goal. |
| The compatibility layer owns the *shape* of every response the UI reads, including fields the UI indexes blindly. | `init.ts:237` reads `user.globalScopes`; `settings.store.ts` indexes `settings.enterprise.*`, `settings.projects…` without guards. A missing key is not a network error — it silently disables a feature. |
| Feature visibility is decided by the *contract*, never by hiding UI. | Menu availability is `settings flag && hasScope(route.middleware)` (`useSettingsItems.ts`, `ProjectNavigation.vue`, `router.ts` route `meta`). |
| An unavailable feature answers with a distinguishable error/state, never `200 {}`. | Today every unknown `/rest/*` path is answered by the catch-all stub (`apps/n8n-lego/src/rest/routes.mjs:1034`, logs `[rest:todo]`). For features the UI *can* reach (see §5) this hides "not implemented" behind a successful response. |
| LEGOs do not import each other's implementation. | Today `src/rest/routes.mjs` is a single 1000+ line file mixing auth, workflow, execution, credentials, node registry and projects — the boundary does not exist yet. Phase 2/3… split it, one LEGO per phase. |

**Current state of the boundary (measured):** the compatibility surface exists
(`src/rest/router.mjs`, `src/rest/routes.mjs`, 64 route entries) but is *unboundaried*:
one file owns 7 domains, and there is no contract test per domain. That is the P1
finding that Phase 2 (compatibility layer) and Phase 3+ (LEGO split) must consume.

---

## 3. What the running UI actually asks for (measured)

Boot sequence, identical on every authenticated page (from `/tmp/p1/audit.log`):

```
GET /rest/settings          → 200   (first, anonymous, before login → drives the login/owner screen)
GET /rest/login             → 401   (anonymous; expected) | 200 (authenticated)
GET /rest/settings          → 200   (again, with session)
GET /types/nodes.json       → 200   (static file, 483 node types)
GET /rest/module-settings   → 200   {"data":{}}
GET /rest/projects/my-projects, /personal, /count → 200
GET /rest/roles             → 200
GET /rest/license           → 200
per page: /rest/workflows, /rest/active-workflows, /rest/executions, /rest/credentials,
          /rest/variables, /rest/credentials/for-workflow, /rest/workflows/:id/exists,
          /rest/workflows/new …
/rest/push                  → WebSocket for execution + collaboration events
```

~20 distinct endpoints were requested by 21 pages + 8 deep interactions (19–21 run to run). Full per-page
matrix: `/tmp/p1/inventory.json` (`pages[].rest`, `restIndex[].shapes`).

---

## 4. Why the menus/features are missing — root causes

### R1 — the user object has no `globalScopes` (this is *the* cause of the missing settings menu)

* Contract: n8n returns `PublicUser.globalScopes` when the user is loaded —
  `reference/n8n/packages/cli/src/services/user.service.ts:147`
  (`if (options?.withScopes) publicUser.globalScopes = getGlobalScopes(user)`).
* UI: `reference/n8n/packages/frontend/editor-ui/src/app/init.ts:237`
  (`RBACStore.setGlobalScopes(user.globalScopes ?? [])`) → `app/stores/rbac.store.ts` →
  `app/utils/rbac/checks/hasScope.ts` → `app/utils/rbac/permissions.ts`.
* Consequence A (menus): every settings entry is `available: canUserAccessRouteByName(...)`,
  i.e. `hasPermission(route.meta.middleware, meta.middlewareOptions)`
  (`app/composables/useUserHelpers.ts`, `app/composables/useSettingsItems.ts`). `useSettingsItems`
  declares **16** entries; with an empty scope set only the unguarded one survives — measured on
  `/settings/personal`, the settings sidebar contains exactly `["Settings", "Personal",
  "Version 2.9.4"]`. (`SettingsSidebar.vue:28` renders the items without `data-test-id`, so they
  are measured by label; the harness now records `settingsSidebarLabels`/`mainSidebarLabels`.)
* Consequence B (pages): `app/utils/rbac/middleware/rbac.ts` returns
  `next({ name: VIEWS.HOMEPAGE })` when the scope check fails. Measured: requesting
  `/settings/users|api|security|community-nodes|sso|log-streaming|external-secrets|workers|environments|usage`
  all end at `/home/workflows`, while `/settings/personal` (guarded by `authenticated` only)
  renders normally.
* Our implementation: `apps/n8n-lego/src/auth.mjs:122` `toPublicUser()` returns
  `{ id, email, firstName, lastName, role, isPending, isOwner, settings, disabled, mfaEnabled,
  personalizationAnswers, createdAt, updatedAt, signInType }` — **no `globalScopes`**
  (status: WRONG SHAPE).
* Fix size: one field. The owner scope list is already deterministic and shipped in
  `apps/n8n-lego/data/roles.json` (121 scopes for `global:owner`), generated from
  `reference/n8n/packages/@n8n/permissions/src/roles/scopes`.

### R2 — `/rest/settings` hides the Usage entry that stock n8n shows

* Upstream: `hideUsagePage` defaults to **false** (`reference/n8n/packages/@n8n/config/src/index.ts:196`)
  and is passed through by `cli/src/services/frontend.service.ts:338`.
* Ours: `apps/n8n-lego/src/rest/settings.mjs` hardcodes `hideUsagePage: true` → the
  "Usage and plan" settings entry can never appear even after R1 is fixed.
* Also ours: `communityNodesEnabled: false` (`src/config.mjs:196` default) gates the
  "Community nodes" entry and page (upstream default for community packages is
  **BELUM TERBUKTI** in this environment — flagged in §8 open questions).

### R3 — most settings pages have no endpoints at all

Even with R1 fixed, these routes are reachable by the community owner (they are guarded by
scopes the owner really has) but the backend has nothing behind them:

| UI page | Scope required (from `router.ts`) | Owner has it? (`roles.json`) | Backend today |
| :--- | :--- | :--- | :--- |
| Settings → Users | `user:create`,`user:update` | yes | `GET /rest/users` only; no list fields, no create/update/delete, no `/rest/users/:id/*` |
| Settings → API | `apiKey:manage` | yes | no `/rest/api-keys*` (MISSING) |
| Settings → Security | `securitySettings:manage` | yes | no `/rest/settings/security`, no `/rest/me/password`, no `/rest/me/2fa*` (MISSING) |
| Settings → Migration report | `breakingChanges:list` | yes | no `/rest/breaking-changes/*` (MISSING) |
| Settings → Community nodes | `communityPackage:list`,`communityPackage:update` + flag | yes | no `/rest/community-packages*` (MISSING); flag off today |
| Settings → Usage and plan | `license:manage` + `!hideUsagePage` | yes | hidden by R2; `/rest/license` exists but no activate/renew |
| Settings → SSO | `saml:manage` | yes (scope) | no `/rest/sso/*` (MISSING; enterprise feature → must answer with a distinguishable "not licensed" state) |
| Settings → LDAP | `ldap:manage` | yes (scope) | no `/rest/ldap/*` (MISSING; enterprise) |
| Settings → Log streaming | `logStreaming:manage` | yes (scope) | no `/rest/log-streaming/*` (MISSING; enterprise) |
| Settings → External secrets | `externalSecretsProvider:list/update` | yes (scope) | no `/rest/external-secrets/*`, `/rest/secret-providers/*` (MISSING; enterprise) |
| Settings → Environments (source control) | `sourceControl:manage` | yes (scope) | no `/rest/source-control/*` (MISSING; enterprise) |
| Settings → Workers | `workersView:manage` + queue mode | no (queue mode off) | correctly hidden, same as stock community |

### R4 — project/workspace contract is minimal

* `/rest/projects/:projectId` is answered by the catch-all stub — measured in the deep pass
  (`[rest:todo] … "GET /rest/projects/ba9f7dfdbf526eef"`) when a project card is clicked.
* `/rest/projects/my-projects` returns the personal project only (array(1)); there are no
  `/rest/projects/:id/workflows|credentials|executions|members`, no folder endpoints
  (`settings.folders.enabled=false`, matching upstream default in community).
* `/rest/settings.enterprise.projects.team.limit` = 0 in ours; upstream community default is
  also 0 (`cli/src/services/frontend.service.ts:328` + `getTeamProjectLimit()`), so the
  sidebar showing only "Overview" is **correct for community n8n**, not a defect
  (`projects.store.ts:69`: `isTeamProjectFeatureEnabled = limit !== 0`).

### R5 — workflow history is stubbed (silent 200)

The pinned UI calls `/rest/workflow-history/workflow/:id`, `/versions`, `/versions/:versionId`,
`/version/:versionId` (`@n8n/rest-api-client/src/api/workflowHistory.ts`). Our app has **no**
such routes, so the catch-all answers `200 {"data":{}}`; the history viewer would open empty.
Observed in the P0 smoke run (`WARN [rest:todo] … GET /rest/workflow-history/workflow/<id>/version/<versionId>`).

### R6 — not defects: what stock community n8n also hides

Verified against the pinned frontend so we do **not** "fix" them by hacking the UI:

* queue-mode-only entries (Workers) — `settings.executionMode !== 'queue'`;
* enterprise-only entries with `enterprise.*` false (project roles, source control, log
  streaming, external secrets, SAML/OIDC/LDAP, MFA enforcement, workflow diffs, variables limit);
* AI entries (`aiAssistant`, `taskAi`, `aiBuilder` off), chat hub module, dynamic-credentials
  resolvers, folders, data tables, insights/usage page;
* the main sidebar's expanded/collapsed state comes from the UI's own experiment
  (`useSidebarExpandedExperiment`); measured entries (`aria-label`s) are exactly
  `Add new item`, `Open command palette`, `Toggle sidebar`, `Overview`, `Help`, `Settings`,
  matching stock community n8n for a single-user instance — no backend flag influences it.

---

## 5. Endpoint inventory

Status legend: **PASS** works for the observed call · **PARTIAL** works but has known gaps ·
**WRONG SHAPE** response lacks fields the UI reads · **STUB** answered by the `[rest:todo]`
catch-all with an empty 200 · **MISSING** no route at all.

### 5.1 Endpoints the UI called in this audit (measured)

| Endpoint | Contract expected (pinned n8n 2.9.4) | Ours today | Missing / notes | Owning LEGO |
| :--- | :--- | :--- | :--- | :--- |
| `GET /rest/settings` | `FrontendSettings` (@n8n/api-types), flags drive every menu | 200, most fields present | R2 (`hideUsagePage`), community-nodes flag; several enterprise sub-objects unverified field-by-field | compatibility |
| `GET /rest/login` | `PublicUser` **with `globalScopes`** when authenticated, 401 otherwise (`user.service.ts:147`) | 200/401 correct | **WRONG SHAPE** (R1) | auth |
| `POST /rest/login`, `POST /rest/logout`, `POST /rest/owner/setup` | session cookie (`n8n-auth`), `PublicUser` with `globalScopes` | 200, cookie set | same as R1 | auth |
| `GET /rest/me` | `PublicUser` + `globalScopes` (+ `mfaAuthenticated`) | 200 | **WRONG SHAPE** (R1) | auth |
| `GET /rest/module-settings` | module registry map (`api/module-settings.ts`) | 200 `{data:{}}` | shape plausible (no modules registered); confirm in P2 | compatibility |
| `GET /rest/license` | `{usage, license}` (`api/usage.ts`) | 200 `{data:{usage,license}}` | field-level contract unverified | compatibility |
| `GET /rest/roles` | `{global,project,credential,workflow}` Role[] | 200, sourced from `reference/n8n` permissions | PASS for list; per-role scope semantics untested | auth |
| `GET /rest/projects/{personal,my-projects,count}` | ProjectListItem(s) with `role`,`scopes`; counts `{personal,team}` | 200 | team limit 0 = upstream community | workspace |
| `GET /rest/projects/:projectId` | project detail (+ per-project resource endpoints) | **STUB** (`[rest:todo]`) | R4 | workspace |
| `GET /rest/workflows` (+ `POST`, `GET/PATCH/DELETE /:id`) | `{count,data}` + filters; `WorkflowEntity` incl. `versionId`, `active`, `shared`, `tags` | 200/implemented (P0 smoke: create/save/execute PASS) | filters/pagination/sharing fields to verify in P3 | workflow |
| `GET /rest/workflows/new`, `GET /:id/exists`, `POST /:id/run`, `GET /:id/executions/last-successful` | editor bootstrap + run | implemented | run route verified end-to-end in P0 | workflow / execution |
| `GET /rest/active-workflows` | `WorkflowListItem[]` | 200 `[]` | PASS (empty) | workflow |
| `GET /rest/executions`, `GET /:id`, `/stop`, `/delete` | `ExecutionSummary` + `data`/`workflowData` | implemented | result inspection verified in P0 | execution |
| `GET /rest/credentials`, `/for-workflow`, `POST /rest/credentials/test`, CRUD, `/new` | credential list/detail (no secrets), `POST /credentials/test` (`credentials.api.ts:144-153`), CRUD | implemented (test route matches the UI's real path) | **no encryption at rest** (P5); `/rest/oauth1-credential/auth` and `/rest/oauth2-credential/auth` (`credentials.api.ts:118-140`) are MISSING, so OAuth credential buttons cannot work | credentials |
| `GET /rest/variables` | enterprise variables list | 200 `[]` | PASS (feature off) | compatibility |
| `GET /rest/types/nodes.json`, `/types/credentials.json`, `POST /rest/node-types` | editor node metadata | 200 (483 types) | PASS; used by palette/canvas | node-registry |
| `GET /icons/*` | node icons | 200 | PASS (362 icons; smoke asserts no 404) | node-registry |
| `GET /rest/push` (WS) | execution + collaboration events | implemented | PASS | execution |
| `GET /rest/ctas/*`, `/rest/banners`, `/rest/events`, `/rest/env-feature-flags`, `/rest/versions`, `/rest/third-party-licenses`, `/rest/community-node-types` | cosmetic/bootstrap | implemented | PASS (cosmetic) | compatibility |
| `GET /rest/tags` | tag list for the tag dropdown | implemented | PASS | workflow |

### 5.2 Endpoints the redirected pages will call once R1 is fixed (from the pinned UI's own API client)

These are **source-derived, not yet observed** (the pages cannot be reached today). They are
listed here so Phase 2+ has the contract list; each row names the client module that proves it.

| Endpoint | Client module | Owning LEGO | Phase |
| :--- | :--- | :--- | :--- |
| `GET/POST/PATCH/DELETE /rest/users`, `/users/:id/*`, `/users/:id/invite-link`, `/users/:id/password-reset-link` | `api/users.ts` | auth | P5 |
| `GET/POST/DELETE /rest/api-keys`, `GET /rest/api-keys/scopes` | `api/api-keys.ts` | auth | P5 |
| `GET/PATCH /rest/settings/security` | `api/security-settings.ts` | auth | P5 |
| `POST /rest/me/password`, `/me/survey`, `/mfa/{enable,disable,qr,verify}` | `api/users.ts`, `api/mfa.ts` | auth | P5 |
| `GET /rest/breaking-changes/report`, `/report/refresh`, `/report/:ruleId` | `api/breaking-changes.ts` | compatibility (node-registry data) | P6 |
| `GET /rest/community-packages` (+ install/uninstall) | `api/communityNodes.ts` | node-registry | P6 |
| `POST /rest/dynamic-node-parameters/{options,resource-locator-results,resource-mapper-fields,local-resource-mapper-fields,action-result}` | `api/nodeTypes.ts:96-142` | dynamic-parameters | P7 |
| `GET /rest/community-node-types/:type` (the list route already exists) | `api/nodeTypes.ts` | node-registry | P6 |
| `GET /rest/workflow-history/workflow/:id`, `/versions`, `/versions/:versionId`, `/version/:versionId` | `api/workflowHistory.ts` | workflow | P3 |
| `GET/POST/PATCH/DELETE /rest/projects*`, `/projects/:id/{workflows,credentials,executions,members}`, folders | `features/collaboration/projects`, `api/*` | workspace | P3 (read-only first) |
| `GET /rest/licenses`, `/license/activate|renew|enterprise/request_trial` | `api/usage.ts` | compatibility | deferred (distinguishable "not supported") |
| `GET /rest/sso/{saml,oidc}/config`, `/sso/saml/*`, `/ldap/{config,sync}` | `api/sso.ts`, `api/ldap.ts` | auth (enterprise) | deferred (must answer "not licensed", not `200 {}`) |
| `GET /rest/log-streaming/*` (eventbus destinations) | `features/settings/logStreaming.store.ts` | observability (new boundary) | deferred |
| `GET /rest/external-secrets/*`, `/secret-providers/*` | `api/externalSecrets.ee.ts`, `api/secretsProvider.ee.ts` | credentials (enterprise) | deferred |
| `GET /rest/source-control/*` | `features/integrations/sourceControl.ee` | workflow (enterprise) | deferred |
| `GET /rest/orchestration/worker/status` | `api/orchestration.ts` | worker | P11 |
| `GET /rest/credential-resolvers*` | `api/credentialResolvers.ts` | credentials (enterprise) | deferred |

### 5.3 The catch-all stub is itself a contract problem

`apps/n8n-lego/src/rest/routes.mjs:1034` answers **any** unknown `/rest/*` path with
`200 {"data":{}}` and logs `[rest:todo]`. Two consequences:

1. it is a precise backlog (every line is a real UI request), and
2. it violates the "never fake an available feature" rule for reachable screens.
   P2 must replace it with a distinguishable unsupported error for paths the UI can reach,
   while keeping the log line as the backlog signal.

---

## 6. Findings summary (what to do, and in which phase)

| # | Finding | Owning LEGO | Phase | Status of finding |
| :--- | :--- | :--- | :--- | :--- |
| R1 | `PublicUser.globalScopes` missing → 0 settings entries, all rbac routes redirect | auth (compat envelope) | P2 | **FIXED in P2** (§10.2; evidence `evidence/settings-visibility-p2.json`) |
| R2 | `hideUsagePage: true` deviates from upstream default `false` | compatibility | P2 | **FIXED in P2** (§10.3; configurable, default false) |
| R3 | 11 settings screens have no endpoints behind them | auth / node-registry / compatibility | P5–P6 (+ distinguishable "not licensed" for enterprise) | pages render since P2; their backends answer **501 unsupported** (§10.5) until the owning phase |
| R4 | `/rest/projects/:id` stub; project resources missing | workspace | P3 | unchanged, now an explicit **501** (§10.5) |
| R5 | workflow history endpoints absent → history viewer empty | workflow | P3 | unchanged, now an explicit **501** (§10.5) |
| R6 | queue/enterprise/AI entries are hidden by flags that match stock community | — | none | measured — **kept honest in P2** (no flag was forced on) |
| R7 | catch-all `200 {}` for unknown `/rest/*` | compatibility | P2 | **FIXED in P2** (§10.5; 501 `{code:'unsupported'}`) |

**Phase 1 gate check**

1. frontend LEGO boundary documented — §2 ✅
2. every important endpoint the UI uses mapped — §3, §5.1 (measured) ✅
3. cause of the missing menus identified — R1/R2/R3 (+R6 counter-examples) ✅
4. each main endpoint has an owning LEGO — §5.1/§5.2 ✅
5. existing P0 E2E still PASS — §7 ✅

---

## 7. P0 regression after Phase 1 (must stay PASS)

Phase 1 adds two test files only (`tests/e2e/compat-inventory.mjs`, this document) and
changes no application code, so the P0 gates are re-run to prove it:

```
node --test apps/n8n-lego/test/*.test.mjs            → 12/12 PASS
node tests/e2e/lego-smoke.mjs <url> --mode=create    → 9/9 PASS   (real UI, fresh instance)
restart instance → --mode=verify                     → 5/5 PASS   (workflow survived)
```

The audit run itself is repeatable: `node tests/e2e/compat-inventory.mjs <url> --deep`.

---

## 8. Open questions to close before Phase 2/3 (each needs measurement, not opinion)

1. Upstream default of `communityNodesEnabled` in community edition (our config default is
   `false`) — decide whether the "Community nodes" entry should render.
2. Field-by-field diff of `GET /rest/settings` against `@n8n/api-types/src/frontend-settings.ts`
   (the audit stores the payload; the diff is mechanical).
3. Whether `/rest/workflow-history/*` is called by the version menu in the default
   (non-enterprise) editor state — needs a run with a saved workflow and network to
   `api.n8n.io` blocked (the recommended-templates fetch currently fails in this sandbox;
   `templates.enabled=false` yet the store still requests template ids — verify in P2).
4. `/rest/license` field contract (`usage.activeWorkflows`, `license.planName`, …) versus what
   `api/usage.ts` reads.
5. Whether any UI surface requires a *patched* bundle (so far: none found).

---

## 9. Deliberately not done in Phase 1 (deferred by the phase rules)

Implementing `globalScopes`, the settings endpoints, project detail endpoints, workflow
history, dynamic parameters, credential encryption, storage abstraction, Rust, UI changes,
CI changes, or any refactor of `src/rest/routes.mjs`. Phase 1 delivers the inventory, the
boundary and the owners; Phase 2 starts with the compatibility layer (R1/R2/R7 are its
first three contract tests).

---

## 10. Phase 2 — Compatibility Contract Layer (implemented)

§1–§9 are the Phase 1 inventory. This section is the Phase 2 build: the boundary it
proposed, now running. Everything below is measured on the pinned UI
(`tests/e2e/settings-compat.mjs`, evidence `evidence/settings-visibility-p2.json`)
and the contract tests (`apps/n8n-lego/test/compat.contract.test.mjs`).

### 10.1 The boundary is real now (P2-A, P2-G)

```
n8n-editor-ui@2.9.4 (npm, prebuilt dist, never patched)   ← Principle 1 holds
        │  HTTP + WebSocket, only the documented n8n surface
        ▼
src/compat/  — THE COMPATIBILITY LAYER
        │  route.mjs        one router; mounts domain modules; `:param` capture; `public` flag contract
        │  response.mjs     the JSON envelopes ({data}, bare {count,data}, error shape) + readBody
        │  error.mjs        HttpError + status semantics (incl. 501 unsupported)
        │  auth-context.mjs requireUser + PublicUser shape (adds globalScopes, mfaAuthenticated)
        │  scopes.mjs       the permission model (roles.json) + getGlobalScopes(user)
        │  capability.mjs   the capability registry + the unsupported handler (501)
        ▼
domain modules (single process — Principle 3)
        src/auth/routes.mjs       AUTH LEGO        login/logout, owner setup, me, users, roles
        src/settings/             SETTINGS LEGO    GET /rest/settings (+ frontend-settings.mjs)
        src/rest/routes.mjs       LEGACY AGGREGATE catalog, workflows, executions, credentials,
                                   projects, license, misc — peeled off per domain in P3+
        src/compat/capability.mjs COMPATIBILITY/UNSUPPORTED owner of every unowned /rest/* path
```

Request flow: `compat router → domain handler`; router misses go to the capability
handler. No business logic moved into `src/compat/`; it owns shape, scope exposure
and the unsupported contract only. `src/rest/routes.mjs` keeps the not-yet-split
domains with an explicit header marking each one's target phase — the file is no
longer "everything", it is a queue with owners.

### 10.2 PublicUser.globalScopes (P2-B) — R1 fixed

| | before (measured P1) | after (measured P2) |
| :--- | :--- | :--- |
| `GET/POST /rest/login`, `POST /rest/owner/setup`, `GET /rest/me` | no `globalScopes` field | `globalScopes: string[121]` for the owner, `mfaAuthenticated: false` — the same options upstream passes (`withScopes: true`) |
| `PATCH /rest/me`, `PATCH /rest/me/settings`, `GET /rest/users` | (same omission) | **no** scopes — mirrors upstream (`users.controller.listUsers` serializes without scopes) |
| source of the value | — | computed per login from the extracted permission model: `getGlobalScopes(user)` = scopes of the user's global role in `data/roles.json` (`@n8n/permissions`), `[]` for an unknown role — exactly upstream `getGlobalScopes()`. Never `ALL_SCOPES`; RBAC is not bypassed |

Proof it is computed, not hardcoded: a `global:member` user logs in and receives
exactly the 25 member scopes (no `user:create`, `user:delete`…) — contract test
"a limited user gets exactly their role scopes". Alongside, the roles extraction
was fixed for an upstream alias (`GLOBAL_ADMIN_SCOPES = GLOBAL_OWNER_SCOPES.concat()`
no longer extracts as 0 scopes; `scripts/fetch-n8n-roles.mjs` resolves `.concat()`
aliases; `data/roles.json` regenerated).

Measured chain end to end: login response carries `globalScopes` (121) →
`init.ts` seeds `RBACStore.setGlobalScopes` → scope-gated routes pass their
guards in the real browser (§10.6).

### 10.3 Settings visibility + hideUsagePage (P2-C, P2-D) — R2 fixed

* `hideUsagePage` is a config value again — `N8N_LEGO_HIDE_USAGE_PAGE` /
  `N8N_HIDE_USAGE_PAGE`, default **false** (upstream `@n8n/config` default,
  `index.ts:196`). It was hardcoded `true`.
* No other flag moved. Queue mode stays off (Workers hidden), AI off, community
  nodes stay off: the upstream default `N8N_COMMUNITY_PACKAGES_ENABLED=true` was
  verified and consciously **not** adopted — the community-packages backend does
  not exist, so the flag would advertise a capability this instance cannot honor
  (it now answers 501, §10.5). This closes §8 question 1.
* Menus that are now visible are scope-available; where their backend is not
  implemented the page renders and the endpoint says so (§10.5) — that is a
  documented deferred state, not a fake implementation.

Measured (`evidence/settings-visibility-p2.json`), stock community set:

| sidebar | before | after |
| :--- | :--- | :--- |
| settings entries | `Personal` only | `Usage and plan, Personal, Users, Project roles, n8n API, External Secrets, Environments, SSO, Security & policies, LDAP, Log Streaming, Migration Report` |
| still hidden (correct) | — | `Workers` (queue mode), `AI Usage`, `Credential resolvers`, `Community nodes` (flag off) |
| `/settings` redirect | `/settings/personal` | `/settings/usage` (guard reads `hideUsagePage`) |
| `/settings/users` direct nav | redirected to `/home` | renders (owner has `user:create`,`user:update`) |
| `/settings/community-nodes` | redirected to `/home` | still redirects to `/home` — flag-gated, same as stock |

### 10.4 Unsupported endpoint semantics (P2-E)

| kind | semantics | example |
| :--- | :--- | :--- |
| feature implemented, data empty | **200** with the real (empty) payload | `GET /rest/variables` → `{data: []}`; `GET /rest/workflows` → `{count: 0, data: []}` |
| capability not implemented | **501** `{message, code: 'unsupported', meta: {feature, owner, phase}}` | `GET /rest/workflow-history/…` → 501 `meta.feature: workflow-history` |
| not authenticated | **401** `{message: 'Unauthorized'}` | any protected path without a session — evaluated *before* the capability handler |
| authenticated, not allowed | **403** | e.g. duplicate owner setup |
| entity missing | **404** `{message}` | `GET /rest/workflows/nope` |
| crash | **500** `{message: 'Internal server error'}` | unchanged |

501 follows upstream's own `NotImplementedError`
(`cli/src/errors/response-errors/not-implemented.error.ts`, status 501); the
editor's REST client surfaces `message`, tooling can branch on `code`/`meta`.
The old fallback — GET `200 {"data":null}` / writes `200 {"data":true}` — is
gone, including for never-seen paths (`meta.feature: 'endpoint-not-implemented'`).

### 10.5 The unsupported handler is one mechanism (P2-F)

`src/compat/capability.mjs` holds the runtime side of the §5 endpoint map: a
registry of known-but-unimplemented namespaces
(`UNSUPPORTED_FEATURES`, longest-prefix match) and the catch-all
`createUnsupportedHandler`. Every miss is answered 501 and logged once per path
as `[rest:unsupported]` with `{method, path, feature, owner, phase}` — the log
keeps the precise-backlog property the `[rest:todo]` line had. Domain modules
can also use `unsupportedFeature('<name>')` as an explicit placeholder route
handler instead of ever writing a stub.

Known missing endpoints now answering 501 (owner → phase), all matched to the
UI's own client modules in §5.2:

* `workflow-history/*` (workflow, P3), `projects/:id` + project resources (workspace, P3)
* `users` admin, `api-keys*`, `settings/security`, `me/password`, `me/survey`, `mfa/*` (auth, P5)
* `oauth1|oauth2-credential/*` (credentials, P5+), `credential-resolvers`, `external-secrets`, `secret-providers` (credentials, deferred)
* `community-packages*`, `community-node-types/:t` (node-registry, P6), `breaking-changes/*` (compatibility, P6)
* `dynamic-node-parameters/*` (dynamic-parameters, P7)
* `sso/*`, `ldap/*`, `log-streaming/*`, `source-control/*`, `licenses`/`license/*` ops, `insights`, `data-tables` (deferred)
* `orchestration/*` (worker, P11)

Measured in the browser: the n8n-API settings page calls `GET /rest/api-keys`
and `GET /rest/api-keys/scopes` and receives **501** (evidence file); the canvas
and the project card fetch `workflow-history/…version/:id` and `GET
/rest/projects/:id` and receive **501** (smoke's "acknowledged" list).

### 10.6 P2 measured results

```
unit + contract   node --test apps/n8n-lego/test/*.test.mjs   → 25/25 PASS
                  (13 P2 contract tests added: globalScopes owner/member,
                   roles-model fidelity, envelope parity, settings inputs,
                   unsupported semantics incl. writes and auth ordering)
browser gate      node tests/e2e/settings-compat.mjs <url>    → 12/12 PASS
                  (login → globalScopes=121 → /settings → usage → 12 sidebar
                   entries → /settings/users renders → /settings/community-nodes
                   redirects home → /settings/api renders with 501 backend →
                   workflow-history 501 contract → no page errors)
P0 regression     lego-smoke --mode=create                    → 9/9 PASS
                  restart → lego-smoke --mode=verify          → 5/5 PASS
                  (smoke now fails on any 5xx except 501, which it lists as
                   acknowledged unsupported capability hits)
```

### 10.7 Next-phase boundaries (unchanged, now backed by 501s instead of stubs)

P2 closes only the contract layer. Nothing below was implemented here, and each
item surfaces today as a named 501 capability rather than a silent success:

* **P3** workspace/workflow split (project detail + project resources, workflow
  history), continued `src/rest/routes.mjs` peel
* **P5** auth administration (users, API keys, security settings, password, MFA) —
  the Users/API/Security settings pages render since P2 and wait on these
* **P6** node-registry services (community packages, breaking-changes report);
  revisit `communityNodesEnabled` once community-packages exists
* **P7** dynamic parameters
* enterprise capabilities (SSO, LDAP, log streaming, external secrets, source
  control, license ops) stay deferred behind the 501 contract — never faked
* **P11** worker/orchestration with queue mode
