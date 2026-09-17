# Node LEGO — Conformance Harness Spec (acceptance for crates/n8n-node-model)

**Author:** Agent 2 · **Date:** 2026-09-17 · **Status:** BINDING once implemented
**Purpose:** turn `node-golden-cases.md` (prose, VERIFIED-BY-EXECUTION) into a
machine-executable parity gate for the `n8n-node-model` Rust port — the same acceptance
architecture Agent 1 used for `n8n-workflow` (`build-fixtures.mjs` → `fixtures.json` →
`tests/reference_fixtures.rs`). Crate-side files below are owned by the crate's
implementor; `crates/**` remains a forbidden write for agent-2.

---

## 1. Components

| Component | Path (today) | Owner / destination |
|---|---|---|
| Golden data (machine-readable GC-1..GC-7 + serde probes) | `docs/isolation/node-fixtures.json` | agent-2 (in-tree, byte-stable) |
| Generator + drift checker | `docs/isolation/node-fixtures.build.cjs` (`--check`) | agent-2; re-derives from reference dist, byte-compares |
| Rust acceptance harness | `crates/n8n-node-model/tests/reference_fixtures.rs` | **crate owner** (Phase-3 assignment) |
| Integration move (optional, at gateway) | `tests/reference/node-rust/` | orchestrator step — path is outside agent-2's write set |

The fixtures are deterministic by construction (`--check` proves byte-identical
re-derivation). The generator additionally contains a **regression tripwire**: every
GC expectation is hard-asserted against the frozen golden values from
`node-golden-cases.md`; on mismatch it exits 3 instead of writing — STOP, INVESTIGATE,
DOCUMENT, per the project regression rule.

## 2. Rust harness layout (required, mirrors crates/n8n-workflow)

One file `crates/n8n-node-model/tests/reference_fixtures.rs` with:

```rust
// Frozen ports (GC-1..GC-7)
const ACCESS_CASES: usize = 3;          // applyAccessPatterns
const CONNECTION_CASES: usize = 1;      // getConnectionTypes
const RENAME_CASES: usize = 1;          // renameFormFields
const OUTPUT_CASES: usize = 4;          // getNodeOutputs
const INPUT_CASES: usize = 2;           // getNodeInputs
const PARAM_CASES: usize = 3;           // getNodeParameters
const VERSIONED_CASES: usize = 5;       // versionedNodeType ops
// Wave 2 pure helpers (WG-1..WG-9)
const RESOLVE_PATH_CASES: usize = 4;    // resolveRelativePath
const BANNED_CHAR_CASES: usize = 7;     // hasDotNotationBannedChar
const MERGE_CASES: usize = 3;           // mergeNodeProperties
const MAKE_NAME_CASES: usize = 5;       // makeNodeName
const MAKE_DESC_CASES: usize = 3;       // makeDescription
const DEFAULT_NAME_CASES: usize = 4;    // isDefaultNodeName
const TRIGGER_CASES: usize = 3;         // isTriggerNode
const DISPLAY_CASES: usize = 6;         // displayParameter
const ASSERT_CASES: usize = 3;          // assertParamIsString/Number
// Wave 3 parameter-issues + filter-parameter suite (WG-10..WG-13)
const ISSUES_CASES: usize = 6;          // getNodeParametersIssues
const FILTER_COND_CASES: usize = 9;     // executeFilterCondition (verdicts)
const FILTER_COND_THROW_CASES: usize = 2; // …conversion-error FilterErrors (byte-exact messages)
const FILTER_VALIDATE_CASES: usize = 4; // validateFilterParameter (leniency pins, all {})
const FILTER_COMBINE_CASES: usize = 3;  // executeFilter (and/or combinators)
// Wave 4 operator matrix (WG-14)
const FILTER_MATRIX_CASES: usize = 26;  // filterOperatorMatrix per-lane verdicts
const FILTER_MATRIX_THROW_CASES: usize = 1; // …missing-rightType conversion FilterError
// Wave 5 nested parameter shapes (WG-15)
const PARAM_NESTED_CASES: usize = 9;    // getNodeParameters collection/fixedCollection
// Wave 6 resourceLocator + resourceMapper (WG-16..WG-19)
const RLC_VALID_CASES: usize = 8;       // isValidResourceLocatorParameterValue
const RLC_ISSUES_CASES: usize = 5;      // resourceLocator regex/expression/mode handling
const RLC_DEFAULT_CASES: usize = 1;     // __rl:true planted into object defaults
const RM_ISSUES_CASES: usize = 4;       // resourceMapper auto/define/expression handling
// Wave 7 IO-acceptance + conditions + features (WG-20..WG-24)
const INPUT_TYPE_CASES: usize = 5;      // nodeAcceptsInputType
const OUTPUT_TYPE_CASES: usize = 3;     // nodeHasOutputType
const SUB_NODE_CASES: usize = 3;        // isSubNodeType
const CHECK_COND_CASES: usize = 8;      // checkConditions (_cnd evaluator + fallback)
const NODE_FEATURE_CASES: usize = 4;    // getNodeFeatures
// Wave 8 display paths + options issues (WG-25/WG-26)
const DISPLAY_PATH_CASES: usize = 4;    // displayParameterPath scopes
const OPTIONS_ISSUES_CASES: usize = 6;  // options/multiOptions required + leniency
// + serdeConformance round-trips: 5 descriptions, 2 INode samples
// TOTAL asserted entries = 19 + 38 + 24 + 27 + 9 + 18 + 23 + 10 + 7 = 175
```

