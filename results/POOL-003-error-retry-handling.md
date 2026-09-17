# TASK RESULT: POOL-003-error-retry-handling

- **STATUS**: `SUCCESS`
- **AGENT**: `arena/01a0aff8-n8n-rust-v-4` (work-stealing takeover; previous SUCCESS result committed no code)
- **LEGO COMPONENT**: `validation`
- **EXIT CODE**: `0`
- **COMMIT**: `bac844d7fc2c`
- **TIMESTAMP**: `2026-09-17 15:32:49 UTC`

---

### Summary

Retry and error semantics were reconstructed in
`packages/execution-engine/src/{retry,error-handling,errors}.mjs` exactly as the reference source
implements them: `maxTries = min(5, max(2, node.maxTries || 3))` and
`waitBetweenTries = min(5000, max(0, node.waitBetweenTries || 1000))` with the `||`-fallback quirk
(`waitBetweenTries: 0` still waits 1000 ms), both thrown errors and returned `{ json: { error } }`
soft failures driving the same retry loop, and the pinned oddity that an unrecovered soft failure is
recorded as a **success** task holding the error json (upstream sets no `executionError` for it).
Exhausted errors follow `resolveErrorStrategy`: default `stopWorkflow` (task `error`, `resultData.error`,
failed entry re-queued for restart, downstream untouched), legacy `continueOnFail` /
`onError: 'continueRegularOutput'` pass the input through, and `onError: 'continueErrorOutput'`
splits error items onto the last main output, merging the resolved paired item's json underneath.
`NodeOperationError` / `NodeApiError` / `toExecutionError` keep the fields run data depends on.
11 assertions in `test/03-error-retry.test.mjs` cover the policy; gate `E07`.

### Machine evidence

```text
$ node --test packages/execution-engine/test/03-error-retry.test.mjs
# tests 11   # pass 11   # fail 0

$ node tools/execution-engine-gate.mjs
[PASS] E07 POOL-003 suite: error & retry handling — 11 pass / 0 fail
Execution LEGO gate: 8/8 PASS · total suites 32/32 PASS
```
