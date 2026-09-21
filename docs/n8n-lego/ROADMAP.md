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
| `/push` WebSocket at `/rest/push` (dependency-free) | ✅ | `executionStarted` / `executionFinished` broadcast on run |
| Boot-critical REST surface | ✅ | `/rest/settings` (74 fields, `FrontendSettings` complete) |
| **Canvas end-to-end verified in a real browser** | ✅ | headless Chromium: sign-in → `/workflow/new` → *Add first step* → node picked from the creator → save (`POST` + `PATCH /rest/workflows`) → *Execute workflow* → execution recorded |
| Credentials CRUD (`/rest/credentials*`) | ✅ | create/list/get/patch/delete + `/new` name generator + `/test` stub |
| Projects + per-resource scopes | ✅ | without `scopes` on project/workflow payloads the editor renders the canvas read-only |
| Workflow checksum + conflict detection | ✅ | SHA-256 over content fields; `expectedChecksum` mismatch → n8n's conflict error |
| Node icons `/icons/*` | ✅ | 362 icons extracted from `n8n-nodes-base`; unknown paths get a neutral glyph |

### 1.1 Remaining app work (log-driven)

Everything not in the table above is discovered by clicking through the UI: each
miss is logged as `[rest:todo] not implemented yet  {"method":..., "path":...}`.

Verified working from the canvas (headless Chromium against a live server):
sign-in, workflow list, node palette search, adding nodes, saving, executing,
execution history, node icons. Remaining items, in order:

1. ⏳ **Credentials at rest** — stored as plain JSON today; encrypt with the
   instance secret (`data/n8n-lego/.instance.json`) before this leaves a
   single-user box.
2. ⏳ **Credential test** — `/rest/credentials/test` returns a canned OK; real
   testing needs per-type handlers.
3. ⏳ **Node-parameters** — `/rest/dynamic-node-parameters/*` (dropdowns,
   resource locators) currently answered by the `[rest:todo]` fallback.
4. ⏳ **Workflow lifecycle** — activation semantics for triggers (webhook/form
   endpoints are already published in settings but not routed yet).
5. ⏳ **Partial execution** — `runData`, `destinationNode`, `triggerToStartFrom`
   ("Execute step" on a single node).
6. ⏳ **Push events during a run** — `nodeExecuteAfter` so nodes light up live
   instead of after `executionFinished` (the canvas already refreshes on finish).
7. ⏳ **Projects/tags/folders** — team projects, folders; tags work, sharing does
   not.
8. ⏳ **Public API `/api/v1`** — reuse the existing baseline implementation
   (`apps/n8n-ts/src/routes/*`).

## 2. Distribution (make it installable) — ✅ all three channels built and verified

Three channels, one release script, Linux/VPS first. Every channel below was
installed and started for real (npm global install into a clean prefix, tarball
into `/tmp/lego-app` with a throwaway data dir, and the Docker image layout
reproduced step by step — no docker binary in this sandbox, so the image itself is
author-only).

| Channel | Deliverable | Verified |
| :--- | :--- | :--- |
| **npm** | `n8n-lego` package, `bin: n8n-lego`, engine vendored into `vendor/`, catalog fetched on first boot | `npm i -g n8n-lego` → `n8n-lego start` → `/healthz` ok, editor + setup screen |
| **Docker** | root `Dockerfile` (multi-stage, non-root, catalog baked in, healthcheck) + `docker-compose.yml` + entrypoint | build sequence reproduced locally: `npm ci --omit=dev` → `catalog` → `start` → `/healthz` ok |
| **Tarball + installer** | `apps/n8n-lego/scripts/install-tarball.sh` (staged as `install.sh`), `deploy/systemd/n8n-lego.service`, editor UI vendored | `bash install.sh --no-systemd` → files + catalog + data dir, server serves the setup screen |
| **One release script** | `scripts/release.sh` (`--npm-only`, `--no-docker`, `--tag`, `--out`) | `dist/n8n-lego-<version>.tgz`, `dist/n8n-lego-<version>.tar.gz` (+sha256), docker image |

Notes:

- The catalog is **not** committed (8 MB): `n8n-lego catalog` writes it into the
  user folder; `start` fetches it when missing (`--no-fetch` keeps boot offline).
- `N8N_LEGO_USER_FOLDER` defaults to `~/.n8n-lego`, so a global install never
  writes inside its own package directory.
- The tarball vendors the editor UI, so a VPS install needs no npm registry; the
  npm package resolves it from the registry as a normal dependency.

Per-channel checklist:

1. ✅ Versioning: single source of truth `apps/n8n-lego/package.json`; reference
   version (`2.9.4`) and node catalog version (`2.9.1`) recorded in
   `version --json` and in `/rest/settings.versionCli`.
2. ✅ `npm pack` sanity: `files` = `bin/ src/ scripts/ data/ vendor/ README
   LICENSE` — 43 files, 88 kB; no `node_modules/` and no extracted catalog.
3. ✅ Installer hardening: non-root user, `N8N_LEGO_USER_FOLDER=/var/lib/n8n-lego`,
   systemd `Restart=always`, journald log format.
4. ⏳ Upgrade path: keep `workflows.json`/`executions.json` schema additive; the
   `roundtrip` test in §4 guards it.
5. ✅ Docker: multi-stage (install UI + catalog at build time so the container
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
