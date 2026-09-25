# AGENT-01 progress

Task: TASK-0018 — cleanup.yml: do not abort when main has advanced past the merge commit; never delete permanent branches
Status: READY_FOR_REVIEW
Started: 2026-09-25T10:55:53.584Z

## Done
- Read `.arena/RULES.md`, `.arena/AGENT_RULES.md`, `.arena/task.md`, `.arena/WORKFLOW.md`.
- Analysed the failure: `cleanup.yml` checks out `main` with `fetch-depth: 1`; when another PR merged in
  between, `merge_commit_sha` is behind the shallow boundary, `git cat-file -t` fails, the runner's
  `git fetch origin main` cannot reach it either (same boundary) and the job aborts on `main`.
- Found a second defect: in `cleanup_runner.py` the `git push origin --delete` is nested inside the
  Supabase "task found" block, and the only protected names are `main`/`master` — an `arena/agent-NN`
  workspace or `arena-manager` as PR head would be deleted.
- Confirmed remote branch layout (`git ls-remote --heads origin`): permanent = `main`, `arena-manager`,
  `arena/agent-01..10`; Slice PR heads = `arena/manager/<slice>`; repo `delete_branch_on_merge=false`.

- Rewrote `tools/orchestration/cleanup_runner.py`: merge-commit recovery (fetch main → deepen 50/500 →
  explicit SHA fetch → unshallow) + ancestry proof against `refs/remotes/origin/main`; permanent-branch
  refusal (`main`, `master`, `arena-manager`, `arena/agent-NN`); already-gone detection (`ls-remote
  --exit-code`, GitHub's "remote ref does not exist"); control plane best-effort (DEC-0017); redacted logs;
  `--dry-run`, `--remote`, `--main-branch`; `main()` returns the exit code (testable).
- Updated `.github/workflows/cleanup.yml`: `fetch-depth: 0`, `permissions: contents: write`, quoted env,
  `--skip-tests` (the previous step already runs the same cargo commands). `runs-on` and secret env
  references unchanged.
- Wrote `tools/orchestration/test_cleanup_runner.py`: 28 tests, temp `file://` bare remotes + scripted git;
  no network, no secrets, no cargo.
- Real-world check (read-only, `--dry-run`, fresh depth-1 clone of GitHub `main` @ 947cd395): old runner
  aborts for PR #297 (merge 953ddfbd, main advanced by PR #298) with rc=1; new runner: "verified after
  deepening origin/main by 50 commits", rc=0. PR #292 head (already deleted) → ALREADY_GONE rc=0.
  `arena/agent-01` as head → PROTECTED rc=0. Remote heads unchanged.

- Evidence written to `.arena/evidence/TASK-0018.md`; status → READY_FOR_REVIEW.

## Remaining
- Manager review / integration into the GOVERNANCE Slice PR. First real run of the workflow happens on the
  next merged PR after integration (cannot be triggered from here).

## Evidence
- commit b55da97b: runner + workflow + tests (see `.arena/evidence/TASK-0018.md`)
- tests: `python3 -m pytest -q tools/orchestration/test_cleanup_runner.py` → 28 passed (observed)
- tests: `python3 -m py_compile tools/orchestration/cleanup_runner.py` → OK (observed)
- Environment note: this Arena session runs on branch `arena/01a0d83c-n8n-rust-v-4` (branched from
  `arena/agent-01` @ c29417ae); `npm run arena:task -- lint` therefore reports only the two branch-name
  checks (`not an agent branch`, `task belongs to arena/agent-01`). Content checks are verified separately.
