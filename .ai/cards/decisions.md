# Decision cards

What was decided, why, and what it rules out. A decision that is not written down
gets re-litigated by the next agent — these are the ones that would cost the most
to rediscover.

Format: **decision** — why — *rules out*.

## Foundation (P2.5)

- **D1 — The stock editor bundle is served untouched; the frontend LEGO contributes
  one additive `<meta>` tag.** The UI must not depend on this LEGO to render, so the
  LEGO cannot be allowed to rewrite markup or styles. *Rules out* injecting scripts
  into the bundle or a build-time patch of `n8n-editor-ui`.
- **D2 — Fail-soft load, fail-closed validation.** A missing or broken LEGO degrades
  to "stock UI without a descriptor". An invalid declaration stops the descriptor —
  a half-true descriptor is worse than none. *Rules out* registering a capability
  whose declaration failed validation, or silently skipping a broken manifest entry.
- **D3 — The boot payload is delivered twice from one source**: the `<meta>` tag on
  `index.html` (already fetched, `no-store`) and `GET /rest/frontend/bootstrap` for
  tooling. *Rules out* a second endpoint the UI has to call before it can render.
- **D4 — Only `src/adapters/**` may name the framework.** A test enforces it.
  *Rules out* framework types leaking into contracts, registries or surfaces — the
  reason a future framework swap stays possible.
- **D5 — Surfaces are the registry's vocabulary.** A capability may only attach to a
  declared surface; the surface names the backend capability and contract behind it.
  *Rules out* capabilities that exist nowhere in the UI and a second source of truth
  for backend ids.
- **D6 — No capability is registered at boot.** The registry exists and its contents
  are empty: P2.5 implemented no feature. *Rules out* looking "done" by declaring
  things that do not exist.

## Nested layer (P2.5.1)

- **D7 — A sub-LEGO exists only with an independently meaningful contract, owner,
  dependency boundary, test boundary or upgrade path.** 19 units today; a component,
  button, icon or helper is private detail. *Rules out* per-component LEGO sprawl.
- **D8 — The public boundary is a port** (`ui:<area>:<name>`). Anything else is
  private by default, and a dependency on something unpublished is refused *by name*.
  *Rules out* sibling imports of internals and "just this once" coupling.
- **D9 — A port may not share an id with an extension point.** A hook is *where you
  attach*; a port is *what you may couple to*. *Rules out* one identifier with two
  meanings.
- **D10 — Upgrade = a new manifest entry for one unit, applied atomically.** Minor
  and patch moves leave every sibling byte-identical; a major move is refused while a
  dependent pins the previous major, and proceeds only with a named acknowledgement
  recorded as `acknowledgedUpgrades`. *Rules out* partial upgrades, silent breaking
  changes, downgrades and coupled units.
- **D11 — `capability` per unit is validated against its surface**, with the
  `none` sentinel normalised to `null`. *Rules out* two places drifting apart.

## Maturity (P2.8-F)

- **D12 — Availability, installation, loading and activation are separate states**
  (`available → installed → loaded → active → idle | unloaded | disabled`), and only
  the last three may serve a request. *Rules out* treating "declared in a catalog" as
  "running".
- **D13 — The declared capability catalog is validated but never registered.**
  `manifest/capabilities.json` declares `translation` (lazy, optional, feature trust,
  fallback locale); the boot payload must not mention it. *Rules out* a catalog that
  quietly becomes a feature claim — and keeps the payload byte-identical to P2.5.
- **D14 — Criticality decides degradation, and `core` may not declare a fallback.**
  A missing core capability is a broken instance, not a degraded one. *Rules out*
  hiding a broken instance behind a fallback that makes it look healthy.
- **D15 — Trust is inherited, never promoted by nesting.** A unit under a `feature`
  capability is a feature and may only be lowered. *Rules out* gaining core
  privileges by being wrapped in the right parent.
- **D16 — Depth is bounded at domain → feature → sub-feature**, refused by name
  beyond that. *Rules out* a hierarchy that is really a folder tree.
- **D17 — Device support is a declared budget, not a platform check.** Six profiles,
  four states (`supported | degraded | remote | unsupported`); a thin client reaches
  what it cannot run locally. *Rules out* `if (isAndroid)` branching in core UI.
- **D18 — The operation envelope is semantic and local-free.** Identity, contract
  version, correlation id, authorization *context* (never a credential), deadline,
  cancellation, idempotency; `toTransportHints()` is empty for local execution.
  *Rules out* a payload tax on in-process calls and tokens in a frontend context.
- **D19 — Risk is blast radius; arbitration is consent.** `riskOf` escalates on
  dependents, foreign contracts and extension/untrusted authorship; adding a unit is
  low risk but always requires arbitration. *Rules out* using risk as the only gate,
  and using "small diff" as an argument for skipping tests.
