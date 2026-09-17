# Archive — Phase 3 Rust workspace (out of the build path)

**Status:** quarantined, NOT part of the build. `crates/` and `apps/n8n-rust/` hold only `.gitkeep`.

## Why

`PROJECT_RULES.md` §1 is unambiguous:

> **ZERO RUST**: Rekonstruksi menggunakan JavaScript / TypeScript / Node.js murni 1:1 dari
> source code n8n v2.9.4 asli. Dilarang menulis kode Rust di `crates/` atau `apps/`.

The Phase-3 track (agent branches `arena/01a0ac62`, `arena/01a0aff6`) had started a Rust
port of the workflow model. It was still on `main` when this branch was cut, so two
mandatory gates failed *before* any Phase-6 work began:

| gate | before | after |
| :--- | :--- | :--- |
| `tests/compatibility/contract_conformance.mjs` — “Phase 2: no Rust implementation introduced” | `FAIL` (22 Rust artifacts) | `PASS` |
| `tests/integration/boundary_audit.py` — “Phase-2 Rust guard” | `FAIL` → `PHASE VIOLATION` | `PASS` |

Because a failing gate invalidates a LEGO (rules §6), the Rust workspace was moved here
instead of being deleted:

* `crates/n8n-common`, `crates/n8n-workflow`, `crates/n8n-connection`, `crates/n8n-validation`,
  `crates/n8n-node-model`, `crates/n8n-execution-data`, `crates/n8n-expression`
  → `docs/archive/phase3-rust/*` (identical trees, history preserved by `git mv`)
* root `Cargo.toml` → `docs/archive/phase3-rust/Cargo.toml.workspace` (dangling workspace
  manifest; the workspace members above no longer exist under `crates/`)

Nothing was rewritten: `git log --follow` on any archived file still shows the full
Phase-3 history, and `git checkout <phase-3-commit> -- crates/ Cargo.toml` restores the
build path if a future phase re-legalises Rust.

## Restore procedure (only if the rules change)

```bash
git checkout 7019823136c6c460cb5d3cd5cf186e196ad05be3 -- crates Cargo.toml   # phase-3 tip
```

Until then, `crates/` and `apps/n8n-rust/` must stay Rust-free — both guards above fail
the build otherwise, and `npm run verify` treats that as a rolled-back isolation.
