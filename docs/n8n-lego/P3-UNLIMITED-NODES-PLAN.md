# P3 — “Unlimited Nodes” Architecture Plan

> **STATUS: PLANNED · ARCHITECTURE GOAL · NOT STARTED.**
> Official planning document for the P3 architecture goal. **No implementation
> code lives here and none is authorized by this document.** P3 is **not** a
> current milestone; canonical numbering (`P3.x`) does not exist until the
> Manager approves it; `docs/n8n-lego/milestones.json` remains the single
> machine-readable canonical register and gains no P3 row from this plan.
>
> - Planning source (architecture goal): **GitHub Issue #75**
>   — *P3 Architecture Goal: Ultra-Efficient Unlimited-Scale Workflow Runtime /
>   Unlimited Nodes*
> - Governance/revision task that recorded this document: **GitHub Issue #76**
> - Related foundation: P2.27 plugin runtime/security design
>   (`docs/n8n-lego/P2.27-PLUGIN-RUNTIME-DESIGN.md` — itself PLANNING ONLY,
>   implementation ZERO until its own Master Prompt).

---

## 1. Goal and product concept — “Unlimited Nodes”

> **AI boleh membuat workflow yang sangat besar, rumit, dalam, bercabang, dan
> kompleks tanpa jumlah logical node menjadi sama dengan jumlah object runtime
> yang harus tinggal di RAM.**

Product concept **Unlimited Nodes** means:

```text
unlimited logical workflow scale
        (working set of execution stays bounded by resource budget)
```

It does **NOT** mean:

```text
unlimited simultaneous execution
```

AI-generated workflows may be arbitrarily long, deep, branched, repetitive,
fan-out/fan-in heavy, built from generated subgraphs and heavy in transforms and
compatibility surface (§15). The AI must never have to self-censor with
“don’t create too many nodes or the runtime will run out of RAM”. Memory, queue,
concurrency, scheduling, persistence, checkpointing and backpressure are the
**runtime’s** responsibility, not the author’s.

## 2. Architecture invariant (normative)

```text
Logical workflow size MUST be decoupled from runtime working-set memory.
```

Equivalences that must hold everywhere in P3 design reviews:

```text
10,000,000 logical nodes  !=  10,000,000 live runtime objects
graph size                !=  runtime working-set size
```

## 3. Reference deployment and stress targets

```text
Stress sizes:     1,000,000 · 5,000,000 · 10,000,000 logical nodes
Reference target: single tenant · 1 vCPU · 1 GB RAM
Plus:             a small developer-feedback workload size
```

What the reference target does and does not mean:

- it does **not** mean 10 million node-operations must finish fast on that box;
- it **does** mean: the workflow remains representable; the graph is never
  fully materialized; the runtime does not run out of RAM merely because the
  logical node count is large; execution stays bounded; queue/frontier stay
  bounded; the system keeps making progress; checkpoint/resume exists; resource
  policy is genuinely enforced.

## 4. P3 architecture problems in today’s engine (documented — NOT fixed now)

Current patterns that must be addressed by P3 (recording them is the extent of
this task; no engine change is made for them here):

```text
graph materialized fully in memory
node data kept in large runtime structures
execution results accumulated in-process
execution logs accumulated in-process
storage still file/collection oriented
execution queue still an in-memory work queue
```

These are acceptable at today’s scale and fatal at 10M logical nodes. They are
declared here as the **P3 architecture problem statement**, owned by Issue #75.

## 5. Target model

```text
AI generated workflow
        |
        v
Persistent Logical Graph
        |
        v
Graph Manifest
        |
        v
Index
        |
        v
Lazy / Chunked Graph Access
        |
        v
Bounded Execution Frontier
        |
        v
Bounded Queue + Backpressure
        |
        v
Streaming Execution State
        |
        v
Checkpoint
        |
        v
Resume / Continue
```

## 6. Requirement — persistent logical graph

Large graphs are **persistent logical data**, not in-memory objects. Required
notions (design vocabulary only at this stage):

```text
node identifier
edge / connection identifier
graph manifest
graph version
graph snapshot
node index
edge index
chunk / segment identity
deterministic addressing
partial reads
partial writes (where needed)
immutable snapshot references
graph integrity / checksum
```

