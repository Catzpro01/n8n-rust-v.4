# Workflow LEGO — Port Contract

The Workflow Model does not reach into the rest of n8n. Everything it needs from
outside is declared here, implemented in `packages/workflow-lego/src/ports/*` and
enforced by `tools/workflow-boundary-map.mjs --check`.

This document is the input for two later decisions:

1. **LEGO 02–04 boundaries** — which peer LEGOs must exist before the Workflow LEGO can be replaced.
2. **The Rust contract** — every port below becomes a Rust trait (or is proven unnecessary).

Machine-readable form: `packages/workflow-lego/manifest/ownership.json` (`ports[]`, `deviations[]`, `extraction.portSpecifiers`).

> **Peer signatures are frozen.** The four functions behind `P-NODE-MODEL`, `P-NODE-RENAME` and
> `P-NODE-REFERENCE` — what LEGO 02 must provide — are frozen with their verbatim reference shapes, call
> sites and semantics in [`workflow-node-port-freeze.md`](./workflow-node-port-freeze.md) (bus envelope
> `MSG-06` in [`workflow-bus-outbox.json`](./workflow-bus-outbox.json)). Port-level type deviations
> `D-02`–`D-05` are listed in §4.1 below.

---

## 1. Port table

| port | kind | direction | provided by | consumed as |
| :--- | :--- | :--- | :--- | :--- |
| `P-KERNEL-TYPES` | types (+ 1 value) | in | shared kernel | `import type {…} from './interfaces'`, `NodeConnectionTypes` value |
| `P-KERNEL-CONSTANTS` | values | in | shared kernel | 5 constants in the `Workflow` class |
| `P-KERNEL-ERRORS` | values | in | shared kernel | `ApplicationError`, `UserError` |
| `P-KERNEL-UTILS` | functions | in | shared kernel | `dedupe`, `isObject` |
| `P-KERNEL-OBSERVABLE` | function | in | shared kernel | `ObservableObject.create` for `staticData` |
| `P-KERNEL-CONFIG` | function | in | shared kernel | `getGlobalState().defaultTimezone` |
| `P-NODE-MODEL` | functions | in | LEGO 02 — Node Model | `getNodeParameters`, `getNodeOutputs` |
| `P-NODE-RENAME` | function | in | LEGO 02 — Node Model | `renameFormFields` |
| `P-NODE-REFERENCE` | function | in | LEGO 02 — Node Model | `applyAccessPatterns` |
| `P-EXPRESSION-RUNTIME` | class | in | runtime (out of scope) | `new Expression(workflow)` in the constructor |
| `P-EXTERNAL-JSSHA` | class | in | third-party (`jssha`) | SHA-256 fallback in `workflow-checksum` |

Outbound (consumers of the LEGO) are the 6 318 `n8n-workflow` import sites in the
monorepo plus `index`, `expression`, `node-helpers`, `workflow-data-proxy`,
`workflow-diff` inside the package. They are listed in
[`workflow-dependency-map.md`](./workflow-dependency-map.md) and are why the LEGO
must keep its current public surface stable.

---

## 2. Host-provided capability (not a port)

`Workflow` also requires a **node-type registry** in its constructor
(`nodeTypes.getByNameAndVersion(type, version)`). It is a *host input*, passed by
the caller, not an ambient dependency — the model never imports it. This is why
node-type-dependent answers (`getTriggerNodes`, `getStartNode`,
`getParentMainInputNode`) are identical in strict port mode: they follow the
registry the host injects, and are therefore part of the host contract instead of
a port.

---

## 3. Which model behavior each port can affect

This mapping is tested (`test/04-strict-isolation.test.mjs`): swapping a port must
change **only** the listed behavior. Anything else would be hidden coupling.

| port | affects |
| :--- | :--- |
| `P-NODE-MODEL` | `nodes[].parameters` after construction (defaults), dynamic `outputs` in `getParentMainInputNode` |
| `P-NODE-RENAME` | `renameNodeInParameterValue` for form nodes |
| `P-NODE-REFERENCE` | `renameNodeInParameterValue` for expression strings / access patterns |
| `P-EXPRESSION-RUNTIME` | only the object stored on `workflow.expression` |
| `P-KERNEL-*`, `P-EXTERNAL-JSSHA` | values semantically, no behavior branch |
| *(host registry)* | `getTriggerNodes`, `getPollNodes`, `getStartNode`, `getParentMainInputNode` |

Everything else — structure, adjacency indexes, traversal, connection indexes,
connection diffing, checksum, graph validation, setters — is answered by the LEGO
itself, with no engine present.

---

## 4. Known deviation

| id | file | edge | kind | handling |
| :--- | :--- | :--- | :--- | :--- |
| `D-01` | `connections-diff.ts` | `connections-diff → index` | type-only import from the package barrel (`.`) instead of `./interfaces` | normalized to `P-KERNEL-TYPES` when the isolated unit is built; the reference source is left untouched |

Recorded rather than silently fixed: the phase forbids editing `reference/n8n/**`.
It disappears when the Rust implementation replaces both files.

### 4.1 Declared signature deviations (`P-NODE-*`)

The three peer ports carry four functions whose port-level types are *deliberately narrower* than the
reference signatures. Frozen — with the reference truth each deviation restores — in
[`workflow-node-port-freeze.md`](./workflow-node-port-freeze.md) §4; they must not be carried into the
Rust traits.

| id | signature | reference | port | why it is allowed |
| :--- | :--- | :--- | :--- | :--- |
| `D-02` | `getNodeParameters` | `options?: GetNodeParametersOptions` (5 named fields) | `options?: unknown` | the Workflow LEGO never passes the 7th argument (`workflow.ts:110-117`) |
| `D-03` | `getNodeOutputs` | `Array<NodeConnectionType \| INodeOutputConfiguration>` | `Array<NodeConnectionType \| { type; displayName? }>` | the LEGO reads only `output.type` (`workflow.ts:698`); other consumers (`NodeHelpers.isExecutable`) need the full member |
| `D-04` | `applyAccessPatterns` | `(expression: string, …) => string` | `(value: NodeParameterValueType, …) => NodeParameterValueType` | parametric widening only; the single call site is guarded by `typeof === 'string'` |

(`getNodeOutputs`'s `workflow: Workflow` → `workflow: unknown` is recorded as `D-05` in the freeze
document: it breaks a type cycle in the isolated unit without changing the runtime call.)

---

## 5. Rust mapping (preview — implementation NOT started)

When the Rust crate is written, each port becomes a trait and the LEGO's public
surface (15 symbols in `manifest.publicSurface`) becomes the crate's public API:

```rust
trait NodeModelPort { fn get_node_parameters(..) -> Option<NodeParameters>; fn get_node_outputs(..) -> Vec<Output>; }
trait NodeRenamePort { fn rename_form_fields(..); }
trait NodeReferencePort { fn apply_access_patterns(..) -> ParameterValue; }
trait ObservableObjectPort { fn create(..) -> StaticData; }
// host input, not a trait: the node-type registry
```

The isolation suite is the compatibility test for that work: the same digest
(BEFORE = the reference runtime, AFTER = the Rust model) must stay identical
across the corpus in `tools/model-digest.mjs`.
