# LEGO Isolation Blueprint: Validation (Schema & Type Validation)

**Agent:** Agent 4 — Schema & Type Validation Engineer
**Reference:** n8n 2.9.4 (`reference/n8n`, upstream `b6dc2787`)
**Contract:** `contracts/validation.contract.md`
**Resolves:** `ISSUE-007` (missing isolation doc) · records the Agent-4 half of `ISSUE-003` (arbitration verdict: **Option A** — Validation holds sole enforcement rights for CycleDetection at workflow-validation level)
**Status:** TESTED (ANALYZED → CONTRACT → TESTED; reference files untouched; enforcement capability implemented standalone in `tests/reference/agent-4/validation/workflow-rules.ts`, 10/10 tests, smoke gate 11/11 unaffected)

---

## 1. Boundary

| | Path | Lines | Role |
|---|---|---|---|
| ALLOWED (owned) | `reference/n8n/packages/workflow/src/schemas.ts` | 499 | zod runtime schemas mirroring `interfaces.ts` types |
| ALLOWED (owned) | `reference/n8n/packages/workflow/src/type-validation.ts` | 481 | `validateFieldType` + `tryToParse*` coercion/parsing |
| ALLOWED (owned) | `reference/n8n/packages/workflow/src/type-guards.ts` | 110 | structural type guards for parameter value shapes |
| ALLOWED (docs) | `docs/isolation/validation*`, `contracts/validation.contract.md` | — | this blueprint, golden cases, contract |
| FORBIDDEN | `reference/n8n/packages/core/**`, `crates/**` | — | never read for write, never imported |

**Import hygiene (verified):** none of the three files imports from `packages/core`, `packages/cli`, or any
other LEGO's source. Their only imports are `./interfaces` (types + `nodeConnectionTypes` const),
`./errors` (`ApplicationError`), `./utils` (`jsonParse`), and the external packages `zod`, `luxon`,
`lodash/isObject`. The boundary is therefore already **structurally clean**.

---

## 2. Correction to the previous contract (ISSUE-003)

The previous `contracts/validation.contract.md` listed four graph rules (`NodeUniqueness`,
`DanglingConnections`, `CycleDetection`, `DisabledHandling`) as if they were reference behaviour.
Source verification (Agent 1 `workflow-handoff.md` §3.2, Agent 5 `CROSS-AGENT-ISSUES.md`, and my own
`grep`) confirms:

| Rule | Implemented anywhere in `packages/workflow/src`? | Reference behaviour today |
|---|---|---|
| NodeUniqueness | **No** | `Workflow.setNodes()` silently overwrites a duplicate name (last wins) |
| DanglingConnections | **No** | `getNode()` → `null`; `getNodes()` warns and skips |
| CycleDetection | **No** (only `detectCycles` is in `@n8n/workflow-sdk` codegen — different package, different data structure) | none |
| DisabledHandling | **Not in Validation** — skip-disabled logic sits in `WorkflowExecute` / `Workflow.getParentNodes` (Execution & Workflow LEGOs) | runtime, not validation |

**Arbitration verdict (ISSUE-003, Option A):** Validation LEGO holds the **sole enforcement right** for
`CycleDetection` (DFS/Tarjan) at workflow-validation level; Workflow LEGO keeps the *declaration* of the
acyclic invariant and does **not** enforce it (`contracts/workflow.contract.md` §5, owner decision
2026-09-17). Accordingly, in the new contract these three rules are listed as **enforcement
capabilities — NEW CAPABILITY, not source fidelity**, and `DisabledHandling` is moved to
Non-responsibilities.

---

## 3. What the boundary actually contains (source inventory)

### 3.1 `type-validation.ts` — coercing parsers and the field validator

| Export | Signature | Throws (`ApplicationError`) |
|---|---|---|
| `tryToParseNumber` | `(unknown) → number` | `Failed to parse value to number` (NaN) |
| `tryToParseString` | `(unknown) → string` | never; objects → `JSON.stringify`, else `String(value)` |
| `tryToParseAlphanumericString` | `(unknown) → string` | `Value is not a valid alphanumeric string` — regex `^[a-zA-Z_][a-zA-Z0-9_]*$` |
| `tryToParseBoolean` | `(unknown) → boolean` | `Failed to parse value as boolean` — accepts `true/false` (any case), numeric `0/1` |
| `tryToParseDateTime` | `(unknown, defaultZone?) → luxon DateTime` | `Value is not a valid date` — tries ISO, RFC2822, HTTP, SQL, `new Date()`; keeps explicit zone, else `defaultZone` |
| `tryToParseTime` | `(unknown) → string` | `Value is not a valid time` — regex checks **shape only** (`hh:mm(:ss)`), so `25:99` is accepted (verified live) |
| `tryToParseArray` | `(unknown) → unknown[]` | `Value is not a valid array` — JSON-parses strings |
| `tryToParseObject` | `(unknown) → object` | `Value is not a valid object` — JSON-parses strings, rejects arrays |
| `tryToParseBinary` | `(unknown) → IBinaryData` | `Value is not a valid binary data object` — needs `mimeType` + (`data` \| `id`) |
| `tryToParseJsonToFormFields` | `(unknown) → FormFieldsParameter` | per-key/per-field messages, `Value is not valid JSON` |
| `tryToParseUrl` | `(unknown) → string` | `The value "x" is not a valid url.` — prefixes `https://` when `://` is absent (returned value is prefixed), rejects protocols outside `ALLOWED_URL_PROTOCOLS` |
| `tryToParseJwt` | `(unknown) → string` | `The value "x" is not a valid JWT token.` |
| `getValueDescription` | `(T) → string` | never; arrays → `array`, objects → `object`, everything else → `'<String(value)>'` quoted (verified live) |
| `validateFieldType` | `(fieldName, value, type: FieldType, {strict?, valueOptions?, parseStrings?}) → ValidationResult` | **never throws** — returns `{valid:false, errorMessage}` |

