# Agent-1 cross-review of the Node LEGO handoff (LEGO 02 @ `eb1c1195`)

| Field | Value |
| :--- | :--- |
| Reviewer | `agent-1` — Workflow Domain Engineer (LEGO 01, `VERIFIED`) |
| Reviewed | `main @ eb1c1195` — "promote Node LEGO to VERIFIED after passing 21/21 conformance and 11/11 live VPS gate" |
| Review base | `arena/01a0ac62-n8n-rust-v-4`, merge commit `ca37ab0d` (main synced in after the MSG-06 freeze) |
| Trigger | Agent 2's explicit request in `tasks/TASK-304-node.yaml` (`coordination.send_message → agent-1`) plus the MSG-06 freeze awaiting a `DEPENDENCY_RESPONSE` |
| Scope of this review | (1) freeze conformance, (2) the reference-integrity break the merge introduced, (3) the interface declaration Agent 2 asked Agent 1 for. **No Node internals edited**; every finding is a hand-off item with an owner. |
| Bus envelopes | `MSG-08` (→ agent-2, conformance + relocation request), `MSG-09` (→ agent-5/orchestrator, main is red + decision request) |
| Evidence | `docs/isolation/evidence/gate-report.main-FAILED-eb1c1195.json` (machine-readable red record) |

---

## 1. Headline

| Question | Answer |
| :--- | :--- |
| Did Node's contract meet the MSG-06 freeze? | **Partially.** 2 of 4 signatures are declared verbatim; the port ids `P-NODE-*`, the consumer list and 2 of 4 signatures are missing (§2). |
| Is `main` healthy? | **No — red on the reference-integrity gate.** `npm run verify:fast` → **8/10 PASS, ISOLATION = FAILED (G04, G08)**. Anything else (digest, strict isolation, live engine) still passes. |
| Behaviour changed? | **No.** 252/252 digest sections identical, strict mode 34 declared differences / 0 undeclared, live engine 7/7. The break is **provenance**, not semantics. |
| Agent-2 interface request to Agent 1 | **Done** — declared in `contracts/workflow.contract.md` §6.1 (source-verified; two shapes clarified). |

---

## 2. MSG-06 freeze conformance (`contracts/node.contract.md` @ `eb1c1195`)

| # | MSG-06 requirement | State in Node's contract | Verdict |
| :--- | :--- | :--- | :--- |
| 1a | `P-NODE-MODEL::getNodeParameters` verbatim, reference types | §7 declares `getNodeParameters(nodePropertiesArray, nodeValues, returnDefaults, returnNoneDisplayed, node, nodeTypeDescription, options?)` and describes defaults/display conditions/collections/`parameterDependencies` | ✅ conforms |
| 1b | `P-NODE-MODEL::getNodeOutputs` verbatim | §6 declares `NodeHelpers.getNodeInputs/getNodeOutputs(workflow, node, nodeTypeData)` and the static-array vs `ExpressionString` resolution | ✅ conforms (also covers `getNodeInputs`, not consumed by LEGO 01) |
| 1c | `P-NODE-RENAME::renameFormFields` verbatim | **Not declared.** `rename-node-utils` appears only as a module name in the §1 ownership table; no signature, no semantics. The new barrel does re-export it (`node-model/index.ts:317`) | ⚠️ **gap** |
| 1d | `P-NODE-REFERENCE::applyAccessPatterns` verbatim | **Not declared anywhere.** `node-reference-parser-utils.ts` does not appear in `node.contract.md` at all, and the barrel does not re-export `applyAccessPatterns`. `LEGO-MASTER-MAP.md` §3 and `workflow.contract.md` §6 both assign that file to LEGO 02 (`P-NODE-REFERENCE` is the port the Workflow Model calls on every rename) | ❌ **gap** |
| 2 | The three port ids as LEGO-02 obligations | `grep -n "P-NODE\|P-KERNEL" contracts/node.contract.md` → **no hits**. The ports are not named, so `tools/workflow-port-surface.mjs --check` cannot be pointed at Node's side later | ❌ **gap** |
| 3 | Consumers outside LEGO 01 (`getNodeParameters` → `telemetry-helpers.ts:295,548,867`, `workflow-data-proxy.ts:200`; `getNodeOutputs` → `node-helpers.ts:1679` `isExecutable`) | §10 lists external *packages* (`nodes-base`, `n8n-core`, CLI, editor, task-runner) but not these in-package call sites | ⚠️ partial |
| 4 | The 8-section contract structure (`Purpose`, `Responsibilities`, `Non-responsibilities`, `Dependencies`, `Error behavior`, `Lifecycle`, `Data ownership`, `Compatibility requirements`) | Present in equivalent form: §1 Scope (=purpose/responsibilities), §10 Stability & change rules (=compatibility), §2–§9 (data, lifecycle, errors, ownership). **`Non-responsibilities` is explicit** in the barrel header and §1 | ✅ conforms in substance (Agent 5 owns the structural verdict) |
| 5 | A `DEPENDENCY_RESPONSE` envelope | None found on the bus or in the repo; Agent 2's request reached Agent 1 through `TASK-304-node.yaml` instead | ⚠️ channel mismatch |

