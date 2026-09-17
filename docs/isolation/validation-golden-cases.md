# Validation LEGO — Golden Cases (n8n 2.9.4)

Format: **INPUT → EXPECTED OUTPUT / ERROR / SIDE EFFECT**. Source of truth: `packages/workflow/src/type-validation.ts`,
`type-guards.ts`, `schemas.ts`, upstream `packages/workflow/test/type-validation.test.ts` (42 cases), and a
live check against the installed `n8n-workflow` 2.9.4 (`node_modules/n8n-workflow`) on 2026-09-17.
No side effects exist in this LEGO (pure functions) unless stated.

> **Machine-readable reference corpus (added 2026-09-17):** `tests/reference/agent-4/validation/fixtures/ref-*.json` — **229 cases recorded from the real `n8n-workflow` 2.9.4 runtime** by `gen-reference-fixtures.mjs` (61 × `validateFieldType`, 168 × `tryToParse{Number,String,AlphanumericString,Boolean,DateTime,Time,Array,Object,Url,Jwt}` over a shared 17-value input matrix). Expectations are *recorded, not hand-written*; `validation.test.ts` #14 re-executes all 229 against the live runtime on every run (anti-drift). Encoding: luxon `DateTime` → `{ $luxon: iso }`, thrown → `{ throws: { name, message } }`, `undefined` arg → `{ $undefined: true }`. Excluded on purpose: `tryToParseDateTime('23:59')` — resolves to *today* at 23:59 (wall-clock dependent; behaviour noted in §B). Any port of `type-validation.ts` is accepted when it reproduces 229/229.

## A. `validateFieldType(fieldName, value, type, options?)`

| # | INPUT | EXPECTED OUTPUT | ERROR |
|---|---|---|---|
| A1 | `('f', null, 'number')` | `{ valid: true }` | — |
| A2 | `('f', '42', 'number')` | `{ valid: true, newValue: 42 }` | — |
| A3 | `('f', '42', 'number', {strict:true})` | `{ valid: false }` | `'f' expects a number but we got '42'` |
| A4 | `('f', 'A', 'number')` | `{ valid: false }` | `'f' expects a number but we got 'A'` |
| A5 | `('f', true, 'number')` | `{ valid: true, newValue: 1 }` | — |
| A6 | `('f', '01', 'boolean')` / `'TRUE'` / `1` | `{ valid: true, newValue: true }` | — |
| A7 | `('f', '000', 'boolean')` / `'FALSE'` / `0` | `{ valid: true, newValue: false }` | — |
| A8 | `('f', 'yes', 'boolean')` / `2` / `-1` / `'tru'` | `{ valid: false }` | `'f' expects a boolean but we got 'yes'` |
| A9 | `('f', 42, 'string')` | `{ valid: true, newValue: 42 }` (pass-through, no coercion) | — |
| A10 | `('f', 42, 'string', {parseStrings:true})` | `{ valid: true, newValue: '42' }` | — |
| A11 | `('f', '1abc', 'string-alphanumeric')` | `{ valid: false }` | `Value is not a valid alphanumeric string, only letters, numbers and underscore allowed` |
| A12 | `('f', 'abc_1', 'string-alphanumeric')` | `{ valid: true, newValue: 'abc_1' }` | — |
| A13 | `('f', '1994-11-05T08:15:30-05:00', 'dateTime')` | `{ valid: true, newValue: DateTime }` (ISO; also RFC2822, HTTP, SQL) | — |
| A14 | `('f', 'not a date', 'dateTime')` | `{ valid: false }` | `'f' expects a dateTime but we got 'not a date' <br/><br/> Consider using <a href="https://moment.github.io/luxon/api-docs/index.html#datetimefromformat" target="_blank"><code>DateTime.fromFormat</code></a> to work with custom date formats.` |
| A15 | `('f', '23:23', 'time')` | `{ valid: true, newValue: '23:23' }` | — |
| A16 | `('f', '25:99', 'time')` | `{ valid: true, newValue: '25:99' }` — **shape-only check, frozen quirk** | — |
| A17 | `('f', 'x', 'options', {valueOptions:[{name:'a',value:'a'},{name:'b',value:'b'}]})` | `{ valid: false }` | `'f' expects one of the following values: [a, b] but we got 'x'` |
| A18 | `('f', {data:'x'}, 'binary')` | `{ valid: false }` | `'f' expects a binary but we got object. Make sure the value is a valid binary data object with 'mimeType' and 'data' or 'id' property.` |
| A19 | `('f', {mimeType:'text/plain', id:'1'}, 'binary')` | `{ valid: true, newValue: <same object> }` | — |
| A20 | `('f', 'nope', 'jwt')` | `{ valid: false }` | `Value is not a valid JWT token` |
| A21 | `('f', '{"a": 1}', 'object')` and `'{a: 1}'` | `{ valid: true, newValue: {a:1} }` | — |
| A22 | `('f', [], 'object', {strict:true})` | `{ valid: false }` | `'f' expects a object but we got array` |
| A23 | `('f', '[1,2]', 'array')` | `{ valid: true, newValue: [1,2] }` | — |
| A24 | `('f', 'x', 'whatever')` (unknown type) | `{ valid: true, newValue: 'x' }` | — |