`validateFieldType` semantics that consumers depend on:
- `null`/`undefined` → `{ valid: true }` (no `newValue`).
- `type` is matched case-insensitively; unknown type → `{ valid: true, newValue: value }` (pass-through).
- `string` without `parseStrings` → pass-through; `strict` forbids coercion for `string/number/boolean/object/array`.
- Default error: `'<field>' expects a <type> but we got <description>`; `datetime` appends Luxon docs hint; `time`, `binary`, `options`, `string-alphanumeric`, `jwt`, `form-fields` have their own messages.
- `options` compares `option.value === value` (strict equality, no coercion).

### 3.2 `type-guards.ts` — structural guards (14 exports)

`isResourceLocatorValue`, `isINodeProperties`, `isINodePropertyOptions`, `isINodePropertyCollection`,
`isINodePropertiesList`, `isINodePropertyOptionsList`, `isINodePropertyCollectionList`,
`isValidResourceLocatorParameterValue`, `isResourceMapperValue`, `isAssignmentValue`,
`isAssignmentCollectionValue`, `isFilterValue`, `isNodeConnectionType` (checks against
`nodeConnectionTypes` const), `isBinaryValue` (`mimeType` + `data`|`id`). All are pure, total functions
(`unknown → boolean`), no throws.

### 3.3 `schemas.ts` — zod runtime schemas (45 exports)

Typed `z.ZodType<T>` mirrors of `interfaces.ts`, grouped:
- **Parameter values:** `INodeParameterResourceLocatorSchema`, `GenericValueSchema`, `IDataObjectSchema` (lazy/recursive), `ResourceMapperValueSchema`, `FilterValueSchema` (+ `FilterConditionValueSchema`, `FilterOperatorValueSchema`, `FilterOperatorTypeSchema`, `FilterOptionsValueSchema`, `FilterTypeCombinatorSchema`), `AssignmentValueSchema`, `AssignmentCollectionValueSchema`, `NodeParameterValueTypeSchema` (lazy union), **`INodeParametersSchema`** (`z.record(NodeParameterValueTypeSchema)`).
- **Node description:** `FieldTypeSchema` (enum), `DisplayConditionSchema`, `IDisplayOptionsSchema`, `INodePropertyOptionsSchema`, `INodePropertyRoutingSchema`, `IconOrEmojiSchema`, `NumberOrStringSchema`.
- **Declarative routing:** `IRequestOptionsSimplifiedAuthSchema`, `IN8nRequestOperations*Schema`, `IPostReceive*Schema` (8 variants) + `PostReceiveActionSchema`, `INodeRequestOutputSchema`, `HttpRequestOptionsSchema`, `INodeRequestSendSchema`.
- **Graph:** **`NodeConnectionTypeSchema`** (enum of all `NodeConnectionType`s — `main`, `ai_*`, …).
- **Node document (added 2026-09-17, inventory gap):** **`INodeSchema`** (`z.ZodType<INode>`, schemas.ts:470) — the runtime shape of a workflow node: required `id`, `name`, `type`, `typeVersion: number`, `position: [number, number]`, `parameters: INodeParametersSchema`; optional `disabled`, `notes`, `notesInFlow`, `retryOnFail`, `maxTries`, `waitBetweenTries`, `alwaysOutputData`, `executeOnce`, `onError: OnErrorSchema`, `continueOnFail`, `webhookId`, `extendsCredential`, `rewireOutputLogTo: NodeConnectionTypeSchema`, `credentials: INodeCredentialsSchema`, `forceCustomOperation {resource, operation}`. **`INodesSchema`** = `z.array(INodeSchema)`. Supporting: **`OnErrorSchema`** (`continueErrorOutput | continueRegularOutput | stopWorkflow`), **`INodeCredentialsDetailsSchema`** (`{id: string|null, name}`), **`INodeCredentialsSchema`** (`record<string, details>`), `ResourceMapperFieldSchema`. In 2.9.4 the only consumer outside `workflow` is `@n8n/api-types/src/chat-hub.ts`; the REST workflow save path does **not** parse nodes with `INodeSchema` (it uses DTO classes) — so this schema is a *parity anchor* for ports (`crates/n8n-node-model::INode` must accept exactly these fields), not a save-time gate.