- Fixture load via `env!("CARGO_MANIFEST_DIR")/./../../` (same `repo_root()` convention as
  `crates/n8n-workflow/tests/reference_fixtures.rs`). NO default-path fallback that could
  mask a missing fixture: file absence = test failure, count assertion = no silent skipping.
- Comparison: `serde_json::Value` deep equality (like workflow harness); object key order is
  irrelevant, array order is observable. `connections_from_text`-style parsing is not needed
  here (none of GC-1..GC-7 depends on object-key order).
- Real-instance serde coverage comes from `tests/reference/0*/workflow.json`
  (read at test time, as the workflow conformance tests already do), NOT from copies.
- Rig compatibility: zero extra deps — `serde_json` + existing crate deps only, so
  `tools/rust-offline-rig/run.sh test` can execute the harness offline.

## 3. Port-shape expectations per case category

| Category | Rust surface (brief §2/§3) | Notes |
|---|---|---|
| `applyAccessPatterns.cases` | `pub fn apply_access_patterns(expression &str, previous &str, new &str) -> String` | pure string→string; early-return case must return input byte-identically |
| `getConnectionTypes.cases` | `pub fn get_connection_types(connections: &[NodeConnectionEntry]) -> Vec<NodeConnectionType>` | strings pass positionally; objects project `.type`; only `undefined`/`None` filtered |
| `renameFormFields.cases` | `pub fn rename_form_fields(node: &mut INode, rename: impl Fn(&str) -> String)` | mutates in place; only entries with `fieldType=="html"` AND a string `html` property are touched; other entries byte-identical |
| `getNodeOutputs.cases` | `pub fn get_node_outputs(node: &INode, description: &INodeTypeDescription, evaluator: Option<&dyn DynamicIoEvaluator>) -> Vec<NodeConnectionEntry>` | **dynamic branch behind the ISSUE-004 seam** (no Workflow type in node core); evaluator `None`/error ⇒ `warn` + `[]` fallthrough |
| `getNodeInputs.cases` | `pub fn get_node_inputs(...)` | same seam; dynamic-throw case ⇒ `[]` + warned |
| `getNodeParameters.cases` | `pub fn get_node_parameters(props, values, return_defaults, return_none_displayed, node_type_version: Option<f64>, description: Option<&INodeTypeDescription>) -> Value/Map` | display-gating; expression strings pass verbatim |
| `versionedNodeType.cases` | `VersionedNodeType` struct + `get_versioned_node_type` | **no-fallback**: absent version ⇒ `None`/undefined, never latest |
| `resolveRelativePath.cases` | `pub fn resolve_relative_path(full_path: &str, candidate: &str) -> String` | `&`-relative resolution against `parameters.`-rooted path; empty path-to-leaf ⇒ root-relative |
| `hasDotNotationBannedChar.cases` | `pub fn has_dot_notation_banned_char(name: &str) -> bool` | **space, dot, leading digit, dash, underscore are all banned** (verbatim regex port) |
| `mergeNodeProperties.cases` | `pub fn merge_node_properties(main: &mut Vec<INodeProperties>, add: &[INodeProperties])` | in-place; same-name **replaced at original index**; `doNotInherit` skipped |
| `makeNodeName.cases` | `pub fn make_node_name(parameters, description) -> String` | skipNameGeneration ⇒ defaults.name; action ⇒ verbatim action string; else `${Operation} ${resource}` (raw values); options guarded by `isINodePropertyOptions` (`name`+`value` present) — malformed options fall back silently |
| `makeDescription.cases` | `pub fn make_description(parameters, description) -> String` | `"${action} in ${defaults.name}"`; raw lower-case `${operation} ${resource} in …`; description fallback |
| `isDefaultNodeName.cases` | `pub fn is_default_node_name(name, description, parameters) -> bool` | makeNodeName prefix + `^\d*$` suffix |
| `isTriggerNode.cases` | `pub fn is_trigger_node(description) -> bool` | `group.contains("trigger")` |
| `displayParameter.cases` | `pub fn display_parameter(values, property, type_version, description) -> bool` | no displayOptions ⇒ true; show ⇒ AND across keys; hide-match ⇒ false |
| `assertParamIsType.cases` | `pub fn assert_param_is_string/number(name, value) -> Result<(), ValidationError>` | error message byte-exact: `Parameter "{name}" is not {type}` |
| `getNodeParametersIssues.cases` | `pub fn get_node_parameters_issues(props, node, description, pinned_names) -> Option<INodeIssues>` | `None` when: all good, node disabled, node pinned, required param display-hidden; issue map keyed by parameter name, message byte-exact `Parameter "{displayName}" is required.` |
| `executeFilterCondition.cases` | `pub struct FilterCondition/FilterOptions` + `pub fn execute_filter_condition(...) -> Result<bool, FilterError>` | `ignoreCase = !caseSensitive`; **unknown operator ⇒ `false` (not error)**; conversion failures ⇒ `FilterError` with template `Conversion error: the string '{v}' can't be converted to a {type} [condition {i}, item {j}]` |
| `validateFilterParameter.cases` | `pub fn validate_filter_parameter(prop, filter) -> HashMap<String, Vec<String>>` | **validation is lenient**: only `parseFilterConditionValues` errors become issues (keys `{name}.{index}`); malformed type/unknown-op conditions STILL validate to `{}` |
| `executeFilter.cases` | `pub fn execute_filter(filter, item_index) -> bool` | `and` = all, `or` = any, per-condition metadata `{index, itemIndex}` |
| `filterOperatorMatrix.cases` | same filter surface, per-lane sweeps | rightValue parsed as `rightType ?? operator.type` (missing rightType ⇒ FilterError); regex ops exempt from ignoreCase lowering; `exists`/`notExists` pre-switch any-type; dateTime null-guard ⇒ `false` |
| `getNodeParametersNested.cases` | `get_node_parameters` with `collection`/`fixedCollection` trees | empty containers materialize as `{}` without inner defaults; plain collection NEVER inner-fills; fixedCollection fills inner defaults **inside populated members only**; `multipleValues` ⇒ member arrays; hidden nested dropped at parent level |
| `isValidResourceLocatorParameterValue.cases` | `pub fn is_valid_resource_locator_parameter_value(value: &Value) -> bool` | numbers always accepted (incl. 0); plain truthiness of `.value` only — `__rl`/`mode` NOT shape-checked here |
| `resourceLocatorIssues.cases` | `get_node_parameters_issues` over RLC properties | mode.validation regex errors verbatim from properties.errorMessage; `={{…}}` expressions bypass validation; unknown mode ⇒ skipped silently; non-RLC shape falls to the generic required branch |
| `rlcDefaults.cases` | `get_node_parameters` RLC defaults | engine plants `__rl: true` into object defaults |
| `resourceMapperIssues.cases` | `get_node_parameters_issues` over resourceMapper | `autoMapInputData` skipped; required-field message uses capitalized fieldWords.singular; **empty-array key `map` present — do NOT serialize-skip empty Vecs**; expression values exempt |
| `nodeAcceptsInputType.cases`/`nodeHasOutputType.cases` | `pub fn node_accepts_input_type/has_output_type(desc, conn_type) -> bool` | plain strings (array or lone, incl. expression strings) match via `== OR substring includes()`; config objects ONLY exact `.type`; missing IO ⇒ false |
| `isSubNodeType.cases` | `pub fn is_sub_node_type(desc) -> bool` | any non-main connection TYPE among static outputs; expression-string outputs ⇒ false |
| `checkConditions.cases` | `pub fn check_conditions(conditions: &[Value], actual: &[Value]) -> bool` | `_cnd` object keys eq/not/gte/lte/gt/lt/between/includes/startsWith/endsWith/regex/exists; empty actualValues ⇒ only `not` is true; conditions `.some`, `_cnd` over multiple actual `.every`; non-`_cnd` fallback = `actual.contains(value)` |
| `getNodeFeatures.cases` | `pub fn get_node_features(def, version: f64) -> Map<String,bool>` | `None`/missing def ⇒ empty map; each feature = `check_conditions(def["@version"], [version])` |
| `displayParameterPath.cases` | `pub fn display_parameter_path(values, property, path, ...)` | empty path = display_parameter; `parameters.*` paths delegate local scope to `get(values, path)` — root values serve `$parameter` refs ONLY, never flat-key fallback |
| `optionsIssues.cases` | `get_node_parameters_issues` over options types | required-empty `''`/`[]` flag with byte-exact message; **required multiOptions with `undefined` value passes**; out-of-list option values never flagged |
| `serdeConformance` | `INodeTypeDescription`, `INode` | deserialize → serialize round-trip equality |

