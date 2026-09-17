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

## Wave 2 — extended pure-function coverage (readiness doc §1.2)

All values below were produced by executing the pinned reference dist (same discipline as
GC-1..GC-7); the in-repo generator hard-asserts them (exit 3 = regression).

### WG-1 `resolveRelativePath(fullPath, candidate) -> string`

| Input | Expected |
|---|---|
| `('parameters.a.b.c', '&d')` | `'a.b.d'` |
| `('parameters.a.b[0].c', '&d')` | `'a.b[0].d'` |
| `('parameters.a.b.c', 'd')` | `'d'` (non-relative passthrough) |
| `('parameters.a', '&d')` | `'d'` (empty path-to-leaf → root-relative) |

### WG-2 `hasDotNotationBannedChar(nodeName) -> boolean`

| Input | Expected | Note |
|---|---|---|
| `'normalNode'` | `false` | dot-notation usable |
| `'NormalNode1'` | `false` | digit suffix fine |
| `'Node A'` | `true` | **space is banned** (dot-notation unusable for names with spaces) |
| `'with.dot'` / `'1digit'` / `'a-b'` / `'under_score'` | `true` ×4 | dot, leading digit, dash, **underscore** all banned |

### WG-3 `mergeNodeProperties(main, add) -> void` (in-place)

| Case | After |
|---|---|
| main `[a]`, add `[b]` | `[a,b]` (append) |
| main `[a,b]`, add `[a']` | `[a',b]` — same-name **replaced at its original index**, not moved |
| add entry with `doNotInherit:true` | unchanged (skipped) |

### WG-4 `makeNodeName(parameters, description) -> string`

| Case | Expected |
|---|---|
| `skipNameGeneration:true` | `defaults.name` (`'My Webhook'`) |
| operation option with `action` | `'Send Message'` — **only if option has BOTH `name` and `value`** (see WG-9) |
| operation option without `action` | `'Get item'` — capitalized operation + raw resource value |
| no resource/operation | `defaults.name ?? displayName` (`'Fallback Name'`) |
| option missing `name` (guard fails) | fallback `'Send chat'` — action silently NOT used |

### WG-5 `makeDescription(parameters, description) -> string`

| Case | Expected |
|---|---|
| action present | `'Send Message in Chat Node'` |
| resource+operation only | `'get item in Item Node'` — **lowercase raw** operation + resource |
| neither | `description.description` verbatim |

### WG-6 `isDefaultNodeName(name, description, parameters) -> boolean`

`'My Webhook'` → true · `'My Webhook1'` → true (`^\d*$` suffix) · `'My Webhook X'` → false · `'Other'` → false.

### WG-7 `isTriggerNode(description) -> boolean`

`group.includes('trigger')`: `['trigger']` → true, `['input']` → false, `['trigger','output']` → true.

### WG-8 `displayParameter(values, property, null, null) -> boolean`

| Case | Expected |
|---|---|
| no `displayOptions` | `true` |
| `show:{mode:['advanced']}` + `{mode:'advanced'}` | `true` |
| same + `{mode:'simple'}` | `false` |
| multi-key show `{mode, other:[1]}` + one mismatch | `false` (AND across keys) |
| `hide:{mode:['advanced']}` + match | `false` |
| hide + `{mode:'simple'}` | `true` |

### WG-9 `assertParamIsString/Number(parameterName, value, node)` (throws)

| Case | Expected |
|---|---|
| `('param', 'ok-str')` | returns (no throw) |
| `('pAnum', 42)` via `assertParamIsString` | throws `Parameter "pAnum" is not string` (byte-exact message) |
| `('pX', 'nope')` via `assertParamIsNumber` | throws `Parameter "pX" is not number` |

**Key type-guard fact (Rust port must mirror):** `isINodePropertyOptions(item)` =
`'name' in item && 'value' in item`; `isINodePropertyOptionsList` = every item conforms.
Options missing `name` are rejected by the guard → `makeNodeName`'s action branch is
silently skipped (WG-4 last row).

## Wave 3 — parameter issues deep dive + filter-parameter suite (readiness §3.1)

### WG-10 `getNodeParametersIssues(properties, node, nodeTypeDescription, pinDataNodeNames?)`

Node `{id, name:'W10 Node', type:'noop', typeVersion:1, position, parameters}`; required
string param `req` (displayName "Required Field"). **Exact issue value:**
`{ parameters: { req: ['Parameter "Required Field" is required.'] } }`.

| Case | Expected |
|---|---|
| `req:''` | issues object (above) |
| `req:'filled'` | `null` |
| `disabled:true` | `null` (disabled nodes are never flagged) |
| pinned (`pinDataNodeNames` contains name) | `null` |
| required param **display-hidden** | `null` (display gating wins over required) |
| same param **display-shown** | issues object |

### WG-11 `executeFilterCondition(condition, options, metadata?)`

| Case (options `{caseSensitive:false}` unless noted) | Expected |
|---|---|
| `string/equals` `'Hello'` vs `'hello'` | `true` (CI default: `ignoreCase = !caseSensitive`) |
| same with `{caseSensitive:true}` | `false` |
| `string/contains` `'the quick brown fox'` vs `'QUICK'` | `true` |
| `number/gt` `42` vs `10` | `true` |
| `number/equals` `42` vs `41` | `false` |
| `boolean/true` `true` | `true` |
| `string/notEmpty` `singleValue:true`, left `'x'` | `true` |
| `dateTime/equals` ISO vs ISO | `true` |
| **unknown operator** `'not-an-op'` | **`false` — registry miss is NOT an error** |

