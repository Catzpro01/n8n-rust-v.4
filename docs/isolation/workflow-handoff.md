# Workflow LEGO — Agent-1 handoff & interface proposal

| Field | Value |
| :--- | :--- |
| Agent | `agent-1` — Workflow Domain Engineer |
| LEGO | `workflow` — Workflow Model / DAG lifecycle |
| Phase | 2 — LEGO Isolation |
| Rust | **NOT STARTED** (Phase 2 forbids it — this document is TypeScript-only) |
| Branch | `arena/01a0abf6-n8n-rust-v-4` @ `6105e6f5` |
| Delivered unit | `tasks/TASK-201.yaml` → `results/TASK-201.md` (isolation), this unit `tasks/TASK-303-workflow-handoff.yaml` (specification & handoff) |
| Self-verification | `npm run verify` → **11/11 PASS** (~27 s) |
| Guardian verification | **NOT YET** — Agent 5 has not audited this branch; request in §5 |

> **Isolation ≠ replacement.** The isolated unit is generated from `reference/n8n/packages/workflow`
> (n8n 2.9.4). No Rust exists for this LEGO. Nothing in this document changes n8n behavior.

---

## 1. Interfaces this LEGO consumes (what peers must guarantee)

Declared in `packages/workflow-lego/src/ports/contracts.ts`; full table in
`docs/isolation/workflow-port-contract.md`. 11 ports, machine-checked by
`node tools/workflow-port-surface.mjs --check`.

| Port | Role | Provider | Provides | Reference target |
| :--- | :--- | :--- | :--- | :--- |
| `P-KERNEL-TYPES` | shared kernel | all LEGOs | `INode`, `INodes`, `IConnections`, `IConnection`, `IPinData`, `IWorkflowSettings`, `NodeConnectionType` + `NodeConnectionTypes` value | `interfaces` |
| `P-KERNEL-CONSTANTS` | shared kernel | all LEGOs | `STARTING_NODE_TYPES`, `MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE`, `NODES_WITH_RENAMABLE_*` | `constants` |
| `P-KERNEL-ERRORS` | shared kernel | all LEGOs | `ApplicationError`, `UserError` | `errors/index`, `@n8n/errors` |
| `P-KERNEL-UTILS` | shared kernel | all LEGOs | `dedupe`, `isObject` | `utils` |
| `P-KERNEL-OBSERVABLE` | shared kernel | all LEGOs | `ObservableObject.create` (static-data change tracking) | `observable-object` |
| `P-KERNEL-CONFIG` | shared kernel | **host** | `getGlobalState().defaultTimezone` — the only ambient state the model reads | `global-state` |
| `P-NODE-MODEL` | peer LEGO | **Agent 2** | `getNodeParameters(...)`, `getNodeOutputs(workflow, node, nodeTypeData)` | `node-helpers` |
| `P-NODE-RENAME` | peer LEGO | **Agent 2** | `renameFormFields(node, rename)` | `node-parameters/rename-node-utils` |
| `P-NODE-REFERENCE` | peer LEGO | **Agent 2** | `applyAccessPatterns(value, currentName, newName)` | `node-reference-parser-utils` |
| `P-EXPRESSION-RUNTIME` | runtime | out of Phase-2 scope | `Expression` constructor — stored as `workflow.expression`, **never called** by the model | `expression` |
| `P-EXTERNAL-JSSHA` | third-party | npm | SHA-256 fallback in `workflow-checksum` when WebCrypto is unavailable | `jssha` |

**Not a port:** the node-type registry. It is host input, not a LEGO seam —
`HostContext.nodeTypes.getByNameAndVersion(type, version)`.

---

## 2. Interfaces this LEGO exposes (what Agents 2, 3, 4 may rely on)

Frozen public surface — 15 symbols, identical across `manifest/ownership.json → publicSurface`,
`src/model-surface.ts` (`MODEL_SURFACE_NAMES`) and the generated `.extract/dist/model-api.js`:

| Group | Symbols |
| :--- | :--- |
| aggregate | `Workflow` |
| graph (deep path `graph/graph-utils`) | `getChildNodes`, `getParentNodes`, `getConnectedNodes`, `getNodeByName`, `mapConnectionsByDestination`, `buildAdjacencyList`, `parseExtractableSubgraphSelection`, `getRootNodes`, `getLeafNodes`, `hasPath`, `getInputEdges`, `getOutputEdges` |
| content | `calculateWorkflowChecksum`, `compareConnections` |
| types (compile-time) | `INode`, `INodes`, `IConnections`, `IConnection`, `IConnectedNode`, `INodeConnection`, `IPinData`, `IWorkflowSettings`, `NodeConnectionType`, `NodeConnectionTypes`, `IConnectionAdjacencyList`, `ExtractableSubgraphData`, `ExtractableErrorResult`, `ConnectionsDiff`, `INodeConnectionsDiff`, `WorkflowSnapshot`, `WorkflowParameters` |

### 2.1 `Workflow` class members (verbatim from `workflow.ts`, 75 tab-indented members)

| Kind | Members |
| :--- | :--- |
| fields | `id`, `name`, `nodes: INodes`, `connectionsBySourceNode`, `connectionsByDestinationNode`, `nodeTypes`, `expression`, `active`, `settings`, `readonly timezone`, `staticData`, `pinData` (+ input shape `WorkflowParameters`) |
| setters | `setNodes`, `setConnections`, `setPinData`, `setSettings`, `overrideStaticData`, `setTestStaticData` |
| lookup | `getNode`, `getNodes`, `getPinDataOfNode`, `getStaticData`, `queryNodes`, `getTriggerNodes`, `getPollNodes` |
| traversal | `getChildNodes`, `getParentNodes`, `getConnectedNodes`, `getParentNodesByDepth`, `searchNodesBFS`, `getParentMainInputNode`, `getConnectionsBetweenNodes`, `getNodeConnectionIndexes`, `getHighestNode` |
| start node | `getStartNode`, `__getStartNode` |
| rename | `renameNode`, `renameNodeInParameterValue` |

---

## 3. Ownership conflicts raised by Agent 5

### 3.1 `graph/**` and `connections-diff` — Workflow (Agent 1) vs Connection (Agent 3)

`LEGO-MASTER-MAP.md` assigns `graph/graph-utils.ts` + `connections-diff.ts` to the **Connection**
LEGO; `packages/workflow-lego/manifest/ownership.json` lists both under **Workflow**, because the
Phase-2 extraction included them to preserve barrel/type parity.

Source evidence (measured, not assumed):

| Fact | Evidence |
| :--- | :--- |
| `graph/graph-utils.ts` has **zero runtime imports** | line 1 is the file's only import: `import type { IConnection, IConnections } from '../interfaces'` |
| nothing inside the package uses it except the barrel | `grep -rn "graph/graph-utils"` → `index.ts:80` only |
| `connections-diff.ts` likewise | only import is `import type { ... } from '.'` (this is deviation **D-01**, normalized to port `P-KERNEL-TYPES`) |
| its only consumer is `workflow-diff.ts` | `workflow-diff.ts:11` |

**Consequence:** both modules are pure, dependency-free leaves. Lifting them into a Connection LEGO
costs an import-path change only — no runtime coupling to `Workflow`, no behavior risk.

**Proposal (needs Agent 3 + Agent 5 agreement, Phase-3 action):**
* **Option A (recommended):** Connection owns `graph/**` + `connections-diff`; Workflow re-exports the
  12 graph + 2 content symbols through a declared port `P-CONNECTION-GRAPH`. Requires re-extraction and
  a re-run of the 11/11 gate — therefore **not** done in this unit.
* **Option B:** Workflow keeps them (current state) and Agent 3 declares them as *consumed* from the
  Workflow contract. Cheapest, but leaves the master map inconsistent with the manifest.
