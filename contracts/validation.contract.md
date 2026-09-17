# LEGO Contract: Validation (Schema & Type Validation)

| | |
|---|---|
| Owner | Agent 4 |
| LEGO | `validation` — parameter type validation, runtime schemas, structural graph rules |
| Reference | n8n 2.9.4, `packages/workflow/src/{schemas,type-validation,type-guards}.ts` |
| Blueprint | `docs/isolation/validation.md` |
| Status | TESTED (implementation: `tests/reference/agent-4/validation/workflow-rules.ts`, 10/10; reference untouched) |
| Supersedes | previous 4-rule contract (see `ISSUE-003` — arbitration verdict **Option A**) |

## 1. Purpose
Guarantee that data entering the workflow model is **well-typed and structurally sound**: coerce and
validate node-parameter values against their declared `FieldType`, provide zod schemas that mirror the
static TypeScript interfaces 1:1, expose type guards for parameter value shapes, and — as the sole
owner of rule enforcement at workflow-validation level — reject workflows that violate
`NodeUniqueness`, `DanglingConnections` or `CycleDetection`.

## 2. Inputs
| Input | Type | Producer |
|---|---|---|
| Field value to validate | `(fieldName: string, value: unknown, type: FieldType, options?: { strict?, valueOptions?: INodePropertyOptions[], parseStrings? })` | Node Model (`node-helpers`, `filter-parameter`) |
| Raw value to parse | `unknown` (+ `defaultZone?: string` for date-time) | Node Model, Expression extensions |
| Candidate value for a guard | `unknown` | Node Model, Expression (`workflow-data-proxy`) |
| Data to schema-check | `unknown` → `INodeParametersSchema`, `NodeConnectionTypeSchema`, `IDisplayOptionsSchema`, … | any consumer of `n8n-workflow` |
| Workflow to rule-check (**new capability**) | `WorkflowContract` (`contracts/workflow.contract.md`): `{ id, name, nodes: NodeContract[], connections: IConnections, settings? }` + `options?: { allowCycles?: boolean }` | API / tooling (not the reference runtime) |

## 3. Outputs
| Output | Shape |
|---|---|
| `validateFieldType` | `ValidationResult` = `{ valid: true, newValue?: T }` \| `{ valid: false, errorMessage: string }` — **never throws** |
| `tryToParse*` | parsed value of the target type, or **throws** `ApplicationError` (messages in §7) |
| Type guards | `boolean` (TypeScript narrowing), never throw |
| zod schemas | `z.ZodType<T>`; `.parse` throws `ZodError`, `.safeParse` returns `{success, data|error}` |
| `validateWorkflow` (**new**) | `{ valid: boolean; errors: ValidationError[] }`, `ValidationError = { code: 'DUPLICATE_NODE_NAME' \| 'DANGLING_CONNECTION' \| 'INVALID_CONNECTION_TYPE' \| 'CYCLE_DETECTED', message: string, node?: string, path?: string[] }` |

## 4. Responsibilities
1. **Type coercion & validation** of parameter values for every `FieldType` (`string`, `string-alphanumeric`, `number`, `boolean`, `dateTime`, `time`, `array`, `object`, `options`, `url`, `jwt`, `form-fields`, `binary`), honouring `strict` (no coercion) and `parseStrings`.
2. **Runtime ↔ static parity:** every exported schema is typed `z.ZodType<InterfaceType>` so `tsc` fails when the schema and the interface drift. Adding a field to an interface without updating its schema is a contract violation.
3. **Type guards** for all composite parameter value kinds (resource locator, resource mapper, filter, assignment, binary, connection type, property lists).
4. **Rule enforcement (NEW CAPABILITY, not reference fidelity — ISSUE-003 Option A):**
   - `NodeUniqueness` — no two nodes share a `name`.
   - `DanglingConnections` — every connection source and destination names an existing node; every connection `type` ∈ `nodeConnectionTypes`.
   - `CycleDetection` — DFS/Tarjan over the `main` connection graph; reports the first cycle path deterministically. Validation LEGO is the **only** LEGO permitted to implement this check; Workflow LEGO declares the invariant and does not enforce it.
