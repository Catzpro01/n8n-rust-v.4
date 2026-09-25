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
| Post-merge branch cleanup | `tools/orchestration/cleanup_runner.py` (`.github/workflows/cleanup.yml`) |

Rules that still apply:
- DEC-0014: one delivery PR per Slice and the 8 completion gates.
- DEC-0015: runner verification; WAITING_RUNNER is never PASS.
- DEC-0009: the Manager credential stays environment-only.

This is governance tooling. It is not product code and never appears in the product manifests.
