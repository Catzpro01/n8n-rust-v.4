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
  src/                     one module per concern, no utils dumping ground
    contract.mjs            contract version, boot payload keys, vocabulary
    versions.mjs            the ONE version vocabulary: parse, compare, ranges, compatibility
    surface-capability.mjs  surface → backend-capability join (`none` → null)
    registry.mjs            capability registry: fail-closed validation, availability ≠ activation
    sublegos.mjs            nested registry: hierarchy, ports, depth bound, upgrades, replacement
    lifecycle.mjs           capability states, criticality, trust levels, degradation
    negotiation.mjs         discovery, access decisions, degradation situations, verdicts
    backend-view.mjs        what the backend advertises, derived (never probed)
    envelope.mjs            operation envelope: identity, deadline, cancellation, idempotency
    transport.mjs           transport-neutral delivery: direct local call, no HTTP between modules
    interactions.mjs        the four classes (call/event/stream/batch) and which transports carry each
    conformance.mjs         architecture rules as data, checked against a live assembly
    observability.mjs       boundary events + bounded buffer (not a telemetry framework)
    impact.mjs              impact graph, selective test map, runnable dry-run plan
    profiles.mjs            device profiles and the four support states
    i18n.mjs                locale identity, direction, message keys, fallback, plural contract
    errors.mjs              semantic error codes and their message keys
    boot.mjs                boot descriptor + the additive `<meta>` tag
    client.mjs              REST client, state store (the boundary, not a transport)
    manifests.mjs           catalog loading (the only Node-only module)
    knowledge.mjs           the `.ai/` pack index and the task → context-level lookup
    lego.mjs                the assembly: catalogs → registries → adapter + the app-facing surface
    adapters/               the framework adapter boundary (the current one is Vue)
  test/                     01-contract 02-registry 03-errors 04-client 05-boundary 06-sublegos
                            07-lifecycle 08-envelope 09-impact 10-profiles 11-registry-maturity
                            12-knowledge 13-versions 14-negotiation 15-transport 16-replacement
                            17-observability 18-impact-plan 19-conformance 20-interactions
                            21-security 22-localization 23-degradation
```

## Boot flow

1. `apps/n8n-lego` resolves the LEGO (checkout → sibling package, tarball → vendored copy).
2. `createFrontendLego({ app, ui })` loads the catalogs, builds both registries, and validates
   the declared capability catalog **without registering it**.
3. The adapter encodes the boot payload twice from one source: the
   `<meta name="n8n-lego:frontend-bootstrap">` tag on `index.html` and `GET /rest/frontend/bootstrap`.
4. Failure is **fail-soft**: the app logs a warning and serves the stock editor without the
   descriptor. A *broken declaration* is fail-closed at the LEGO boundary — it stops the
   descriptor, not the UI.

## Numbers that matter

| Thing | Value |
| ----- | ----- |
| Architecture tests | 207 across 23 suites |
| Surfaces | 12 (`manifest/surfaces.json`) |
| Extension hooks | 15, version `1.1.0`, 7 declared future consumers |
| Sub-LEGO units | 19 in a 3-level hierarchy (11 roots, max depth 2) |
| Architecture rules | 17, as data (`frontend.conformance()`), mirrored in contract §19.9 |
| Boot payload | 18,126 B JSON / 24,168 B base64, budget **32 KB** (test-enforced) |
| Browser-visible delta | the one `<meta>` tag (24,268 B on the served page) |
| Runtime dependencies | none |
| Locales | `id, en, ar, zh, ru, jv`; Arabic is RTL |
| Message slots | 13 |
| Declared capabilities | 1 (`translation`), installed: 0 |

## Rules worth remembering (the full list is data)

`frontend.conformance()` checks all 17 rules against a live assembly; each names the vocabulary
that enforces it and the suite that proves it, and `contracts/frontend.contract.md` §19.9 mirrors
the same list as JSON. The rules that matter most day to day:

- A capability attaches only to a declared surface (fail-closed); operations are named
  `<domain>.<name>`, the grammar the envelope also uses.
- Registration is metadata: `activation: 'lazy' | 'manual'` needs an `entry` path once a
  capability is installable, and registering it still does not load it.
- Trust is inherited and may only be *lowered* by nesting; `core` may not declare a fallback.
- Device budgets decide support; core code never branches on platform identity, and the
  framework name appears only in `src/adapters/`.
- Test selection comes from declaration data: a plan names its tiers, its skipped tiers and its
  caveat, and never replaces full CI.
- **Placement grants nothing** — access is the unit's own surface binding or a capability that
  declares that surface; a parent's access is inherited by nobody (`test/14`).
- **Contracts name operations, never transports**; the cheapest capable transport wins, and a
  call no transport can carry is refused by name (`test/15`).
- **One version vocabulary**, and **implementation is replaceable while contracts are not**
  (`versions.mjs`, `subLegos.replace`, `test/16`).
- **Interactions** (`call`/`event`/`stream`/`batch`) are declared per operation and decide which
  transports are capable; a caller may not reshape one (`test/20`).
- **Hooks are surface-owned** and owners are checked against the manifests (`test/21`).
- **Localization boundary**: locale identity, direction (`ar` RTL, rest LTR), keys, fallback and
  the plural *contract* live here — dictionaries do not (`test/22`).
- **Every degradation situation is a state with a reason and a fallback** (unavailable, disabled,
  unsupported, incompatible, degraded, not installed, migration-required), and required
  permissions are declared names rather than credentials (`test/23`).
- Events are boundary-level and payload-free: no `payload`, `token`, `authorization`, `subject`
  or `scopes` may enter the stream (`observability.mjs`, `test/17`).

## Evidence commands

```bash
npm run frontend-lego:test                                     # 207 tests, the architecture surface
node --test apps/n8n-lego/test/*.test.mjs                      # app-side boundary + boot tag
node apps/n8n-lego/scripts/capture-frontend-evidence.mjs       # 39-check evidence JSON
python3 tools/sublego-audit/audit.py                           # nested-LEGO + agent boundary audit
npm run verify:fast                                            # repo-wide fast gate
```

The browser gate (`tests/e2e/frontend-boundary.mjs`) needs Chromium and `n8n-editor-ui`; it runs
in CI, not in a bare checkout.
