# @lego/workflow — Workflow Model LEGO

Phase 2 structural isolation of the workflow model from
`reference/n8n/packages/workflow` (n8n 2.9.4).

**Isolated ≠ replaced.** The boundary is real and enforced; the running
implementation is still the pinned reference runtime. The Rust implementation of
this LEGO has **not started**.

## What is in the box

| path | role |
| :--- | :--- |
| `manifest/ownership.json` | single source of truth: what the LEGO owns, what it uses through ports, declared deviations, extraction mapping, public surface |
| `manifest/boundary-map.json` | generated dependency/boundary map of the reference package |
| `manifest/boundary.expectations.json` | pinned crossings/inbound edges — drift makes the gate fail |
| `manifest/port-surface.json` | exact symbols each port must provide (derived from the owned sources' imports) |
| `manifest/reference.sha256.json` | pinned hashes of `reference/n8n/**` (15 050 files) |
| `src/ports/` | the declared outer boundary: contracts + one module per port |
| `src/adapters/reference/` | binds ports to the pinned reference runtime (`n8n-workflow@2.9.1`) |
| `src/adapters/strict/` | standalone port implementations (no reference runtime, no third-party deps) |
| `src/model-surface.ts` | the public surface — the single seam a replacement must implement |
| `src/kernel/snapshots.ts` | generated kernel values (drift-checked against the reference source) |
| `test/` | 19 isolation tests (boundary, extraction, build, equivalence, strict isolation, surface parity) |
| `.extract/` | generated isolated unit (git-ignored, reproducible) |

## Setup

```bash
# from the repository root
scripts/setup-reference-runtime.sh      # n8n-workflow/core/nodes-base 2.9.1 (the n8n 2.9.4 dependency set)
npm install --prefix packages/workflow-lego
```

The reference runtime is located automatically (`.runtime/`, then the sandbox
default) or explicitly with `LEGO_LIVE_RUNTIME` / `LEGO_REFERENCE_PKG`.

## Commands

```bash
npm run build       # extract the isolated unit + TypeScript build
npm run typecheck   # typecheck ports/adapters/facade
npm test            # isolation tests (needs the reference runtime for equivalence)
npm run verify      # full 11-gate verification (from the repository root: npm run verify)
```

## How to read the isolation

1. `manifest/ownership.json` says what the LEGO owns and which ports it may use.
2. `tools/workflow-boundary-map.mjs --check` fails if any dependency crosses the boundary without a declared port.
3. `tools/workflow-isolation-extract.mjs` builds the isolated unit by rewriting **only** those specifiers; the result must compile with nothing but the ports available.
4. `tools/model-digest.mjs` runs the same 14-section fingerprint against the reference runtime and the isolated unit — 252 comparisons over 18 real workflows, currently 0 differences.
5. `src/adapters/strict` reruns the model with no engine at all: port-independent behavior must stay identical, which proves there is no hidden coupling.

## Backend localization boundary

`src/backend-localization-service.ts` is the native locale hub for `id`, `jv`,
`ar`, `zh`, `ru`, and `en`. `src/universal-locale-enforcer.ts` is a pure API
boundary adapter: it returns a copied payload, translates only known
human-facing fields, and never rewrites the protected machine keys
`name`, `type`, `value`, `inputs`, `outputs`, `routing`, or `requestRules`.

The reconstructed runtime uses the equivalent ESM adapter in
`packages/reconstructed-engine/localization.mjs`; `WorkflowExecutionEngine`
localizes execution logs at the final response boundary while keeping canonical
machine statuses and adding localized `statusText`. Built-in or community node
loaders can register their human-facing catalogs with
`registerTranslations(...)` before a response is emitted.

## Built-in node catalog (Node Model LEGO — Agent 2)

`src/node-catalog-localization.ts` (ESM twin:
`packages/reconstructed-engine/node-catalog.mjs`) carries the native
metadata of the 15 core built-in node types (labels, descriptions, and the
primary parameter display names) for `id`, `jv`, `ar`, `zh`, `ru`, `en`.
The English source text is pinned to the n8n 2.9.4 reference
(`n8n-nodes-base/dist/types/nodes.json`); non-English catalogs additionally
register the English source text as a value alias so payloads still carrying
source values are localized.

Contract:

- registration goes through the Agent 1 seam
  (`registerBuiltInNodeCatalog(service)`); the engine registers the catalog
  automatically at construction, and user-supplied translations win on
  key conflicts;
- only human-facing fields are translated; the seven protected machine tokens
  (`name`, `type`, `value`, `inputs`, `outputs`, `routing`, `requestRules`),
  `parameters`, `connections`, and all workflow data subtrees stay
  byte-identical;
- `localizeNodeMetadata(node, locale)` is pure: it returns a copy with
  `label`/`description` filled from the catalog and never mutates the input;
- unknown node types are returned unchanged — no guessing;
- community packages register namespaced catalogs
  (`community.<package>.<alias>.label`, `...description`,
  `...parameters.<name>`) through
  `registerCommunityNodeCatalog(service, locale, packageName, nodes)`;
- execution responses gain an additive `nodeLabel` field for known built-in
  node types; user-chosen node names are never translated;
- `test/06-node-catalog.test.mjs` guards key/value drift between the TS
  boundary and the ESM runtime catalog.

## Not done (deliberately)

- No Rust code.
- No changes to `reference/n8n/**` (hash-verified).
- Node Model / Connection / Validation are still the reference implementations, consumed through ports.
- Full node catalog extraction remains the responsibility of the Node Model LEGO;
  this LEGO provides the backend locale contract and enforcement seam.
