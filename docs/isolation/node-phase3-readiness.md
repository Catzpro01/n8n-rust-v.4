# Node LEGO — Phase 3 Readiness (pre-Rust groundwork)

**Author:** Agent 2 · **Date:** 2026-09-17 · **Status of Phase 2:** VERIFIED (master-map)
**Constraint honored:** this document is preparation only. `crates/` and `apps/n8n-rust/`
remain untouched; Rust implementation starts only on an official Phase-3 manifest.

Lifecycle position: `DISCOVERED → ISOLATED → CONTRACTED → REFERENCE TESTED ✅` —
this document maps what `RUST IMPLEMENTED` must reproduce for the Node LEGO.

---

## 1. What the Rust port must reproduce (scope from the verified contract)

### 1.1 Type-only surface (zero behavior — direct Rust `struct`/`enum`/`trait` mapping)

| Group | Symbols (from `contracts/node.contract.md`) | Rust shape |
|---|---|---|
| Instance | `INode`, `INodes`, `IPinData`, `INodeCredentials[Details]`, `OnError` | serde structs w/ camelCase; `Position([f64; 2])` |
| Values | `NodeParameterValueType` (string\|number\|boolean\|null + ResourceLocator/Mapper/Filter/Assignment), `INodeParameters` | tagged enum + map |
| Properties | `INodeProperties` family + display options | struct set + option enums |
| Description | `INodeTypeBaseDescription`, `INodeTypeDescription` | structs; `inputs/outputs: Vec<…> \| ExprString` |
| IO | `NodeConnectionType[s]` (13 variants), `INode(Input\|Output)Configuration`, `IConnections` family | const-tagged enums; map-of-map-of-vec |
| Lifecycle | `INodeType`, `IVersionedNodeType`, `Node` abstract | **traits**: `NodeType { fn description(); fn execute(); … }` |
| Items/issues | `INodeExecutionData` (`{json,binary?,pairedItem?}`), `INodeIssues*` | structs |
| Registry | `INodeTypes` interface | trait `NodeTypeRegistry` (impl lives in infra LEGO) |

### 1.2 Runtime-behavior surface (pure functions → Rust `fn` ports; golden parity required)

| Module | Functions | Expression-free? |
|---|---|---|
| `node-helpers` | `getNodeParameters` (defaults/display merge), `displayParameter(Path)`, `getConnectionTypes`, `getNodeParametersIssues`, `getParameterIssues`, `mergeNodeProperties`, `getVersionedNodeType(All)`, `isTriggerNode`, `isDefaultNodeName`, `makeNodeName`, `makeDescription`, `checkConditions`, `getNodeFeatures`, `isSubNodeType`, `makeToolDescription…`, `nodeHasOutputType`, `nodeAcceptsInputType` | ✅ pure over data |
| `node-helpers` | `getNodeInputs`, `getNodeOutputs` — **dynamic branch calls `workflow.expression.getSimpleParameterValue`** | ⚠️ expression seam (ISSUE-004) |
| `node-helpers` | `isExecutable`, `getNodeWebhookPath/Url` | `Workflow` type-edge / env-free strings |
| `versioned-node-type` | `getLatestVersion`, `getNodeType` (no-fallback semantics!) | ✅ pure |
| `node-validation` | `validateNodeCredentials` (uses `displayParameter`), `isNodeConnected`, `isTriggerLikeNode` | ✅ pure |
| `node-parameters` | `executeFilter*`, `validateFilterParameter`, `validateNodeParameters`, `assertParamIs*`, type-guards, `resolveRelativePath`, `renameFormFields` | ✅ pure |
| `node-reference-parser-utils` | `applyAccessPatterns` (string→string), `hasDotNotationBannedChar`, escapes | ✅ pure |

## 2. Cycle mitigation for the Rust architecture (recorded ISSUE-004/006)

1. **Expression seam → injected trait.** Node core must never link the expression runtime.
   `getNodeInputs/getNodeOutputs` receive a host-injected `DynamicIoEvaluator` port;
   with it absent/mocked, only the static-array branch executes (matches reference
   `Array.isArray(...)` fast path). `isExpression` becomes a pure detector fn in node core.
2. **Workflow type-edge → port.** `isExecutable/isNodeConnected` expressed over
   `IConnections` + node names only (data in, verdict out); the `Workflow` aggregate stays
   outside.
3. **Registry → trait, impl external.** `INodeTypes.getByName(AndVersion)` is a Rust trait
   whose implementation is provided by the loading/infra layer (Agent 4), so node core has
   no io/fs dependency.

## 3. Verification plan for the Rust port (parity gates)

1. **Golden cases from the reference suite** — the 532 node-LEGO unit tests
   (`node-helpers*`, `node-validation`, `node-parameters/*`, `filter-parameter`,
   `rename-node-utils`) map 1:1 to Rust golden fixtures; JSON in/out via
   `tests/reference/harness/run.js` conventions already on main.
2. **Shape conformance** — keep the contract table (§1–§8) machine-checkable against
   `tools/model-digest.mjs` digests of the TS source (already used by conformance 21/21).
3. **Live parity** — Phase-2 caveat #1 applies first: re-run the 11/11 on VPS+PostgreSQL
   to refresh the canonical baseline *before* any swap (Phase-3 task per integration report).
4. **Frozen ports** — Rust must expose at minimum the 6 frozen symbols of
   contract §11 (P-NODE-MODEL×4, P-NODE-RENAME, P-NODE-REFERENCE) with identical names/
   semantics (they are cross-LEGO API).

## 4. Cross-LEGO answers delivered with this document

- **→ Agent 3 (CD-05 open question):** runtime-confirmed at `node-helpers.ts:1140-1200` —
  `onError:'continueErrorOutput'` deep-copies outputs, renames a single output's displayName
  to `'Success'`, and **appends trailing** `{category:'error', type:'main', displayName:'Error'}`
  (ordinary final index). Now formalized in contract §11.
- **→ Agent 3 (CD-05 symbols):** `getNodeInputs` and `getConnectionTypes` frozen in §11
  (same freeze discipline as the four MSG-01 symbols).
- **→ Agent 4:** validation-side references to `validateFieldType`/`filter-parameter` were
  re-checked — ownership per master map stands (`type-validation.ts` = Validation;
  `filter-parameter` = Node). No change; noted for the Phase-3 crate split.

## 5. Not started here

- No Rust code, no `crates/`, no `apps/n8n-rust/` changes.
- No extraction/move of TS implementations (barrel remains the boundary).
- No changes to other agents' files/contracts.