## B. `tryToParse*` (throw `ApplicationError`)

| # | INPUT | EXPECTED OUTPUT | ERROR |
|---|---|---|---|
| B1 | `tryToParseNumber('A')` | — | `ApplicationError: Failed to parse value to number` |
| B2 | `tryToParseBoolean('yes')` | — | `Failed to parse value as boolean` |
| B3 | `tryToParseDateTime('2018-05-16', 'America/New_York')` | `DateTime` in `America/New_York` (defaultZone applied: no zone in input) | — |
| B4 | `tryToParseDateTime('1994-11-05T08:15:30-05:00', 'UTC')` | `DateTime` keeping `-05:00` (explicit zone wins) | — |
| B5 | `tryToParseArray('{"a":1}')` | — | `Value is not a valid array` |
| B6 | `tryToParseObject('[1]')` | — | `Value is not a valid object` |
| B7 | `tryToParseUrl('not a url')` | — | `The value "https://not a url" is not a valid url.` (input without `://` is prefixed with `https://` **before** parsing and in the message) |
| B7b | `tryToParseUrl('example.com/x')` | `'https://example.com/x'` (prefixed value is returned) | — |
| B7c | `tryToParseUrl('javascript://x')` | — | `The value "javascript://x" is not a valid url.` (`ALLOWED_URL_PROTOCOLS` = `http:`, `https:`, `ftp:`, `file:`) |
| B8 | `tryToParseJwt('')` | — | `The value "" is not a valid JWT token.` |
| B9 | `tryToParseJsonToFormFields('not json')` | — | `Value is not valid JSON` |
| B10 | `getValueDescription('s')` / `[1]` / `{a:1}` / `1` / `null` | `'s'` / `array` / `object` / `'1'` / `'null'` | — |

## C. Type guards & schemas