## 4. Reference-observed semantics the harness pins (do not "improve")

1. **`onError:'continueErrorOutput'`**: `outputs` is **deep-copied** (description never
   mutates — every error case asserts `descriptionUnchangedAfterCall == true`); a single
   output is converted to a config object with `displayName:"Success"` **even when it was
   already a config object with its own displayName** (verified: `{type:"main",
   displayName:"Out"}` becomes `{type:"main", displayName:"Success"}`); then exactly one
   `{category:'error', type:'main', displayName:'Error'}` is **appended at the trailing
   index** (no rename for multi-output).
2. **Dynamic IO failure**: `getSimpleParameterValue` throw ⇒ `console.warn("Could not
   calculate inputs|outputs dynamically for node: ", <name>)` and result `[]`. The Rust
   port maps this to `log::warn!`/`tracing::warn!`; the harness asserts the `[]` result and
   no panic (log capture is out of scope).
3. **`versions`**: `currentVersion = defaultVersion ?? max(nodeVersions.keys)`;
   `getNodeType(n)` with absent `n` returns **undefined/None — no fallback**;
   `getVersionedNodeType(plain)` returns the identical object (identity, not a copy).
4. **Display-gating**: defaults are applied to rendered parameters only; explicitly typed
   values on display-hidden parameters are dropped (unless `returnNoneDisplayed`);
   expression strings (`={{ … }}`) pass through verbatim in all arms.