5. Guard against malformed JSON / corrupted structures at the boundary (`tryToParseObject/Array` use `jsonParse`, schemas reject unknown shapes).

## 5. Non-responsibilities
- Does **not** execute nodes, resolve expressions (`={{ }}` strings are passed through as `string` unless `parseStrings`), or touch credentials.
- Does **not** enforce rules inside the reference load/execution path — the reference never calls `validateWorkflow`; wiring it in is a separate, explicitly approved task.
- **`DisabledHandling` is not a validation rule.** Skipping disabled nodes is runtime behaviour of `WorkflowExecute` / `Workflow.getParentNodes` (Execution & Workflow LEGOs). Disabled nodes are still validated structurally here.
- Does **not** check trigger presence (`validateWorkflowHasTriggerLikeNode` in `workflow-validation.ts`) or node credential issues (`node-validation.ts`) — those files are outside this boundary (Workflow / Node Model).
- Does **not** own `interfaces.ts` types; it mirrors them.
- Does **not** modify `packages/core/**` or `crates/**`.

## 6. Dependencies
| Dependency | Class | Direction |
|---|---|---|
| `packages/workflow/src/{schemas,type-validation,type-guards}.ts` | INTERNAL | owned |
| `./interfaces` (`FieldType`, `IBinaryData`, `INodePropertyOptions`, `ValidationResult`, `nodeConnectionTypes`, …) | SHARED (kernel types) | outbound, read-only |
| `./errors` `ApplicationError` | SHARED | outbound |
| `./utils` `jsonParse` | SHARED | outbound |
| `zod`, `luxon`, `lodash/isObject` | EXTERNAL | outbound |
| `node-helpers.ts`, `node-parameters/filter-parameter.ts`, `node-parameters/node-parameter-value-type-guard.ts` | CROSS-BOUNDARY ← Node Model (Agent 2) | inbound |
| `workflow-data-proxy.ts`, `extensions/string-extensions.ts` | CROSS-BOUNDARY ← Expression (Agent 3) | inbound |
| `WorkflowContract` / `NodeContract` / `ConnectionContract` | CROSS-BOUNDARY ← Workflow (Agent 1), Connection | input type for `validateWorkflow` only |
| `packages/core/**` | FORBIDDEN | none (verified: zero imports) |

No circular dependency: nothing this LEGO imports depends on it.

## 7. Error behavior
| Function | Failure | Result |
|---|---|---|
| `validateFieldType` | any | `{ valid:false, errorMessage }`; default message `'<field>' expects a <type> but we got <getValueDescription(value)>`; specialised: alphanumeric `Value is not a valid alphanumeric string, only letters, numbers and underscore allowed`; time `'<field>' expects time (hh:mm:(:ss)) but we got <v>.`; binary default + `. Make sure the value is a valid binary data object with 'mimeType' and 'data' or 'id' property.`; options `'<field>' expects one of the following values: [a, b] but we got <v>`; jwt `Value is not a valid JWT token`; datetime default + Luxon `DateTime.fromFormat` hint; form-fields → underlying parser message |
| `validateFieldType` with `null`/`undefined` | — | `{ valid:true }` (never an error) |
| `validateFieldType` unknown `type` | — | pass-through `{ valid:true, newValue:value }` |
| `tryToParseNumber` | NaN | throws `Failed to parse value to number` |
| `tryToParseAlphanumericString` | regex fail | `Value is not a valid alphanumeric string` |
| `tryToParseBoolean` | not `true/false/0/1` | `Failed to parse value as boolean` |
| `tryToParseDateTime` | no format matched | `Value is not a valid date` |
| `tryToParseTime` | not shaped `hh:mm(:ss)` | `Value is not a valid time` (shape only — `25:99` passes; frozen quirk) |
| `tryToParseArray` / `Object` | wrong shape / bad JSON | `Value is not a valid array` / `Value is not a valid object` |
| `tryToParseBinary` | missing `mimeType` or `data`/`id` | `Value is not a valid binary data object` |
| `tryToParseUrl` / `Jwt` | invalid | `The value "<v>" is not a valid url.` (where `<v>` is already `https://`-prefixed if the input had no `://`; only `ALLOWED_URL_PROTOCOLS` accepted; the prefixed string is the return value) / `The value "<v>" is not a valid JWT token.` |
| `tryToParseJsonToFormFields` | bad key/type | `Key '<k>' in field <i> is not valid for form fields` etc.; non-JSON → `Value is not valid JSON` |
| zod `.parse` | shape mismatch | `ZodError` with `issues[]` (first issue is what the API layer returns as 400 — see `contracts/api.contract.md` §3) |
| `validateWorkflow` (new) | rule violation | never throws; accumulates **all** errors; `valid:false` if `errors.length > 0`; malformed input (not an object, `nodes` not array) → single `INVALID_INPUT` error |