Static ↔ runtime parity is guaranteed by the `z.ZodType<T>` annotations: TypeScript fails to compile if
a schema drifts from its interface (responsibility 3 of this LEGO is thus already enforced by `tsc`).

---

## 4. Consumers (who depends on this LEGO)

| Consumer | LEGO | Symbols | Class |
|---|---|---|---|
| `node-helpers.ts:51-52` | Node Model (Agent 2) | `validateFieldType`, `isINodeProperties*`, `isResourceLocatorValue` … | CROSS-BOUNDARY (inbound) |
| `node-parameters/filter-parameter.ts:14` | Node Model | `validateFieldType` | CROSS-BOUNDARY (inbound) |
| `node-parameters/node-parameter-value-type-guard.ts:7` | Node Model | `isResourceLocatorValue`, `isResourceMapperValue`, `isFilterValue` | CROSS-BOUNDARY (inbound) |
| `workflow-data-proxy.ts:33` | Expression (Agent 3) | `isResourceLocatorValue` | CROSS-BOUNDARY (inbound) |
| `extensions/string-extensions.ts:11` | Expression | `tryToParseDateTime` | CROSS-BOUNDARY (inbound) |
| `index.ts:33,35,72` | package public API | `export *` of all three files | SHARED surface (frontend editor-ui, nodes-base, core consume via `n8n-workflow`) |

Outbound dependencies of this LEGO:

| Dependency | Class |
|---|---|
| `./interfaces` (types, `nodeConnectionTypes`) | SHARED (kernel types) |
| `./errors` `ApplicationError` | SHARED (kernel errors) |
| `./utils` `jsonParse` | SHARED (kernel utils) |
| `zod`, `luxon`, `lodash/isObject` | EXTERNAL |
| `packages/core/**`, other LEGO sources | **none** |

No runtime cycle: nothing this LEGO imports imports it back.

---

## 5. The enforcement capabilities (NEW, per ISSUE-003 Option A)

The contract now declares three rule-enforcement capabilities the reference lacks. They are specified
here as **interfaces + algorithms** and implemented — TypeScript only, no Rust — as a standalone module
`tests/reference/agent-4/validation/workflow-rules.ts` (not wired into any reference path; the three
reference files in the boundary are untouched). Tests: `tests/reference/agent-4/validation/validation.test.ts`. Input is the `WorkflowContract` (`contracts/workflow.contract.md`); output is
`{ valid: boolean; errors: ValidationError[] }`.

| Capability | Algorithm | Error code | Message shape |
|---|---|---|---|
| `NodeUniqueness` | single pass over `nodes[]`, `Set<name>` | `DUPLICATE_NODE_NAME` | `Duplicate node name "<name>"` |
| `DanglingConnections` | for every `connections[src][type][i][j].node`, check `src` and `node` ∈ node names; also reject `type ∉ nodeConnectionTypes` via `isNodeConnectionType` | `DANGLING_CONNECTION` / `INVALID_CONNECTION_TYPE` | `Connection from "<src>" to unknown node "<dst>"` |
| `CycleDetection` | iterative DFS with `visiting/visited` sets over the **`main`** connection graph (Tarjan SCC acceptable; must be deterministic and report the first back-edge path) | `CYCLE_DETECTED` | `Cycle detected: A → B → A` |

Design constraints (agreed with Workflow contract §5): pure functions, no I/O, no mutation of the input,
disabled nodes are **still** validated structurally (disabled-handling is runtime behaviour, not
validation), and the checks are **additive** — they never change how the reference loads/executes a
workflow (the regression gate 11/11 must stay green; the reference never calls them).

---

## 6. Risks / open points

1. **Behaviour delta risk** — if a future task wires the new rules into a loading path, previously
   accepted (duplicate-name / dangling / cyclic) workflows will start failing. Wiring is out of scope for
   Phase 2; the rules ship as a standalone `validateWorkflow` entry point only.
2. **`ai_*` edges and legitimate loops** — n8n allows loops through `SplitInBatches`/`Loop Over Items`
   on the `main` graph at runtime. `CycleDetection` therefore must be **opt-in** (`{ allowCycles: true }`
   default for reference parity) or restricted to a report-only severity — decision recorded in contract
   §11.
3. **Coupling in `type-validation.ts`** — depends on `luxon` (`DateTime`) as a return type; any Rust
   port must define an equivalent date model. Documented, not refactored.
4. **`DisabledHandling`** was previously "untested" in `LEGO-MASTER-MAP.md`; it is now explicitly a
   non-responsibility of this LEGO (owner: Execution/Workflow), which closes that row for Validation.