5. **`isINodePropertyOptions` type guard** (drives `makeNodeName`/`makeDescription` action
   resolution): each option must contain BOTH `name` and `value`; an option carrying
   `value`+`action` but no `name` fails the guard, so the `action` branch is SILENTLY
   skipped and the `${Operation} ${resource}` fallback is used. The Rust port of the
   type-guard predicates must be exact.
6. **Dot-notation banned chars**: the banned set includes space, dot, any leading digit,
   dash and underscore (full verbatim regex in
   `src/node-reference-parser-utils.ts` `DOT_NOTATION_BANNED_CHARS`) — names like
   `'Node A'` therefore require `$node["Node A"]` access. Do not "tighten" this set.
7. **Assert message templates** (parameter-type validation): throws with byte-exact
   message `Parameter "{parameterName}" is not {tsType}` — e.g. `Parameter "pAnum" is
   not string`. Message text is part of the cross-LEGO error surface; no paraphrasing.
8. **`mergeNodeProperties` is destructive-in-place** on the main array: new names append,
   same names replace AT THEIR ORIGINAL INDEX (order of merged properties observable),
   `doNotInherit:true` entries are skipped.
9. **Two-tier filter behavior**: validation (`validateFilterParameter`) is LENIENT — only
   `parseFilterConditionValues` errors under `unresolvedExpressions:true` become issues
   (type-mismatched/unknown-op conditions validate to `{}`); the failure floor is at
   RUNTIME where `executeFilterCondition` throws `FilterError` on conversion problems.
   Exception: an **unknown operator at runtime yields `false`**, never throws. Preserve
   both tiers exactly; do not unify them.
