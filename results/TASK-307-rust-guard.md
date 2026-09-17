# TASK RESULT: TASK-307-rust-guard

- **STATUS**: `SUCCESS`
- **AGENT**: arena worker — session `arena/01a0aee7-n8n-rust-v-4`
- **LEGO COMPONENT**: `integration`
- **TIMESTAMP**: `2026-09-17 10:37 UTC`
- **BASE STATE**: `d721b603` (branch tip carries this change)
- **FULL RECORD**: [`docs/isolation/RUST-PURGE-RECORD.md`](../docs/isolation/RUST-PURGE-RECORD.md)

---

### Summary (padat)

`PROJECT_RULES.md` rule 1 (ZERO RUST) was being violated at `d721b603` by 22 tracked artifacts under
`crates/` (15 `.rs` = 2 740 lines + 7 `Cargo.toml` = 85 lines), and both offline harnesses were
failing on it while `docs/isolation/LEGO-MASTER-MAP.md` claimed `No premature Rust | PASS`. The 22
artifacts were `git rm`-ed (`.gitkeep` placeholders kept, everything recoverable from `d721b603`),
`tools/rust-guard.mjs` was added as `npm run rust:guard` and chained into `npm run isolation:check`,
and the false PASS claim in the master map was corrected in place with this evidence attached.
Re-verified after installing the pinned reference runtime: `contract_conformance.mjs` **21/21 exit 0**
(was 20/21 exit 1), `boundary_audit.py` **AUDIT RESULT: PASS exit 0** (was FAIL exit 1),
`npm run verify` **11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED**, and the retained fixture corpus
still re-derives (`build-fixtures.mjs --check`, exit 0). The VPS `11/11` PostgreSQL smoke re-run is
**NOT** claimed — unreachable from this sandbox (no route to `157.10.160.95`, no `docker`), so
`run_gate.sh --offline-only` correctly reports `INCONCLUSIVE` and caveat `C1` of `TASK-305` stays open.

### Evidence

| check | before (`d721b603`) | after | exit |
| :--- | :--- | :--- | ---: |
| `node tools/rust-guard.mjs` | *(tool did not exist)* | `RESULT: PASS — no .rs / Cargo.toml under crates, apps` | 0 |
| `npm run isolation:check` | n/a (no rust step) | boundary + kernel + port + reference + rust guard | 0 |
| `node tests/compatibility/contract_conformance.mjs` | `20/21`, `[FAIL] Phase 2: no Rust implementation introduced` | `RESULT: 21/21 CHECKS PASSED` | 0 |
| `python3 tests/integration/boundary_audit.py` | `PHASE VIOLATION: Rust introduced during Phase 2` / `AUDIT RESULT: FAIL` | `Rust guard: clean` / `AUDIT RESULT: PASS (all edges documented)` | 0 |
| `npm run verify:fast` | G08/G09/G10 FAIL (no reference runtime installed) | `gates: 10/10 PASS` | 0 |
| `npm run verify` | — | `gates: 11/11 PASS`, G11 live `7/7 PASS · R0…R6:PASS` | 0 |
| `bash tests/integration/run_gate.sh --offline-only` | stage 1 FAIL | `OFFLINE STAGES : PASS` / `LIVE 11/11 : NOT RUN` | 2 (INCONCLUSIVE by design) |

Negative test proving the new guard is not a no-op — planted `crates/n8n-probe/{Cargo.toml,src/lib.rs}`,
all three guards exit 1 (`RESULT: FAIL — 2 Rust artifact(s)`, `20/21`, `AUDIT RESULT: FAIL`); after
`rm -rf crates/n8n-probe` the guard exits 0 again.

### Protocol compliance

* **Dual-phase review (pre/post task) — NOT PERFORMED.** `dynamic_task_pool` and
  `task_consensus_votes` live in Supabase; `https://gqctxugkxekdqxsaqrum.supabase.co` is unreachable
  from this sandbox (`curl` → `HTTP 000`, DNS resolves; `api.github.com` → `200`). No peer task could
  be read and no vote cast. Not a skip-by-choice: recorded here so the gap is visible.
* **Non-blocking rule respected** — the task was self-assigned from the failing gate instead of
  waiting for a pool entry or an approval.
* **No Rust written, no reference source touched** — gate `G04` re-verified the reference tree as
  byte-identical (15 050 files, root `f8da35180669d798…`).
* **Frontend UI untouched** — rule 5 mirrored into `docs/isolation/STANDING-WORKER-PROTOCOL.md` from
  `origin/main` (`7ff42003`); no `editor-ui` / Vue / CSS asset in the diff.

### Handed to the next worker

1. Re-run the VPS `11/11` smoke on PostgreSQL and refresh `tests/reference/baseline/SMOKE_TEST_RESULTS.md`
   (caveat `C1`) — this is the only thing standing between the offline green and a `PASS` from `run_gate.sh`.
2. Phase 3 consumer of `tests/reference/workflow-rust/fixtures.json` must be TypeScript/JS per rule 1;
   the corpus (8 checksum, 6 diff, 6 shape, 6 rename, 9 traversal cases) is language-agnostic and intact.
3. `ISSUE-004` (runtime cycles) and `ISSUE-006` (global state / env coupling) still open — both must be
   cut before any LEGO is swapped out.
