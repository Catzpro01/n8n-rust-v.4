# P3 Slice I — Execution-as-Query — Evidence (Issue #97, planning #75 #3)

- **Milestone:** P3.8 · **Slice:** I — bounded ready queries + fan-out/in observability (§30 execution model primitives; #75 architecture #3 "bounded execution frontier" coordination numbers)
- **Branch:** `feat/p3-execution-query` · **Baseline (frozen):** protected main `d43b65309ded4fbe2d8de86fc6ca6ba372b029d1` (post-Slice-H #122; open PRs `[]`)
- **Slice boundary:** stateless QUERY methods on the existing graph only. No lock row (pure method additive — contract unchanged, pins stay **36**), no new module, no executor, no scheduling policy.

## §1 Deliverable — `workflow-graph.mjs` additive methods

| method | bound | semantics |
| :--- | :--- | :--- |
| `fanOutOf(name)` | 1 chunk read | connection links declared by a node (fan-out limit observability) |
| `fanInOf(name)` | lazy index once → O(1) | indexed incoming edges; dangling sources excluded — never block (structural truth) |
| `initialReady({limit, fromOrdinal})` | **paginated** O(page)/call | cold-start roots (in-degree 0) with STATELESS cursors `{ready, next, done}` — discovery never materializes the whole ready set |
| `readyAfter(satisfied)` | **\|satisfied\| × fan-out** — no whole-graph scan | newly-ready = successors whose ALL indexed predecessors are satisfied; monotone (satisfied never re-reported — re-fire belongs to the runner); canonical ordinal order; frozen result; `satisfied` must be node names (bare strings rejected — fail-closed) |

Stateless by design: the graph owns NO execution state (execution-as-query) — cursors and the satisfied set live in the caller, feeding Slice D backpressure into query cost.

## §2 Validation

| gate / suite | result |
| :--- | :--- |
| Focused `lego-workflow-graph.test.mjs` | **38/38 PASS** (6 new Slice I tests: fan bounds, dangling-truth, pagination cursors, fan-in coordination on diamond, cycle termination via monotone semantics, cost bound) |
| 7 gates | **7/7 PASS** |
| backend full | **962 · 959 pass · 3 fail = PRE-EXISTING rest.test 404 only** |
| frontend full | **419 · 418 pass · 0 fail · 1 skip** |
| P2 regression | **fail 0** |
| classification | new 0 · pre-existing 3 · env 0 · baseline-exception 0 |
| pin scan | no stale rows (36 stands — additive slice) |

## §3 Performance gate — measured (single-run)

| metric | measurement |
| :--- | :--- |
| `readyAfter` after 1-node batch, **100,000-way fan-out** | **5.6 ms** → returns 100,000 ready (cost = batch × fan-out, verified proportional) |
| `fanOutOf(Root)` / `fanInOf(W0)` | 100,000 / 1 (O(1) after lazy index) |
| `initialReady({limit:1000})` page | **< 1 ms**, stateless `next` cursor, `done=false` |

## §4 Non-scope held

No executor, no queue/scheduler policy (Slice D owns bounds; future executor slices own scheduling), no re-fire semantics (runner), no lock/REST/capability changes.

**Milestone P3.8 remaining:** completion recorded on Issue #97 post-merge.
