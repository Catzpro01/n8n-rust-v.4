# Agent 6 — PIPE-12 / PIPE-13 observation probes

Machine-recorded behaviour of the n8n `{{ … }}` pipeline and the `WorkflowDataProxy` lookup slice.
**Not a test suite: an oracle recorder.** `observations.json` is the raw output of the pinned
n8n runtime resolved to `n8n-workflow` 2.9.1 / `n8n-core` 2.9.1 (recorded in `meta.runtime`; re-check with
`node -p "require('./.runtime/node_modules/n8n-workflow/package.json').version"`). Note for anyone comparing versions:
`reference/n8n/package.json` says `2.9.4` (the monorepo root) while `reference/n8n/packages/{workflow,core}/package.json`
say `2.9.1` — both statements in the fleet are about the same tree; the **packages** are what the probes drive; the two isolation records cite it by ID.

```text
expression-probes.cjs   the runner (drives the real n8n-workflow + n8n-core; re-implements nothing)
observations.json       503 recorded entries (266 PIPE-12 · 214 PIPE-13 · 23 fixture)
                        418 outcome records = 353 values + 65 typed throws
                        (reproduce with: grep -c on the keys `ok` and `threw`)
determinism-check.cjs   replays two observation files against each other, masking environment-dependent fields

engine-probes.cjs            TASK-403 runner: drives real WorkflowExecute runs and records the execution engine
engine-observations.json     16 probe groups / 2300 leaf values / 14 recorded throws (24 lifecycle graphs)
                             sha256 cadbfaf2f5ad95ae9bb5dcbb61bca46b033b4e794d853ae9014d84674f9a8009
engine-determinism-check.cjs same replay check for the engine file (masks generatedAt, startTime,
                             executionTime, establishedAt, timestamp, instanceId, pushRef, lineNumber)
make-stable.cjs            THE mask, as a module + CLI: masks the keys above plus pid, ppid, now, today, release,
                             finishedTime, startedAt, version, process_version, and ISO/epoch/DateTime/hex32 values.
                             Both runners import it, so "written by the runner" and "derived from a recording"
                             are the same bytes by construction.
observations.stable.json   sha256 bddbd1238983c53a0ca9145b36b978b94b8f7f3805922f2ef95cd6947b2bd677
engine-observations.stable.json
                            sha256 110d4a3600f0da060c79cb40ac81f9a0398ba04434dbcaf47c0a53d4e0876489

Why two files per runner: the raw JSON is the authoritative observation (it must keep the real timestamps, because
`meta.now` vs an expression's resolved date IS the finding in several cases). The `.stable.json` mirror exists only so
a CI gate can `diff -q` two runs. `process_version` is masked because the sandbox sets `version: process.pid`
(`expression.ts:433`, anatomy finding D2), i.e. that probe's value is a PID and drifts by design.
```

## TASK-403 (engine) run

```bash
NODE_PATH=$PWD/.runtime/node_modules \
  node docs/isolation/agent-6-probes/engine-probes.cjs /tmp/engine-observations.json
node docs/isolation/agent-6-probes/engine-determinism-check.cjs \
  /tmp/engine-observations.json docs/isolation/agent-6-probes/engine-observations.json
```

```bash
# gate-diffability check (agent-4's ask): two consecutive runs must be byte-identical
R=docs/isolation/agent-6-probes
NODE_PATH=$PWD/.runtime/node_modules AGENT6_STABLE=/tmp/a.json node $R/engine-probes.cjs /tmp/ra.json
NODE_PATH=$PWD/.runtime/node_modules AGENT6_STABLE=/tmp/b.json node $R/engine-probes.cjs /tmp/rb.json
diff -q /tmp/a.json /tmp/b.json            # -> no output
diff -q /tmp/a.json $R/engine-observations.stable.json   # -> no output
```

Runner flags: `AGENT6_STABLE=<path>` (write the masked mirror) · `AGENT6_ONLY=403L,403M` (bisect; a group that hangs is
recorded as `probe-timeout` instead of blocking the run).

Engine group map: `403A`/`403A2` context surface (+ missing `executionId` ⇒ `__UNKNOWN__`) · `403B` one context per
node run · `403C` 24-graph lifecycle matrix (disabled / `null` / empty branch / pin data / retries / `executeOnce` /
`continueOnFail` / hints / `setMetadata` / pairedItem autofix / merge waiting / v0 vs v1) · `403D` start-node
resolution, destination filter, `executionIndex` · `403E` cancel + `executionTimeoutTimestamp` · `403F` context class
vs node flags · `403G` bare `checkReadyForExecution` · `403H` error-output routing incl. the synthetic error output ·
`403I` `runIndex` + proxy per activation · `403J` sibling order by canvas position · `403K` the gate the engine itself
applies. Written up in [`../execution-engine.md`](../execution-engine.md) and
[`contracts/execution-engine.contract.md`](../../../contracts/execution-engine.contract.md).

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
| `13E_gap_closure` | 42 | 5 blocks: `$fromAI` 14 · `$tool` 7 · `$agentInfo` 6 · lineage+`resolveSourceOverwrite` 9 · `additionalKeys` surface 11 |
| `fixture` | 23 | workflow / items / runData anchor |
| **total** | **503** | 65 of the entries are recorded throws (418 outcomes = 353 values + 65 throws) |

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
| `13E_gap_closure` | PIPE-13 | the four formerly-`PARTIAL` rows, now observed: the `$fromAI` data source, the `connectionInputData[runIndex]` fallback quirk and key validation boundaries; `$tool`'s fallback chain; `$agentInfo` on a real agent + `ai_tool` + `ai_memory` graph (eager snapshot, `queryNodes` tool discovery, resource/operation display names, `hasValidCalendar`, `aiDefinedFields`); the `pairedItem.sourceOverwrite` lineage redirect next to the 6-case `resolveSourceOverwrite` matrix and the empty-candidate `TypeError`; and the `getAdditionalKeys` / `getNonWorkflowAdditionalKeys` / `$secrets` / `$execution.customData` supply surface |
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

Recorded result for the committed pair (2026-09-17, 503 entries): `MATCH`.

## Integrity

```
sha256(observations.json)    = c7e62b01a58a017fe9643147442b8d9ce875be79928a45dd25f552c8a6b100c1
sha256(expression-probes.cjs) = 49c0c739bd112c9ee8cd75fe7dabfe2b4c6cb4b314823a2131a8b7d358c3ff8f
sha256(determinism-check.cjs) = eda63bb2d4ae685ac794277b785f2830c83ff08af495f4a17233b18f2648b046
runtime: n8n-workflow@2.9.1  n8n-core@2.9.1  @n8n/tournament@1.0.6  luxon@3.7.2  node v22.22.3
reference: reference/n8n @ b6dc2787c45677a29a9612cd27eb911302961a83 (unmodified)
```

`tests/reference/**` (Agent 3/5 goldens) are **not** modified by this directory; the runner only
reads `tests/reference/harness/harness.js`.