- **D20 — Own contracts vs foreign contracts.** `contracts/frontend*.contract.md`
  belong to this LEGO; every surface backend contract belongs to another. Only
  *foreign* contracts escalate risk. *Rules out* the degenerate model where every
  change is "high" because every unit declares the frontend contract.
- **D21 — The `.ai/` pack is drift-checked, not trusted.** Indexes are generated from
  the manifests and a test fails with the exact difference when they age; each file
  has a size budget. *Rules out* a knowledge pack that rots into fiction and prompts
  that grow into "read the whole pack".
- **D22 — `contracts/micro-frontend.contract.md` (Web Components, `id/en/es/fr/de/ja`)
  is marked superseded, not deleted.** The Vue reference and the TESTED
  `contracts/localization.contract.md` (`id, en, ar, zh, ru, jv`) govern instead; the
  legacy module names are mapped to current units for traceability. *Rules out*
  silently adopting a conflicting locale set or a framework migration nobody asked
  for — and keeps the history available for the Manager to overrule.
- **D23 — A shared word is quoted, never re-invented.** `src/vocabulary.mjs` pins each concept the
  backend foundation owns with its contract id, version, owner, file and symbol; a local word
  declares what it maps to, and an undeclared one fails `vocabularyConflicts()`.
  `test/29-alignment.test.mjs` compares the lock against the backend modules, skipping with a
  stated reason while they are absent. *Rules out* two dialects for "why can this not run", and a
  rename dressed up as alignment.
- **D24 — The seam is closed: declarations cross, implementations do not.** `src/seam.mjs` lists
  the 13 inputs the frontend may consume and the sources each may come from; an implementation
  file, a route table, a port, a credential store, a model output or a rendered screen is refused
  by name, and both sides project a capability into the same 16 fields. *Rules out* inferring a
  capability from a module, and two identity shapes.
- **D25 — AI is declared, not implemented.** Six AI capabilities are declared with no entry path;
  provider, runtime and tool types stay distinct; a model-less installation is valid and the UI
  says which layer is absent. *Rules out* shipping an inference client, a vendor field or a
  chain-of-thought store while the contracts are still being agreed.
- **D26 — a quoted word records its publication.** A canonical vocabulary names its contract,
  version, owner and declaration; a file no contract row publishes is declared *pending* with
  the decision that asks for one (`XA-9`, `XA-17`, `XA-20`). Verified against the backend tree
  at `e754c5df`: 53 quoted sets, 24 local, 2 pending, 0 drift. *Rules out* a second dialect, an
  invented version and a silent rename.

## AI surfaces (P2.12–P2.13)

- **D27 — A Skill is a registry entry, not an execution.** `ai.skill@1.0.0` is published with
  four operations and two permissions; the frontend quotes them, offers none of them, keeps the
  six states independent (never one boolean) and refuses `execute`, `register`, `select`, `load`
  and `release` in both spellings. Discovery never invokes a body loader. *Rules out* a UI that
  runs a skill, and a "skill enabled" toggle that collapses six states into one (`test/31`, `XA-19`).
- **D28 — Context & Session is ONE LEGO with TWO contracts, and a claim is not a publication.**
  `ai.context` (what is loaded now) and `ai.agent-session` (bounded state: identity plus
  references) are declared in four backend files and locked in none, so the frontend renders
  `declared-not-locked`, quotes the fields and states it can cite, reports the version as
  `declaredVersion` and keeps the rollover phase machine (`NORMAL → PREPARE → ROLLOVER`) and the
  verification results (`verified / degraded / failed`) in `PENDING_PUBLICATIONS` under `XA-20`.
  Conversation, session, context window, memory and execution stay five distinct things; a record
  that merges them is refused. No token figure is fabricated (a usage number carries its declared
  kind or is not rendered), a rollover threshold at 100% is refused, no Memory store is implied
  (`XA-12`), and no execution affordance is offered — the three declared verbs nobody registered
  (`rollover`, `rehydrate`, `verify`) are answered `operation-unpublished`. *Rules out* a second
  `ai-context`/`ai-session` domain, a token dashboard, a transcript view, a "continue" button wired
  to an invented operation, and a silent reset rendered as a new session (`test/32`, `test/29`).
- **D29 — Agent completion is not merge approval.** A milestone is complete when the reconciled
  state on protected main passes verification, not when an agent's branch does: two gates
  (RECONCILIATION PASS, then MERGE PASS), a four-kind conflict taxonomy in which a scope violation
  is *not merged*, and a canonical milestone register (`docs/n8n-lego/milestones.json`) that only
  the manager re-sequences. The same rule is written into workforce governance so it applies to
  P2.13, P2.14 and later. *Rules out* "done on my branch" as a status, merging whichever branch
  arrives first, and merging a locked-contract disagreement (`test/33`).
