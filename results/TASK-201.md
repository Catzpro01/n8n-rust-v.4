# TASK RESULT: TASK-201

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-1`
- **MODULE**: `workflow-isolation` (LEGO 01 — Workflow)
- **PHASE**: `phase-2` (structural isolation, no Rust)
- **GATES**: `11/11 PASS`
- **BEHAVIOR CHANGE**: `NONE DETECTED`
- **RUST IMPLEMENTATION**: `NOT STARTED`

---

### Objective

Isolate `reference/n8n/packages/workflow` (n8n 2.9.4) into a Workflow LEGO with an
explicit boundary, while keeping n8n behavior identical. No behavior change, no Rust.

### Boundary

- **owns** — workflow structure, node collection, connections, adjacency indexes, graph validation, connection diff, content checksum (10 files)
- **does NOT own** — execution, expression runtime, persistence, webhook runtime, scheduler (reachable only through declared ports)
- **shared kernel** — type vocabulary, constants, errors, utils, observability, config

Full record: `docs/isolation/workflow.md` · contract: `docs/isolation/workflow-port-contract.md` · map: `docs/isolation/workflow-dependency-map.md`

### Gate results

| gate | title | status |
| :--- | :--- | :--- |
| `G01` | boundary drift gate (owned files, crossings, inbound edges) | ✓ PASS |
| `G02` | kernel snapshot conformance (constants/vocabulary vs reference) | ✓ PASS |
| `G03` | port surface matches the imports of the owned sources | ✓ PASS |
| `G04` | reference tree byte-identical to the pinned hashes | ✓ PASS |
| `G05` | isolation extraction (pure import rewrites only) | ✓ PASS |
| `G06` | TypeScript build PASS (isolated unit, ports only) | ✓ PASS |
| `G07` | TypeScript build PASS (versioned boundary/ports/facade) | ✓ PASS |
| `G08` | unit tests PASS (boundary, extraction, equivalence, strict isolation, surface) | ✓ PASS |
| `G09` | BEFORE vs AFTER digest: BEHAVIOR CHANGE NONE | ✓ PASS |
| `G10` | strict port mode: no hidden coupling to the reference runtime | ✓ PASS |
| `G11` | live verification: workflow load / save / 1-node / linear / webhook / execution record | ✓ PASS |

### Requested checklist

| gate | status |
| :--- | :--- |
| TypeScript build PASS | ✓ |
| unit tests PASS (19 tests) | ✓ |
| workflow load PASS | ✓ |
| workflow save PASS | ✓ |
| manual execution PASS | ✓ |
| 1-node PASS | ✓ |
| linear workflow PASS | ✓ |
| webhook PASS | ✓ |
| execution persistence PASS (harness-level; DB-level in VPS baseline) | ✓ |
| reference smoke test 11/11 PASS | ✓ |

### Live verification (reference execution engine)

n8n-core 2.9.1 · n8n-nodes-base 2.9.1 · n8n-workflow 2.9.1 — the exact dependency set of n8n@2.9.4.

| # | check | status |
| :--- | :--- | :--- |
| `R0` | reference runtime fingerprint | ✓ PASS |
| `R1` | workflow load | ✓ PASS |
| `R2` | workflow save / serialize / reload | ✓ PASS |
| `R3` | manual execution — 1 node (manualTrigger) | ✓ PASS |
| `R4` | manual execution — linear workflow (Manual Trigger → Set) | ✓ PASS |
| `R5` | webhook workflow — HTTP POST → Webhook node → engine → HTTP response | ✓ PASS |
| `R6` | execution record written (harness-level persistence) | ✓ PASS |

### Behavioral comparison

- BEFORE (reference runtime) vs AFTER (isolated unit): **252 section comparisons across 18 real n8n workflows — 0 differences**
- Strict port mode (no reference runtime in the module graph): **218 identical checks, 0 undeclared differences**
- Reference tree: **15,050 files byte-identical** to the pinned hashes

### Files

```
packages/workflow-lego/        new — manifest/, src/ports/, src/adapters/, src/kernel/, src/model-surface.ts, test/
tools/                         new — workflow-boundary-map, workflow-kernel-conformance, workflow-port-surface,
                                     workflow-reference-manifest, workflow-isolation-extract, model-digest,
                                     reference-model-api, workflow-isolation-gate, live/engine-harness
docs/isolation/                workflow.md (record), workflow-port-contract.md, workflow-dependency-map.md,
                               workflow-verification.md, evidence/*
scripts/setup-reference-runtime.sh, package.json, .gitignore
reference/n8n/**               UNCHANGED (hash-verified)
```

### Sandbox limitations (not isolation failures)

- The full n8n CLI cannot be installed here: native `sqlite3` needs node headers from nodejs.org (blocked).
- Code nodes execute out of process in n8n 2.x (task runner); the runnable harness uses real non-code nodes and the VPS baseline covers the Code path.

Recorded in `docs/isolation/evidence/live-verification.json → knownLimitations`.
