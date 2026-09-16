# Workflow LEGO → Node LEGO — port freeze (`P-NODE-*`)

| Field | Value |
| :--- | :--- |
| Unit | Phase-2 post-merge handoff — freeze of the **4 peer signatures** the Workflow LEGO consumes from LEGO 02 |
| LEGO | `workflow` (LEGO 01) — status **VERIFIED** on `main` (live 11/11 VPS gate, `docs/isolation/LEGO-MASTER-MAP.md`) |
| Frozen by | `agent-1` — Workflow Domain Engineer (owner of the **consuming** side) |
| Frozen for | `agent-2` — Node Model, LEGO 02 (owner of the **providing** side) |
| Base | `main` @ `3b2636dd` — pulled into `arena/01a0ac62-n8n-rust-v-4` before this freeze was authored |
| Reference | n8n `2.9.4` — `reference/n8n`, upstream `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Authority | `contracts/workflow.contract.md` §6 · `docs/isolation/workflow-port-contract.md` §1/§3 |
| Machine check | `node tools/workflow-port-surface.mjs --check` → **PASS** (manifest ports == consumed ports) |
| Bus envelope | `docs/isolation/workflow-bus-outbox.json#MSG-06` — alias **`MSG-01` (Phase 2)** |
| Rust | **NOT STARTED** — Phase 2 forbids it. §8 sketches trait shapes only, for Phase 3. |

> **What this document is.** The Workflow Model does not import Node internals; it reaches LEGO 02 through
> three declared ports carrying **four functions**. Those four shapes are now frozen. Agent 2 declares them
> in `contracts/node.contract.md`; Agent 5 verifies both sides agree. No reference source is modified by
> this freeze — `reference/n8n/**` stays byte-identical (hash-pinned, `manifest/reference.sha256.json`).

---

## 1. What "frozen" means here

A signature is frozen when its **name**, its **arity and parameter types**, its **return shape** and its
**observable semantics** are fixed. The implementation language is *not* frozen — a TypeScript adapter
today, a Rust trait in Phase 3 — but a change to any of the four properties is a **contract change**, not
an implementation detail:

| A change to… | Consequence |
| :--- | :--- |
| name, arity, parameter order/types, return shape | the consuming call sites in `workflow.ts` stop compiling or silently mis-bind → **freeze broken** |
| observable semantics (see §3) | the digest baseline is invalidated: `docs/isolation/evidence/model-digest.comparison.json` records **252/252 identical** before vs after and **34 declared** strict-mode differences (**18 × `rename`, 16 × `nodeParameters`**, 0 undeclared) |
| anything else (internals of LEGO 02) | allowed — ports exist exactly so Node internals can change freely |

**Change control.** If a signature must change, the change is valid only together with: (a) an amended
`contracts/node.contract.md` **and** `contracts/workflow.contract.md` §6, (b) a re-extraction +
re-run of the isolation gate (`npm run verify`), and (c) Agent-5 re-verification of the new digest
baseline. Until then the four shapes below are the agreement.

---

## 2. The four frozen signatures

Reference truth is quoted verbatim from the pinned source; the port declaration is quoted from
`packages/workflow-lego/src/ports/contracts.ts` (the exact shape the LEGO compiles against).

### 2.1 `P-NODE-MODEL` → `getNodeParameters`

| | |
| :--- | :--- |
| Reference | `reference/n8n/packages/workflow/src/node-helpers.ts:658-666` |
| Port declaration | `contracts.ts` → `NodeModelPort.getNodeParameters` |
| Adapter | `packages/workflow-lego/src/ports/node-model.ts` (namespace import: `NodeHelpers.getNodeParameters`) |
| Call site | `workflow.ts:110-117` — constructor default-injection, **6 arguments, `options` omitted** |
| Options type | `node-helpers.ts:639-645` `GetNodeParametersOptions = { onlySimpleTypes?, dataIsResolved?, nodeValuesRoot?: INodeParameters, parentType?: string, parameterDependencies?: IParameterDependencies }` |

```ts
// reference — node-helpers.ts:658
export function getNodeParameters(
	nodePropertiesArray: INodeProperties[],
	nodeValues: INodeParameters | null,
	returnDefaults: boolean,
	returnNoneDisplayed: boolean,
	node: Pick<INode, 'typeVersion'> | null,
	nodeTypeDescription: INodeTypeDescription | null,
	options?: GetNodeParametersOptions,
): INodeParameters | null

// port — contracts.ts (identical, except `options?: unknown` — see D-02)
getNodeParameters(
	nodePropertiesArray: INodeProperties[],
	nodeValues: INodeParameters | null,
	returnDefaults: boolean,
	returnNoneDisplayed: boolean,
	node: Pick<INode, 'typeVersion'> | null,
	nodeTypeDescription: INodeTypeDescription | null,
	options?: unknown,
): INodeParameters | null
```

