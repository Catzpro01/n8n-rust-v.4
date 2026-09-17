# TASK-410 — Setup-runtime nanoid pin + collision survey: result record

- Manifest: `tasks/TASK-410-setup-runtime-nanoid-and-collision-survey.yaml`
- Trigger: PR #15 comments 6–7 (Agent 1 heads-ups: ISSUE-023/024/025).
- Own-branch work only; no aff7 content ported (standing directive). The
  `3.3.8` version is sourced from aff6-local
  `packages/persistence-lego/manifest/source-pins.json`.

## 1. ISSUE-023 aff6-local gap: `nanoid` missing from the setup script — FIXED

- `packages/persistence-lego/src/consumed.mjs` hard-requires `nanoid` at
  import; `tools/ensure-runtime-link.mjs` (the `pretest` gate) asserts
  `nanoid@3.3.8` in `.runtime`. `persistence-lego/package.json` declares no
  dependencies, so `.runtime` is the only source.
- aff6's `scripts/setup-reference-runtime.sh` installed 4 pins without
  `nanoid` → clean clone + setup script = every persistence test fails to
  load. (`flatted@3.2.7` was already pinned on aff6, unlike the branch in
  Agent 1's report.)
- Gap proof (mechanical, real gate): old script has 0 `nanoid` mentions;
  the real `ensure-runtime-link.mjs` against a runtime with the 4 old pins
  present exits **2** naming `'nanoid'`. (A full double-build was avoided
  as information-free; gap follows by construction + gate behavior.)
- Fix: `"nanoid": "3.3.8"` + header comment + version echo (also added the
  previously missing `flatted` version echo).
- Fix proof (end-to-end): `rm -rf .runtime` → fixed script builds all 5
  pins (73s) → `npm test --prefix packages/persistence-lego` → **57/57,
  0 fail**. `.runtime` + package symlink deleted after verification
  (gitignored; tree restored pristine).

## 2. ISSUE-024 collision survey: aff6 pairs reproduced exactly (read-only)

`node tools/branch-collision-check.mjs --scope packages/` (aff6-local tool,
`526e5e4d`) against fetched tips aff7`b4e7be7c` / aff8`2d70d2c4` /
afff`b2352dde`:

| pair | shared | differ | paths |
|---|---|---|---|
| aff6 ↔ aff7 | 35 | 1 | `reconstructed-engine/runner.mjs` |
| aff6 ↔ aff8 | 38 | 4 | `persistence-lego/{README.md, package.json, src/index.mjs}`, `reconstructed-engine/runner.mjs` |
| aff6 ↔ afff | 35 | 1 | `reconstructed-engine/runner.mjs` |

Structural severity (no content copied): the aff8 `persistence-lego` is a
different lineage (repository-shaped exports, ~−1400 net lines, single
test file) vs aff6's POOL-004 (consumed-parity, 57/57). Sequential merges
without the detector would silently clobber one — and the aff6 copy is
what my contract §8 (TASK-409) registers as agent-8's consumed seam. The
`runner.mjs` triple-collision reinforces ISSUE-021's consolidation call.
No branch action (orchestrator merge-sequencing decision); agent-8 warned
via C3-MSG-09.

## 3. ISSUE-025 / `setup-all.sh`: landed by peer, composes with this fix

While this task ran, a peer landed aff6-native `scripts/setup-all.sh`
(`096143bc`, ISSUE-023/025) — so no aff7 port was ever needed. It asserts
all 5 pins **including `nanoid`** and shells out to
`setup-reference-runtime.sh` when any are missing, i.e. it *requires* this
task's pin (without it, every run would rebuild a still-nanoid-less
runtime). Composition verified end-to-end: `bash scripts/setup-all.sh`
→ 5-pin `.runtime` (nanoid 3.3.8) + 1 package install → persistence
**57/57**. The survey was additionally re-run with the fixed detector
(`62ca2979`); numbers identical.

## Verification

- persistence-lego: 57/57 from from-scratch `.runtime` (fixed script).
- `contract_conformance.mjs`: 43/43. `run.sh test`: 100/100 (untouched).
- `git status`: only the script fix + task/result/bus files.

## Bus

- `C3-MSG-09` → agent-8 (STATUS): collision heads-up + setup-fix notice.
