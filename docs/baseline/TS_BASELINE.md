# TypeScript LEGO Baseline

Status: **IN PROGRESS** (not frozen until manager acceptance)

## Goal

Usable TypeScript baseline that is easy to install, run, tweak, upgrade, and debug on a VPS — before migrating LEGOs to Rust one-by-one.

## Contract

[`contracts/ts-runtime-baseline.contract.md`](../../contracts/ts-runtime-baseline.contract.md)

## Layout

| Path | Owner |
|------|--------|
| `apps/n8n-ts/**` | Runtime HTTP server |
| `apps/n8n-ts/lib/engine-adapter.mjs` | LEGO integration (single engine) |
| `packages/reconstructed-engine` | DAG execution engine |
| `packages/execution-lego` | Execution runtime ports (re-export) |
| `packages/workflow-lego` | Workflow model LEGO |
| `deploy/docker/*n8n-ts*` | Container packaging |
| `scripts/{install,start,stop,upgrade,rollback,doctor}.sh` | Ops scripts |
| `tests/runtime/**` | Real HTTP tests |

## Ops

```bash
./scripts/install.sh
./scripts/start.sh
curl -s localhost:5678/healthz
./scripts/doctor.sh
./scripts/stop.sh
```

Docker:

```bash
docker compose -f deploy/docker/docker-compose.n8n-ts.yml up -d --build
```

## Freeze gate

Manager declares `TYPESCRIPT BASELINE FROZEN` only after:

1. install → start → healthz
2. workflow run success
3. runtime tests green
4. no Rust tree changes
5. VPS smoke (when runner available)

Until then: **not frozen**.
