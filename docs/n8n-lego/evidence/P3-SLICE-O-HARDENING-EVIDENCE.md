# P3 Slice O — Hardening — Evidence (Issue #97, planning #75)

- **Milestone:** P3.14 · **Slice:** O — seeded property tests, byte-flip fuzz, error-family + banned-primitive scans
- **Branch:** `feat/p3-hardening` · **Baseline (frozen):** protected main `e164f059c0a376199fe031d2ef4cca3d66b1198d` (post-Slice-K #132, incl. concurrent P9.1 #128; open PRs `[]`)
- **Slice boundary:** test suite + `.ai` regen only — **no lock row, no module** (pins stay 41).

## §1 Deliverable — `apps/n8n-lego/test/lego-p3-hardening.test.mjs` (**5/5 PASS**)

| test | property |
| :--- | :--- |
| seeded structural mutation (mulberry32 `0xC0FFEE`, 200 iters) | every mutated bundle (deleted keys / truncated node strings / count lies) either loads **round-trip identical** to baseline names or is rejected via **WorkflowGraphError only**; tripwire fired (`rejected ≥ 1`); control bundle loads clean |
| byte-flip fuzz (mulberry32 `0xBADF00D`, 300 iters) | single-bit flips: malformed JSON → reject pre-graph; parseable corruptions → load honestly OR **WorkflowGraphError** — never another failure family, never a hang (300/300 accounted) |
| malformed definitions (11 cases) | fail closed in `WorkflowGraphError` + `lego.contract_violation`; **empty workflow = LEGAL** (builds `nodeCount 0`, asserted — honest classification, not forced) |
| error-family scan (8 modules) | exactly ONE exported `*Error` class + ONE `this.code` namespace per P3 module (graph, dna, frontier, state-stream, ir, optimizer, guard, oracle) |
| banned primitives (8 modules) | no `Math.random`/`Date.now`/`new Date`/`require`/network-process builtins/`fetch`/`process.exit` |

Notes: deterministic seeds printed in assertions for reproducibility; no `Math.random` in the suite itself.

## §2 Also in this PR (governance follow-up from K's concurrent-merge)

- `.ai` regenerated on true main `e164f059` (K's regen of `CURRENT_STATUS.md`/`PROJECT_MASTER_PLAN.md`/`contracts.md` had not landed in PR #132's merge; `lego:ai:check` flagged it on main, now regenerated — ships here).

## §3 Validation

| gate / suite | result |
| :--- | :--- |
| Focused hardening | **5/5 PASS** |
| Focused bundle (hardening+stress+optimizer+telemetry+ir+guard+oracle+dna+graph+frontier+state) | **119/119 PASS** |
| 7 gates | **7/7 PASS** |
| backend full | **1017 · 1014 pass · 3 fail = PRE-EXISTING rest.test 404 only** |
| frontend full | **419 · 418 pass · 0 fail · 1 skip** |
| P2 regression | fail 0 |
| classification | new 0 · pre-existing 3 · env 0 · baseline-exception 0 |

**Milestone P3.14 remaining:** completion recorded on Issue #97 post-merge.