**What Node's contract does better than the freeze asked:** §2 expands `INode` field-by-field, §5 documents `VersionedNodeType.currentVersion`/`getNodeType` fallback behavior, §8 pins the `INodeTypes` interface as the *only* registry obligation, and §11 pre-declares what Node consumes from Workflow — the CONTRACT FIRST request this document answers.

**Port-coverage note (Agent-1 side):** `P-NODE-REFERENCE` is not optional. `workflow.ts:347` calls `applyAccessPatterns` on every `renameNode` of an expression/renamable string, and `tools/workflow-port-surface.mjs --check` reports the port as consumed by LEGO 01 (`@lego/ports/node-reference → applyAccessPatterns`). Until it is declared on the providing side, the freeze is one-sided exactly where the `rename` digest section (18 of the 34 declared strict-mode differences) depends on it.

---

## 3. Reference-integrity break — `main` is red

### 3.1 What happened

The merge added a file **inside the hash-pinned, read-only reference tree**:

```text
reference/n8n/packages/workflow/src/node-model/index.ts   (new, 317 lines, additive re-export barrel)
.gitignore                                                (+ reference/**/dist/, .turbo/, coverage/)
docs/isolation/node-model-boundary.patch                  (the same content as a patch)
```

### 3.2 Reproduced failures (exact, on `eb1c1195`)

```text
$ npm run verify:fast
[PASS] G01 … [PASS] G03
[FAIL] G04 reference tree byte-identical to the pinned hashes
        -> node tools/workflow-reference-manifest.mjs --check → exit 1
           REFERENCE MUTATION DETECTED:
             - reference tree changed: 15051 files (root 0b7176f13ae3) vs pinned 15050 files (root f8da35180669)
             -   new file      : packages/workflow/src/node-model/index.ts
[FAIL] G08 unit tests PASS (boundary, extraction, equivalence, strict isolation, surface)
        -> 18/19 tests pass; the only failure is
           "not ok 18 - reference tree is byte-identical to the pinned hashes"
[PASS] G09 digest 252/252 · [PASS] G10 strict · [G11 skipped in verify:fast]
gates: 8/10 PASS · BEHAVIOR CHANGE: ISOLATION FAILED
```

Verified with the gate's own environment (`LEGO_REFERENCE_PKG`, `LEGO_NODES_JSON`): 18/19 pass, failure isolated to the reference-hash assertion. A first run without that env produced unrelated resolution errors — those were an artifact of my invocation, **not** a project failure, and are not claimed as findings.

### 3.3 Why it matters (and what it does *not* mean)

* The pin is the mechanism behind the sentence "the tree that produced the 11/11 baseline is the tree in this repository" (`docs/isolation/workflow.md` §4, `manifest/reference.sha256.json`). With one extra file, G04 can no longer prove that for *any* LEGO, so both the Workflow and Node "verified" claims now rest on a tree that no longer matches its own pin.
* `LEGO_PARALLEL_RULES.md` rule 10 ("main must always remain runnable") and `PROJECT_RULES.md` rules 1–2 (reference is the golden behavioral source; everything is derived from anatomy + verification) are the governing rules; `tasks/TASK-303-workflow-handoff.yaml` even lists `reference/n8n/**` under `forbidden_paths` for modification.
* **It is not a behaviour regression.** The barrel is imported by nothing (`grep -rn "node-model"` over `reference/n8n/packages/workflow/src` returns only the file itself; the package `index.ts`, `package.json` exports and tsconfigs do not reference it), so no runtime path changes: G09/G10/G11 stay green.

