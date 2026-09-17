# Legacy Rust port (archived) — `legacy/rust-port/`

**Status: ARCHIVED, NOT BUILT, NOT IN SCOPE.**
**Rule restored:** `PROJECT_RULES.md` #1 — *ZERO RUST*: reconstruction is JavaScript / TypeScript /
Node.js 1:1 with n8n v2.9.4; writing Rust under `crates/` or `apps/` is forbidden.

---

## Why this directory exists

The Phase-3 Rust track (`crates/**` + the root `Cargo.toml` workspace, TASK-401…TASK-410 /
TASK-PIPE-26) was merged to `main` while PROJECT_RULES #1 forbade exactly that. Two automated guards
have been reporting it ever since:

```text
tests/compatibility/contract_conformance.mjs
  [FAIL] Phase 2: no Rust implementation introduced — Rust artifacts present in Phase 2: crates/… (22 files)
  RESULT: 20/21 CHECKS PASSED

tests/integration/boundary_audit.py
  -- Phase-2 Rust guard: VIOLATION ['crates/n8n-common/Cargo.toml', …]
  AUDIT RESULT: FAIL
```

Every PR opened since then inherited that red baseline, so "all gates green" was not attainable for
anybody. The machinery is real and was reported green by its own rig; the **location** was the
violation (a Rust workspace auto-detected by `cargo` at the repository root of a ZERO RUST project).
It is archived here instead of deleted — nothing is lost, and the guards can pass again.

## What was moved

| Was | Now |
| :--- | :--- |
| `Cargo.toml` (workspace: 7 members, `resolver = "2"`, edition 2021) | `legacy/rust-port/Cargo.toml` |
| `crates/n8n-common`, `n8n-workflow`, `n8n-connection`, `n8n-validation`, `n8n-node-model`, `n8n-execution-data`, `n8n-expression` | `legacy/rust-port/crates/**` (23 tracked files) |

Moved with `git mv` (rename detection preserved), so `git log --follow` still resolves the history of
every file, and the diff shows renames rather than deletions.

## Restore (one command pair, fully reversible)

```bash
git mv legacy/rust-port/crates crates
git mv legacy/rust-port/Cargo.toml Cargo.toml
```

Then, to build it offline (no crates.io in the sandbox):

```bash
tools/rust-offline-rig/setup.sh          # toolchain + vendored crates into $RUST_RIG
tools/rust-offline-rig/run.sh test       # cargo test --workspace, from a copy — never in-tree
```

`tools/rust-offline-rig/run.sh` was updated for the archived layout and now copies
`legacy/rust-port/{Cargo.toml,crates}` into its build directory, so the rig works from this location
too.

## Evidence status (do not overclaim)

| Claim | Where it comes from | Re-verified here? |
| :--- | :--- | :--- |
| rig green (unit + harness tests) | `tools/rust-offline-rig/README.md`, `docs/isolation/CROSS-AGENT-ISSUES.md` ISSUE-022 | **no** — this sandbox has no Rust toolchain |
| crate conformance vs the pinned reference | `tests/reference/workflow-rust/fixtures.json` (35 derived cases) | **no** — needs the reference runtime + cargo |
| "43/43 contract conformance" with Rust present | ISSUE-022 (Rust-track text) | **no** — that reading required a modified guard |

Nothing above is a licence to treat the archive as verified. It is an archive: the tree is inert,
untested here, and out of scope until a task manifest says otherwise.

## What the guards do now

* `contract_conformance.mjs` — the Phase-2 Rust guard scans `crates/` and `apps/` (both clean), **and**
  a new check requires that whenever `legacy/rust-port/` exists it carries this README and leaves **no**
  `Cargo.toml`/`Cargo.lock` at the repository root. Deleting the README, or restoring the crates into
  a build-visible location without a decision, fails the gate.
* `boundary_audit.py` — same guard, same added assertion.
* `tools/rust-offline-rig/run.sh` — points at the archived paths (see above).

If the project later decides to *legitimately* run a Rust track, the correct move is an explicit
amendment of PROJECT_RULES (and a Phase-3 mode in both guards, as requested in
`docs/isolation/workflow-bus-outbox.json` MSG-14) — not a silent `git mv` back.
