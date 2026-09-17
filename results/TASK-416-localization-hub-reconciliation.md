# TASK RESULT: TASK-416-localization-hub-reconciliation

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-5`
- **LEGO COMPONENT**: `localization` (Phase 4G — merge intelligence, catalogue ownership)
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-18 UTC`
- **BASE**: `1dcb96b5` (Phase 4F tip)
- **COUNTERPART**: `7fba8a6d1887de570c9a3515ca11a7587c04c8a7` (PR #21 head, `arena/01a0b104`)

---

### Why this task exists

While this line grew Phase 4C → 4F, a parallel branch rewrote the module this line treats as the
frozen catalogue: **PR #21 changes `backend-localization-service.ts` by +634/−33**, turning 9 keys into
**27 keys × 6 locales** (adding `param.*`, `validation.*`, `connection.*`, `workflow.*`, `system.*`,
`execution.started/finished`, …). Two lines, one repository, no visibility between them.

The honest options were: ignore it (and discover the consequences at merge time), or measure it. Phase
4G measures it, makes the composition **superset-tolerant**, and hands the orchestrator a dossier.

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | :--- |
| `write_file` (`tools/localization-hub-diff.mjs`) | ✓ SUCCESS | `0` |
| `edit_file` (`localization-vocabulary.ts` — ownership rule) | ✓ SUCCESS | `0` |
| `edit_file` (`test/08` — F12/F13) | ✓ SUCCESS | `0` |
| `edit_file` (`tools/localization-gate.mjs` — G15) | ✓ SUCCESS | `0` |
| `edit_file` (`src/index.ts` — promote the two helpers) | ✓ SUCCESS | `0` |
| `run_tool` (hub diff vs PR #21) | ✓ SUCCESS | `0` — verdict **COMPATIBLE** |
| `run_simulation` (clean worktree + counterpart hub) | ✓ SUCCESS | `0` — 3 states measured |
| `run_tests` (79/79) | ✓ SUCCESS | `0` |
| `run_gate` (16/16) | ✓ SUCCESS | `0` |
| `run_gate` (`contract_conformance` 22/22 · `boundary_audit` PASS · `isolation:check` 4/4) | ✓ SUCCESS | `0` |
| `mutation_test` (M13, M14) | ✓ SUCCESS | red → green |
| `git worktree remove` (simulation cleanup) | ✓ SUCCESS | `0` |

### Finding 1 — the two hubs are compatible by value, and that is now machine-checked

```text
$ node tools/localization-hub-diff.mjs --their-ref 7fba8a6d --base d357e6e5
locales            6 ours / 6 theirs
keys               35 ours / 27 theirs / 11 shared
value pairs        66 identical / 0 divergent      ← no translation had to be reconciled
unpromoted runtime BASE_LOCALE_MESSAGES, BROWSER_STORAGE_KEYS, LEGACY_LOCALE_ALIASES,
                   NATIVE_NUMBER_FORMATS, isRtl, isTranslatableKey, matchLocale, resolveAcceptLanguage
unpromoted types   LocaleMessages, LocaleParityReport, LocalizationPersistencePort,
                   MessageValue, NumberFormats, TranslateOptions
file collisions    README.md, docs/isolation/localization.md, package.json,
                   backend-localization-service.ts, index.ts, SMOKE_TEST_RESULTS.md
script collisions  —           (their `i18n:check` does not clash with `localization:*`)
verdict            COMPATIBLE
evidence           docs/isolation/evidence/localization-hub-diff.json
```

Their 27 keys are a **strict superset** of the 9 this line was built against, and the 11 keys the two
sides share carry **identical text in all six locales** (66/66 pairs). Nothing in the *content* blocks
a merge.

### Finding 2 — the composition was fragile, now it is not

`createProductRuntime()` used to let overlays shadow the catalogue. Against a grown 4B that would have
meant: the same key resolves to this line's text via the composed runtime and to the 4B hub's text via
`NativeLocalizationService` — two owners, no error. Phase 4G fixes the rule:

* `withoutCatalogueOwnedKeys()` drops overlay entries the catalogue owns → **the catalogue owns its keys**;
* `catalogueOverlaps()` reports every overlap with both texts and an `identical` flag → divergence is
  **reported**, never silently preferred;
* gate **G15** asserts the rule against the live catalogue *and* against a deliberately grown stub (so
  the check has teeth today, where the real overlap count is 0);
* test **F13** was rewritten from "no overlap at all" to the **value-agreement invariant** — the old
  assertion was a snapshot of today's 9-key catalogue and would have reddened a legitimate superset
  merge. That rewrite is what makes this line merge-clean instead of merge-hostile.

### Finding 3 — the merge recipe, proven end-to-end in a clean worktree

`docs/isolation/evidence/merge-simulation-pr21.json` (measured, not predicted):

| Keadaan | Tes lini ini | Gate lini ini | Yang merah |
| :--- | :--- | :--- | :--- |
| A. Phase 4F apa adanya | 76/77 | 13/15 | G1 (test L13), G8 |
| B. setelah hardening 4G | 78/79 | 14/16 | G1 (test L13), G8 — sebab sama |
| C. B + resep promosi (12 runtime + 6 type) | **79/79** | **16/16 PASS** | — |

So after merging the two branches, exactly one mechanical change remains: extend the promotion block in
`packages/workflow-lego/src/index.ts` with the 8 runtime + 6 type names listed above. G8 and test L13
are the checks that will keep saying so until it is done — which is their job.

### Driven-red proof (the gate must be able to fail)

```text
M13  withoutCatalogueOwnedKeys() stops dropping catalogue-owned keys   exit 1  failed=[G1, G15]
M14  src/index.ts stops promoting catalogueOverlaps()                  exit 1  failed=[G8]
---  sources restored                                                  exit 0  failed=[]   (79/79 + 16/16)
```

### Boundary statement

* `backend-localization-service.ts`, `settings-localization-adapter.ts` and the counterpart's tooling
  were **inspected, diffed and simulated against — never edited** (`allowed_paths`/`forbidden_paths` of
  this task). The 27-key rewrite is the Phase 4B owner's decision, not this line's.
* No merge was performed, no branch was rewritten, no Rust/UI/reference file was touched.
* Detection and evidence only: the coordination record is `docs/isolation/CROSS-AGENT-ISSUES.md`
  **ISSUE-023** (status OPEN, with the numbers above and the recommendation to run the diff tool with
  `--check` before merging the two branches).

### Not measured (stated rather than implied)

* The counterpart gate (`tools/localization-hub-check.mjs`, `i18n:check`) could not run here: its loader
  compiles TypeScript with the pinned `typescript` from `packages/workflow-lego/node_modules`, which
  this sandbox cannot install. This line's gate needs no dependencies (Node type stripping).
* Live verification (docker/VPS) stays unavailable; `run_gate.sh --offline-only` remains
  `INCONCLUSIVE by design` for the live 11/11 stage.
* `docs/isolation/localization.md` is an **add/add conflict** with the parallel branch, and the two
  Rust dispositions differ (`legacy/rust-port/` archive here vs `crates/`+`apps/` `.gitkeep` there) —
  both are orchestrator decisions, recorded, not resolved unilaterally.