### 2.2 `P-NODE-MODEL` → `getNodeOutputs`

| | |
| :--- | :--- |
| Reference | `node-helpers.ts:1140-1144` |
| Port declaration | `contracts.ts` → `NodeModelPort.getNodeOutputs` |
| Adapter | `packages/workflow-lego/src/ports/node-model.ts` |
| Call site | `workflow.ts:694` — inside `getParentMainInputNode()` |
| Output member type | `interfaces.ts:2293-2300` `INodeOutputConfiguration = { category?: 'error'; displayName?: string; maxConnections?: number; required?: boolean; type: NodeConnectionType; filter?: INodeFilter }` |

```ts
// reference — node-helpers.ts:1140
export function getNodeOutputs(
	workflow: Workflow,
	node: INode,
	nodeTypeData: INodeTypeDescription,
): Array<NodeConnectionType | INodeOutputConfiguration>

// port — contracts.ts (union member narrowed — see D-03)
getNodeOutputs(
	workflow: unknown,
	node: INode,
	nodeTypeData: INodeTypeDescription,
): Array<NodeConnectionType | { type: NodeConnectionType; displayName?: string }>
```

### 2.3 `P-NODE-RENAME` → `renameFormFields`

| | |
| :--- | :--- |
| Reference | `reference/n8n/packages/workflow/src/node-parameters/rename-node-utils.ts:3-6` |
| Port declaration | `contracts.ts` → `NodeRenamePort.renameFormFields` |
| Adapter | `packages/workflow-lego/src/ports/node-rename.ts` |
| Call site | `workflow.ts:448` — inside `renameNode()`, guarded at `:447` by `NODES_WITH_RENAMABLE_FORM_HTML_CONTENT.has(node.type)` |

```ts
// reference — rename-node-utils.ts:3 (parameter is named `renameField`; the port names it `rename` — positional, no effect)
export function renameFormFields(
	node: INode,
	renameField: (v: NodeParameterValueType) => NodeParameterValueType,
): void
```

### 2.4 `P-NODE-REFERENCE` → `applyAccessPatterns`

| | |
| :--- | :--- |
| Reference | `reference/n8n/packages/workflow/src/node-reference-parser-utils.ts:104-125` |
| Port declaration | `contracts.ts` → `NodeReferencePort.applyAccessPatterns` |
| Adapter | `packages/workflow-lego/src/ports/node-reference.ts` |
| Call site | `workflow.ts:347` — inside `renameNodeInParameterValue()`, only for `typeof value === 'string'` |

```ts
// reference — node-reference-parser-utils.ts:104 (return type inferred: string)
export function applyAccessPatterns(expression: string, previousName: string, newName: string): string

// port — contracts.ts (parametric widening — see D-04)
applyAccessPatterns(value: NodeParameterValueType, currentName: string, newName: string): NodeParameterValueType
```

---

## 3. Frozen semantics — what Agent 2 must preserve

Measured from the pinned source, not inferred. These are the behaviors the digest baselines depend on.

### 3.1 `getNodeParameters`

* Returns the **resolved parameter object**, or `null`; the caller (`workflow.ts:118`) maps `null` → `{}`
  and assigns it to `node.parameters` — so a port that returns `null` where the reference returns an
  object changes every construction digest (`nodeParameters` section).
* Applies defaults when `returnDefaults = true` and filters out non-displayed values when
  `returnNoneDisplayed = false` (both are the values used by the Workflow LEGO).
* Recursive by design: it calls itself for nested properties/collections (`node-helpers.ts:692, 837, 919,
  954`). A re-implementation must reproduce nesting, not just top-level defaults.
* Uses `deepCopy` (shared kernel `utils`) — values must be **copies**, never references into
  `nodeType.description`.

### 3.2 `getNodeOutputs`

Four observable branches, in order:

| Branch | Behavior | Evidence |
| :--- | :--- | :--- |
| `nodeTypeData` falsy | returns `[]` | `node-helpers.ts:1146-1148` |
| `outputs` is an array | returned as-is | `1150-1151` |
| `outputs` is an `ExpressionString` | evaluated through the **workflow aggregate**: `workflow.expression.getSimpleParameterValue(node, outputs, 'internal', {})`; non-array result → `[]`; on throw → `console.warn('Could not calculate outputs dynamically for node: ', node.name)` + `[]` | `1152-1170` |
| `node.onError === 'continueErrorOutput'` | **deep-copies** the array (must not mutate the node type), wraps a lone string as `{ type }`, sets `displayName = 'Success'` on the first output, appends `{ category: 'error', type: 'main', displayName: 'Error' }` | `1172-1190` |

> **This is the `node → workflow` seam recorded as ISSUE-004.** `getNodeOutputs` receives the workflow
> **aggregate** and calls *into the expression runtime* through it (`workflow.expression`). It is a runtime
> call **out of** LEGO 02 into the expression runtime — *not* a reach into Workflow internals. The Workflow
> LEGO passes `this` (`workflow.ts:694`); no Workflow private state is read by the port.
> `console.warn` is observable behavior (same discipline as `workflow.contract.md` §7).
> Also reachable transitively from the exported `NodeHelpers.isExecutable()` (`node-helpers.ts:1676-1688`),
> which is consumed outside this LEGO — so a wrong `getNodeOutputs` mis-answers execution too.

### 3.3 `renameFormFields`

* Walks `node.parameters.formFields.values[]` **only** when that path is an array; entries whose
  `fieldType === 'html'` get `entry.html = renameField(entry.html)`.
* **Mutates the node in place** and returns `void`; non-object entries are skipped; other paths
  (`node.parameters.jsCode` `:431-438`, `node.parameters.html` `:439-446`) are *not* its business — the
  caller handles those before it calls the port.
* The rename callback passed by the caller closes over `this.renameNodeInParameterValue(...)` with
  `hasRenamableContent: true` (`workflow.ts:448-452`) — i.e. it re-enters the Workflow Model through the
  `P-NODE-REFERENCE`/recursion path. A port implementation that reorders or batches the calls changes the
  `rename` digest section.

### 3.4 `applyAccessPatterns`

* **String in → string out.** Fast path first: `if (!expression.includes(previousName)) return expression;`
* Then, per `ACCESS_PATTERNS` entry whose `checkPattern` occurs in the expression: a global `replace` with
  `backslashEscape(previousName)` as the match and `dollarEscape(newName)` as the replacement, followed by
  an optional `customCallback`.
* Private module helpers travel with the port and are **not** separate ports: `ACCESS_PATTERNS`,
  `backslashEscape`, `dollarEscape`, `LazyRegExp`, the `ITEM_TO_DATA_ACCESSORS` / `DATA_ACCESSORS` tables.
  `OperationalError` (imported in the same file) is used only by `extractReferencesInNodeExpressions`
  (`node-reference-parser-utils.ts:503+`), **not** by `applyAccessPatterns` → no error port is required.

---

## 4. Declared deviations between reference and port (fidelity notes)

These are inherited from the isolation layer, deliberately narrow, and recorded so Agent 2's contract
publishes the **reference** shape (not the erased port type) and Phase 3 does not inherit a lossy trait.
`D-02`–`D-04` are added as a table to `docs/isolation/workflow-port-contract.md` §4.1; `D-05` is noted
there too (it is a type-level accommodation, not a shape change).

| id | signature | reference | port today | handling |
| :--- | :--- | :--- | :--- | :--- |
| `D-02` | `getNodeParameters` | `options?: GetNodeParametersOptions` (5 named fields) | `options?: unknown` | allowed: the Workflow LEGO never passes the 7th argument. `contracts/node.contract.md` must publish the **named** type; the Rust trait must take the full options struct |
| `D-03` | `getNodeOutputs` | `Array<NodeConnectionType \| INodeOutputConfiguration>` | `Array<NodeConnectionType \| { type; displayName? }>` | the LEGO reads only `output.type` (`workflow.ts:698`); the narrowed member is sufficient **for LEGO 01**, but the real `INodeOutputConfiguration` (`category`, `maxConnections`, `required`, `filter`) must be preserved for other consumers |
| `D-04` | `applyAccessPatterns` | `(expression: string, …) => string` | `(value: NodeParameterValueType, …) => NodeParameterValueType` | parametric widening only: the single call site is guarded by `typeof parameterValue === 'string'` (`workflow.ts:341-347`). The Rust trait should take `String`/`&str` |
| `D-05` | `getNodeOutputs` | `workflow: Workflow` (the aggregate class) | `workflow: unknown` | prevents a type cycle in the isolated unit; the call site still passes the real aggregate. The Rust trait takes the aggregate by reference |

