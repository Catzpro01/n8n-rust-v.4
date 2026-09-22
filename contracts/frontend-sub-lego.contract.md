# Frontend Sub-LEGO Contract

| Field | Value |
| :--- | :--- |
| Scope | The units **inside** the frontend LEGO (LEGO 13, `ui-frontend`) |
| Owner | Agent 1 — Frontend / UI / Compatibility |
| Phase | P2.5 (declared; no feature implemented) |
| Version | 1.0.0 |
| Parent contract | [`frontend.contract.md`](frontend.contract.md) |
| Implementation | `packages/frontend-lego/manifest/sub-legos.json`, `packages/frontend-lego/src/sublegos.mjs` |
| Tests | `packages/frontend-lego/test/06-sublegos.test.mjs` |

---

## 1. When something becomes a sub-LEGO

A Vue component, button, icon, store or helper is **not** a sub-LEGO. It is internal implementation detail of
whichever unit owns it.

A unit becomes a sub-LEGO when it has an independently meaningful:

* **contract** — a boundary somebody else can program against,
* **lifecycle** — it can be mounted, replaced or removed on its own,
* **dependency boundary** — what it needs is declarable,
* **test boundary** — it can be proven correct without its siblings,
* **ownership** — one owner is accountable for it,
* **upgrade path** — it can move to a new version without a full frontend release.

If a proposed unit fails those tests, it stays a file inside an existing unit. There is no "every component is a
LEGO" rule and no component-level registry.

## 2. Hierarchy

Ids are dotted and hierarchical, and the id **is** the position in the tree:

```
settings
settings.general
settings.security
settings.localization            ← the Translation LEGO's host surface
settings.localization.rtl        ← three levels, when the boundary is real

workflow-editor
workflow-editor.canvas
workflow-editor.node-panel
workflow-editor.parameter-panel
workflow-editor.execution-panel
```

Rules (validated at registration; a violation is refused, not repaired):

1. `parentId` must be exactly the id prefix. A dotted id is never a root unit.
2. A parent must be declared **before** its children. An orphan is a typo, not a declaration-order question.
3. Ids are unique; a re-declaration is refused.
4. Depth is not limited, but a level must be justified by §1 — nesting for its own sake is refused by review, not
   by the registry, so this stays a design rule rather than a hard cap.

## 3. The sub-LEGO descriptor

| Field | Meaning | Required |
| :--- | :--- | :--- |
| `id` | dotted identity, lowercase kebab-case segments | yes |
| `parentId` | id prefix (or `null` only for a true root) | derived |
| `title` | human label (a message key is a future Translation-LEGO concern) | yes |
| `owner` | one of the agents in the owner table | yes |
| `version` | semver of the unit, independent of the LEGO version | yes |
| `contract` | the `contracts/*.contract.md` that defines it | yes |
| `public.ports` | the **only** boundary another unit may consume | yes |
| `public.contracts` | contracts that define those ports | yes |
| `internals` | private area under `src/sub-legos/**` | yes |
| `dependsOn[]` | `{ subLego, port, versionRange }` — declared couplings | optional |
| `surface` | the UI surface it renders into (from `manifest/surfaces.json`) | optional |
| `capability` | the backend capability it consumes — must equal the one its surface declares | derived |
| `status` | `declared` / `available` / `partial` / `unsupported` | yes |
| `tests` | at least one regression test path | yes |
| `upgrade` | `{ policy, compatibleWith, coupledWith? }` | yes |

Endpoints and availability are **not** restated here: they are read from the surface the unit declares, which is the
single place the backend boundary is described (P2 compatibility layer). `capability` names the backend capability in
that same vocabulary and is validated against the surface — a unit cannot claim a capability its surface does not
have, so the two can never drift apart.

## 4. Public and private

* A unit may consume only a **published port** of another unit.
* Depending on anything else — a module path, a store, a private function — is refused *by name*:
  `"credentials" reaches into the private internals of "dialogs": "internal:dialog-store" is not a published port`.
* Dependencies are explicit and directional; the registry refuses cycles.
* Ports use the `ui:<area>:<name>` grammar, may not collide with another unit's port, and may not share an id with a
  declared extension point (hooks are attachment points; ports are contracts — different things that must not be
  confused).
* Private areas are never published: the boot descriptor carries identity, hierarchy, version, status, owner, surface
  and published port names only. Test paths and internals stay in the process.

## 5. Upgrading one unit

An upgrade is a new manifest entry for one unit — the mechanism the package actually ships. It is validated exactly
like a fresh declaration, then evaluated against every dependent:

| Change | Result |
| :--- | :--- |
| `1.0.0 → 1.1.0` inside a dependent's range | applied; **only** that unit changes |
| `1.0.0 → 2.0.0` while a dependent pins `^1.0.0` | **refused** and names the dependents and their ranges |
| `2.0.0` with `{ acknowledge: ['<dependent>'] }` | applied; the dependent records `acknowledgedUpgrades` — the only way another unit is allowed to change |
| any downgrade | refused |
| a unit whose `upgrade.policy` is `coupled` | refused without a coordinated release |

Version ranges are deliberately small: `1.x`, `^1.0.0`, `~1.2.0`, `>=1.2.0 <2.0.0`, `*`.

Consequences that are asserted by tests, not promised by prose:

* upgrading `workflow-editor.node-panel` leaves `workflow-editor.canvas`, `workflow-editor.execution-panel` and every
  other unit **byte-identical**;
* a breaking move cannot happen silently behind a dependent's back;
* a dependent keeps resolving the port it declared across a compatible upgrade.

## 6. Ownership and change protocol

* `agent-01` owns every unit declared in P2.5 (they are all declared, none implemented).
* A feature LEGO that takes over a unit (Translation taking `settings.localization`) must, in the same change:
  register its capability, keep the published ports stable or increment the major version, and extend the unit's
  `tests` list. Cross-domain changes go to the Manager/Integrator.
* Adding a unit is a manifest change plus a test; there is no code path that adds a unit implicitly.

## 7. What is deliberately not here

* No runtime loader that mounts/unmounts sub-LEGOs — the units are declared, and a loader needs a delivery decision
  (how an extension script reaches the page) that belongs to a later phase.
* No per-unit bundling or lazy loading: the pinned `n8n-editor-ui@2.9.4` bundle is served verbatim.
* No translation, theme, search, accessibility or import/export implementation — only the ports and hooks they attach
  to.
