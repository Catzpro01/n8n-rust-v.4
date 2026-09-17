# TASK RESULT: POOL-001-core-workflow-execute-loop

- **STATUS**: `SUCCESS`
- **AGENT**: `arena/01a0aff8-n8n-rust-v-4` (work-stealing takeover, STANDING-WORKER-PROTOCOL §4)
- **LEGO COMPONENT**: `execution`
- **EXIT CODE**: `0`
- **COMMIT**: `bac844d7fc2c`
- **TIMESTAMP**: `2026-09-17 15:32:49 UTC`

---

### Summary

The core execute loop of n8n 2.9.4 was reconstructed 1:1 in `packages/execution-engine`
(JavaScript ESM, zero dependencies, ZERO RUST per `PROJECT_RULES.md` v2.9.4) instead of the
previous result, which reported SUCCESS while committing nothing (`git_commit` FAILED — empty tree).
`WorkflowExecute.run()` → `processRunExecutionData()` now reproduces the source-verified loop:
start-node selection, `runNodeFilter` for destination nodes, `runIndex` = recorded runs (I12),
pairedItem normalisation of inputs (I3), `ensureInputData` re-queue, retry/soft-failure loop,
task-data assembly, `alwaysOutputData` (I9), empty-output branch end (I8), output routing with
`previousNodeOutput` (I7), multi-input `waitingExecution` join, pinData and the endless-loop guard —
each line-mapped in `docs/isolation/execution.md` §2. 14 assertions in
`test/01-execution-loop.test.mjs` cover the loop; the contract lives in
`contracts/execution.contract.md` (§5 invariants L1–L14) and the machine gate is
`tools/execution-engine-gate.mjs` gate `E05`.

### Machine evidence

```text
$ node --test packages/execution-engine/test/01-execution-loop.test.mjs
# tests 14   # pass 14   # fail 0

$ node tools/execution-engine-gate.mjs
[PASS] E05 POOL-001 suite: core workflow execute loop — 14 pass / 0 fail
Execution LEGO gate: 8/8 PASS → docs/isolation/evidence/execution-engine-gate.json

reference/n8n: unmodified (15050 files, root digest f8da35180669d798…)
```
