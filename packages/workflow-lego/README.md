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

## Not done (deliberately)

- No Rust code.
- No changes to `reference/n8n/**` (hash-verified).
- Node Model / Connection / Validation are still the reference implementations, consumed through ports.