* Until one is chosen, both documents are correct about *content* and inconsistent about *ownership* —
  recorded here so it is a decision, not a silent drift.

### 3.2 Cycle detection — Workflow (Agent 1) vs Validation (Agent 4) → `ISSUE-003`

**Finding: the reference implements no cycle detection in the Workflow Model — and neither does the
file the master map assigns to Validation.**

| Claim | Evidence |
| :--- | :--- |
| `packages/workflow/src` contains no cycle logic | `grep -rIn cycle packages/workflow/src` → **2 hits, both the word "lifecycle"** in `execution-context.ts:96,118` |
| the only `detectCycles` in the whole reference tree | `packages/@n8n/workflow-sdk/src/codegen/graph-annotator.ts:16` — DFS (`visiting`/`visited`) over a `SemanticGraph`, called at line 159 by the SDK **codegen** annotator. Different package, different data structure, not a runtime workflow guard |
| `workflow-validation.ts` (named by `TASK-204`) implements | `validateWorkflowHasTriggerLikeNode(nodes, nodeTypes, ignoreNodeTypes)` — a trigger-presence check, unrelated |

**Proposed resolution (Agent 1 side done in this unit):** the acyclicity claim is a *declaration of
intent*, not reference behavior.
* Workflow owns the structural **invariant declaration** and explicitly does **not** enforce it.
  → `contracts/workflow.contract.md` §4/§5 amended accordingly by Agent 1.
* Validation **may** own the enforcement, but must list `CycleDetection` as a **NEW CAPABILITY**, not
  as source fidelity, and must not cite `@n8n/workflow-sdk` as its implementation.
* Requested from Agent 4: amend `contracts/validation.contract.md` §2 the same way (`MSG-03`).

> The same audit shows `NodeUniqueness` and `DanglingConnections` are also **not** enforced anywhere in
> `packages/workflow/src`: `setNodes()` silently overwrites duplicate names and `getNode()` returns
> `null` for unknown names. Details in `contracts/workflow.contract.md` §5.

---

## 4. Responses to Agent-5 issues where Agent 1 is the required owner

| Issue | Agent-1 response |
| :--- | :--- |
| **ISSUE-002** — uncontracted `expression` on Workflow's critical path | The seam is already declared: `P-EXPRESSION-RUNTIME` is an **opaque** port — the model stores the instance (`workflow.expression`, workflow.ts:134) and never calls it. Node-output resolution goes through `P-NODE-MODEL`. `contracts/expression.contract.md` now exists on the peer branch `arena/01a0ac05` → gap closes when that branch lands. |
| **ISSUE-003** — cycle-detection ownership conflict | Resolved from source, see §3.2. Agent-1 half fixed in `contracts/workflow.contract.md`; Agent-4 half requested via `MSG-03`. |
| **ISSUE-006** — hidden coupling via `getGlobalState()` (LOW, owner Agent 1) | **Fixed by the isolation itself.** `workflow.ts:132` (`this.settings.timezone ?? getGlobalState().defaultTimezone`) is now reachable only through port `P-KERNEL-CONFIG`, i.e. injectable, and is exercised as an explicit input in the digest matrix (`construction` section). The only `process.env` reads inside this LEGO are the adapter-mode switches in `src/ports/runtime.ts` (`LEGO_PORT_MODE`, `LEGO_REFERENCE_PKG`) — tooling, not model behavior. Answer to the master map's "can Workflow be swapped?" question becomes **yes, through 11 declared ports**. |
| **ISSUE-001 / ISSUE-008** — artifacts landing on `main` directly | Not Agent-1's to fix, but this branch follows the flow from here on: PR #1 stays **unmerged** until Agent 5 verifies (§5). No further direct commits to `main` from Agent 1. |
| **Contract structural gap** — all 4 contracts lack brief §6 sections | Agent-1 half fixed: `contracts/workflow.contract.md` now carries Purpose, Responsibilities, Non-responsibilities, Invariants (declared vs enforced), Dependencies, Error behavior, Lifecycle, Data ownership, Compatibility requirements. Peers own theirs. |

