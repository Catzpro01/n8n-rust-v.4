# DEC-0019 follow-up: legacy multi-agent tooling removed

Program: GOVERNANCE (#256). Executor: Manager (DEC-0019). Owner request (chat, 2026-09-25): "hapus sisa kode lama".

## Removed (everything stays in git history)

- **Task-distribution engine:**
  - `tools/workforce/src/{engine,core,domain,store,recovery,render,scheduler}.mjs` and their tests;
  - `docs/engineering-operations/workforce/policy.json`;
  - every object schema except `decision.schema.json`.
- **Legacy agent runtime:**
  - `tools/arena-bridge`, `tools/arena-executor`, `tools/gateway`;
  - `deploy/systemd/arena-{bridge,executor}.service`;
  - `scripts/arena/`, `switch_arena_branch.sh`, `tests/arena/`.
- **Supabase control plane:**
  - `tools/orchestration/control_plane.py`, `report_ci_status.py` and the worker/supervisor/scheduler daemons (all of `tools/orchestration` except `cleanup_runner.py`, its test, and `setup_laptop_runner.ps1`, which installs the GitHub Actions runners);
  - `supabase/migrations`, `deploy/supabase`, `supabase_client.py`;
  - the Supabase variables in `.env.example`.
- **CI:**
  - the three "Report ... Status to Supabase" steps (validation, integration, audit), which only reported and gated nothing;
  - the Supabase secrets passed to `cleanup.yml`;
  - `audit.yml` + `audit_runner.py`. That job compared the diff with the agent task file `.arena/TASK.md`; without that file it always passed. Architecture enforcement stays in `n8n-lego.yml` (lego:arch, lego:foundation, capabilities, scale-out, contract gates).
- **Agent docs:**
  - `AGENT_CONNECT_GUIDE.md`, `AGENT_INSTRUCTION.md`, `my_progress.md`;
  - `docs/orchestration/`;
  - `.arena/registry/agents.yaml`.

Files deleted: 132.

## Kept

- **Governance tools:**
  - decision records and `decisions-check`;
  - the DEC-0015 merge verdict (`tools/workforce/src/checks.mjs`, CLI `checks`);
  - `cleanup_runner.py`, with its optional Supabase mirroring removed; it now needs only git.
- **Historical material** (history is not rewritten):
  - evidence and reports;
  - `.arena/tasks`, `.arena/progress`, `.arena/bootstrap`, `results/`;
  - the DEC records.

## Tests (observed, Manager sandbox)

- workforce 7/7:
  - checks classifier;
  - decision records;
  - a new invariant that the removed engine/runtime paths stay absent.
- `tools/orchestration/test_cleanup_runner.py` 24/24:
  - 5 legacy control-plane tests replaced by 1 test proving that cleanup needs only git;
  - pyflakes clean.
- backend `apps/n8n-lego`: 2422/2422.
- frontend: 451 pass, 0 fail, 1 skip.
- gates: lego:arch, lego:arch:selftest, lego:foundation, lego:foundation:selftest, lego:capabilities, lego:scaleout and lego:ai:check all PASS.

## Finding

`main` has no branch protection and no rulesets (GitHub API: "Branch not protected"). This is reported to the owner and not changed here.
