# Execution Data LEGO — pure core (Node.js ESM, ZERO RUST)

A **1:1 reconstruction** of the pure execution-data core of **n8n 2.9.4**
(upstream commit `b6dc2787c45677a29a9612cd27eb911302961a83`), written in plain
JavaScript/Node.js ESM with **zero runtime dependencies**.

This is *not* the engine. It is the data layer the engine reads and writes: item
envelopes, the four node-facing item helpers, the paired-item and source-data
rules, the `IRunExecutionData` factories and version migration, and the
binary-data representation rules.

- Contract: `contracts/execution-data.contract.md` (owner Agent 3, status TESTED)
- Reconstruction record: `docs/isolation/execution-data-lego.md`
- Reference runtime for A/B: `n8n-workflow@2.9.1` / `n8n-core@2.9.1` — the exact
  n8n 2.9.4 dependency set (see `scripts/setup-reference-runtime.sh`)

## Run

```bash
bash scripts/setup-reference-runtime.sh     # once; installs .runtime/ (gitignored)
npm test --prefix packages/execution-data-lego     # 77/77
npm run test:parity --prefix packages/execution-data-lego   # A/B vs the real n8n packages
```

Without `.runtime/` the 9 A/B parity tests report **SKIP** (never a false green);
the other 68 run standalone.

## Layout

| Module | Reconstructed from (n8n 2.9.4) |
| :--- | :--- |
| `src/constants.mjs` | `workflow/src/constants.ts:6,137,139,140`, `core/src/binary-data/utils.ts:7` |
| `src/errors.mjs` | `@n8n/errors/dist/application.error.js` |
| `src/deep-copy.mjs` | `workflow/src/utils.ts:53-89` |
| `src/pretty-bytes.mjs` | `pretty-bytes@5.6.0` (pinned by n8n-core 2.9.1) |
| `src/item-helpers.mjs` | `core/.../node-execution-context/utils/{return-json-array,normalize-items,construct-execution-metadata,copy-input-items}.ts` |
| `src/paired-items.mjs` | `core/src/execution-engine/workflow-execute.ts:1514-1557, 1741-1764, 2581-2637`, `.../utils/resolve-source-overwrite.ts` |
| `src/run-execution-data.mjs` | `workflow/src/run-execution-data-factory.ts:52-163`, `run-execution-data/run-execution-data{.v1,}.ts` |
| `src/binary.mjs` | `workflow/src/utils.ts:261-270`, `core/src/binary-data/{utils.ts,binary-data.service.ts:70-126,234-236}`, `core/.../binary-helper-functions.ts:256-341` |

## Explicitly deferred (boundary, not gaps)

- `BinaryDataService` and the `filesystem`/`filesystem-v2`/`s3`/`database`
  managers — everything *above* the manager call is reconstructed, the managers
  themselves need a configured service.
- `FileType.fromBuffer()` content sniffing and `IncomingMessage` handling in
  `prepareBinaryData` (async, HTTP-bound).
- The `WorkflowExecute` loop itself — this LEGO owns the **rules** the loop
  enforces, not the loop (contract §7).

## Frozen quirks

Every divergence-from-intuition found while porting is pinned by a test and
recorded in `docs/isolation/execution-data-lego.md` §3. Two of them were found
by **differential testing against the real n8n packages**, not by reading:

- **H-07** — `constructExecutionMetaData`'s `itemData` argument **loses** to an
  item that already carries `pairedItem` (the `...rest` spread is last).
- **H-06** — `normalizeItems` raises
  `TypeError: Cannot use 'in' operator to search for 'json' in null` on a `null`
  member, because `typeof null === 'object'` passes the guard.
