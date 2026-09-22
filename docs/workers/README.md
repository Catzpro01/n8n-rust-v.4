# Worker Plan — TypeScript LEGO Baseline (Phase TS-1)

Manager: **integration authority** (this session). Workers: 4 parallel work streams defined below.
Contract (frozen, read first): [`contracts/runtime-api.contract.md`](../../contracts/runtime-api.contract.md).

## 0. Operating rules (all workers)

| Rule | Detail |
| :--- | :--- |
| Scope isolation | A worker edits **only** the paths in its `ALLOWED` list. `FORBIDDEN` paths are absolute — a change there rejects the whole PR. |
| One engine rule | `apps/n8n-ts` consumes `packages/reconstructed-engine/index.mjs`. No second execution engine, ever. |
| Rust freeze | `crates/**`, `apps/n8n-rust/**`, `Cargo.*` are untouched. No new Rust. |
| Control plane | `tools/arena-*/**`, `deploy/systemd/arena-*.service`, `deploy/supabase/**`, `.arena/**` untouched. |
| Reference | `reference/n8n/**` untouched (read-only behavioural reference). |
| Golden data | `tests/reference/**` untouched. Runtime fixtures live in `tests/runtime/fixtures/`. |
| No new deps | Runtime uses Node built-ins only; `typescript` is allowed as a devDependency. |
| Evidence | Every PR records: commands run, observed output, and the acceptance criteria it closes. |

## 1. Work streams

| Worker | Stream | Branch | ALLOWED | FORBIDDEN |
| :--- | :--- | :--- | :--- | :--- |
| **W1** | Runtime server (`apps/n8n-ts/**`) | `runtime-kernel/ts1-runtime-server` | `apps/n8n-ts/**` | everything else |
| **W2** | Packaging (`deploy/docker/**`, `scripts/{install,start,stop,upgrade,rollback,doctor}.sh`, `scripts/lib/**`, `.env.example`, `deploy/systemd/n8n-ts-runtime.service`) | `infrastructure-orchestration/ts1-packaging` | the listed paths | `apps/**`, `packages/**`, `tests/**`, existing `scripts/arena/**`, `scripts/run-lego-tests.sh`, existing systemd units |
| **W3** | Testing (`tests/runtime/**`, `tests/integration/runtime_*`, `tests/fixtures/runtime/**`) | `verification/ts1-runtime-tests` | the listed paths | `apps/**`, `packages/**`, existing files under `tests/integration/` |
| **W4** | LEGO integration (`packages/reconstructed-engine/**`, `docs/lego-integration.md`) | `data-plane/ts1-lego-integration` | the listed paths | `packages/workflow-lego/src/**`, `packages/execution-lego/src/**` (audit only), `apps/**`, `tests/**` |

### Dependency order

```
contracts/runtime-api.contract.md   (manager, FROZEN — done)
        │
        ▼
W4  engine entrypoint + registry ───────────► W1 runtime server ──► W3 tests ──► W2 packaging
        (provides §5 exports)                   (needs §5 exports)     (needs W1)   (needs W1+W3)
```

W4 unblocks W1. W3 and W2 follow W1. Any worker that finds a contract gap reports it to the
manager instead of inventing a private interface (see `docs/workers/CONTRACT-REQUESTS.md`).

## 2. Definition of Done (per worker)

1. All `ALLOWED` paths implemented, nothing outside them touched (`git diff --name-only` in the PR).
2. Worker's own tests green (`node --test …`), plus no regression in the manager gate:
   `npm run runtime:gate`.
3. Docs updated inside the worker's scope (README in the worker's directory).
4. PR opened with: scope table, evidence block, acceptance criteria closed, and the exact commands to reproduce.
5. Worker never merges, never pushes to `main`, never rewrites another worker's files.

## 3. Stream briefs

| File | Worker |
| :--- | :--- |
| [`W1-runtime-server.md`](W1-runtime-server.md) | HTTP runtime server + operator console |
| [`W2-packaging.md`](W2-packaging.md) | install/start/stop/upgrade/rollback/doctor + Docker + systemd |
| [`W3-testing.md`](W3-testing.md) | real-process test suite + fixtures |
| [`W4-lego-integration.md`](W4-lego-integration.md) | engine entrypoint, node registry, LEGO audit |

## 4. Integration (manager only)

```
W1..W4 PRs → contract review → boundary overlap check → progressive merge →
CI (local gate + GitHub Actions) → laptop build/test → VPS deploy (vps-runtime) → live smoke
```

`BASELINE FROZEN` is declared **only** by the user, after all §6 acceptance criteria of the contract pass.