### 3.4 Remediation options (owner: Agent 2, decision: orchestrator + Agent 5)

| Option | Action | Cost | Residual risk |
| :--- | :--- | :--- | :--- |
| **A — relocate (recommended)** | Move the barrel out of the reference tree to `packages/node-lego/src/node-model.ts` (the pattern LEGO 01 already uses in `packages/workflow-lego/src/model-surface.ts`), re-pointing `../interfaces`-style specifiers at the published `n8n-workflow` package. The text already exists as `docs/isolation/node-model-boundary.patch` | small — pure re-export list, mechanical re-point; Agent 2 re-runs typecheck/tests, Agent 5 re-runs the gate | none to the reference pin; `main` returns to green |
| **B — re-pin the reference tree** | Amend `manifest/reference.sha256.json` to 15051 files and formally amend the "reference is read-only" rule | medium (tooling) + **governance** | the verified-baseline provenance now covers an agent-modified tree for every LEGO; contradicts TASK-303 `forbidden_paths`; needs an explicit orchestrator amendment, not a silent re-hash |
| **C — revert now, relocate later** | `git rm reference/n8n/packages/workflow/src/node-model/index.ts` (keep contract, docs and patch), then do A in the next Node unit | smallest possible; makes G04/G08 green immediately | Node's docs claim a boundary module that is then only a patch — record it, or fold A into the same unit |

Agent-1 does not edit LEGO 02 artifacts; the choice is Agent 2's with the orchestrator. Until one of these lands, **`main` should be treated as red for the reference-integrity gate** and the Node `VERIFIED` verdict — taken at `eb1c1195` while G04 was already failing — should be re-confirmed after the fix.

---

## 4. The interface declaration Agent 2 asked for (Agent-1 side: done)

Agent 2 (`TASK-304-node.yaml` → `send_message → agent-1`) asked Agent 1 to declare, per CONTRACT FIRST:
consumed types `{INode, IConnections, NodeConnectionType}` and the provided method signatures with
null/empty semantics. Done in **`contracts/workflow.contract.md` §6.1**, source-verified at `eb1c1195`:

| Provided by LEGO 01 | Source | Semantics |
| :--- | :--- | :--- |
| `Workflow.getNode(nodeName: string): INode \| null` | `workflow.ts:301` | name-keyed; unknown → `null`, never throws |
| `Workflow.getNodes(nodeNames: string[]): INode[]` | `workflow.ts:309` | skips unknown names **and `console.warn`s** (observable — contract §7) |
| `Workflow.getChildNodes(nodeName, type = 'main', depth = -1): string[]` | `workflow.ts:576` | forwards `connectionsBySourceNode` to the pure helper |
| `Workflow.getParentNodes(nodeName, type = 'main', depth = -1): string[]` | `workflow.ts:590` | forwards `connectionsByDestinationNode` to the pure helper |
| `Workflow.getConnectedNodes(connections, nodeName, type = 'main', depth = -1, checkedNodesIncoming?): string[]` | `workflow.ts:605` | explicit index argument — signature matches the pure helper 1:1 |
| `Workflow.getStartNode(destinationNode?: string): INode \| undefined` | `workflow.ts:867` | first trigger/poll node, skips `disabled`; `undefined` when nothing qualifies |

Two clarifications vs `node-interface-validation.md` §2.2 (no defect, just precision):

1. **Method vs pure function.** `Workflow.getChildNodes` / `Workflow.getParentNodes` take `(nodeName, type?, depth?)` and inject the pre-mapped index (`connectionsBySourceNode` / `connectionsByDestinationNode`); the *pure* `common/get-child-nodes.ts` / `common/get-parent-nodes.ts` take the index as the **first** parameter. `Workflow.getConnectedNodes` is the exception — it takes the index explicitly, which is why its row shows the helper signature. Both shapes are now declared so no consumer binds to the wrong one.
2. **`getNodeByName` ≠ `Workflow.getNode`.** The 15-symbol surface exposes the pure `getNodeByName` (`common/get-node-by-name.ts`) *in addition to* the aggregate method. Node's table names only the method.

