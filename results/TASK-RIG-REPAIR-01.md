# TASK-RIG-REPAIR-01 — ISSUE-025 vendoring repair: cargo claims now reproduce on this branch

**Status: SUCCESS** — `tools/rust-offline-rig/run.sh check` **exit 0**, `run.sh test` **exit 0
(37/37 tests, 12 binaries)**, and the ISSUE-017 execution probe re-run with Agent 5's exact
recorded result. `crates/` untouched (rig-only change; all builds happen in the `/tmp` copy).

## What landed

1. `tools/rust-offline-rig/setup.sh` — CRATES extended 10 → 15 repos: `indexmap-rs/indexmap:2.2.6`,
   `indexmap-rs/equivalent:v1.0.2`, `rust-lang/hashbrown:v0.14.5`, `rust-lang/regex:1.10.6`,
   `BurntSushi/aho-corasick:1.1.3` (tags verified via `git ls-remote` + GitHub API; crates.io
   remains unreachable — TLS reset — so the git-clone path is used).
2. `tools/rust-offline-rig/vendor_prep.py` — PLAN 12 → 19 crates (`regex-automata 0.4.7` +
   `regex-syntax 0.8.4` are vendored from **subdirs of the regex 1.10.6 tag**); `rewrite_manifest`
   rebuilt to also handle **section-style path deps** (`[dependencies.regex-automata]` +
   bare `path = "..."`) and to drop `[[test]]`/`[[bench]]`/`[[example]]` stanzas pointing into
   excluded dirs — both shapes exist in the regex workspace manifests. FATAL check preserved.
3. `README.md` rig section count updated.

## Verification (all on the rig's `/tmp/rust-rig/build/repo` tree copy)

- `run.sh check` → `Finished dev profile … in 9.22s`, exit 0 (first successful workspace resolve
  on this branch — previously `error: no matching package named indexmap found`).
- `run.sh test` → **37 passed / 0 failed** across n8n-common/connection/execution-data/expression/
  node-model/validation/workflow + conformance (2) + reference_fixtures (5) — matches Agent 1's
  recorded "37/37", now independently reproduced.
- **ISSUE-017 probe re-run** (probe written into the build copy only, never committed, deleted
  with the copy — same protocol as the original):
  ```
  PROBE getStartNode(None) with DISABLED trigger -> Some("Manual Trigger")
  PROBE getStartNode(Some("Code")) with DISABLED parent -> Some("Code")
  ```
  The recorded HIGH divergence **stands, code unchanged**: the port still starts execution at a
  node the user disabled (reference `workflow.ts:839/:853` skips `disabled === true`). ISSUE-017
  remains OPEN; it is now re-provable by anyone with the repaired rig.

## ISSUE-025 disposition

Required action satisfied in full: repair landed → `check`/`test` re-run → probe re-run.
**Status: OPEN → REPAIRED (addendum in CROSS-AGENT-ISSUES.md).** No regression: `npm run
verify:all` real exit 0 unaffected (Rust rig is not in the JS/TS chain).
