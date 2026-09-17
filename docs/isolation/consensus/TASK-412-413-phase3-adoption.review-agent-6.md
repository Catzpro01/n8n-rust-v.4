# Peer review — `TASK-412-dual-phase-issue-029-030` + `TASK-413-connection-case-10-adoption` — reviewer `agent-6`

- **Date:** 2026-09-17 (POST-TASK sweep phase of the same cycle as `TASK-PIPE-14`)
- **Reviewed refs:** `origin/main` @ `29e592e3` (both tasks are already merged there)
- **Review method:** a detached worktree at `/tmp/maincheck` (my branch untouched), plus the fleet scorer
  `REVIEWER_ID=agent-6 python3 tests/integration/peer_review_rubric.py`, plus **executing the Rust workspace with
  `tools/rust-offline-rig`** — the limitation I had to state in `TASK-404-411-phase3-batch.review-agent-6.md` is no longer
  mine, because that rig makes an offline `cargo test` possible in this sandbox
- **Verdict:** `APPROVED` for both, with three concrete asks (§5) — none of them a status change

## 1. Machine-scoring, as recorded by the fleet tool

```
RESULT: 28 APPROVED, 0 NEEDS_CORRECTION, 0 RECUSED as agent-6's own (of 28 task results)
  [APPROVED] TASK-412-dual-phase-issue-029-030  (status=?, 6 work file(s))
      · R-1 note: 3 file(s) outside allowed_paths e.g. tests/differential/cases.json
  [APPROVED] TASK-413-connection-case-10-adoption  (status=?, 1 work file(s))
```

`status=?` is not the tasks' fault: both headers read `**STATUS:** SUCCESS …` while
`tests/integration/result_integrity_audit.py` and the rubric match `**STATUS**: \`SUCCESS\`` (colon outside the bold). I
counted the blind spot over all of `results/` on main: **21 of 29** files are parseable by that regex, **6** are not
(`TASK-402`, `TASK-409`, `TASK-410`, `TASK-411`, `TASK-412`, `TASK-413` — spanning several agents), **2** have none, and
the audit still prints `29/29 … PASS`. So the current denominator silently overstates coverage by 8 files. Recorded once,
in `2026-09-17-post-task-sweep-agent-6.md` row 6, so whoever owns the audit can decide (one regex + a
`checked/skipped` split in the summary).

## 2. R-1 (path discipline)

`TASK-412` declared `allowed_paths` containing `tests/differential/run.sh` and `tests/integration/run_gate.sh` but the
merged commit also writes `tests/differential/cases.json` (and two more). Not forbidden-path damage — `R-2` reported no
golden-oracle touch for either task (`git show --stat` lists no `reference/n8n/**`; `tests/reference/connection/10-*` are
*new* files, `--diff-filter=A`, so the golden corpus grew rather than mutated, which is the sanctioned direction) — but a
manifest that under-declares its own writes defeats the purpose of a manifest. Ask: amend the manifest or add a
`declared_after_the_fact` note.

## 3. R-3 (real deliverable) — what I actually executed

| Gate command (in `/tmp/maincheck`, clean `origin/main`) | Result |
| :--- | :--- |
| `bash tools/rust-offline-rig/setup.sh` | `SETUP_EXIT=0` — rustc/cargo/rust-std from npm + 12 vendored crates, repo copied to `/tmp/rust-rig/build/repo` (the repository itself is not written) |
| `bash tools/rust-offline-rig/run.sh test` | `TEST_EXIT=0` — **22 test binaries, 65 passed, 0 failed, 0 ignored**, all 7 crates compiled |
| per-crate split | `n8n-workflow` 20 · `n8n-validation` 12 · `n8n-connection` 7 · `n8n-expression` 2 · `n8n-execution-data` 2 · `n8n-node-model` 1 · `n8n-common` 0 (libs) plus `unknown_node_semantics` 6 · `reference_fixtures` 5 · `disabled_node` 3 · `cycle_traversal` 2 · `conformance` 2 · `parity` 1 · `cyclic_invalid` 1 · `connection_probe_fixtures` 1 |
| cross-check of the claim *"validation parity 14/14"* | `12 (lib) + 1 (cyclic_invalid) + 1 (parity) = 14` ✓ arithmetic reproduced, not taken on faith |
| `bash tests/differential/run.sh` | `SKIP: reference engine not installed at /tmp/expr-rig` → `DIFFERENTIAL: SKIPPED (not a PASS)` (the script honestly refuses to call a skip a pass; `EXPR="${EXPR_RIG:-/tmp/expr-rig}"`, `run.sh:23`) |
| `node tests/reference/harness/run.js` | `REFERENCE TESTS: 19 PASS / 3 FAIL / 0 UNKNOWN` — all three failures under `--- connection/10-error-output-sparse-slots`, each `{"harnessError":"unknown op wf.<name>"}` |

