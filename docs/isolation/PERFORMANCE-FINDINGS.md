# PERFORMANCE FINDINGS — Phase 2 (observation only)

**Maintainer:** Agent 5
**Rule (brief §19):** Phase 2 records potential problems. **No optimization is performed now.**
All items below are deferred to **Phase 6**. None of these is a defect; several are deliberate
n8n 2.9.4 design choices that the Rust port must consciously decide to keep or change.

Tags: `HIGH RAM | HIGH CPU | UNNECESSARY COPY | LARGE SERIALIZATION | BLOCKING I/O`

---

| # | Location | Tag | Observation | Phase-3+ relevance |
| ---: | :--- | :--- | :--- | :--- |
| P-01 | `src/utils.ts` `deepCopy`, used across `node-helpers.ts`, `workflow.ts` | UNNECESSARY COPY | Full structural clone of node parameters on many read paths. In Rust this is where `Arc`/`Cow` should replace cloning. | Node LEGO |
| P-02 | `src/observable-object.ts` (used by `workflow.ts` for `staticData`) | HIGH RAM | Every static-data object is wrapped in a Proxy with change tracking; proxies defeat JIT optimisation and add per-access cost. | Workflow LEGO |
| P-03 | `src/interfaces.ts` — 3 452 lines, imported by 40+ modules | HIGH RAM (build) | Single giant type hub; any change invalidates nearly the whole package's type-check/build graph. Slow incremental builds, not slow runtime. | all LEGOs |
| P-04 | `src/workflow.ts` graph traversal (`getParentNodes`/`getChildNodes`) | HIGH CPU | Adjacency is recomputed/walked from the `connections` record rather than from a prebuilt index; repeated traversal is O(E) each call. | Workflow / Connection LEGO |
| P-05 | `src/expression.ts` + `@n8n/tournament` | HIGH CPU | Expressions are parsed on each evaluation path with no visible AST cache; sandboxing adds per-call wrapper cost. | Expression LEGO |
| P-06 | `src/augment-object.ts` | UNNECESSARY COPY | Copy-on-write augmentation layer over run data — correct, but allocation-heavy per item. | Execution Data LEGO |
| P-07 | Execution payload path (`run-execution-data/**`) | LARGE SERIALIZATION | Entire `IRunExecutionData` is serialised to PostgreSQL per execution; large binary/JSON items inflate write size. Observed in baseline test #11. | Persistence LEGO |
| P-08 | `tests/integration/regression_gate.py` check 4 | BLOCKING I/O | The gate shells out to `docker exec … psql` synchronously with a 5 s timeout — test infrastructure only, no product impact. Agent-5-owned; may be improved without a LEGO owner's approval. | Agent 5 |

## Measurement status

**No profiling was performed.** All findings above are static code observations.
No CPU, RAM, or latency numbers exist for this repository yet — do not quote any.
A measured baseline (n8n 2.9.4 on the reference VPS) is a **Phase 6 prerequisite**, and until it
exists no optimisation claim can be validated.