A 10,000,000-node workflow must decompose logically:

```text
workflow
  |
  +-- chunk 000001
  +-- chunk 000002
  +-- chunk 000003
  +-- ...
  +-- chunk 010000
```

**Not all chunks may be required to reside in RAM** — ever, at any size.

## 7. Requirement — lazy / chunk loading

The runtime fetches only what execution needs:

```text
Execution Cursor
      |
      v
Node Index
      |
      v
Required Segment
      |
      v
Active Frontier
```

Once a segment is no longer needed and its state is safe:

```text
segment -> checkpoint -> release memory
```

Forbidden shape:

```text
workflow load -> entire graph to RAM
```

## 8. Requirement — bounded execution frontier

The execution runtime has a deliberately limited working set. Required design
concepts:

```text
bounded scheduler
bounded queue
bounded frontier
concurrency cap
fan-out control
fan-in coordination
backpressure
cancellation
deadline
resource budget
```

A large fan-out must never become:

```text
millions of queued runtime objects, unbounded
```

## 9. Requirement — streaming execution state

Structures like the following are forbidden because they grow without bound:

```text
allNodeResults[]
allExecutionEvents[]
allActiveTasks[]
```

Design must instead support:

```text
streaming execution events
bounded buffers
persisted execution state
selective history retention
segment-level checkpoint
node-level checkpoint where appropriate
```

## 10. Requirement — checkpoint / resume

If a workflow stops at node:

```text
6,382,192
```

the runtime must **not** restart from node 1 because a process died. A
checkpoint must be able to store at least:

```text
workflow identity
workflow version
execution identity
current cursor
active frontier
required state
pending work
data references
tenant context
request / correlation context
deadline / resource context
checkpoint integrity
```

Target recovery shape:

```text
crash -> latest valid checkpoint -> resume
```

## 11. Requirement — indexed node access

The hot execution path must never perform a whole-graph scan. Targets:

```text
O(1) or near-O(1) lookup on common paths
efficient segment/range lookup
compact node index
compact edge lookup
no full graph scan merely to locate the next node
```

## 12. Requirement — resource enforcement

Budgets must be **executable**, not prose:

```text
memory · CPU · concurrency · queue depth · timeout · deadline ·
output size · process count · network · I/O

declared budget
      |
      v
runtime enforcement
      |
      +--> throttle
      +--> queue
      +--> defer
      +--> checkpoint
      +--> reject
```

“Documented budget without enforcement” does not satisfy P3.

## 13. Requirement — Rust role

Rust is permitted and will likely matter for efficiency. Candidate hot paths:

```text
graph index
compact graph representation
graph traversal
serialization / deserialization
scheduler
bounded queue
memory-sensitive state
execution hot path
```

But:

> **Rust is not the Unlimited Nodes architecture.**

The forbidden framing is:

```text
JavaScript -> Rust        (as the sole scalability strategy)
```

The correct composition is:

```text
persistent graph
+ lazy loading
+ bounded execution
+ streaming
+ checkpoint
+ resource enforcement
+ Rust where valuable
```

Existing P2.22 portability discipline applies: the **contract** is what
consumers see; Rust arrives behind the same contracts, when — and only where —
it measurably helps.

## 14. Requirement — plugin locality (built on P2.27)

The P2.27 plugin architecture remains the foundation (itself awaiting its own
Master Prompt). Locality rule reused unchanged:

```text
trusted + hot path                -> in-process
portable / restricted compute     -> WASM
Python / native / risky           -> isolated process
external / heavy / independent    -> remote
```

Forbidden defaults:

```text
one node   = one process
one node   = one network request
```

unless that boundary is genuinely required. Batch and reuse connections/workers
whenever safe (consistent with P2.27 §performance/§locality rules).

## 15. Requirement — n8n node compatibility stays intact

P3 Unlimited Nodes is **not** a reason to break compatibility. The boundary
keeps supporting:

```text
official n8n nodes
official trigger nodes
verified community nodes
permitted community/custom packages
native LEGO nodes
future Rust nodes
future Python nodes
future WASM nodes
```

