# n8n lego — application roadmap

Goal (owner decision, 2026-09-21): the project ships as an **installable
application** with the **real n8n editor UI**, under the name **n8n lego**.
Rust work is paused until the app is downloadable and installable; the LEGO
engine stays the execution backend and the Rust port resumes afterwards.

Status legend: ✅ done · 🔄 in progress · ⏳ planned

---

## 1. Application (make it run) — ✅ runnable

| Item | State | Evidence |
| :--- | :--- | :--- |
| App skeleton `apps/n8n-lego` (`n8n-lego` package, CLI `n8n-lego`) | ✅ | `npm run lego:start` |
| Real editor UI served + templated (`%CONFIG_TAGS%`, `BASE_PATH`) | ✅ | `GET /` returns the n8n UI, `<title>n8n lego — Workflow Automation</title>` |
| Node catalog (483 node types, `n8n-nodes-base@2.9.1`) | ✅ | `npm run lego:catalog` → `GET /rest/types/nodes.json` |
| Roles/scopes extracted from reference source (owner = 121 scopes) | ✅ | `scripts/fetch-n8n-roles.mjs` → `GET /rest/roles` |
| Owner setup + login + session cookie | ✅ | `showSetupOnFirstLoad` → `POST /rest/owner/setup` → `GET /rest/login` |
| Workflow CRUD | ✅ | `GET/POST/PATCH/DELETE /rest/workflows` |
| Manual execution through the LEGO engine | ✅ | `POST /rest/workflows/:id/run` → `{ executionId: 1, status: "success" }` |
| Execution history in n8n shape (`resultData.runData`) | ✅ | `GET /rest/executions/:id` |
| `/push` WebSocket (dependency-free) | ✅ | handshake + heartbeat; execution events pending |
| Boot-critical REST surface | ✅ | `/rest/settings` (74 fields, `FrontendSettings` complete) |

### 1.1 Remaining app work (log-driven)

Everything not in the table above is discovered by clicking through the UI: each
miss is logged as `[rest:todo] not implemented yet  {"method":..., "path":...}`.
Known next items, in order:

1. 🔄 **Canvas end-to-end** — confirm drag/drop, node parameters, "Execute step",
   pinned data. Requires live browser verification, then whatever the log lists.
2. ⏳ **Credentials** — `/rest/credentials` CRUD + credential types from
   `credentials.json` (extracted already), encrypted at rest with the instance
   secret.
3. ⏳ **Workflow lifecycle** — activate/deactivate semantics (trigger ownership
   lives in `trigger.lifecycle`, `crates/n8n-workflow/src/trigger.rs`), webhook
   and form endpoints (`endpointWebhook`, `endpointForm` are already published in
   settings).
4. ⏳ **Push events** — broadcast `executionStarted` / `executionFinished` /
   `nodeExecuteAfter` so the canvas lights up during a run.
5. ⏳ **Partial execution** — `runData`, `destinationNode`, `triggerToStartFrom`.
6. ⏳ **Projects/tags/folders** — team projects, `N8N_LEGO_WORKFLOW_TAGS`, folders.
7. ⏳ **Public API `/api/v1`** — reuse the existing baseline implementation
   (`apps/n8n-ts/src/routes/*`).

## 2. Distribution (make it installable) — ⏳ planned

Three channels, same artifact, Linux/VPS first.

| Channel | Deliverable | Notes |
| :--- | :--- | :--- |
| **npm** | publish `n8n-lego` with `bin: n8n-lego`; postinstall runs the catalog fetch | `npm i -g n8n-lego` → `n8n-lego start`, like upstream n8n |
| **Docker** | `deploy/docker/Dockerfile` + compose service on 5678, volume for `N8N_LEGO_USER_FOLDER` | reuse `deploy/docker/` scaffolding |
| **Tarball + installer** | `scripts/install.sh` (exists for the TS baseline) adapted to stage the app, data dir and optional systemd unit | `deploy/systemd/*.service` exists; add `n8n-lego.service` |

Per-channel checklist:

