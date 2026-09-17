# Agent 6 — PIPE-12 / PIPE-13 observation probes

Machine-recorded behaviour of the n8n `{{ … }}` pipeline and the `WorkflowDataProxy` lookup slice.
**Not a test suite: an oracle recorder.** `observations.json` is the raw output of the pinned
n8n 2.9.4 runtime; the two isolation records cite it by ID.

```text
expression-probes.cjs   the runner (drives the real n8n-workflow + n8n-core; re-implements nothing)
observations.json       461 recorded observations (266 PIPE-12 · 172 PIPE-13 · 23 fixture), incl. 55 throws
determinism-check.cjs   replays two observation files against each other, masking environment-dependent fields
```

## Run

```bash
scripts/setup-reference-runtime.sh .runtime          # n8n-workflow@2.9.1 / n8n-core@2.9.1 (gitignored)
NODE_PATH=$PWD/.runtime/node_modules \
  node docs/isolation/agent-6-probes/expression-probes.cjs \
       docs/isolation/agent-6-probes/observations.json
```

Environment knobs: `AGENT6_REPO` (repo root, default: parent of `docs/isolation/agent-6-probes`),
`AGENT6_HARNESS` (default `<repo>/tests/reference/harness/harness.js` — the stand-in node types from
Agent 3 are reused so the fixture run is comparable with `tests/reference/execution-data/*`),
`N8N_USER_FOLDER` (temp by default).

## What each observation group proves

Per-group counts (verifiable with `node -e` over the JSON — arrays count rows, objects count keys):

| Group | Entries | Shape |
|---|---|---|
| `12A_chunking_n8n_vs_tournament` | 66 | one row per (template × splitter); 33 templates |
| `12B_template_semantics…` | 40 | one record per template |
| `12B2_param_pipeline_raw_strings` | 15 | |
| `12C_extension_syntax` | 50 | 10 cases + sub-lists (rewrites, reserved names, destructure) |
| `12C2_extension_inventory` | 17 | 8 name lists + `extendedFunctions` + `hasExtendedMethod` |
| `12D_sandbox` | 78 | 39 cases + their sub-lists (blocked/destructure/errors) |
| `13A_lookup_matrix` | 90 | every `$`-key, incl. 4 `raw` sub-groups |
| `13B_scoping` | 36 | 19 groups |
| `13C_core_glue` | 12 | 3 live `WorkflowExecute` runs |
| `13D_extra` | 34 | 10 groups |
| `fixture` | 23 | workflow / items / runData anchor |
| **total** | **461** | 55 of the entries are recorded throws |

| Group | Task | Content |
|---|---|---|
| `PIPE-12 / 12A_chunking_n8n_vs_tournament` | PIPE-12 | both splitters (`extensions/expression-parser.ts` vs `@n8n/tournament/ExpressionSplitter`) over 22 templates; the 3 divergent rows are the two-splitter finding |
| `12B_template_semantics_resolveWithoutWorkflow` | PIPE-12 | 40 tmpl-compat value rules: raw vs joined, falsies, unclosed brackets, swallowed errors, syntax errors |
| `12B2_param_pipeline_raw_strings` | PIPE-12 | the `=`-prefix, `=`-alone, identity, recursion-into-arrays/objects rules |
| `12C_extension_syntax` / `12C2_extension_inventory` | PIPE-12 | `extendSyntax` rewrites (`$if` → ternary, `?.` lowering, cache identity) + the full extension surface (String 33 / Array 26 / Date 18 / Object 15 / Number 12 / Boolean 5, `extendedFunctions`) |
| `12D_sandbox` | PIPE-12 | 39 attack/robustness cases with the exact class·message each produces (including the *silent* `undefined` outcomes) |
| `PIPE-13 / 13A_lookup_matrix` | PIPE-13 | every `$`-key of `getDataProxy()` against real run data |
| `13B_scoping` | PIPE-13 | `itemIndex`/`contextNodeName`/`runIndex` shifts, missing-data matrix, `returnObjectAsString`, `additionalKeys` precedence, pin data manual vs regular, `binaryMode: combined`, copy-on-write augmentation, luxon global-zone side effect, `$parameter` recursion guard |
| `13C_core_glue` | PIPE-13 | two live `WorkflowExecute` runs through `node-execution-context`: `rawExpressions`, `ensureType`, `evaluateExpression` defaults, `getWorkflowDataProxy` (sibling-`&` throw, `$execution`, `$vars`, `$env` denial) and the error-context attachment on a failing parameter |
| `13D_extra` | PIPE-13 | binary metadata vs full binary, `$evaluateExpression` prefix traps, run/branch out-of-range messages, non-ancestor pairing, global-seeding asymmetry, `$self`, `defaultReturnRunIndex` |
| `fixture` | both | the exact workflow/items/runData the numbers came from (re-runnable determinism anchor) |

## Determinism

`determinism-check.cjs` compares two observation files after masking exactly the fields that depend
on the host: `$now` / `$today` timestamps, `process.pid` (which n8n also leaks as `process.version` —
see finding C9), `ppid`, the node `release`/`versions` maps, `startTime`/`finishedTime` of the fixture
run, and `generatedAt`. Everything else must match byte-for-byte:

```bash
node docs/isolation/agent-6-probes/expression-probes.cjs /tmp/replay.json
node docs/isolation/agent-6-probes/determinism-check.cjs \
     docs/isolation/agent-6-probes/observations.json /tmp/replay.json
# => DETERMINISM CHECK: MATCH (only environment-dependent fields differ)
```

Recorded result for the committed pair (2026-09-17, 461 entries): `MATCH`.

## Integrity

```
sha256(observations.json)    = 6a5878218b9620e42fc450b82405ec61628fc338ca1c90464e2366889467f452
sha256(expression-probes.cjs) = 716da4d98881a00647dfdf5d17fbf9ffdbeaab6593557950ed9008254c83431e
sha256(determinism-check.cjs) = eda63bb2d4ae685ac794277b785f2830c83ff08af495f4a17233b18f2648b046
runtime: n8n-workflow@2.9.1  n8n-core@2.9.1  @n8n/tournament@1.0.6  luxon@3.7.2  node v22.22.3
reference: reference/n8n @ b6dc2787c45677a29a9612cd27eb911302961a83 (unmodified)
```

`tests/reference/**` (Agent 3/5 goldens) are **not** modified by this directory; the runner only
reads `tests/reference/harness/harness.js`.