---

## 5. Verification request to Agent 5 (`SPECIFICATION_READY`)

**Subject:** branch `arena/01a0abf6-n8n-rust-v-4` @ `6105e6f5` (PR #1, base `main`).

Reproduce (all offline, no VPS, no live n8n host required):

```bash
npm run verify          # 11/11 PASS, ~27 s   — writes docs/isolation/evidence/gate-report.json
npm run verify:fast     # 10/10 PASS          — same minus the live engine harness
npm run isolation:check # boundary + kernel + port-surface + reference-hash checks
npm run workflow-lego:test   # 19/19 unit tests (boundary, extraction, equivalence, strict, parity)
```

Expected evidence, already committed:

| Artifact | Content |
| :--- | :--- |
| `docs/isolation/evidence/gate-report.json` | G01–G11 verdicts, all PASS |
| `docs/isolation/evidence/model-digest.comparison.json` | 18 workflows × 14 sections: **252/252 identical** (before vs after); strict mode 218 identical / 34 declared port diff / **0 undeclared** |
| `docs/isolation/evidence/live-verification.json` | live engine 7/7 PASS + known limitations L1–L3 |
| `docs/isolation/workflow-verification.md` | generated human-readable report |

Honest limits (do not accept these gate rows at face value elsewhere):

* **L1** — Code-node task runner cannot run in this sandbox (`additionalData.startRunnerTask` absent);
  the live harness uses `n8n-nodes-base.set` for the linear/webhook workflows.
* **L2** — n8n CLI / TypeORM / `sqlite3` are not installable here, so **DB-level execution persistence
  (baseline checks 6/11) is not replayable** in this environment; it is recorded as a VPS-baseline item.
* **L3** — the webhook listener is exercised in-process over HTTP, not through the CLI webhook server.

### 5.1 Explicit non-goals of this unit

No new isolation code, no changes under `reference/n8n/**`, no Rust, no merge of PR #1.

### 5.2 Boundary amendment request (for the guardian to accept or reject)

`tasks/TASK-201-workflow.yaml` (from `main`) whitelists only
`reference/n8n/packages/workflow/**` + `docs/isolation/workflow.md`. The delivered isolation cannot
physically live there — it needs `packages/`, `tools/`, `scripts/`, `tests/`, `tasks/`, `results/`.
This branch therefore treats those as **additive, agent-1-scoped** paths and declares them explicitly in
`tasks/TASK-303-workflow-handoff.yaml`. Requested: either accept the superset as the Agent-1 boundary, or
return a corrected `allowed_paths` list — in which case the isolation unit must be relocated before merge.

---

## 6. Outgoing messages

Envelopes are in `docs/isolation/workflow-bus-outbox.json` (schema-matched to
`public.agent_messages`). **Transport status: not delivered** — the repository contains only the
Supabase migration (`docs/supabase_migration.sql`), no client, and no `service_role` key is available;
RLS grants `anon` SELECT only, so the publishable key cannot insert. Delivery requires either the
secret key or an orchestrator-side flush.

**Owner decision (2026-09-17): keep the file-based outbox as the transport for now** — no Supabase
client is to be added by Agent 1; the orchestrator flushes these envelopes when a service-role key
is available.

---

## 7. Reconciliation with `main`'s TASK-301 spec (`docs/isolation/workflow_spec.md`)

While this unit was being written, `main` advanced to `f71f66b8` (`merge(agent-1): Phase 2 pure workflow
domain model isolation spec verified by Agent 5`) and now carries a **second Agent-1 artifact** produced
by the orchestrator's pipeline: `docs/isolation/workflow_spec.md` (TASK-301, gated by TASK-302).
It is a specification document only — it changes no code, no `reference/**` and no boundary — but three
of its statements sit next to this LEGO's measured reality:

| # | `workflow_spec.md` says | Measured reality | Action needed |
| :--- | :--- | :--- | :--- |
| 1 | §3.5 lists `detectCycles(nodes, connections): boolean` as a pure function **of the Workflow LEGO** | No such function exists in `packages/workflow/src` (§3.2), and it is not part of the frozen 15-symbol surface | **Decision required** — see §7.2 |
| 2 | §3.2/§3.3 give Rust-shaped signatures (`getNode(...) -> NodeReference`, `Vec<String>`) | Phase 2 forbids Rust; the frozen surface is TypeScript with the signatures in §2.1 | Read those lines as Phase-3 sketches, not Phase-2 deliverables |
| 3 | §6 pre-writes "Reference Smoke Test: 11/11 PASS" and "Interface Contract Verification by Agent 5: VERIFIED" | This branch's *measured* results are 11/11 gates + 7/7 live engine; guardian verification of this branch is still **pending** (§5) | Guardian should verify the branch, not the merge message |

### 7.1 The "11/11" label is ambiguous — three different gates wear it

| Named "11/11" | Where | What it actually counts | Runnable in this sandbox? |
| :--- | :--- | :--- | :--- |
| VPS smoke test | `tests/reference/baseline/SMOKE_TEST_RESULTS.md` | 11 end-to-end n8n lifecycle checks (start, editor, login, create, save, load, manual exec, 1-node, linear, webhook, execution recorded) | **No** — needs the VPS |
| Isolation gate | `tools/workflow-isolation-gate.mjs` (`npm run verify`) | **11 gates** G01–G11 (boundary, kernel, ports, reference hash, extraction, 2× tsc, tests, digest, strict, live) | **Yes** (≈27 s) |
| Agent-5 regression gate | `tests/integration/regression_gate.py` | **5 checks** (healthz, editor UI, webhook, DB execution, contracts) — `total_checks = 5` | **No** — needs live n8n on `127.0.0.1:5678` |

Discrepancy worth recording: `tasks/TASK-302-agent5-gate.yaml` sends
`gate_score: "11/11 PASS"`, while the gate actually executed in `results/TASK-302-agent5-gate.md` logged
`GATE RESULT: 5/5 CHECKS PASSED`. Both results are legitimate; only the label is unsupported.
Recommendation: the merge condition should name the gate *and* its check count, e.g.
`vps_smoke_11/11` vs `isolation_gate_11/11` vs `agent5_gate_5/5`.

### 7.2 Open decision — does the Workflow LEGO gain `detectCycles`?

| Option | Consequence | Status |
| :--- | :--- | :--- |
| **A. Keep the model faithful** (current) — Workflow declares the acyclic invariant, does not enforce it; Validation owns enforcement as a **new capability** | Public surface stays at 15 symbols; digest baseline 252/252 remains meaningful; no reference-behavior drift | **DECIDED by repo owner 2026-09-17** — implemented in `contracts/workflow.contract.md` §4/§5 (see also §3.2 above) |
| **B. Add `detectCycles` to the Workflow LEGO** as an explicitly **new** capability | Surface 15 → 16; requires updating `manifest/ownership.json → publicSurface`, `MODEL_SURFACE_NAMES`, the `.extract` facade, the 19/19 surface-parity test, and re-running the 11/11 gate. The function would also have to be listed as *not* reference-derived | **REJECTED by repo owner 2026-09-17** — do not implement without a new decision |

### 7.3 Task-ID collision resolved

`main` added `tasks/TASK-301-workflow-isolation.yaml` (id `TASK-301-workflow-isolation`, orchestrator
pipeline). This branch's handoff unit was renamed
`tasks/TASK-301-workflow.yaml` → **`tasks/TASK-303-workflow-handoff.yaml`** (id
`TASK-303-workflow-handoff`) so the two units cannot be mistaken for each other.
