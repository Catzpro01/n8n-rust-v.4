# AGENT-01 progress

Task: TASK-0018 — cleanup.yml: do not abort when main has advanced past the merge commit; never delete permanent branches
Status: WORKING
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

## Remaining
- Rewrite `tools/orchestration/cleanup_runner.py` (merge-commit recovery: fetch main → deepen → explicit
  SHA fetch → unshallow; ancestry check against `refs/remotes/origin/main`; permanent-branch refusal;
  already-gone detection; secret-safe logging).
- Update `.github/workflows/cleanup.yml` (deep checkout, explicit `contents: write`, quoted env, `--skip-tests`
  because the previous step already ran the same cargo commands; secret names unchanged).
- Write `tools/orchestration/test_cleanup_runner.py` (fake git runner + real local temp repos; no network,
  no secrets) covering advanced-main, permanent-branch refusal, already-deleted, non-existent SHA.
- Evidence file `.arena/evidence/TASK-0018.md`, status → READY_FOR_REVIEW.

## Evidence
- Environment note: this Arena session runs on branch `arena/01a0d83c-n8n-rust-v-4` (branched from
  `arena/agent-01` @ c29417ae); `npm run arena:task -- lint` therefore reports only the two branch-name
  checks (`not an agent branch`, `task belongs to arena/agent-01`). Content checks are verified separately.