10. **Issue-early exits**: `getNodeParametersIssues` returns `null` for disabled nodes,
    nodes present in `pinDataNodeNames`, and required-but-display-hidden parameters —
    display gating beats `required:true`. The exact issue message currency is
    `Parameter "{displayName}" is required.`
11. **Operator-matrix invariants** (WG-14, switch at `filter-parameter.ts:238-405`):
    (a) `regex`/`notRegex` are EXEMPT from ignoreCase lowercasing — the right pattern is
    compared verbatim (supports `/pattern/flags`); (b) rightValue parses as
    `rightType ?? operator.type` — array ops without `rightType` throw the conversion
    FilterError; (c) `exists`/`notExists` resolve BEFORE the type switch (valid on any
    lane); (d) dateTime equality comparison is millisecond-based with a null-guard
    returning `false` after `empty`/`notEmpty`; (e) number boundaries are strict `>`
    and `<` with `gte`/`lte` inclusive.
12. **Nested-default asymmetry** (WG-15): an empty `collection`/`fixedCollection`
    materializes as `{key:{}}` with NO inner defaults; a plain `collection` never fills
    inner defaults (provided keys pass verbatim), while a `fixedCollection` DOES fill
    missing inner defaults **inside populated members** (and fabricates nothing when
    devoid of members); display-hidden nested structures are dropped at the parent level.
13. **RLC/RM validation asymmetries** (WG-16..WG-19): (a)
    `isValidResourceLocatorParameterValue` accepts ALL numbers (including `0`) and checks
    only `.value` truthiness — `__rl`/`mode` are checked elsewhere
    (`isINodeParameterResourceLocator`); (b) mode.validation regex failures surface the
    mode's custom `errorMessage` byte-verbatim; (c) `={{…}}` expressions bypass RLC and
    ResourceMapper validation at issue level; (d) engine plants `__rl:true` into RLC
    object defaults; (e) resourceMapper required-field failures emit BOTH an empty-array
    parent key and the `key.field-id` entry — serializers must NOT drop empty arrays.
14. **IO-type matching asymmetry** (WG-20..WG-22): plain STRING entries in
    inputs/outputs (including expression strings like `={{…}}`) match connection types by
    `==` OR substring `includes()` — config objects match only by exact `.type`. A Rust
    port matching strings exactly-first then objects is WRONG for literals containing the
    type as a substring.