---

## 5. Exhaustive consumption inside the Workflow LEGO

Four call sites, nothing else (verified: `grep -n "getNodeParameters\|getNodeOutputs\|renameFormFields\|applyAccessPatterns" reference/n8n/packages/workflow/src/workflow.ts`):

| # | Site | Method | Port | Trigger |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `workflow.ts:110` | `constructor` | `P-NODE-MODEL::getNodeParameters` | once per node, only when the host registry resolves its type |
| 2 | `workflow.ts:347` | `renameNodeInParameterValue` | `P-NODE-REFERENCE::applyAccessPatterns` | string values of `=`-expressions or renamable content |
| 3 | `workflow.ts:448` | `renameNode` | `P-NODE-RENAME::renameFormFields` | node types in `NODES_WITH_RENAMABLE_FORM_HTML_CONTENT` |
| 4 | `workflow.ts:694` | `getParentMainInputNode` | `P-NODE-MODEL::getNodeOutputs` | non-main output detection |

Which public model answers move if a port misbehaves — asserted by
`packages/workflow-lego/test/04-strict-isolation.test.mjs`:

| Port | digest sections affected | model surface affected |
| :--- | :--- | :--- |
| `P-NODE-MODEL` | `nodeParameters` (construction), `triggers`-adjacent answers via dynamic outputs | `Workflow.nodes[].parameters`, `getParentMainInputNode` |
| `P-NODE-RENAME` + `P-NODE-REFERENCE` | `rename` | `renameNode`, `renameNodeInParameterValue`, all connection keys after a rename |

Everything else — adjacency indexes, traversal, connection diffing, checksum, graph helpers, setters — is
port-independent: **218/252** digest sections stay identical with *no* reference runtime in the module graph.

> Label discipline: `tools/model-digest.mjs:373` conservatively lists `triggers` as port-dependent; the
> measured evidence (`model-digest.comparison.json` → `portDependentSections`) and `test/04` record only
> `nodeParameters` + `rename`, because `triggers` follows the **host-injected node-type registry**
> (host input, not a port — `workflow-port-contract.md` §2). Read the evidence, not the label.

---

## 6. What Agent 2 must declare (`contracts/node.contract.md`)

1. The **four signatures verbatim** (§2), under the reference types of §4 — not the erased port types.
2. The three port ids as the LEGO-02 outward obligation: `P-NODE-MODEL` (`getNodeParameters`,
   `getNodeOutputs`), `P-NODE-RENAME` (`renameFormFields`), `P-NODE-REFERENCE` (`applyAccessPatterns`).
3. **Consumers** of the same symbols outside LEGO 01, so they are not broken silently by a rename:
   `getNodeParameters` → `telemetry-helpers.ts:295,548,867`, `workflow-data-proxy.ts:200`;
   `getNodeOutputs` → `node-helpers.ts:1679` (`isExecutable`, exported);
   `renameFormFields` / `applyAccessPatterns` → `workflow.ts` only.
4. The §6 section set required by the brief and already present in `workflow.contract.md`
   (`Purpose`, `Responsibilities`, `Non-responsibilities`, `Dependencies`, `Error behavior`, `Lifecycle`,
   `Data ownership`, `Compatibility requirements`) — Agent-5 reported this structural gap for all four
   contracts (`PHASE-2-INTEGRATION-REPORT.md`).
5. A reply envelope (`DEPENDENCY_RESPONSE`) stating *accepted as frozen* or *change requested with
   evidence*. Anything else leaves the freeze one-sided.

---

## 7. Verification performed for this freeze (base `3b2636dd`)

Executed in this workspace on the pulled `main` (Node 22.22.3), all four offline gates:

```text
node tools/workflow-boundary-map.mjs --check      → PASS (104 src files, 10 owned, 21 crossings, 0 undeclared)
node tools/workflow-port-surface.mjs --check      → PASS (manifest ports == consumed ports)
node tools/workflow-kernel-conformance.mjs --check→ PASS (snapshots match pinned reference)
node tools/workflow-reference-manifest.mjs --check→ PASS (15 050 files, root f8da35180669d798…)
```

Source cross-checks behind §2–§5: the four signatures, the four call sites, the branch behaviors of
`getNodeOutputs`, and the `OperationalError` non-involvement in `applyAccessPatterns` were all read from
the pinned source at the line numbers cited. No file under `reference/n8n/**` was modified.