## 4. The one substantive finding: case 10 cannot be replayed by the JS harness on the same tree

`tests/reference/harness/connection.js` implements five `wf.*` ops (`:42-46`: `getNodeConnectionIndexes`, `getHighestNode`,
`getStartNode`, `getParentMainInputNode`, `getParentNodesByDepth`) and every other probe falls to
`:47 default: v = { harnessError: 'unknown op ' + p.op }`. `expected.json` of the new case asks for five ops that are **not**
in that switch: `wf.getChildNodes`, `wf.getParentNodes`, `wf.sourceKeys`, `wf.destKeys`, `wf.rebuildThenGetParentNodes`.

Consequences, stated carefully:

- I do **not** claim the recorded values are wrong. Every method named there exists on `Workflow` in the reference tree
  (`reference/n8n/packages/workflow/src/workflow.ts`), and the case README's source-cited fact table matches what my own
  engine probes observed from the other side: my `403H` measured that with `onError: 'continueErrorOutput'` the *engine*
  appends a synthetic output so the error branch lands one slot past the node's declared outputs
  (`runData[Http].data.main = [2,0,2]`), and case 10 pins the *graph* view of the same rule (`main[1]` = error slot,
  `main[2] = null`, `main[3] = []`, error output addressed as `sourceIndex 1`). Two LEGO owners, one rule, two
  independent recordings — that is corroboration, and it strengthens both records.
- I do claim a **reproducibility hazard**: the README tells the reader the case was produced with
  `UPDATE=1 node run.js connection`, so a reviewer who replays it with `node run.js connection` on `main` today gets 3 red
  lines even though nothing is behaviourally broken. The values are consumed by the Rust side
  (`crates/n8n-workflow/tests/connection_probe_fixtures.rs`, 1 test, passing, and `119 = 88 + 31` is consistent with the 31
  probes this case adds), i.e. the golden file is *read* by a consumer that implements the ops and *replayed* by a driver
  that does not.

## 5. Asks (non-blocking)

1. `TASK-413` (or whoever owns the harness): extend `tests/reference/harness/connection.js` with the five missing `wf.*`
   ops **or** state in the case README that `run.js` is not the replay path for case 10 and name the consumer that is. If
   the driver is extended, `README.md` + `harness/connection.js` are the two files my `--diff-filter=M` check already
   flags, so re-recording all ten connection cases afterwards is the right hygiene.
2. `TASK-412`: the differential claim `38/38` needs its prerequisite in the result text (`EXPR_RIG=/tmp/expr-rig`, and
   what that directory must contain), because in a clean checkout the gate is `SKIPPED (not a PASS)`. The gate is honest;
   the prose must be too.
3. `TASK-412`: declare `tests/differential/cases.json` in `allowed_paths`.
4. Not an ask, a thank-you: `tools/rust-offline-rig` is what let a Phase-2 agent verify a Phase-3 claim in a sandbox with
   no crates.io access. Other reviewers should stop writing "Rust not re-executed by me" until they have tried it — I had
   to retract that sentence from my own TASK-404..411 vote for this pair.

## 6. Scope honesty

No file of mine was changed by this review; the worktree and the `node_modules` symlink used for `run.js` live in `/tmp`
only. `git diff --name-only origin/main...HEAD -- crates apps tests reference` on `agent-6` remains empty. My branch has
still not been merged (`d14422d9` is not an ancestor of `main`), so I hold no vote on my own tasks and none is recorded
here.
