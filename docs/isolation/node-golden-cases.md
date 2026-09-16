# Node LEGO — Verified Golden Cases for the Frozen Ports

**Author:** Agent 2 · **Date:** 2026-09-17 · **Status:** VERIFIED-BY-EXECUTION
**Method:** each case was produced by *executing the built reference*
(`reference/n8n/packages/workflow/dist/cjs` @ `n8n@2.9.4` / `n8n-workflow@2.9.1`),
not by hand-computation. Case rationale ties to `contracts/node.contract.md` §11.
**Intended use:** fixtures for the `n8n-node-model` Rust parity tests
(see `docs/isolation/node-rust-brief.md` §4).

Naming note: the contract freezes TS names; Rust mirrors them snake_cased.

---

## GC-1 `applyAccessPatterns(expression, previousName, newName) -> string`

| Input | Expected |
|---|---|
| `("$('Old Node').item.json.a + \"x\"", 'Old Node', 'New Node')` | `"$('New Node').item.json.a + \"x\""` |
| `("const x = $node[\"Old Node\"].json.b", 'Old Node', 'New Node')` | `"const x = $node[\"New Node\"].json.b"` |
| `("no reference here", 'Old Node', 'New Node')` | `"no reference here"` (early return, unchanged) |

## GC-2 `getConnectionTypes(connections) -> NodeConnectionType[]`

| Input | Expected |
|---|---|
| `['main', {type:'main', category:'error', displayName:'Error'}, {type:'ai_tool'}]` | `['main', 'main', 'ai_tool']` |

Strings pass positionally; objects project `.type`; nothing is filtered except `undefined`.

## GC-3 `renameFormFields(node, renameFn) -> void` (mutates in place)

Node before (excerpt): `parameters.formFields.values = [ {fieldType:'html', html:"Hello $('Old Node').item"}, {fieldType:'text', label:'Name'}, {fieldType:'html'} ]`,
`renameFn = s => s.replace('Old Node','New Node')`.

Node after (verified): html of entry 0 → `"Hello $('New Node').item"`; the `text` entry untouched;
the `html`-typed entry **without** an `html` property untouched. Return value: `undefined` (void).

## GC-4 `getNodeOutputs(workflow, node, nodeTypeData)`

| Case | Expected |
|---|---|
| static `outputs:['main']`, no `onError` | `['main']` |
| same + `onError:'continueErrorOutput'` | `[{type:'main', displayName:'Success'}, {category:'error', type:'main', displayName:'Error'}]` |
| `outputs:['main','main']` + `onError:'continueErrorOutput'` | `['main', 'main', {category:'error', type:'main', displayName:'Error'}]` — no "Success" rename for multi-output |
| deep-copy guard | the `INodeTypeDescription.outputs` array is **not mutated** (verified `description_untouched_after_calls: true`) |
| `getConnectionTypes()` of the single-output error case | `['main','main']` → trailing error output is an ordinary trailing index |

Dynamic-output failure path: unchanged behavior — `console.warn` + fallthrough (as in GC-5).

## GC-5 `getNodeInputs(workflow, node, nodeTypeData)`

| Case | Expected |
|---|---|
| static `inputs:['main', {type:'ai_tool', required:true}]` | `['main', {type:'ai_tool', required:true}]` (config objects pass through) |
| dynamic `inputs:'={{...}}'` with evaluator throwing | `[]` (+ `console.warn('Could not calculate inputs dynamically…')`) |

## GC-6 `getNodeParameters(props, values, returnDefaults, returnNoneDisplayed, node, nodeTypeDescription)`

Properties used: `mode`(options, default `'simple'`) · `advOpt`(string, default `'fallback'`, shown only for `mode='advanced'`) · `always`(string, default `''`).

| Case | Expected |
|---|---|
| `values={}`, `returnDefaults=true` | `{ mode:'simple', always:'' }` — defaults applied; display-gated `advOpt` **not** included |
| `values={mode:'simple', advOpt:'typed-but-hidden', always:'={{ 1+1 }}'}` | `{ mode:'simple', always:'={{ 1+1 }}'}` — hidden value dropped; expression string untouched |
| same values, `returnNoneDisplayed=true` | `{ mode:'simple', advOpt:'typed-but-hidden', always:'={{ 1+1 }}'}` |

## GC-7 `VersionedNodeType` / `getVersionedNodeType`

| Case | Expected |
|---|---|
| `nodeVersions={1,2}`, no `defaultVersion` | `currentVersion === 2` (`max(keys)`) |
| `getNodeType()` (no arg) | returns v2 instance |
| `getNodeType(1)` | returns v1 instance |
| `getNodeType(9)` (absent) | `undefined` — **no fallback** |
| `getVersionedNodeType(plainINodeType)` | passthrough (same object) |

---

### Reproduction

```bash
cd reference/n8n/packages/workflow && pnpm --filter n8n-workflow build   # dist must exist
node docs/isolation/node-fixtures.build.cjs            # re-derives docs/isolation/node-fixtures.json
node docs/isolation/node-fixtures.build.cjs --check    # drift check: byte-identical re-derivation
```

(The generator was promoted into the repo at `docs/isolation/node-fixtures.build.cjs`; it
executes the same cases against the built reference and hard-asserts every expectation
above — drift vs this document exits with a regression signal instead of regenerating.
Machine-readable fixtures power `docs/isolation/node-conformance-harness.md`.)

### Parity acceptance rule for `n8n-node-model` (Phase 3)

The crate's unit tests MUST reproduce GC-1..GC-7 byte-identically (JSON equality after
serialization), at minimum for the 6 frozen ports + `VersionedNodeType`. Any deviation is
a conformance defect (register it as MSG back to agent-2/mediator, do not "fix" semantics).