The **full gate was also re-run end-to-end** on this base (not only the offline subset), after installing
the pinned runtime (`scripts/setup-reference-runtime.sh` → `.runtime`, `n8n-workflow/core/nodes-base`
2.9.1, plus `npm install --prefix packages/workflow-lego`):

```text
npm run verify → 11/11 PASS · BEHAVIOR CHANGE: NONE DETECTED
  G01 boundary drift PASS          G06 tsc (isolated unit) PASS
  G02 kernel snapshot PASS         G07 tsc (boundary/ports/facade) PASS
  G03 port surface PASS            G08 unit tests PASS (19 tests)
  G04 reference tree PASS (15050)  G09 digest 252 sections · 0 differences
  G05 extraction PASS              G10 strict port mode PASS
                                   G11 live engine PASS (7/7: R0–R6)
```

Raw second run preserved as `docs/isolation/evidence/gate-report.reproduction-3b2636dd.json` — kept in a
**separate file on purpose**: the artifacts under `evidence/*.json` that this repository records as
verified for PR #1 are Agent 5's baseline and were left untouched (the reproduction differs from them only
in timestamps, durations and the local runtime path).

Not re-run here: the VPS 11/11 smoke test (needs the VPS host; recorded in
`tests/reference/baseline/SMOKE_TEST_RESULTS.md`).

---

## 8. Phase-3 preview — the four signatures as Rust traits (not implemented)

```rust
pub trait NodeModelPort {
    fn get_node_parameters(
        &self,
        node_properties_array: &[INodeProperties],
        node_values: Option<&INodeParameters>,
        return_defaults: bool,
        return_none_displayed: bool,
        node: Option<&NodeTypeVersionRef>,          // Pick<INode, 'typeVersion'>
        node_type_description: Option<&INodeTypeDescription>,
        options: Option<&GetNodeParametersOptions>, // D-02: the named struct, not `unknown`
    ) -> Option<INodeParameters>;

    fn get_node_outputs(
        &self,
        workflow: &Workflow,                         // D-05
        node: &INode,
        node_type_data: &INodeTypeDescription,
    ) -> Vec<NodeOutput>;                            // D-03: enum, order preserved
}

pub trait NodeRenamePort {
    fn rename_form_fields(&self, node: &mut INode, rename: &mut dyn FnMut(NodeParameterValueType) -> NodeParameterValueType);
}

pub trait NodeReferencePort {
    fn apply_access_patterns(&self, expression: String, previous_name: &str, new_name: &str) -> String; // D-04
}

pub enum NodeOutput { Type(NodeConnectionType), Config(INodeOutputConfiguration) }
```

The compatibility test for that work is the isolation suite: the same digest must stay identical across
the 18-workflow corpus in `tools/model-digest.mjs`, and `test/04` must still show that only the declared
port-dependent sections move.

---

## 9. Process observations (recorded, not fixed here)

1. **`LEGO-MASTER-MAP.md` is ahead of the tree for LEGO 02.** The mediator commit `a092e00f` set Node's
   isolation doc to ✅ and status to `ISOLATED (IN_REVIEW)`, but at `3b2636dd` `docs/isolation/node.md`
   does not exist and `contracts/node.contract.md` still has only `Data Schema` + `Invariants`. Agent 5
   owns that table — flagged here rather than edited.
2. **Bus ids.** Phase-1 envelopes `MSG-01`…`MSG-05` in `workflow-bus-outbox.json` are preserved verbatim;
   this handoff is `MSG-06` with the alias `MSG-01 (Phase 2)` so ids stay unique while the orchestrator's
   instruction (`MSG-01`, freeze of the 4 `P-NODE-*` signatures) remains traceable.
3. **Open and untouched by this unit:** `ISSUE-003` (cycle-detection ownership, Agent 4 + Agent 1),
   `ISSUE-007` (`docs/isolation/{node,connection,validation}.md` missing), and the `graph/**` /
   `connections-diff` ownership question in `MSG-02` (Agent 1 keeps them until Agent 3 answers).

---

## 10. Reproduce

```bash
git fetch origin && git checkout arena/01a0ac62-n8n-rust-v-4 && git pull origin main   # base 3b2636dd
node tools/workflow-port-surface.mjs --check          # the freeze is machine-enforced at the port level
node tools/workflow-boundary-map.mjs --check
grep -n "getNodeParameters\|getNodeOutputs\|renameFormFields\|applyAccessPatterns" \
  reference/n8n/packages/workflow/src/workflow.ts     # the 4 call sites
sed -n '104,125p' reference/n8n/packages/workflow/src/node-reference-parser-utils.ts  # 2.4
```
