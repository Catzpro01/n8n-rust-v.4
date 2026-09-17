# reconstructed-engine — n8n execution surface, reference-faithful port

Port unit for **task POOL-002-R1** (rework of POOL-002). Plain ESM JavaScript, no build
step, no runtime dependency on n8n: it is the executable specification the Rust engine
port is written against, and it doubles as the oracle harness for that port.

```
src/      the port            constants, utils, errors, run-execution-data,
                              workflow-data-proxy (+env provider), additional-keys,
                              get-secrets-proxy, execution-metadata,
                              node-execution-context, reference-runtime (seam)
fixtures/ the evidence        corpus.json (probe definitions, hand-written),
                              data-proxy.golden.json + reference-snapshot.json
                              (RECORDED from the pinned reference — do not hand-edit)
evidence/ the captured proof  transcripts of both modes + summary.json (gate 08 audits them)
test/     the gates           00-08 + oracle/10, helpers/ (harness, stub host, recorders)
manifest/ the surface record  port-surface.json (generated: ported / deferred /
                              out-of-scope / additions, per module and per class)
runner.mjs, test-run.mjs,     POOL-001's execution-loop lane. NOT part of this port:
runner.test.mjs               gate 06 pins them unedited and forbids imports either way
```

## Run it

```bash
npm run verify:engine            # everything, including the live oracle gate
npm run verify:engine:offline    # usable where .runtime is missing; oracle degrades loudly
npm --prefix packages/reconstructed-engine test          # same as verify:engine
npm run verify:engine:evidence          # re-capture evidence/*.txt + summary.json (auditor-facing)
node --test --test-force-exit packages/reconstructed-engine/test/04-*.test.mjs   # one gate
```

`--test-force-exit` is required: importing `n8n-core` leaves its DI logger handle open — and it
makes the runner's own summary untrustworthy (it has reported 97/103 on an unchanged tree with
`fail 0`). `scripts/run-engine-tests.sh` runs one gate file per process, checks each file's
declared count against the printed results, and computes the aggregate itself.

## Two rules this package lives by

1. **Nothing is asserted against itself.** `fixtures/data-proxy.golden.json` is produced
   by `test/helpers/record-golden.mjs`, which drives the *installed reference package*
   (`n8n-workflow@2.9.1` / `n8n-core@2.9.1`) and stamps `$source`, `$runtimeVersion` and
   the reference-tree hash. `test/04` then grades `src/` against those values offline.
   Gate 10 re-derives the same probes from the live runtime, so a stale golden is a
   failure, not an assumption. Re-record with `npm run record:golden` (needs the oracle;
   `scripts/setup-reference-runtime.sh`).
2. **Claims are reproducible, not quoted.** `evidence/` holds a transcript of both modes
   with the counts and the sha256 of the fixtures they were produced against; gate 08 fails
   if those drift apart, and the recorder refuses to write evidence for a red run.
3. **A gate that cannot fail is not a gate.** `test/07-falsification.test.mjs` copies the
   package to a temp dir, applies one defect to `src/`, re-runs the whole suite, and
   requires red — with an unmutated control that must be green. It has already paid for
   itself: it exposed that `$execution.mode` had no probe, and the corpus grew to cover it. 15 mutants
   are on the list today (behaviour, error shapes, limits, traps in the harness itself).
   Nested `node --test` runs must strip `NODE_OPTIONS`/`NODE_TEST_CONTEXT` or the child
   reports nothing and exits 0 (the mutation would "pass").

## Two execution loops, on purpose (for now)

`runner.mjs` owns the *orchestration* seam — a self-contained loop with its own minimal
data proxy; `src/workflow-data-proxy.mjs` is the *reference-verified* proxy. They are
siblings, not layers: gate 06 asserts neither imports the other, so Phase 3 can swap the
loop onto this port (or not) without either side silently inheriting the other's
assumptions. `runner.mjs`'s `$json`/`$input`/`$execution` shorthands are conveniences with
different semantics — do not treat them as evidence about n8n.

## Deferred surface

Anything not ported raises `NotPortedError` naming the reference `file:line`. The list is
generated, not remembered: `test/05` fails if `src/` grows an undeclared export, if a
deferred symbol starts returning a value, or if the manifest stops matching the runtime.
See `manifest/port-surface.json` and `docs/isolation/node-execution-context.md` §2 for
the table (paired-item accessors, `$fromAI*`, `$tool`, `$agentInfo`,
`DateTime/Duration/Interval`, `getInputConnectionData`, `getSignedResumeUrl`, `startJob`,
`augmentObject/augmentArray`, the `getNodeParameter` strategy options, and the
host-supplied `NodeHelpers` decisions). `$jmesPath` / `$jmespath` used to be in that table; they
are now ported and take the `jmespath` module through the same injected-options seam as `luxon` —
without an injected module a valid call still raises `NotPortedError`, it never answers `undefined`.

## Provenance

n8n 2.9.4 sources at `reference/n8n` (commit `b6dc2787`); every symbol carries the
reference file:line it came from in its doc comment. Where the reference is awkward —
silently dropped metadata keys, an inconsistent truncation/warning threshold, two
different "Unknown context type" strings — the port copies it and says so in a comment;
"improvements" belong upstream, not here.
