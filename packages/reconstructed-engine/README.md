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
test/     the gates           00-07 + oracle/10, helpers/ (harness, stub host, recorders)
manifest/ the surface record  port-surface.json (generated: ported / deferred /
                              out-of-scope / additions, per module and per class)
runner.mjs, test-run.mjs      POOL-001's execution-loop prototype, pinned byte-identical
                              by gate 06 and NOT used by this port
```

## Run it

```bash
npm run verify:engine            # everything, including the live oracle gate
npm run verify:engine:offline    # usable where .runtime is missing; oracle degrades loudly
npm --prefix packages/reconstructed-engine test          # same as verify:engine
node --test --test-force-exit packages/reconstructed-engine/test/04-*.test.mjs   # one gate
```

`--test-force-exit` is required: importing `n8n-core` leaves its DI logger handle open.

## Two rules this package lives by

1. **Nothing is asserted against itself.** `fixtures/data-proxy.golden.json` is produced
   by `test/helpers/record-golden.mjs`, which drives the *installed reference package*
   (`n8n-workflow@2.9.1` / `n8n-core@2.9.1`) and stamps `$source`, `$runtimeVersion` and
   the reference-tree hash. `test/04` then grades `src/` against those values offline.
   Gate 10 re-derives the same probes from the live runtime, so a stale golden is a
   failure, not an assumption. Re-record with `npm run record:golden` (needs the oracle;
   `scripts/setup-reference-runtime.sh`).
2. **A gate that cannot fail is not a gate.** `test/07-falsification.test.mjs` copies the
   package to a temp dir, applies one defect to `src/`, re-runs the whole suite, and
   requires red — with an unmutated control that must be green. It has already paid for
   itself: it exposed that `$execution.mode` had no probe, and the corpus grew to cover it.
   Nested `node --test` runs must strip `NODE_OPTIONS`/`NODE_TEST_CONTEXT` or the child
   reports nothing and exits 0 (the mutation would "pass").

## Deferred surface

Anything not ported raises `NotPortedError` naming the reference `file:line`. The list is
generated, not remembered: `test/05` fails if `src/` grows an undeclared export, if a
deferred symbol starts returning a value, or if the manifest stops matching the runtime.
See `manifest/port-surface.json` and `docs/isolation/node-execution-context.md` §2 for
the table (paired-item accessors, `$fromAI*`, `$tool`, `$jmesPath`, `$agentInfo`,
`DateTime/Duration/Interval`, `getInputConnectionData`, `getSignedResumeUrl`, `startJob`,
`augmentObject/augmentArray`, the `getNodeParameter` strategy options, and the
host-supplied `NodeHelpers` decisions).

## Provenance

n8n 2.9.4 sources at `reference/n8n` (commit `b6dc2787`); every symbol carries the
reference file:line it came from in its doc comment. Where the reference is awkward —
silently dropped metadata keys, an inconsistent truncation/warning threshold, two
different "Unknown context type" strings — the port copies it and says so in a comment;
"improvements" belong upstream, not here.