Consumers keep seeing the same contract while implementations change:

```text
HTTP Request
   +-- JS implementation
   +-- Rust implementation
   +-- WASM implementation
```

The workflow keeps using the **same logical node**; the implementation behind
it is an implementation migration (P2.22/P2.27 language-independence rule),
never a workflow rewrite.

## 16. Requirement — AI-generated workflow model

P3 explicitly targets AI-authored workflows that are:

```text
long · very deep · highly branched · repetitive · generated subgraphs ·
large fan-out · large fan-in · many segments · many transforms ·
heavy node-compatibility surface
```

The runtime owns: memory · queue · concurrency · scheduling · persistence ·
checkpointing · backpressure. The author owns none of those worries.

## 17. Requirement — multi-tenant preparation (contracts only)

Deployment target remains **single tenant**. Contracts must nevertheless be
extendable later. Context vocabulary to design for:

```text
tenantId · principalId · sessionId · requestId · correlationId ·
workflowId · executionId · capabilityScope · resourceBudget · deadline
```

Today `tenantId = default` is acceptable. Contracts must not be shaped so that
going multi-tenant later requires a total graph/execution-contract rewrite.
**No full multi-tenant implementation is undertaken just to satisfy this
planning document.** (Aligns with P2.27 §tenant security context reservation.)

## 18. Anti-patterns (forbidden)

1. Whole graph -> RAM on every execution.
2. Every node becomes a live runtime object.
3. All node results held in RAM.
4. All execution events stored unbounded.
5. Queue without a bound.
6. Frontier without a bound.
7. Whole-graph scan on the hot path.
8. Process per node.
9. Network call per tiny operation without a real boundary need.
10. Rewriting every node to Rust before the runtime model is proven.
11. Shattering every function into a microservice.
12. Kubernetes used to solve a local runtime problem.
13. Artificially low node limits where a bounded resource model would do.
14. Weakening correctness to win a benchmark.

## 19. Benchmark matrix

Separate benchmark suites are required per axis:

### Graph
```text
logical node count · serialized graph bytes · index bytes ·
edge count · chunk count
```

### Validation
```text
validation peak RSS · validation CPU · validation time ·
validation working-set
```

### Execution
```text
execution peak RSS · active frontier · queue depth · concurrency ·
time-to-first-progress · progress rate · CPU utilization
```

### Persistence
```text
execution state size · checkpoint frequency · checkpoint cost · I/O volume
```

### Reliability
```text
crash recovery · resume time · partial failure ·
resource-pressure behavior
```

Stress sizes: `1M` · `5M` · `10M` logical nodes, plus a small workload for
developer feedback.

## 20. Acceptance direction

P3 architecture counts as successful when:

```text
logical graph grows orders of magnitude
working-set memory does NOT follow total node count linearly
graph access is lazy/segment-wise
node lookup is indexed
execution frontier is bounded
queue is bounded
backpressure works
execution state streams
checkpoints exist
execution resumes after crash
resource budgets are enforced
official/community node compatibility intact
plugin contract intact
single tenant stays simple
future tenant isolation needs no graph/execution contract rewrite
```

## 21. Relationship to P2.27

- P2.27 (Contract-Driven Pluggable Runtime & Security Foundation) supplies the
  **foundation**: plugin identity/contracts, locality classes, capability
  security, secret broker, tenant context, resource budgets, supervisor/
  quarantine, circuit breaker, deadlines — P3 consumes these reservations.
- P3 does **not** implement either milestone; both remain **NOT STARTED**
  pending their own Master Prompts.
- Roadmap language for P3 stays exactly: **PLANNED · ARCHITECTURE GOAL · NOT
  STARTED**; no `P3.1/P3.2/P3.3` numbering without Manager approval;
  `milestones.json` stays the canonical register (no duplicate source).

## 22. Issue references

- **Issue #75** — planning source for Unlimited Nodes (architecture goal).
- **Issue #76** — governance/revision task that created this document
  (P2.27 preflight: `mainBaseline` correction + stale wording fix).

No additional issue is created for this concept unless genuinely necessary.
