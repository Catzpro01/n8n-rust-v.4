# TASK RESULT: POOL-002-R1-node-execution-context-data-proxy

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-2`
- **LEGO COMPONENT**: `node` (port unit: execution context + data proxy)
- **EXIT CODE**: `0`
- **BRANCH**: `arena/01a0aff7-n8n-rust-v-4` (baseline `fc4e5631`)
- **TIMESTAMP**: `2026-09-18 (Asia/Novosibirsk)`
- **SUPERSEDES**: `POOL-002` (agent-8, `FAILED` — that record is preserved verbatim)

---

### What shipped

`packages/reconstructed-engine/` — a reference-faithful ESM port of the n8n 2.9.4 execution
surface (workflow data proxy incl. `$env` provider, run-execution-data + factory, node
execution contexts, additional keys + `$secrets` proxy, execution metadata, the six error
classes, all of `constants.ts`) plus nine gates that compare it to the pinned reference.

| Artifact | Content |
|---|---|
| `src/*.mjs` (10 files) | the port; every symbol documents its reference `file:line` |
| `fixtures/corpus.json` | 19 data-proxy scenarios + 3 execute-context scenarios + deferred-probe set |
| `fixtures/legacy-runner.lock.json` | POOL-001 non-entanglement pin (sha256 + traceable commit blob) |
| `fixtures/data-proxy.golden.json` | 344 reference-recorded probe results (values *and* errors), 21 proxy + 3 context scenarios |
| `fixtures/reference-snapshot.json` | recorded constant values, sandbox key set, context method set, additional-key set |
| `manifest/port-surface.json` | generated per-module/per-class classification: ported / deferred / out-of-scope / additions + class hierarchy check |
| `test/00…07`, `test/oracle/10` | the gates, incl. recorders (`record-golden.mjs`, `record-surface.mjs`) and an offline host stub that throws on anything unmodelled |
| `docs/isolation/node-execution-context.md` | boundary, deferral table, verbatim-quirk table for the Rust port, verification map |
| `scripts/run-engine-tests.sh`, `npm run verify:engine[:offline]` | one command for both modes |

### Verification

| Run | Result |
|---|---|
| `npm run verify:engine` (oracle `n8n-workflow@2.9.1`/`n8n-core@2.9.1` installed) | **117/117 pass** |
| `npm run verify:engine:offline` (oracle suppressed at the seam via `ENGINE_NO_RUNTIME=1`) | **117/117 pass**, and the transcript must *prove* the suppression (gate 08): `oracle equivalence NOT RUN` ×6 + host-dependent degradation lines |
| `test/07-falsification` | control green; **22/22 mutations caught** (each re-runs the whole suite in a temp copy) |
| `test/05-surface-coverage` | 0 undeclared gaps, 0 undeclared additions, 43/43 sandbox keys, 5/5 additional keys, 4/4 class hierarchies match |
| `evidence/` (gate 08 audits it) | transcripts of both runs above at head `7196779e`, node v22.22.3, captured by `npm run verify:engine:evidence`; recorder refuses red runs |

### Bugs this method found (and that a read-the-source review would not have)

1. `contextReader` normalised `node` → swallowed *"The request data of context type "node"
   the node parameter has to be set!"*; fixed by sharing ONE `getContext` implementation.
2. `WorkflowOperationError` was ported against an older `(message, error, options)` shape;
   2.9.x is `(message, node?, description?)` — found by comparing own-property shapes with
   the live reference classes.
3. `$env` was "deferred" and returned `undefined`; the reference *throws* under the default
   env-block setting. Fixed by porting `workflow-data-proxy-env-provider.ts` outright.
4. `sendChunk`/`logAiEvent` were listed as declared deviations but match the reference
   exactly — the stale declarations were removed (a deviation that stops being true is a
   documentation bug; gate 10 now asserts every declaration is still observable).
5. Falsification exposed two coverage holes (`$execution.mode`, the unconnected-node
   `branchIndex` default); the corpus grew two scenarios and re-recording closed them.
6. Harness traps fixed on the way: JSON turns `undefined` call args into `null` (needs a
   sentinel); goldens keyed by a re-parsed rendered string lose `Date`/args (store `_path`);
   nested `node --test` inherits `NODE_OPTIONS`/`NODE_TEST_CONTEXT` and reports nothing.

### Also fixed on 2026-09-18: the offline claim was not verifiable, and prose was the only proof

Three defects in the *verification machinery*, all found while adding `evidence/`:

1. `verify:engine:offline` suppressed the runtime in the shell wrapper only;
   `src/reference-runtime.mjs` kept discovering `<repo>/.runtime` itself. So the "offline"
   run was actually a live run and its transcript contained no degradation lines. Fixed by
   making `ENGINE_NO_RUNTIME=1` a property of the seam, and by having gate 08 require the
   degradation markers to be present in the captured offline transcript.
2. `--test-force-exit` makes node's own summary untrustworthy: identical trees reported
   `# tests 97 / 100 / 102 / 103`, each with `fail 0` — results still buffered when the process is
   killed reach neither the ok lines nor the tally, so a green count can simply be smaller than
   the suite. The runner now executes one gate file per process, cross-checks `declared == printed`
   per file (mismatch = `RESULT INTEGRITY FAILED`), drops the runner's tally and prints an
   aggregate it computed itself. Both failure shapes were exercised (a file that cannot load; a
   deliberate red assertion), and the `set -euo pipefail` interaction was itself a bug: `grep -c`
   exits 1 on zero matches, which aborted the loop *before* the verdict — the same silence the
   check exists to catch. Relayed to agent-5 as MSG-08.
3. Gate 01's "no import-time global mutation" pattern also matched
   `process.env.X === 'y'` (a read). Tightened to real assignments, with a self-check test
   asserting both directions (a planted `process.env.TZ = 'UTC'` must be caught; a comparison
   must not) — because a static gate that cries wolf gets disabled rather than fixed.

New artifacts: `test/08-evidence-consistency.test.mjs`, `test/helpers/capture-evidence.mjs`,
`evidence/` (2 transcripts + summary.json + README), `ENGINE_NO_RUNTIME` support and per-file result integrity checks in
`scripts/run-engine-tests.sh`, and `npm run verify:engine:evidence`. Numbers at that point: 103/103
live, 103/103 offline, 15/15 mutants caught; after the JMESPath port below, 117/117, 117/117 and
22/22.

### Cross-lane evidence produced while finishing (2026-09-18)

Recorded from the live 2.9.1 runtime, not inferred from source — see
`docs/isolation/CROSS-AGENT-ISSUES.md` (ISSUE-016 update) for the tables:

- **Pinned + disabled node:** `WorkflowDataProxy` substitutes pinned output **regardless of
  `disabled`** (`getPinDataIfManualExecution` checks only `mode === 'manual'`,
  `workflow-data-proxy-helpers.ts:3-12`) while `$('n').isExecuted` stays `false`. Scenario
  `pinned-and-disabled-node`; gate 07 catches both "fixes" (filtering pin data by `disabled`,
  and counting a pinned node as executed).
- **`$input` is not fed by pin data:** the `pinDataToTask` fallback
  (`workflow-data-proxy.ts:909-926`) lives in the paired-item/placeholder path; `$input.all()`
  reads `connectionInputData` and raises when it is empty. Scenario
  `pinned-upstream-substitutes-input` — my own first hypothesis, disproved by recording.
- **H-07 agreement with POOL-005:** `constructExecutionMetaData` spreads
  `{ json, pairedItem: itemData, ...rest }`, so an item that already carries `pairedItem` wins.
  The port reproduces this exactly (verified against the live `n8n-core` module) and is now
  pinned offline in gate 03 with a gate-07 mutant for the inversion.

### `$jmesPath` / `$jmespath`: ported, and the deferred list shrank by one

The last entry in `manifest/port-surface.json → deferred` that could be closed without a second
LEGO was the JMESPath accessor, so it is now ported the way `luxon` already was: the reference
`import * as jmespath from 'jmespath'` is a bare specifier, `src/` is not allowed to have one
(gate 01), so the module arrives through `reference-runtime.mjs` and is injected as the ctor's
15th-argument options object. What the port had to get right, none of it visible in a skim:

- the arity/type guard runs **before** the module is touched, so `={{ $jmesPath('x','a') }}`
  raises `ExpressionError: expected two arguments (Object, string) for this function` on a host
  with no jmespath — that is why three of the eight corpus probes are graded *offline*;
- `typeof null === 'object'`, so `$jmesPath(null, 'a')` is *accepted* and answers `null`
  (`{ ...null }` is `{}`); the guard is `typeof`, not truthiness, and that is now a golden probe;
- objects are spread into a copy because `jmespath.search` mutates what it walks (it stamps
  `__ident__` onto every object) while arrays are passed by identity — a "clean up the useless
  copy" refactor is now mutant `…spread removed as an optimisation`, and its inverse
  (capability check before the guard) is mutant `…moved before the argument guard`;
- it lives in a module-scope `jmespathWrapper(proxy, …)`, not a class method, because gate 05
  compares `WorkflowDataProxy.prototype` with the reference method-for-method; making it a
  method is a real drift and gate 05 caught it while I was writing this.

Ten value probes are host-dependent and therefore flagged `_oracleDependent` by rule, not by hand:
`record-golden.mjs` stamps any probe whose root needs an injected capability *and* that answered
successfully. Offline gate 04 then asserts those raise instead of answering (diagnostic: "5
probe(s) graded as must-raise only"), which keeps the honest-degradation contract intact.

### Then the luxon keys: the deferred rule turned on my own port

Porting jmespath made the neighbouring `luxon` group the last one on the deferred list that no
other LEGO owns, and looking at it properly produced a finding against this port rather than a new
feature: `DateTime`/`Interval`/`Duration` were installed as `this.luxon?.X`, i.e. **three silent
`undefined`s** whenever no host injected luxon — exactly the inert-field pattern `ISSUE-016` was
raised for, and the one place in the package where "deferred symbols raise, nothing answers
undefined" (an acceptance criterion in `tasks/POOL-002-R1-node.yaml`) was untrue. All five
luxon-dependent keys now go through one installation loop: values when the capability is there,
`NotPortedError` naming `workflow-data-proxy.ts:1535-1543` when it is not.

Two reference details came with it, both pinned the only way they can be — against a fake luxon,
since a wall clock cannot be recorded:
- `DateTime.now()` is called **twice** (`:1535-1536`), so `$today` can be a day ahead of `$now`
  across midnight. Deriving one from the other reads like a fix; it is a deviation, and it is now a
  mutant (`$today derived from $now's clock sample`) alongside the "obviously better" `skip the
  Settings.defaultZone write` mutant.
- the corpus previously probed `$now`/`$today` as *deferred* symbols, and the recorded reference
  value was a timestamp (`luxon:2026-09-17T15:41:47.163-04:00`) — a latent flake waiting for any
  run that answered them. They are removed from `corpus.deferredProbes` (11 → 7 probes) and replaced
  by deterministic ones: `DateTime.fromISO(…).toISO()` prints the ambient zone (`…+09:00` for a
  workflow with `settings.timezone: Asia/Tokyo`), so the golden grades the global write instead of
  the clock.

`$agentInfo` was the third finding in the same sweep: the port had a constant `undefined`, the
reference has a method whose *first guard* returns `undefined` and whose rest is agent metadata.
`WorkflowDataProxy.prototype.agentInfo` now exists with the reference's name (gate 05 compares
prototypes method-for-method and had already caught `jmespathWrapper` being a method), answers
`undefined` for non-agent nodes and raises for `@n8n/n8n-nodes-langchain.agent`. That took the
ported-class method count from 11 to 12 of the reference's 13.

And the sweep turned up the behaviour behind `ISSUE-006` rather than a bug: the ambient write is on
the *shared* module object, so with two live proxies the later construction changes what the
earlier one's `DateTime` key resolves against (`+09:00` → `-05:00` measured on the reference), while
`$now`/`$today` stay snapshot-zoned. Not a defect to fix in a frozen port — a constraint to record,
now pinned by the last test in gate 04 and relayed as MSG-10.

Two accidents worth recording, because the gates caught both and I would not have noticed otherwise:
a `from:` anchor in a new mutant still named `agentInfoValue` after the rename, and gate 07's
"anchor must match exactly once" rule made that a red test instead of a disabled one; and inserting
the four mutants with `rindex("\n];")` produced `},,` — an array hole — which `for…of` walked into a
TypeError, so the file reported 22 tests when it should have reported 23 and the failure was a file
level `not ok`, easy to lose under a `| head`. Counting `name:` lines in the source is not a
substitute for counting tests.

### Goldens survived the shared-runtime pin change (d77c55b5)

Another lane pinned `flatted@3.2.7` + `nanoid@3.3.8` as overrides in
`scripts/setup-reference-runtime.sh`. After reinstalling `.runtime` with those pins, the whole
suite — including gate 04 (graded against goldens recorded *before* the pin) and gate 10
(in-process equivalence) — is still green (103/103 at that time; 108/108 after the JMESPath port). So the recorded values do not depend on those
transitive versions, and other lanes do not need to re-record their goldens because of that pin.
If a future pin ever does move a value, gate 04 fails on the diff; the fix is
`npm run record:golden`, never an edit to `fixtures/`.

### Note for POOL-001 / Phase 3

`runner.mjs` now carries its own minimal `WorkflowDataProxy` (`$json`/`$input`/`$execution`
shorthands, `mode: 'manual'` hardcoded, `runIndex: -1` semantics). That is fine while the two
lanes are decoupled — gate 06 makes "decoupled" an assertion — but when the loop is migrated it
should import `src/workflow-data-proxy.mjs` and the reference-recorded behaviour in
`fixtures/data-proxy.golden.json` becomes the migration test.

### Scope discipline

- No writes outside `packages/reconstructed-engine/**`, `docs/isolation/node-execution-context.md`,
  `scripts/run-engine-tests.sh`, this `tasks/`+`results/` record, the outbox, and the root
  `package.json` (two added scripts).
- `packages/reconstructed-engine/{runner.mjs,test-run.mjs,runner.test.mjs}` (POOL-001) untouched —
  gate 06 pins them by sha256, verifies the pin traces to a real commit blob, and forbids imports in
  either direction. (The lane's own `cc2d111f` rewrite of `runner.mjs` landed on this branch during
  the work; the pin was re-recorded to it rather than reverted — that file is not this lane's to own.)
- No Rust, no `crates/**`, no UI files. POOL-003 (error/retry) stays **reported**, not fixed:
  its overlap (`NodeOperationError`, `setDescriptiveErrorMessage`, retry/continue-on-fail
  policy) is ported and pinned here so that task can consume rather than re-port it.
- `reference/n8n` remains read-only; `.runtime` stays gitignored (it does not survive
  sandbox snapshots, which is exactly why gates 00–07 must pass offline).
