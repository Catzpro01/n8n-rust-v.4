# Governance records (formerly: workforce control plane)

> **DEC-0019 (owner):** the Manager executes every task itself. There are no agent branches, no worker slots and no
> task-distribution engine. Persistent branches are `main` and `arena-manager` only (see `.arena/RULES.md`).

The task-distribution engine that used to live here was removed after DEC-0019. It had 10 worker slots
(AGENT-01..10) plus a task graph, reservations, leases, a scheduler, a merge queue, an event store and recovery.
The legacy agent runtime around it was removed too:
- `tools/arena-bridge`, `tools/arena-executor`, `tools/gateway`;
- the Supabase control plane and its migrations;
- the Python worker daemons in `tools/orchestration`.

All of it remains in git history.

What remains:

| What | Where |
|---|---|
| Decision records (canonical, immutable; replacement uses `supersedes`) | `decisions/DEC-nnnn.json` |
| Decision record shape | `schemas/decision.schema.json` |
| Validator + CLI | `tools/workforce/src/{schema,cli}.mjs`, run `node tools/workforce/src/cli.mjs decisions-check` |
| DEC-0015 merge verdict (GitHub-hosted vs self-hosted checks, WAITING_RUNNER is never PASS) | `tools/workforce/src/checks.mjs`, run `node tools/workforce/src/cli.mjs checks <jobs.json>` |
| Tests (run in CI by `n8n-lego.yml`) | `tools/workforce/test/*.test.mjs` |
| Live milestone progress (DEC-0021) | `tools/lego/progress-event.mjs`, run `node tools/lego/progress-event.mjs record --slice <id> --checkpoint <CP-nn> --status <status> --evidence <ref>` |
| Post-merge branch cleanup | `tools/orchestration/cleanup_runner.py` (`.github/workflows/cleanup.yml`) |

Rules that still apply:
- DEC-0014: one delivery PR per Slice and the 8 completion gates.
- DEC-0015: runner verification; WAITING_RUNNER is never PASS.
- DEC-0009: the Manager credential stays environment-only.
- DEC-0020: milestone truth is Main-Owned; README.md and `.ai/` are generated
  projections of `docs/n8n-lego/milestones.json` on `main`.
- DEC-0021 (LIVE-MILESTONE EXCEPTION): milestone progress telemetry may be
  committed straight to `main` by the Manager in a `governance(progress):` commit
  (`tools/lego/progress-event.mjs`), one measurable event per commit. The
  exception is telemetry only — source, tests, runtime, API, contracts,
  schemas, dependencies, Rust, CI workflows, security policy, permissions,
  infrastructure, database schema and production configuration still go through a
  delivery PR — and it never bypasses a Slice completion gate.

This is governance tooling. It is not product code and never appears in the product manifests.