1. ⏳ Versioning: single source of truth `apps/n8n-lego/package.json`; reference
   version (`2.9.4`) and node catalog version (`2.9.1`) recorded in
   `version --json` and in `/rest/settings.versionCli`.
2. ⏳ `npm pack` sanity: `files` list must include `src/`, `bin/`, README — and
   **not** `node_modules/` or the extracted catalog (fetched per install).
3. ⏳ Installer hardening: non-root user, `N8N_LEGO_USER_FOLDER=/var/lib/n8n-lego`,
   systemd `Restart=always`, journald log format.
4. ⏳ Upgrade path: keep `workflows.json`/`executions.json` schema additive; the
   `roundtrip` test in §4 guards it.
5. ⏳ Docker: multi-stage (install UI + catalog at build time so the container
   starts without network access).
6. ⏳ Offline install (VPS without registry access): ship a prebuilt tarball with
   `node_modules/n8n-editor-ui` and the catalog included (measured: UI 152 MB
   unpacked, catalog 7.8 MB → tar.gz ≈ 40 MB).

## 3. Rename to "n8n lego" — 🔄 started

Public identity is already `n8n lego` (app name, package `n8n-lego`, CLI, UI
title, log lines). The full rename also covers internal identifiers; those are
list-risky, so they are staged and must be verified by a Rust build (see §3.2).

### 3.1 Done

| Area | Before | After |
| :--- | :--- | :--- |
| App directory | — | `apps/n8n-lego` |
| App package | — | `n8n-lego@0.1.0` |
| CLI | — | `n8n-lego start \| doctor \| version` |
| UI title / application-name | `n8n.io - Workflow Automation` | `n8n lego — Workflow Automation` |
| Log/service name | `n8n-ts-runtime` | `n8n-lego` |
| Docs | — | `docs/n8n-lego/ROADMAP.md`, `apps/n8n-lego/README.md` |

### 3.2 Staged (needs `cargo check` before merge)

| Area | Count | Change | Risk |
| :--- | :--- | :--- | :--- |
| Rust crates | 8 | `n8n-*` → `lego-*` (dir, `Cargo.toml` name, `use` paths, workspace members) | mechanical but compile-verified only by CI |
| LEGO ids in registry | 12 + 21 | `workflow` → `lego-workflow` etc. in `.arena/registry/*.yaml` | must be changed together with `tools/sublego-audit`, `tests/integration/boundary_audit.py`, ownership policy |
| Contracts | 30 | `contracts/*.contract.md` renames + cross-references | referenced from docs, gates and code comments |
| Baseline app | 1 | `apps/n8n-ts` → `apps/n8n-ts-baseline` (or archive) | `package.json` scripts and docs point at it |

Rules for §3.2:
* one mechanical script, `--dry-run` first, full file list in the PR body;
* registry + audit tooling updated **in the same commit** or
  `npm run lego:audit` fails;
* Rust identifiers renamed only in a commit whose CI run compiles clean — the
  sandbox has no Rust toolchain, so this must not land unverified on `main`.

## 4. Quality gates

| Gate | Command | Status |
| :--- | :--- | :--- |
| Environment | `npm run lego:doctor` | ✅ |
| App unit tests | `npm run lego:test` | ⏳ first tests being added |
| REST smoke (boot → setup → workflow → run → execution) | `apps/n8n-lego/test/rest.test.mjs` | ⏳ |
| UI smoke (headless: `/`, `/rest/settings`, `/rest/types/nodes.json`) | — | ⏳ |
| Registry/architecture audit | `python3 tools/sublego-audit/audit.py` | ✅ (unchanged by this work) |

## 5. Order of work

1. 🔄 Finish §1.1 items 1–4 → the UI is usable end-to-end (create, run, inspect).
2. ⏳ §2 npm channel → `npm i -g n8n-lego` works.
3. ⏳ §2 tarball + systemd → installable on a 2 GB VPS.
4. ⏳ §2 Docker.
5. ⏳ §3.2 rename, once CI can verify the Rust build.
6. ⏳ Resume the Rust port on top of the working app (Phase 3 continues with a
   green app as the behavioural baseline).