Runtime conversion failures throw `FilterError` with byte-exact messages
(`[condition 0, item 0]` suffix):
`Conversion error: the string 'not-a-date' can't be converted to a dateTime [condition 0, item 0]` ·
`Conversion error: the string 'XYZ' can't be converted to a number [condition 0, item 0]`.

### WG-12 `validateFilterParameter(property, filterValue)` — LENIENT-BY-DESIGN

Returns `Record<string,string[]>` of issue keys `${properties.name}.${index}`; **four**
well/ill-shaped filters returned `{}`:
valid CI filter · `null` left on string op · string right on number op · unknown operator.
Validation-time leniency vs runtime `FilterError` (WG-11) is a deliberate two-tier
behavior the Rust port MUST preserve (issues are raised only from
`parseFilterConditionValues` with `unresolvedExpressions:true, errorFormat:'inline'`).

### WG-13 `executeFilter(filterValue)`

`and` both-pass → `true` · `and` one-fails → `false` · `or` one-passes → `true`.

## Wave 4 — filter operator matrix sweep (WG-14)

Authority: verbatim switch enumeration at `src/node-parameters/filter-parameter.ts:238-405`
(`/tmp` dist execution pinned each verdict). Lanes: **string(6) number(4) dateTime(4)
boolean(3) array(5) object(2) any-exists(2) = 26 verdicts + 1 throw-case.**

| Lane | Cases (name → verdict) |
|---|---|
| string | `notEquals` T · `notContains` T · `startsWith` T (CI) · `endsWith` T (CI) · **`regex '/^the quick/i'` T — regex ops are EXEMPT from ignoreCase lowercasing** (right not lowered) · `equals` null-left F (null coerces to `''`) |
| number | `lt` T · `gte` boundary-equal T · `lte` 10≤9 F · `gt` equal F (strict boundaries) |
| dateTime | `after` T · `before` (wrong direction) F · `afterOrEquals` equal-millis T · **null-left guard → F (throws nothing)** |
| boolean | `false`-op on `false` T · `equals` true/true T · `notEquals` true/true F |
| array | `contains` CI T (rightType `string`) · `contains` CI T (rightType `any`) · `lengthEquals` 3 T (rightType `number`) · `lengthGt` [1]>2 F · `empty` [] T |
| object | `empty` `{}` T · `notEmpty` `{a:1}` T |
| any | `exists` on `'x'` T · `notExists` on `null` T (pre-switch lane) |

**Throw-case:** array `contains` WITHOUT `rightType` throws
`FilterError: Conversion error: the string 'alpha' can't be converted to an array [condition 0, item 0]`
— rightValue parsing defaults to `rightType ?? operator.type`; production operator
definitions always carry `rightType`, the Rust port must too (or keep the default).

## Wave 5 — getNodeParameters nested shapes (WG-15)

All with `returnDefaults:true, returnNoneDisplayed:false, node:null, description:null`.

| Case | Expected | Pin |
|---|---|---|
| empty `collection` | `{coll:{}}` | container key materializes, **inner defaults NOT filled** |
| provided `{coll:{inner:'override'}}` | verbatim | plain collection NEVER fills inner defaults (even with data) |
| empty `fixedCollection` (single) | `{fixed:{}}` | same container rule |
| provided fixed single | verbatim `opts` object | pass-through |
| fixed multipleValues 1 full member | verbatim array | member shape preserved |
| fixed multipleValues empty | `{fixed:{}}` | no default members fabricated |
| fixed multipleValues **partial member** `{in:'one'}` | `{in:'one', other:9}` | **inner defaults ARE filled inside populated members** — asymmetry vs plain collection |
| display-hidden collection (parent rule) | dropped entirely | display gating wins, value discarded |
| display-shown collection | kept verbatim | baseline |

### Reproduction

```bash
# build the pinned workflow package (reference tree is source-only per ISSUE-011;
# keep build output OUT of reference/n8n/** to preserve manifest integrity):
cd reference/n8n && pnpm install --filter n8n-workflow... --frozen-lockfile && pnpm --filter n8n-workflow build
mv packages/workflow/dist /tmp/n8n-workflow-dist   # outside the pinned tree (agent-local)
node docs/isolation/node-fixtures.build.cjs            # re-derives docs/isolation/node-fixtures.json
node docs/isolation/node-fixtures.build.cjs --check    # drift check: byte-identical re-derivation
# or point the generator at any dist: NODE_FIXTURES_DIST=/path/to/dist/cjs
```

(The generator lives in the repo at `docs/isolation/node-fixtures.build.cjs`; it executes
the cases against the built reference and hard-asserts every expectation above — drift vs
this document exits with a regression signal instead of regenerating. Machine-readable
fixtures power `docs/isolation/node-conformance-harness.md`. Dist resolution order:
`$NODE_FIXTURES_DIST` → in-tree `reference/.../dist/cjs` → `/tmp/n8n-workflow-dist/cjs`.)

### Parity acceptance rule for `n8n-node-model` (Phase 3)

The crate's unit tests MUST reproduce GC-1..GC-7, WG-1..WG-9, WG-10..WG-13, WG-14, and
WG-15 byte-identically (JSON equality after serialization) — 117 golden cases in
`docs/isolation/node-fixtures.json`, plus the 7 `serdeConformance` round-trip probes
(see `node-conformance-harness.md` §5 for the binding acceptance gate). Any deviation is
a conformance defect (register it as MSG back to agent-2/mediator, do not "fix" semantics).
