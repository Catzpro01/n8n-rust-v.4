# LEGO Isolation: Node Execution Context + Workflow Data Proxy

**Status:** `REFERENCE TESTED` — 117/117 gates green with the live oracle and 117/117 with the oracle suppressed at the seam, falsification gate green (22/22 mutants caught); transcripts in `packages/reconstructed-engine/evidence/`, audited by gate 08
**Owner:** Agent 2 (LEGO `node`, port unit `node-execution-context` + `workflow-data-proxy`)
**Task:** `tasks/POOL-002-R1-node.yaml` (rework of POOL-002, whose `FAILED` record is kept at `results/POOL-002-node-execution-context-data-proxy.md`)
**Deliverable:** `packages/reconstructed-engine/`
**Reference:** n8n 2.9.4 (`reference/n8n`, commit `b6dc2787`), oracle artifact `n8n-workflow@2.9.1` / `n8n-core@2.9.1` (the artifact 2.9.4 ships)

---

## 1. What this port unit owns

| Ported module (`src/*.mjs`) | Reference origin | Scope claim |
|---|---|---|
| `workflow-data-proxy.mjs` | `packages/workflow/src/workflow-data-proxy.ts:76-1586` | complete (`getDataProxy`, every accessor getter, `$()`/`$input`/`$items`/`$json`/`$node`/`$parameter`/`$binary`/`$data`, top-level proxy trap) |
| `workflow-data-proxy-env-provider.mjs` | `packages/workflow/src/workflow-data-proxy-env-provider.ts` | complete (`$env` block-checking proxy) |
| `run-execution-data.mjs` | `packages/workflow/src/run-execution-data.ts`, `run-execution-data-factory.ts` | complete (+ `getContext`, shared with the context classes) |
| `node-execution-context.mjs` | `packages/core/src/execution-engine/node-execution-context/{node-execution-context,base-execute-context,execute-context}.ts` | partial: the execute path; hook/webhook/trigger/poll/supply-data/load-options contexts are separate units |
| `additional-keys.mjs`, `get-secrets-proxy.mjs` | `.../utils/get-additional-keys.ts`, `.../utils/get-secrets-proxy.ts` | complete for both modules |
| `execution-metadata.mjs` | `.../utils/execution-metadata.ts`, `construct-execution-metadata.ts`, `packages/core/src/errors/invalid-execution-metadata.error.ts` | complete |
| `errors.mjs` | `packages/@n8n/errors/src/application.error.ts`, `packages/workflow/src/errors/**` | partial: the six classes the execution path raises |
| `constants.mjs` | `packages/workflow/src/constants.ts` | complete (all 80 exports, values pinned) |
| `utils.mjs` | `packages/workflow/src/utils.ts` | selective: the helpers the above call, re-implemented (no lodash/n8n dependency at runtime) |

`scope: complete` is not prose — `test/helpers/record-surface.mjs` reads the export lists and the class prototype chains out of the installed package and **aborts** if a reference symbol is neither ported nor classified. `manifest/port-surface.json` is that record, and `test/05` fails when the code and the record disagree.

## 2. Boundary: what the port refuses

Everything below raises `NotPortedError` (which carries the reference file:line) instead of returning a plausible value. The list is machine-readable in `manifest/port-surface.json → modules[*].deferred` and is asserted by gates 04/05.

| Symbol | Why deferred | Owning LEGO |
|---|---|---|
| `$('n').pairedItem` / `.itemMatching` / `.item`, `$getPairedItem` | paired-item resolution algorithm | paired-item |
| `$fromAI` / `$fromAi` / `$fromai` | fromAI placeholder parsing | Expression |
| `$tool`, `$agentInfo`, `agentInfo`, `buildAgentToolInfo` | agent runtime | agent |
| `getInputConnectionData` | `utils/get-input-connection-data.ts` + HITL tools | connection |
| `getSignedResumeUrl`, `getInstanceBaseUrl`, `getInstanceId` | webhook URL signing / instance settings service | webhook / persistence |
| `startJob` | long-running job resumption | jobs |
| `augmentObject` / `augmentArray` | scripting-node copy-on-write | Expression (scripting) |
| `{ extractValue, ensureType, skipValidation }` options on `getNodeParameter` | parameter-resolution strategy | validation |
| `NodeHelpers.{getNodeInputs,getNodeOutputs,getNodeFeatures,displayParameter}` | supplied by the host; the port delegates when the runtime is present and raises when it is not | Workflow model |

Class hierarchy is compared, not assumed: `BaseExecuteContext extends NodeExecutionContext` — in the reference `NodeExecutionContext` is the *shared base*, despite its name — and gate 05 asserts `referenceExtends === portExtends` for all four classes.

## 3. Injected capabilities (the isolation part that matters)

The reference reaches outside itself in ways this port had to make explicit:

1. **`luxon`** (`:7`, `:90`, `:1535-1536`, `:1539-1543`) — the reference imports `{ DateTime, Duration, Interval, Settings }` and writes a global timezone default at construction. The port takes `luxon` as an injected option and performs that write only when a host supplied the object. All five dependent sandbox keys (`$now`, `$today`, `DateTime`, `Interval`, `Duration`) are installed by ONE loop, so "no luxon" means five loud `NotPortedError`s — not three `undefined`s and two errors, which is what the previous shape gave and what the ISSUE-016 rule forbids. The consequence is worth stating for the Expression lane and for the Rust port: because the write lands on the shared module object, **two live proxies do not get two timezones — the last one constructed wins** for everything read through the `DateTime`/`Interval`/`Duration` keys, while `$now`/`$today` keep the zone they sampled. Measured on the reference (`DateTime.fromISO('2024-02-29T12:00:00.000').toISO()` on proxy A goes `…+09:00` → `…-05:00` after proxy B is built, with A's `$now.zoneName` unchanged) and reproduced here; `test/04`'s last test pins both halves. Two further points are pinned by gate 04 against a *fake* luxon, because a real clock cannot be pinned: `DateTime.now()` is called **twice** (`$today` floors the second sample, so across midnight the reference can hand out a `$today` ahead of `$now` — reproduced, not "fixed"; mutant *$today derived from $now's clock sample*), and `Settings.defaultZone` is written exactly at construction with the **workflow's** timezone (mutant *Settings.defaultZone write skipped as global mutation*).
2. **`jmespath`** — `$jmesPath` / `$jmespath` (`workflow-data-proxy.ts:763-775`) calls `jmespath.search`. The reference does `import * as jmespath from 'jmespath'`, a bare specifier, and gate 01 forbids bare specifiers in `src/`. So the module is injected as `jmespath` in the same options object as `luxon`, and the harness resolves it from the seam (`reference-runtime.mjs`); the sandbox keys are wired to a module-scope `jmespathWrapper(proxy, data, query)` because the reference defines it at module scope and gate 05 compares the class prototype method-for-method. Both `typeof`-guard behaviour and the reference's `{ ...data }` copy (jmespath mutates what it walks — it stamps `__ident__` onto nodes — while arrays pass by identity) are pinned: the value probes in the golden, and two offline tests in gate 04 that use a *fake* jmespath so the copy semantics and the guard ordering are graded even where no oracle exists.
The `agentInfo` slot deserves a note because it is *half* ported and that is the correct outcome: `workflow-data-proxy.ts:1061-1063` returns `undefined` for every node type except `@n8n/n8n-nodes-langchain.agent`, so `undefined` IS the faithful answer for the corpus — but a constant `undefined` would be a lie for agent workflows. The port therefore keeps the reference's method name on the prototype (TS `private` is compile-time only, and gate 05 compares the class method-for-method) and raises `NotPortedError` for the agent branch only.

3. **`Container.get(...)`** — the reference resolves `Logger`, `InstanceSettings` and `NodeHelpers` from the DI container. The port's constructor takes them as `deps` (`deps.logger`, `deps.nodeHelpers`, `deps.instanceId`), defaulting to a silent logger and a *raising* NodeHelpers seam. The oracle harness is the only place that installs the real ones.

`test/01-module-graph.test.mjs` enforces the resulting invariant: every import in `src/` is relative (plus `node:` builtins), only `reference-runtime.mjs` may touch an installed package, and the whole graph must load in a child process with the oracle hidden from it.

## 4. Verbatim quirks the Rust port must copy (not "fix")

Each of these is asserted by a gate; each looks like a bug in the reference and is load-bearing behaviour in n8n.

| Quirk | Reference | Consequence if "improved" |
|---|---|---|
| `$now` and `$today` each call `DateTime.now()` | `workflow-data-proxy.ts:1535-1536` | sharing one sample makes `$today` lag `$now` across a midnight boundary — a plausible-looking bug fix that changes which day a long-running expression sees |
| `ApplicationError` does not set `this.name` | `@n8n/errors/application.error.ts` | every `error.name === 'ApplicationError'` check changes answer |
| `@n8n/errors` compiles with `useDefineForClassFields:false`, `n8n-workflow` with `true` | build configs | `packageName`/`cause`/`description` appear or vanish as *own keys*; `toJSON()` output and telemetry shape move |
| `WorkflowOperationError(message, node?, description?)` | `workflow-operation.error.ts:8-24` | reading arg 2 as an options bag yields `node: undefined` + the options in `cause` |
| `COMMON_ERRORS[code]` looked up un-uppercased after an uppercased guard | `node.error.ts:88` | a lowercase code yields `message: undefined` — the text users see |
| `ExecutionBaseError` assigns `context.runIndex/itemIndex/metadata` unconditionally | `node-operation.error.ts:44-46` | `Object.keys(e.context)` shape differs |
| `getContext` **creates on read** | `run-execution-data.ts` | context writes silently vanish on the next run |
| `migrateRunExecutionData` rewrites only `startData`, sets `originalDestinationNode` to `undefined` (key stays) | `run-execution-data.ts:19-45` | persisted payload shape changes; `'destinationNode' in startData` answers differently |
| unsupported version throws a plain `Error`, not `ApplicationError` | `run-execution-data.ts:42` | error-class-based alerting |
| `$execution.customData` metadata caps at 10 keys **silently**, truncates keys at 50 / values at 512 while warning past 255 | `execution-metadata.ts:7-52` | workflows that store 11 keys start erroring |
| two *different* "Unknown context type" messages | `Workflow.getStaticData` says `` Only `global` and `node` ``; `NodeHelpers.getContext` says `` Only `flow` and `node` `` | unifying them breaks the strings users grep |
| `pinData` short-circuit before execution, and `nodeFailed` sniffing `data[0][0].json.error` | `workflow-execute.ts` | pinned-node runs and continue-on-fail routing |
| `setAllWorkflowExecutionMetadata` validates **per key**, keeps the successful writes, rethrows the first error | `execution-metadata.ts:52-64` | "validate the whole object first" is cleaner and wrong |

### 4b. One deliberate simplification, and the proof that it is safe

`$input.all() / first() / item` guard on `connectionInputData.length === 0`. The reference has no
such guard there: it computes `placeholdersDataInputData` (from `runData[activeNode][runIndex].inputOverride`
when the active node already has run data, else from `connectionInputData[runIndex]?.json`) and throws
`No execution data available` when *that* is falsy — `workflow-data-proxy.ts:1061-1079` — but that
throw belongs to the fromAI placeholder lookup, not to the item getters. So the port and the reference
get to the same answer by different roads, and copying the reference's expression into the accessor
would be a **regression**: `$input.all()` would start throwing for an item that carries only `binary`.

This is recorded rather than argued: three scenarios in `fixtures/corpus.json`
(`input-placeholder-sourcing-edge`, `input-placeholder-from-input-override`,
`input-override-ai-tool-placeholder`) pin the behaviour in both directions, and two mutants in gate 07
(delete the guard / replace it with the reference's expression) are each caught. The divergence that
remains reachable runs only through `$fromAI`, which is deferred to the Expression LEGO.

## 5. How it is verified

| Gate | Runs offline? | What it can see |
|---|---|---|
| `00-constants` | yes (+live) | every constant value and the exact export set vs. `fixtures/reference-snapshot.json`; live half re-derives it |
| `01-module-graph` | yes | import purity, no oracle in the graph, no module-scope global mutation |
| `02-errors` | yes (+live) | class names, levels, context filtering, `messages` mapping, and **own-property shape** against the reference classes |
| `03-run-execution-data` | yes (+live) | migration branches, factory key sets, `getContext` create-on-read, metadata limits, `constructExecutionMetaData` pairing precedence + key order; live half compares structures |
| `04-data-proxy-golden` | yes | 21 data-proxy scenarios (190 accessor probes + 7 deferred-symbol probes) + 3 execute-context scenarios (49 method probes each) — **344 recorded results** in all, graded against `fixtures/data-proxy.golden.json`, recorded from the reference. 15 proxy probes are flagged `_oracleDependent` *by rule* (they need a host-injected capability — jmespath or luxon); offline they are asserted as must-raise, never skipped. Two of the tests here run against fake injected modules, which is the only way to grade the injected-capability quirks deterministically |
| `05-surface-coverage` | yes (+live) | manifest ↔ code ↔ reference: buckets, class methods, 43 sandbox keys, additional-key set, hierarchy |
| `06-legacy-runner-regression` | yes | the POOL-001 loop (`runner.mjs`, `test-run.mjs`, `runner.test.mjs`) is unedited since the recorded commit (sha256 + `git hash-object` + `git rev-parse <commit>:<path>` traceability), and the dependency runs in neither direction |
| `07-falsification` | yes | **22 mutations** + control, each re-running the whole suite inside a temp copy |
| `08-evidence-consistency` | yes | the captured transcripts still describe the tree: fixture/manifest hashes, per-run counts, `# fail 0`, and proof that the "offline" run really had no oracle (it degrades host-dependent probes to "must raise", which must be visible in the transcript) |
| `oracle/10-reference-equivalence` | no — needs the oracle | the same probes against the installed reference **in-process**, plus: every declared deviation must still be a deviation and must be covered by a probe; the surface manifest must be reproducible from the runtime |

`npm run verify:engine:evidence` re-captures both transcripts (`test/helpers/capture-evidence.mjs`); it refuses to write when a run is red, and gate 08 refuses to let a stale transcript be quoted as current proof.

Offline mode is a property of the **seam**, not of the shell wrapper: `ENGINE_NO_RUNTIME=1` makes
`reference-runtime.mjs` report "unavailable" even when `.runtime` exists on disk. Before that, the
runner hid the directory from itself while the modules under test still discovered it — so the
"offline" run was live, and the transcript said so (it printed no degradation diagnostics at all).
Gate 08 now requires the offline transcript to *show* `oracle equivalence NOT RUN` and the
host-dependent degradation lines: an offline claim without them in the file is a failure.

**`--test-force-exit` under-reports, so the runner does the counting.** A single
`node --test` over all ten gate files reported `# tests 97`, `100`, `102` and `103` on
identical trees, always with `fail 0`: results still in flight when the process is killed never
reach the ok lines *or* the summary, so a green count can simply be smaller than the suite.
`scripts/run-engine-tests.sh` therefore runs one gate file per process, cross-checks each file's
declared count against the results actually printed (a mismatch is `RESULT INTEGRITY FAILED`, not
a pass), drops the runner's own tally, and prints an aggregate it computed itself. Both failure
shapes — a file that cannot load, and a red assertion — were verified to exit 1 with the message
intact; under `set -euo pipefail` that also required tolerating `grep`, which exits 1 on zero
matches and was silently aborting the loop instead of reporting the empty result.

**Re-capture is the last step before publishing, not the first.** Each transcript header records
the commit whose tree it graded, and gate 08 asserts that sha names a real commit — which is only a
useful check if the recorded commit survives. A `git rebase` rewrites it, so evidence captured
*before* a rebase points at an object no other clone will have. The procedure this lane follows:
rebase, then `npm run verify:engine:evidence`, then commit and push; the whole gate then proves the
transcripts match the tree that is actually about to be checked out elsewhere.

Degradation is explicit: when the oracle is missing, host-dependent probes are asserted as "must raise, never answer undefined" and the oracle gate prints `oracle equivalence NOT RUN` (it *fails* unless `ENGINE_ALLOW_NO_ORACLE=1`, because a silently-skipped equivalence gate is not a gate).

## 6. What the goldens found (why this method is worth its cost)

Three defects were caught by comparison, none by reading:

1. **Swallowed error.** A local `contextReader` copy of `NodeHelpers.getContext` normalised `node` to `node?.name`, so `$input.context.*` returned `{}` where the reference raises *The request data of context type "node" the node parameter has to be set!*. Fix: one shared implementation (`run-execution-data.mjs → getContext`), used by both the proxy and the context classes.
2. **Inert `getStaticData` stub surfaced a real signature drift.** `WorkflowOperationError` had been ported against the older `(message, error, options)` shape; the 2.9.x signature is `(message, node?, description?)`.
3. **`$env` returned `undefined`.** The port deferred `$env`, but the oracle blocks env access by default and *throws*; `undefined` looked like a working accessor. Fixed by porting `workflow-data-proxy-env-provider.ts` (70 lines, no dependencies) — the deferred list shrank and the behaviour is now exact, including the ExpressionError text.

Falsification then caught a *harness* gap: `$execution.mode` was unprobed, so swapping `'test'`/`'production'` in the port stayed green. `fixtures/corpus.json` grew two scenarios — `execution-metadata-and-vars` (the `$execution`/`$vars`/customData surface) and `orphan-branch-default` (an executed node that is *not* connected to the active node, which is the only way to reach the `branchIndex ?? 0` default) — and re-recording made both mutations fail loudly.

## 7. Notes for the sibling LEGOs

- **POOL-003 (error/retry).** `retryOnFail` / `maxTries` / `waitBetweenTries` / `continueOnFail()` / `nodeFailed` are ported and pinned here (gate 04's `ctx-on-error-routing`). Treat §4's rows as the fixed contract; the *execution loop* around them stays in `workflow-execute.ts` (POOL-001's `runner.mjs`, which gate 06 pins untouched).
- **POOL-002 vs POOL-003 overlap:** `NodeOperationError` + `setDescriptiveErrorMessage` + `ExecutionBaseError` are **this** unit's surface; POOL-003 should consume them, not re-port them.
- **Expression LEGO:** the data proxy calls `workflow.expression.getParameterValue(...)` with the frozen 12-argument signature (`contracts/expression.contract.md`) and honours E-06/E-07 for `=`-prefixed plain strings; `$env`, `$fromAI` name-collisions and `$secrets` are resolved *here*, so Expression does not need to re-implement them.
- **Validation LEGO:** `{extractValue, ensureType, skipValidation}` remain deferred — say the word and they can move into your unit with the goldens to match.
- **agent-5:** `run_gate.sh --offline-only` is unaffected; `npm run verify:engine` is the new live gate, `verify:engine:offline` the oracle-free one.
