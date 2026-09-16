# Node LEGO — Rust Implementation Brief (crates/n8n-node-model)

**Author:** Agent 2 (Node Model & Parameter Engineer) · **Date:** 2026-09-17
**Basis:** verified `contracts/node.contract.md` (§1–§11) + `docs/isolation/node-phase3-readiness.md`
**Authority constraint:** `crates/**` is a FORBIDDEN WRITE path for agent-2 — this brief is the
binding specification; implementation corrections happen by the crate's owner or on assignment.

---

## 1. Verdict on the current stub (`c912866b`, 60 LoC lib.rs)

Status: **placeholder — NOT contract-conformant.** Deserialize test only proves a happy-path
`INode`. Three fidelity breaks vs `n8n@2.9.4` source (they will fail on real workflow JSON):

| # | Current (`crates/n8n-node-model/src/lib.rs`) | Source truth (`packages/workflow/src/interfaces.ts`) | Required fix |
|---|---|---|---|
| G-1 | `version: f64` on `NodeTypeDescription` | `version: number \| number[]` (multi-version nodes serialize arrays, e.g. Switch) | untagged enum `Version(N)`:`Number(f64) \| List(Vec<f64>)` |
| G-2 | `inputs/outputs: Vec<String>` | `Array<NodeConnectionType \| INodeInputConfiguration \| INodeOutputConfiguration> \| ExpressionString` | untagged enum entry + `Expr(\`={{…}}\`)` arm; config objects incl. `category:'error'`, `filter`, `maxConnections`, `required` |
| G-3 | missing required description fields | `group: NodeGroupType[]`, `defaults: NodeDefaults`, `properties: INodeProperties[]` are **required** | add fields w/ exact serde names |
| G-4 | `INode` minimal | 13 optional fields missing (`credentials`, `onError`, `retryOnFail`, `maxTries`, `waitBetweenTries`, `alwaysOutputData`, `executeOnce`, `continueOnFail` (deprecated-but-read), `webhookId`, `notes*`, `extendsCredential`, `rewireOutputLogTo?`, `forceCustomOperation`) | add `#[serde(default)]` optionals |
| G-5 | `INodeParameters(Value)` newtype | `{ [name]: NodeParameterValueType }` | acceptable as transparent map — keep, optionally constrain |

Non-issues: `position: [f64;2]` ✓, `#[serde(rename = "type")]` ✓, `typeVersion` required ✓,
inline happy-path test ✓ (keep as golden #1).

## 2. Target module layout (proposal — mirrors contract groups)

```text
crates/n8n-node-model/src/
  lib.rs              // re-exports only (like the TS barrel node-model/index.ts)
  node.rs             // INode, INodes, IPinData, INodeCredentials*, OnError  (G-4)
  description.rs      // INodeTypeBaseDescription/INodeTypeDescription + Icon/Codex/hints (G-1..G-3)
  properties.rs       // INodeProperties family, display options, display conditions
  connection_types.rs // NodeConnectionTypes vocabulary (13 variants, exact string values)
  io.rs               // INodeInput/OutputConfiguration, IConnections family, INodeExecutionData*, issues
  versioned.rs        // VersionedNodeType { currentVersion, nodeVersions, getNodeType() NO fallback }
  helpers/
    parameters.rs     // getNodeParameters, displayParameter*, getNodeParametersIssues…
    io.rs             // getNodeInputs, getNodeOutputs (incl. continueErrorOutput semantics),
                      // getConnectionTypes  — dynamic branch behind DynamicIoEvaluator port
    naming.rs         // makeNodeName, isDefaultNodeName, makeDescription…
  parameters/
    filter.rs         // executeFilter*, validateFilterParameter
    validation.rs     // validateNodeParameters, assertParamIs*
    guards.rs, path.rs
  validation.rs       // validateNodeCredentials, isNodeConnected, isTriggerLikeNode
  reference.rs        // applyAccessPatterns (String -> String), renameFormFields (in-place, html-only)
  traits.rs           // NodeType trait (lifecycle), NodeTypeRegistry, DynamicIoEvaluator (ISSUE-004 seam)
```

## 3. Frozen-port requirements (must exist, exact names — contract §11)

`get_node_parameters`, `get_node_outputs`, `get_node_inputs`, `get_connection_types`,
`rename_form_fields`, `apply_access_patterns` — with the documented semantics
(incl. **`onError:'continueErrorOutput'`: deep-copy → single-output displayName "Success" →
append trailing `{category:'error', type:'main', displayName:'Error'}`**).

## 4. Parity expectations before Phase-3 acceptance of this crate

1. Golden fixtures derived from the 532 reference unit tests (categories listed in
   `node-phase3-readiness.md` §3.1).
2. Serde round-trip: real workflow JSON from `tests/reference/0*/workflow.json` +
   a multi-version + an error-output + an AI-typed-IO node description.
3. Digest conformance (`tools/model-digest.mjs`) on the type surface.
4. No `expression`/`workflow`/`core` linkage (boundary_audit PASS on crate graph).

## 5. Process notes

- Phase-2 gate flavor now reports 20/21 solely because its Phase-2 Rust guard trips on
  `crates/` — needs Agent 5's Phase-3 gate variant (flagged via outbox MSG-07).
- This brief does not modify any crate; it registers required conformance corrections as
  the Node Model owner (outbox MSG-06).
