# P3-S01 — Execution optimizer extensions

**Issue:** #75 / #224 (remaining optimization items whose foundations exist in P3.3–P3.13)
**Status:** implemented
**Branch:** `delivery/p3-s01-optimizer-extensions`
**Contract:** `execution.optimizer-extensions@1.0.0`, extends `execution.optimizer@1.0.0` (owner `agent-1`, domain `execution`)

## 1. What was delivered

`apps/n8n-lego/src/lego/execution-optimizer-extensions.mjs` — the six remaining
#75/#224 optimizer items, as one contract. Each is decided from **structural
preconditions plus an explicit whitelist**; none guesses at semantics.

| # | Item | Entry point | Proven-safe because |
|---|---|---|---|
| 1 | Semantic node elimination | `eliminationPlan`, `applyElimination` | dead **and** pure-whitelisted **and** unflagged **and** another terminal survives |
| 2 | Content-addressed subgraph cache | `createSubgraphCache`, `contentAddress` | SHA-256 over a *canonical* serialisation → a hit is byte-identical, never "looks similar" |
| 3 | Resource-aware compilation | `compilePlan` | width from a longest-path layering capped by a **declared** budget; an unsatisfiable budget refuses |
| 4 | Incremental execution | `replanIncremental`, `stepFingerprint` | a changed step invalidates its whole downstream cone; an absent fingerprint forces a recompute |
| 5 | Self-profiling | `createOptimizerProfiler` | every sample carries a mandatory provenance; no clock, so no invented duration |
| 6 | Hot/cold path split | `splitHotCold` | observed counts against a declared threshold; cold-by-default is reported separately from cold-by-evidence |

## 2. The house rules that were honoured

- **Defaults are OFF.** `OPTIMIZER_EXT_DEFAULTS` is all-`false`; `resolveExtensions`
  refuses unknown names and non-boolean values. An optimizer that changes
  behaviour by default is a bug, not a feature.