> **Recorded schema corpus:** `fixtures/schema-cases.jsonl` — all **45** barrel-public zod schemas × 25-value input matrix = **1125 cases** (`gen-schema-fixtures.mjs`, re-executed by `validation.test.ts` #16), plus `fixtures/schema-enums.json` with the five frozen vocabularies pulled from the runtime: `FieldTypeSchema` (12), `NodeConnectionTypeSchema` (13 — asserted equal to `NODE_CONNECTION_TYPES` in `workflow-rules.ts` / spec §2), `OnErrorSchema` (3), `FilterOperatorTypeSchema` (7), `FilterTypeCombinatorSchema` (2). Observations for ports: `GenericValueSchema` and `NodeParameterValueTypeSchema` accept every matrix value (including `null`/`undefined`) — they are *shape-permissive by design*; 5 schemas strip unknown keys on success (zod default) — parse output ≠ input, so never use `.parse` output for persistence.

> **Recorded corpus:** `fixtures/guard-*.json` — 11 public guards × 32-value input matrix = **352 cases** from the live runtime (`gen-guard-fixtures.mjs`; re-executed by `validation.test.ts` #15). Notable: **21 cases throw** (`isINodeProperties` / `isINodePropertyOptions` / `isINodePropertyCollection` on the 7 non-object inputs) — see `validation.md` §3.2 correction. `isResourceLocatorValue` checks key *presence* only (`'__rl' in value && 'mode' in value && 'value' in value`, type-guards.ts:17): `{__rl:false, mode, value}` → **true**, `{mode, value}` → false, `{__rl:true}` alone → false; `isFilterValue` accepts any string combinator (`xor` → true, structural only); `isBinaryValue` needs `mimeType` **and** (`data` or `id`).

| # | INPUT | EXPECTED OUTPUT |
|---|---|---|
| C1 | `isNodeConnectionType('main')`, `('ai_tool')`, `('nope')` | `true`, `true`, `false` |
| C2 | `isBinaryValue({mimeType:'a', id:'1'})`, `({mimeType:'a'})` | `true`, `false` |
| C3 | `isResourceLocatorValue({__rl:true, mode:'id', value:'1'})` | `true` |
| C4 | `INodeParametersSchema.safeParse({a:1, b:'x', c:{__rl:true,mode:'id',value:'1'}})` | `success: true` |
| C5 | `INodeParametersSchema.safeParse('nope')` | `success: false` |
| C6 | `NodeConnectionTypeSchema.safeParse('bogus')` | `success:false`, `issues[0].code === 'invalid_enum_value'` |

## D. Rule enforcement (NEW CAPABILITY — implemented in `tests/reference/agent-4/validation/workflow-rules.ts`, all D cases pass)

These are the target goldens for `validateWorkflow(workflow, { allowCycles })`. They are **not** reference
behaviour (see `docs/isolation/validation.md` §2); the reference silently accepts all of D1–D4.

| # | INPUT | EXPECTED OUTPUT | SIDE EFFECT |
|---|---|---|---|
| D1 | `tests/reference/01-empty-workflow` | `{ valid: true, errors: [] }` | none |
| D2 | `tests/reference/03-linear` (Trigger → Code) | `{ valid: true, errors: [] }` | none |
| D3 | two nodes named `Code` | `{ valid:false, errors:[{ code:'DUPLICATE_NODE_NAME', node:'Code', message:'Duplicate node name "Code"' }] }` | none |
| D4 | connection `Trigger → Ghost` where `Ghost` ∉ nodes | `{ valid:false, errors:[{ code:'DANGLING_CONNECTION', path:['connections','Trigger','main','0','0'], message:'Connection from "Trigger" to unknown node "Ghost"' }] }` | none |
| D5 | connection type `foo` | `{ valid:false, errors:[{ code:'INVALID_CONNECTION_TYPE', … }] }` | none |
| D6 | `A → B → A` on `main`, default options | `{ valid: true, errors: [] }` (`allowCycles` defaults to `true` for reference parity) | none |
| D7 | `A → B → A` on `main`, `{ allowCycles:false }` | `{ valid:false, errors:[{ code:'CYCLE_DETECTED', message:'Cycle detected: A → B → A' }] }` | none |
| D8 | `A → B → A` via `ai_tool` only, `{ allowCycles:false }` | `{ valid: true, errors: [] }` (only `main` edges are considered) | none |
| D9 | disabled node with duplicate name | still `DUPLICATE_NODE_NAME` (disabled-handling is not a validation concern) | none |
| D10 | `validateWorkflow('garbage')` | `{ valid:false, errors:[{ code:'INVALID_INPUT', … }] }` — never throws | none |
| D11 | diamond DAG `A → {B, C} → D`, `{ allowCycles:false }` | `{ valid: true, errors: [] }` — shared descendant is not a cycle (BLACK nodes are not revisited) | none |
| D12 | `A → B → C → A`, `{ allowCycles:false }` | `{ valid:false, errors:[{ code:'CYCLE_DETECTED', node:'A', path:['connections','C','main'], message:'Cycle detected: A → B → C → A' }] }` | none |
| D13 | nodes `[A, A]`, connections `Nope → A`, `A → Ghost` | 3 errors in this order: `DUPLICATE_NODE_NAME` (nodes[1]), `DANGLING_CONNECTION` `"Connection from \"A\" to unknown node \"Ghost\""`, `DANGLING_CONNECTION` `"Connection from unknown node \"Nope\""` — known sources (nodes[] order) before unknown sources (sorted), independent of JSON key order (§11.9) | none |
| D14 | output slots `main: [1, null, {}, [{node:'A'}]]` | 2 × `DANGLING_CONNECTION` `"Malformed connection output from \"A\""` at paths `[…,'main','0']` and `[…,'main','2']`; `null` slot is legal (sparse), never throws | none |

Machine-readable form of D1–D14: `tests/reference/agent-4/validation/fixtures/D*.json` (generated by `gen-fixtures.ts`,
guarded by the anti-drift test). Rust probe result against the unmodified `crates/n8n-validation`:
`tests/reference/agent-4/rust-parity/README.md` (10/14).

## E. `INodeSchema` / `INodesSchema` — node-shape parity anchor (real `n8n-workflow` 2.9.4, `validation.test.ts` #13)

| # | INPUT | EXPECTED OUTPUT | ERROR | SIDE EFFECT |
|---|---|---|---|---|
| E1 | minimal node `{id,name,type,typeVersion:1,position:[0,0],parameters:{}}` | `success:true` | — | none |
| E2 | + all 15 optional fields (`disabled…forceCustomOperation`, `onError:'continueErrorOutput'`, `rewireOutputLogTo:'ai_tool'`, `credentials:{x:{id:null,name}}`) | `success:true` | — | none |
| E3 | `parameters` missing | `success:false` | `parameters` `invalid_type` — **required, no default** (contrast: `crates/n8n-node-model::INode` has `#[serde(default)]` on `parameters` → accepts what n8n rejects; parity note for Agent 2 / Implementer) | none |
| E4 | `position:[0,0,0]` | `success:false` | `position` `too_big` (strict 2-tuple) | none |
| E5 | `typeVersion:"1"` | `success:false` | `typeVersion` `invalid_type` (no coercion) | none |
| E6 | `onError:'explode'` | `success:false` | `onError` `invalid_enum_value` | none |
| E7 | `rewireOutputLogTo:'foo'` | `success:false` | `rewireOutputLogTo` `invalid_enum_value` (`NodeConnectionTypeSchema`) | none |
| E8 | `credentials:{x:{name:'c'}}` | `success:false` | `credentials.x.id` `invalid_type` (`id` key required, `string \| null`) | none |
| E9 | `someFutureField:42` | `success:true`, **field stripped** from `data` | — | zod default `strip` — a port must **not** use this schema as a save gate (round-trip loss); `n8n-node-model` keeps unknown keys via `#[serde(flatten)] extra` — correct for round-trip, but note the asymmetry with E3 |
| E10 | `tests/reference/01-empty-workflow`, `03-linear` `nodes[]` via `INodesSchema` | `success:true` | — | none |
