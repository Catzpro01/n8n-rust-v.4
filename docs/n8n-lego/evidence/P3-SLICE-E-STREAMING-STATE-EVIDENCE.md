# P3 Slice E — Streaming Execution State — Evidence (Issue #97, planning #75 #4)

- **Milestone:** P3.4 · **Slice:** E — bounded streaming state (§30; Verification Gate Amendment; #75 required architecture 4)
- **Branch:** `feat/p3-streaming-state` · **Baseline (frozen):** protected main `75189576ddd3a5725e5d8ca0ac8e611f6bd9b7c6` (post-Slice-D #114; open PRs `[]` at fork)
- **Slice boundary:** bounded append-only state log + streaming reads + selective consume. NOT snapshot/resume (Slice F lands on this seam next), NOT scheduler/executor wiring, NOT fs persistence.

## §1 Deliverable

New module `apps/n8n-lego/src/lego/state-stream.mjs` — contract **`execution.state-stream@0.1.0`** (lock row **35**, owner `agent-1`, domain `execution`, no capability/REST):

- **Bounded buffer by policy:** `maxResidentEvents` REQUIRED (no default), validated `1..1048576` — the buffer bound is explicit, never implicit.
- **Explicit backpressure (no silent loss):** `append` → `{status:'admitted'|'backpressure', code:'lego.backpressure'}`; refusal retains NOTHING and never burns a `seq` (asserted: size/lastSeq unchanged after refusal).
- **Streaming reads:** `read(from,limit)` bounded non-destructive window; `stream(cursor,{batchSize})` finite generator (endSeq captured at call; bounds validated on first iteration); `consume(limit)` destructive FIFO drain = **selective retention** (backlog shrinks only when a sink takes events; `firstResidentSeq` cursor advances; freed capacity admits again).
- **JSON-domain payloads** deep-frozen on admission (documented producer contract; `undefined`/functions/NaN/non-plain refused with `field: event`).
- **Purity:** **ZERO imports** — no clock/fs/network/timers/randomness/process (source-scanned).
- **One error family:** `StateStreamError`, code `lego.contract_violation`; `lego.backpressure` published (errors 1.2.0 untouched).
- **Execution domain boundary:** `mustNotDependOn: workflow` intact; module imports nothing; `execution.paths` += module (capabilities 4, status `partial`).

## §2 Governance edits

- lock row 35 appended (R9: execution 0.1.0); **count-pins 34 → 35 in 10 files** (the original 9 + Slice D's own frontier row-test pin discovered by the full suite — fixed with per-context message, no blanket replace).
- `domains.json#execution.paths` += `src/lego/state-stream.mjs` (2+/1− only).
- `BACKEND_LEGO.md` changelog +1 · `.ai` regenerated (64/37/101 in sync).

## §3 Validation (this tree)

| gate / suite | result |
| :--- | :--- |
| Focused `lego-state-stream.test.mjs` | **8/8 PASS** |
| Frontier suite (pin updated) | **10/10 PASS** · graph suite **29/29 PASS** |
| 7 gates (arch…ai:check) | **7/7 PASS** |
| backend full | **945 · 942 pass · 3 fail = PRE-EXISTING rest.test 404 only** |
| frontend full | **419 · 418 pass · 0 fail · 1 skip** (FE34 pin 35 green) |
| P2 regression | **fail 0** |
| classification | new 0 · pre-existing 3 · env 0 · baseline-exception 0 |

Test-authoring fixes during development (TEST-side only): read/stream limits within the module's own bound (tests over-asked capacity), one-refusal counter arithmetic, generator validation occurs on first `next()` (asserted via spread), independent fresh stream for the prefix reference. No test deleted; module semantics never bent.

## §4 Performance gate — measured (single-run, indicative; bounds asserted in-suite)

| metric | measurement |
| :--- | :--- |
| flood: 200,000 × ~530 B appends → capacity 4096 | admitted **4096** · backpressured **195,904** · peakSize **4096** (= bound) · append loop 144 ms |
| memory under flood | heap Δ **+2 MB** (all retained would need **~101 MB**) — refused events are never retained |
| drain | consume-all of resident backlog: 4096/4096 in <1 ms |
| bounded invariant | size ≤ capacity asserted after every append in-suite; seq monotonicity asserted |

## §5 Non-scope held

No snapshot/resume (F), no fs/durable sink (adapter later), no scheduler wiring, no workflow-graph change, no capability/REST, no P2.27 expansion, no P4+.

**Milestone P3.4 remaining:** none (single-slice) — completion recorded on Issue #97 post-merge; **P3.5 / Slice F** (snapshot/resume on this seam) follows from the merged baseline.