- **No semantic guessing.** `ELIMINABLE_PURE_TYPES` is the whitelist (`noOp`,
  `set`). `NON_ELIMINABLE_FLAGS` (credentials, retry, onError, continueOnFail,
  alwaysOutputData, webhook, trigger) block elimination even for a whitelisted
  type. "Where proven" (#97) means the whitelist, not vibes.
- **Zero-import, and the one import is in-domain.** The `execution` domain
  depends on `platform-kernel`, `compatibility`, `storage` — **not** `workflow`
  (which owns `src/checksum.mjs`) and **not** `observability`. A content address
  therefore cannot borrow a checksum from another domain, so **SHA-256 is
  implemented in-module** and asserted against FIPS 180-4 vectors.
- **No I/O, no clock, no workflow import.** Pure functions over plain data.
- **Bounded.** `maxSteps 4096`, `maxDepsPerStep 64`, `maxSubgraphSteps 256`,
  `maxCacheEntries 1024`, `maxSubgraphBytes 65536`, `maxProfileSteps 4096`,
  `maxPlanWidth 256`. Over-limit **refuses**; it never evicts silently.

## 3. Design decisions worth recording

**A dead node is a terminal node.** The first elimination rule ("it is not the
terminal step") was wrong and the tests caught it: a node with no consumer *is*
terminal, so the rule eliminated nothing. The real invariant is that **removing
a step must leave at least one terminal**, because a graph must still be able to
produce its declared output. Rewritten, and now exercised by a fixture where a
dead `noOp` sits alongside a surviving terminal.

**Plan width comes from longest-path layering, not raw fan-out.** The first
formula (`steps − fanOut`) reported a 3-step fork as sequential and a chain as
parallel. Width is now `max(level size)` where `level(step) = 1 + max(level of
its dependencies)` — a schedule this module can actually justify, because every
step in a level has all of its dependencies in strictly earlier levels.

**A missing node type must not become `null` in an identity function.** Both
`canonicalIr` and `stepFingerprint` now *require* `type` to be a string. Encoding
a typeless step as `null` would let a typeless step and a differently-typed step
share a content address.

**The subgraph cache hands back a deep-frozen copy, not a JSON string.** The
first version stored `JSON.stringify(value)` and returned it, which forced the
caller to re-parse and made a cache read return a different shape than a cache
write. Serialisation is still used — for the byte accounting and to prove the
payload is storable — but the value returned is a frozen copy, so a reader can
neither re-parse nor mutate an entry behind the cache's back.

**A refused admission is counted, not absorbed.** `stats().refused` makes a
non-pure or uncanonicalisable subgraph visible. A caller must not be able to
mistake a silent refusal for a cache miss.

**`compilePlan` reads the budget and refuses an unsatisfiable one.** An unknown
budget key throws (it is not in the P3.11 guard vocabulary); `maxConcurrency: 0`
throws with `cannot execute anything` rather than degrading to a plan that
cannot run. A plan that silently ignores its budget is worse than no plan.

## 4. Registration

`src/lego/execution-optimizer-extensions.mjs` added to the **`execution`**
domain in `apps/n8n-lego/src/lego/manifest/domains.json`. This is what makes
`lego:arch` pass: before registration the gate attributed the file to
`lego-foundation`, which explicitly must not depend on `execution`
(`lego-foundation -> execution via './resource-guard.mjs'`).

## 5. Tests

`apps/n8n-lego/test/lego-execution-optimizer-extensions.test.mjs` — **47 tests,
47 pass**, fixture `apps/n8n-lego/test/fixtures/p3/execution-optimizer-extensions.json`.

| # | Area | Assertion |
|---|---|---|
| 1 | contract | id / version / owner / extends, all six transform names, **every default OFF** |
| 2 | vocabularies | pure whitelist, non-eliminable flags, plan shapes, provenance, guard budgets |
| 3 | hashing | SHA-256 against FIPS 180-4 vectors (`""`, `"abc"`, the lazy-dog string), 1000-char input, null refused |
| 4 | canonicalisation | key-order and dep-order independent |
| 5 | content address | `sha256:<64 hex>`; changes when the content changes |
| 6 | fail-closed | unusable IRs → `null` for `canonicalIr` / `contentAddress` / `stepFingerprint` |
| 7 | fingerprints | stable across key order; sensitive to a parameter change |
| 8 | elimination | a dead pure `noOp` is planned out; `remaining` keeps ordinal order |
| 9 | elimination | a step **with** a consumer is never eliminated |
| 10 | elimination | a non-pure type is never eliminated, even when dead |
| 11 | elimination | **every** `NON_ELIMINABLE_FLAGS` value blocks elimination |
| 12 | elimination | the last terminal step is never eliminated |
| 13 | elimination | rewiring records the hoisted parents |
| 14 | apply | valid IR out, input untouched, every surviving dep satisfiable, frozen |
| 15 | apply | a forced elimination hoists parents onto the consumer (no orphan) |
| 16 | apply | an unknown step / malformed plan refused |
| 17 | fail-closed | nine malformed IR shapes refused by **all four** entry points |
| 18 | cache | a hit means byte-identical content (structurally identical subgraph hits) |
| 19 | cache | a changed parameter is a miss, never a stale hit |
| 20 | cache | a non-pure type is **refused and counted**, not silently missed |
| 21 | cache | an uncanonicalisable subgraph is refused |
| 22 | cache | bounded LRU with eviction accounting |
| 23 | cache | fail-closed configuration (4 shapes) |
| 24 | cache | an oversized subgraph is refused |
| 25 | cache | an unserialisable payload is refused |
| 26 | compile | a **chain** → sequential; a fork → bounded-parallel width 2 |
| 27 | compile | fan-out → bounded-parallel capped by the budget; no budget → plan-width bound |
| 28 | compile | width never exceeds the plan bound (400-wide graph) |
| 29 | compile | unknown budget key, `maxConcurrency 0`, `1.5`, `-1`, negative `timeoutMs`, non-object budget all refused |
| 30 | compile | a zero-concurrency budget is refused with `cannot execute anything` |
| 31 | incremental | an unchanged graph is fully reusable, `savings === 1` |
| 32 | incremental | a changed step invalidates its whole downstream cone; `invalidatedBy` names the cause |
| 33 | incremental | an absent **and** a non-matching fingerprint force a recompute |
| 34 | incremental | no evidence at all → nothing reusable |
| 35 | incremental | a fingerprint naming an unknown step, or a non-string fingerprint, refused |
| 36 | incremental | `savings` is derived from the reusable set |
| 37 | profiler | samples accumulate; mean/max derived; `mixedProvenance: false` |
| 38 | profiler | a mixed profile reports `mixedProvenance: true` and `measuredFraction() === 0` |
| 39 | profiler | an unprofiled step is `null`; an empty profiler is `null`, **not 100%** |
| 40 | profiler | negative / `NaN` / `Infinity` / string / unknown-provenance / empty-id samples all refused |
| 41 | profiler | bounded; the bound refuses rather than evicting |
| 42 | hot/cold | observed frequency classifies against the threshold; `measuredFraction === 1` |
| 43 | hot/cold | cold-by-default is reported separately from cold-by-evidence |
| 44 | hot/cold | an all-zero observation set classifies nothing as hot, and is fully measured |
| 45 | hot/cold | six out-of-range thresholds and bad observations refused |
| 46 | toggles | unknown extensions and non-boolean values refused |
| 47 | isolation | the module has exactly **one** import, and it is `./resource-guard.mjs` |

## 6. Verification

| Gate | Result |
|---|---|
| `lego-execution-optimizer-extensions.test.mjs` | **47 / 47 pass** |
| `lego:arch` (backend LEGO architecture gate) | **OK** — every import respects its declared boundary |
| `lego:capabilities` / `lego:scaleout` / `lego:foundation` | ok |
| `lego:arch:selftest` / `lego:foundation:selftest` | ok |
| `lego:ai` + `lego:ai:check` | ok (in sync) |
| `governance-register.mjs check` | exit 0 |
| `lego-execution-optimizer.test.mjs` (P3.13, unchanged) | 8 / 8 |
| `lego-execution-ir.test.mjs` | 9 / 9 |
| `lego-resource-guard.test.mjs` | 8 / 8 |
| `compat.oracle.test.mjs` | 7 / 7 |
| Full `apps/n8n-lego` suite (116 files) | **2662 pass / 3 fail** |

### 6.1 The 3 failures are pre-existing on `main`, not from this slice

`apps/n8n-lego/test/rest.test.mjs` fails 3 tests (`/rest/types/nodes.json`,
`/rest/types/node-versions.json`, `POST /rest/node-types` — all 404 ≠ 200).
These reproduce on **pristine `main` with every P3-S01 change stashed**,
including untracked files (`# pass 9 # fail 3`). They are a pre-existing
condition in the node-catalog REST surface, unrelated to this slice, isolated
and recorded here per §22. The same three failures were already recorded for
P9-S01; the condition is unchanged.

No workflow, Cargo, runner-config, `crates/`, `contracts/` or `packages/` file
is touched by this slice.

## 7. Not delivered here

- **No engine wiring.** Nothing in `src/engine.mjs` calls the extensions yet.
  They are a locked, reviewed contract first; instrumentation is a separate
  slice so a behaviour change can never ride in unnoticed.
- **No equivalence proof against the compatibility oracle.** `toggleSweep` is
  the oracle's job (#91: a benchmark is never sufficient, only
  `compareCanonical`). The transforms are declared as toggle names here and
  wired there, not proven here.
- **No cross-run persistence of fingerprints or profiles.** Both are in-memory
  and bounded; a persistent store needs a retention decision, which belongs to
  P9.15, not to an optimizer.
- **No allocation of real resource budgets.** `compilePlan` *reads* a declared
  budget; it never acquires memory, concurrency or time from the P3.11 guard.
