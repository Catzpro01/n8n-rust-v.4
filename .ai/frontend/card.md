# L1 — Frontend domain card

One page on how the frontend LEGO is built. Everything here is derivable from the
manifests and the tests; the card exists so an agent does not have to read them.

## What this LEGO is

`ui-frontend` — the frontend LEGO Foundation. It owns the UI architecture, the
compatibility boundary, the UI capability registry and the frontend regression gates.
It does **not** own workflow, execution, auth, credentials, storage, the node registry
or Rust, and it implements no feature of its own — including no AI feature: it declares
the AI vocabulary, and performs no inference.

The application (`apps/n8n-lego`) serves the stock editor bundle unchanged and asks this
LEGO for one thing: the boot descriptor. The LEGO never renders, never injects markup
beyond one additive `<meta>` tag, and never rewrites the bundle.

## Where things live

```
packages/frontend-lego/
  index.mjs                 the public surface (catalogs, registries, lifecycle, impact, adapter)
  manifest/                 surfaces.json 12 UI surfaces + the backend capability behind each
                            extension-points.json 15 hooks (1.1.0) + 7 declared future consumers
                            sub-legos.json 19 nested units · ownership.json · capabilities.json
  src/                      one module per concern, no utils dumping ground
    contract.mjs versions.mjs surface-capability.mjs registry.mjs sublegos.mjs lifecycle.mjs
    negotiation.mjs vocabulary.mjs seam.mjs backend-view.mjs envelope.mjs transport.mjs
    interactions.mjs conformance.mjs observability.mjs impact.mjs profiles.mjs i18n.mjs
    errors.mjs boot.mjs client.mjs manifests.mjs knowledge.mjs agents.mjs agent-events.mjs lego.mjs
    adapters/ the framework adapter boundary (currently Vue; the only framework-aware code)
  test/                     01-contract … 23-degradation, 24-vocabulary, 25-operations,
                            26-ai-contracts, 27-agent-events, 28-seam, 29-alignment
```

What the less obvious ones own: `negotiation.mjs` discovery, access, degradation and
operation answers; `vocabulary.mjs` the shared vocabulary lock; `seam.mjs` the closed
input list and the one capability identity; `agents.mjs` the AI capability/provider/
runtime kinds, the MCP boundary and the installation layers; `agent-events.mjs` the agent
event vocabulary, the bounded work trace and the delegation tree; `knowledge.mjs` the
`.ai/` pack index.

## Boot flow

1. `apps/n8n-lego` resolves the LEGO (checkout → sibling package, tarball → vendored copy).
2. `createFrontendLego({ app, ui })` loads the catalogs, builds both registries, and
   validates the declared capability catalog **without registering it**.
3. The adapter encodes the boot payload twice from one source: the
   `<meta name="n8n-lego:frontend-bootstrap">` tag on `index.html` and `GET /rest/frontend/bootstrap`.
4. Failure is **fail-soft**: the app logs a warning and serves the stock editor without the
   descriptor. A *broken declaration* is fail-closed at the LEGO boundary — it stops the
   descriptor, not the UI.

## Numbers that matter

| Thing | Value |
| ----- | ----- |
| Architecture tests | 264 across 29 suites (3 alignment comparisons skip until the backend foundation lands) |
| Architecture rules | 24, as data (`frontend.conformance()`), mirrored in contract §19.16 |
| Surfaces / hooks / units | 12 / 15 (`1.1.0`) / 19 in a 3-level hierarchy |
| Boot payload | 18,126 B JSON / 24,168 B base64, budget **32 KB**, byte-pinned to P2.5 |
| Browser-visible delta | the one `<meta>` tag (24,268 B on the served page) |
| Runtime dependencies | none |
| Locales | `id, en, ar, zh, ru, jv`; Arabic is RTL; 13 message slots |
| Declared capabilities | 7 (`translation` + 6 AI), installed: 0 |
| Shared vocabularies | 6 quoted from the backend foundation, 7 declared locally |
| Seam | 13 declared inputs, 7 forbidden sources, 16 identity fields |
| Agent events | 26 types in 7 namespaces; trace bound 200 rows, summary 280 characters |

## Rules worth remembering (the full list is data)

`frontend.conformance()` checks all 24 rules against a live assembly; each names the
vocabulary that enforces it and the suite that proves it, and
`contracts/frontend.contract.md` §19.16 mirrors the same list as JSON.

- A capability attaches only to a declared surface (fail-closed); operations are named
  `<domain>.<name>`. Registration is metadata: it still does not load anything.
- Trust is inherited and may only be *lowered*; device budgets decide support; the framework
  name appears only in `src/adapters/`. Test tiers come from declaration data and never
  replace full CI.
- **Placement grants nothing** — access is the unit's own surface binding or a capability
  that declares that surface (`test/14`).
- **Contracts name operations, never transports**; the cheapest capable transport wins, and a
  call no transport can carry is refused by name (`test/15`).
- **One version vocabulary**, and **implementation is replaceable while contracts are not**
  (`test/16`).
- **Interactions** (`call`/`event`/`stream`/`batch`) are declared per operation (`test/20`);
  **hooks are surface-owned** (`test/21`).
- **Localization boundary**: locale identity, direction (`ar` RTL), keys, fallback and the
  plural *contract* live here — dictionaries do not (`test/22`).
- **Every degradation situation is a canonical state** (`available`, `degraded`,
  `capability-unavailable`, `optional-absent`, `version-incompatible`, `dependency-disabled`,
  `migration-required`, `feature-unsupported`), and required permissions are declared names,
  never credentials (`test/23`).
- **A shared word is quoted, never re-invented**; a local word that competes with one declares
  its reason (`vocabulary.mjs`, `test/24`).
- **An operation that cannot run names the reason**: missing permission, incompatible version,
  migration gate, unpublished list or a missing grant (`test/25`).
- **AI is declared, not implemented**; a model-less installation is valid and the UI says which
  layer is absent (`agents.mjs`, `test/26`).
- **An agent trace is bounded and reference-only**, and a delegation tree grants nothing to a
  child (`agent-events.mjs`, `test/27`).
- **The seam is closed**: declarations cross, implementation does not; an implementation file,
  a route table, a port or a credential store is refused by name (`seam.mjs`, `test/28`).
- Events are boundary-level and payload-free: no `payload`, `token`, `authorization`,
  `subject`, `scopes`, `transcript` or `reasoning` may enter the stream (`test/17`).

## Evidence commands

```bash
npm run frontend-lego:test                          # 264 tests, the architecture surface
node --test apps/n8n-lego/test/*.test.mjs           # app-side boundary, boot tag, backend alignment
node apps/n8n-lego/scripts/capture-frontend-evidence.mjs   # 47-check evidence JSON
python3 tools/sublego-audit/audit.py                # nested-LEGO + agent boundary audit
npm run verify:fast                                 # repo-wide fast gate
```

The browser gate (`tests/e2e/frontend-boundary.mjs`) needs Chromium and `n8n-editor-ui`; it
runs in CI, not in a bare checkout. The AI vocabulary, the seam and the shared-vocabulary lock
are generated into `.ai/index/capabilities.json`; cross-agent questions and their arbiters live
in `docs/n8n-lego/decisions/cross-agent-decisions.json`.