All thrown errors are `ApplicationError` (kernel); no other error class escapes this LEGO.

## 8. Lifecycle
Stateless, pure module. No init, no teardown, no caching.
```
parameter resolution (Node Model) → validateFieldType(name, value, type, opts) → {valid,newValue} | {valid:false,errorMessage}
expression extension ($string.toDateTime) → tryToParseDateTime(value, defaultZone)
API DTO / tooling → INodeParametersSchema.safeParse(params)
tooling / future API hook → validateWorkflow(workflowContract, {allowCycles}) → {valid, errors[]}
```

## 9. Data ownership
- Owns no persistent data and no tables.
- Owns the **schema definitions** (`schemas.ts`) as the canonical runtime shape of parameter values; other LEGOs must import them rather than redefine.
- Owns the `ValidationError` code vocabulary for the new rules.
- Does not own `interfaces.ts` (kernel) — parity is enforced, not ownership.

## 10. External interfaces
Public via `n8n-workflow` (`index.ts` re-exports):
- `validateFieldType`, `getValueDescription`, all `tryToParse*`.
- `is*` guards listed in `docs/isolation/validation.md` §3.2.
- All `*Schema` exports of `schemas.ts`.
- **New (implemented standalone in `tests/reference/agent-4/validation/workflow-rules.ts`; promotion into `packages/workflow/src` requires a boundary extension via manifest):** `validateWorkflow(workflow: WorkflowContract, options?: { allowCycles?: boolean }): { valid: boolean; errors: ValidationError[] }`, with composable parts `checkNodeUniqueness`, `checkDanglingConnections`, `detectCycles`.

## 11. Compatibility requirements
1. Every message string in §7 is frozen — editor UI and node tests match on them.
2. `validateFieldType` must never throw and must return `{valid:true}` for `null`/`undefined`.
3. `strict` must forbid coercion for `string`, `number`, `boolean`, `object`, `array`; `parseStrings=false` keeps `string` pass-through.
4. `options` uses strict equality on `option.value`.
5. `tryToParseDateTime` keeps an explicit zone in the input; applies `defaultZone` only when none is present; falls back to system zone.
6. zod schemas stay `z.ZodType<T>`-annotated; no `z.any()` widening.
7. `validateWorkflow` is **additive and opt-in**: the reference load/execute path is unchanged, so the regression gate (11/11) is unaffected. Default `allowCycles: true` for parity with the reference (n8n allows runtime loops, e.g. `Loop Over Items`); callers wanting strict DAG semantics pass `allowCycles: false`.
8. `CycleDetection` considers only `main` connections; `ai_*` edges are excluded.
9. Any implementation of the new rules must land in files inside this boundary and be documented as NEW CAPABILITY in `docs/isolation/validation.md`; no other LEGO may implement uniqueness/dangling/cycle checks (ISSUE-003 Option A).