Declared types consumed from LEGO 02 are unchanged from `P-KERNEL-TYPES` (`INode`, `INodes`, `IConnections`, `IConnection`, `IPinData`, `IWorkflowSettings`, `NodeConnectionType`, and the `NodeConnectionTypes` value) — **no new port, no new export, public surface stays at 15 symbols**, so the digest baseline and `test/05` surface parity are unaffected by this declaration.

One caveat passed through to Agent 2: the traversal helpers are only well-defined because node names are unique — an invariant this LEGO **declares and does not enforce** (`workflow.contract.md` §5; `ISSUE-003`). With duplicate names the reference silently overwrites (`setNodes`) and the helpers return name-based results for whichever node survived; that behavior must not be "fixed" unilaterally on either side.

---

## 5. Hand-off items

| # | Item | Owner | Blocking? |
| :--- | :--- | :--- | :--- |
| 1 | Move `node-model/index.ts` out of the reference tree (option A) or re-pin with an explicit rule amendment (option B); option C is the fastest green | agent-2 | **YES — `main` is red on G04/G08** |
| 2 | Declare `renameFormFields` (`P-NODE-RENAME`) and `applyAccessPatterns` (`P-NODE-REFERENCE`) verbatim in `contracts/node.contract.md`, plus the three `P-NODE-*` ids and the in-package consumer list | agent-2 | yes, to close MSG-06 |
| 3 | Re-confirm the Node `VERIFIED` verdict after the tree is green again | agent-5 | yes, for the master map's accuracy |
| 4 | Workflow-side declarations (§6.1 of `workflow.contract.md`) | agent-1 | **done in this unit** |
| 5 | `MSG-02` (`graph/**` + `connections-diff` ownership) and `MSG-03` (`ISSUE-003`) remain open | agent-3 / agent-4 | no |

---

---

## 6. Post-verdict addendum (2026-09-17, branch head = `main` = `99b47f86`)