15. **`checkConditions` evaluator** (WG-23): `_cnd`-object dialect with 12 semantic keys;
    empty `actualValues` answers `true` ONLY for `not`; `_cnd` uses `.every` across
    actual values while the outer list is `.some`; non-`_cnd` plain values use
    `actual.contains`. `getNodeFeatures` is a strict projection —
    `{feature: check_conditions(def['@version'], [version])}`, undefined def ⇒ `{}`.
16. **Display-path scoping** (WG-25): `displayParameterPath` evaluates lookups on
    `get(values, path)` — a `parameters.*` path only redirects the ROOT handle for
    `$parameter` references; flat show/hide keys do NOT see the root. A Rust port
    consulting root for flat keys fabricates visibility the reference does not have.
17. **Required/invalid leniency matrix** (WG-26): required flags hit empty-string for
    `options` and empty-array for `multiOptions`, but `undefined` sails through both;
    values are NEVER cross-checked against the declared options list. Do not "harden"
    either side in the port.
18. **Nested-issue scoping asymmetry** (WG-27): non-fixed `collection` children keep the
    ANCESTOR basePath (`node-helpers.ts:1505-1513`) — required checks and display keys
    never read the nested `coll.*` values, so a filled nested required field STILL flags
    (issue keyed by child name, no prefix). `fixedCollection` instead descends:
    basePath `<name>.<option>[<i>]`, issues still keyed by the child name only. A port
    that "fixes" collection scoping diverges from the oracle.
19. **fixedCollection count limits** (WG-28): `minRequiredFields`/`maxAllowedFields`
    emit byte-exact `At least N field(s) (is|are) required.` / `At most N field(s)
    (is|are) allowed.` keyed by the fixedCollection name; unset options (`undefined`)
    are skipped entirely — no count validation, no child validation.

## 5. Acceptance wiring (brief §4, gate 1)

`n8n-node-model` is **RUST IMPLEMENTED-verified for the Node LEGO when**:

1. This harness reproduces all 186 entries (19 frozen-port golden cases + 38 wave-2 pure
   helper cases + 24 wave-3 parameter-issues/filter cases + 27 wave-4 operator-matrix
   cases + 9 wave-5 nested-parameter cases + 18 wave-6 RLC/resourceMapper cases + 23
   wave-7 IO/conditions/features cases + 10 wave-8 display-path/options cases + 11
   wave-9 nested-issues cases + 7 serde samples) green under
   `tools/rust-offline-rig/run.sh test` (offline).
2. The 6 frozen ports exist with the exact snake_cased names listed in brief §3
   (`get_node_parameters`, `get_node_inputs`, `get_node_outputs`, `get_connection_types`,
   `rename_form_fields`, `apply_access_patterns`) and crate exports match contract §11.
3. G-1..G-4 fixes from brief §1 are in place (serde probes cover them: version union,
   IO union incl. expression + config arms, required description fields, full INode
   optionals).
4. Byte-stability of the fixtures is re-confirmed by `--check` after any reference
   rebuild (tripwire exit 3 = regression investigation, not regeneration).

Deviation rule (from `node-golden-cases.md`): any mismatch is a **conformance defect** —
report via bus to agent-2/mediator; never "fix" the semantics to match the port.

## 6. Known non-goals

- The harness does not test the expression runtime (ISSUE-004 seam is an injected trait;
  GC dynamic cases only pin the failure fallthrough).
- No timing/perf assertions (perf gates live with Agent 5's Phase-3 gate variant — MSG-07).
- Full 532-reference-test coverage remains the Phase-3 stretch goal (brief §4.1); this
  pack is the **frozen-port minimum plus the pure-helper, issues/filter, and
  operator-matrix waves** that gates acceptance. Larger sweeps (`rename-node-utils`
  variants, custom-ops/RLC fixtures, optionValueExtractors, collection/nested
  `getNodeParameters` shapes…) follow the same add-category/add-constant protocol:
  extend the generator, hard-assert the verified values, bump the fixture file in one
  commit.