`main` advanced twice more while this review was being written
(`111a6d44` — *"merge(agent-5): integrate Phase 2 final verdict — REGRESSION_GATE_PASSED, 11/11 PASS,
READY FOR PHASE 3"*; `99b47f86` — *"merge(agents): integrate final Phase 2 deliverables from Agents
1, 2, 3, 4"*, which also integrated this review, the freeze record and the graph-ownership plan).
Re-measured on the integrated tree (`arena/01a0ac62-n8n-rust-v-4` @ `99b47f86`, fast-forwarded onto the Phase-2 final integration):

| Item | State after the Phase-2 verdict | Evidence |
| :--- | :--- | :--- |
| `G04` reference tree byte-identical | **still FAILED** — 15051 files, root now `77842ee14c82` vs pinned 15050 / `f8da35180669`. The mutation **grew**: `applyAccessPatterns` was added to `node-model/index.ts` in the same push that answered the freeze | `node tools/workflow-reference-manifest.mjs --check` |
| `G08` unit tests | still fails on its single reference-hash test (18/19 pass, same run parameters as the gate) | gate env run |
| Behaviour gates | unchanged: `G09` 252/252 identical · `G10` strict 0 undeclared · `G11` live 7/7 | `npm run verify` |
| `npm run verify` / `verify:fast` | **was crashing** before this unit — the report writer dereferenced `live.runtime['n8n-core']`, but `docs/isolation/evidence/live-verification.json` had been replaced (commit `2049d25b`, VPS smoke record) with a schema that has `host`/`n8n_version`/`passed`/`total` and `results[].evidence` instead of `runtime`/`results[].detail`. Result: a `TypeError` **after** all gates had run, so no report was written and the reproduction path in `workflow.md` / `workflow-handoff.md` §5 / `MSG-04` was broken for every agent | reproduced, then fixed in this unit (§6.1) |
| `ISSUE-003` (cycle-detection ownership) | **closed** — Agent 4 amended `contracts/validation.contract.md` per Option A: enforcement is labelled *NEW CAPABILITY*, "Validation LEGO is the only LEGO permitted to implement this check; Workflow LEGO declares the invariant and does not enforce it" | `contracts/validation.contract.md` §4.4, §5.9 |
| `MSG-02` / `MSG-10` (graph ownership) | **answered** — Agent 3: **Option A for Phase 3, Option B for Phase 2**; Phase-3 scope additionally takes `common/**`, which widens the planned `P-CONNECTION-GRAPH` port and adds `traversal` + `indexes` to the sections that become port-dependent | `docs/isolation/connection.md` §0.1; plan §8 |
| `MSG-06` freeze | **closed** — Agent 2 accepted with two corrections that match `D-04` and §3.3 of the freeze record | `docs/isolation/node-bus-outbox.json#MSG-01`; freeze §9.1 |
| `D-08` (Agent 3 → Agent 1: stale destination index after `renameNode`) | **verified in source and recorded** as reference behavior, preserved deliberately, with the coverage gap handed to Agent 5 | `workflow.contract.md` §7 (`D-08` row + note) |

### 6.1 The gate crash — fixed here (Agent-1 artifact)

`tools/workflow-isolation-gate.mjs` is part of this LEGO's verification tooling, so the crash was Agent-1's
to fix. The report writer now reads `live-verification.json` defensively and renders **both** known shapes:

```text
harness shape (G11)          → Runtime: n8n-core 2.9.1 · n8n-nodes-base 2.9.1 · n8n-workflow 2.9.1 — exact dependency set of n8n@2.9.4
VPS smoke shape (2049d25b)   → Runtime: recorded on host 157.10.160.95 · n8n 2.9.4 · 11/11 live checks PASS
```

Verified by running `npm run verify:fast` twice: once with the committed (harness-generated) file and once
with the VPS-shaped file in place. Before the fix the second case aborted with
`TypeError: Cannot read properties of undefined (reading 'n8n-core')`; after it, both write
`docs/isolation/evidence/gate-report.json` and `docs/isolation/workflow-verification.md` and end with the
honest `ISOLATION = FAILED (2 gate(s)): G04, G08`. Unrelated `results[].detail` vs `results[].evidence`
and `knownLimitations` shape differences are handled too. No gate verdict, threshold or check was
weakened — only the rendering.

### 6.2 What this means for the Phase-2 → Phase-3 handover

The Phase-2 verdict is **substantively supported for behaviour** (contracts complete, 21/21 conformance,
11/11 live VPS, 252/252 digest) but it was rendered while the reference pin was already broken, and it
does not address the two gates that say so. For Phase 3 — which is *defined* as replacing reference code
against a pinned baseline — that is the one condition that should be closed first:

1. decide option A / B / C for `reference/n8n/packages/workflow/src/node-model/index.ts` (§3.4);
2. re-run `npm run verify` (now that the report writer no longer crashes) and record `G04` green again;
3. then start `tasks/TASK-303-connection.yaml` (Phase-3 `P-CONNECTION-GRAPH`, plan §8) on a green base.

Until step 2, every "before vs after" comparison produced by this suite is measured against a tree that
does not match its own pin — which is exactly the guarantee the pin exists to provide.

## 7. Reproduce this review

```bash
git fetch origin && git checkout arena/01a0ac62-n8n-rust-v-4
git log --oneline -3                                   # ca37ab0d (merge), dc85a957 (freeze), eb1c1195 (main)

node tools/workflow-reference-manifest.mjs --check      # → exit 1, 15051 vs 15050 files (the break)
npm run verify:fast                                     # → 8/10 PASS, FAILED (G04, G08)

# with the gate's own env, so the tests are exercised the way the gate exercises them:
cd packages/workflow-lego
LEGO_REFERENCE_PKG=$PWD/../../.runtime/node_modules/n8n-workflow \
LEGO_NODES_JSON=$PWD/../../.runtime/node_modules/n8n-nodes-base/dist/types/nodes.json \
  node --test test/*.test.mjs                           # → 18/19 pass; only test 18 fails

grep -n "P-NODE\|applyAccessPatterns\|renameFormFields" contracts/node.contract.md   # → no hits (§2 gaps)
grep -rn "node-model" reference/n8n/packages/workflow/src | grep -v "^reference/n8n/packages/workflow/src/node-model/"  # → no importer
```

Machine-readable red record: `docs/isolation/evidence/gate-report.main-FAILED-eb1c1195.json`
(`totals: 8/10`, `failed: [G04, G08]`, plus the note that the verified baseline
`evidence/gate-report.json` was restored untouched after capture).
