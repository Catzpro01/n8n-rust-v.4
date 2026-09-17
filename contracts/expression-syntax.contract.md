# LEGO Contract: Expression Syntax (`{{ … }}` resolution)

**Task:** `TASK-PIPE-12` · **Worker:** Agent 6 (peran sesaat *Expression & Scoping Specialist*) · **Branch:** `agent-6`
**Derived from:** n8n `2.9.4` source (`reference/n8n/packages/workflow/src/{expression.ts, expression-evaluator-proxy.ts, expression-sandboxing.ts, expressions/expression-helpers.ts, expressions/../extensions/expression-parser.ts, extensions/expression-extension.ts, extensions/*-extensions.ts, extensions/extended-functions.ts}` + `@n8n/tournament@1.0.6`) and 503 runtime observations (see [`docs/isolation/agent-6-probes/observations.json`](../docs/isolation/agent-6-probes/observations.json)).
**Anatomy:** [`docs/isolation/expression-syntax-pipeline.md`](../docs/isolation/expression-syntax-pipeline.md)
**Relationship to other contracts:** refines [`expression.contract.md`](expression.contract.md) §1/§3/§4 (Agent 3). It is a *sub-contract of the same LEGO* — no new module, no ownership change. On any wording conflict, this file's rule wins **only** for the syntax half and only where it cites an observation ID.
**Status:** `CONTRACTED` (no implementation yet; Rust not permitted in this phase)

---

## 1. Interface

```typescript
// The whole slice is reachable through two functions.
interface ExpressionSyntax {
  isExpression(v: unknown): v is string;                       // v is string && v[0] === '='

  resolveLeaf(input: {
    parameterValue: NodeParameterValue;                        // string leaf
    siblingParameters: INodeParameters;                        // may be {}
    data: IDataObject;                                         // the PIPE-13 proxy object
    returnObjectAsString?: boolean;                            // default false
    runIndex: number; itemIndex: number;                       // error context only
  }): NodeParameterValue | undefined;                          // throws ExpressionError | ApplicationError

  walk<T>(value: T, data: IDataObject, opts): T;               // array/object recursion, leaf → resolveLeaf
}

// internal but observable, therefore contractual
splitTemplate(text): Array<{type:'text',text:string} | {type:'code',text:string,hasClosingBrackets:boolean}>
extendSyntax(text, forceExtend?: boolean): string
compileAndRun(text, data): unknown                             // = Tournament.execute
```

No function in this slice may read workflow data by itself: `data` is the only world it can see.

## 2. Input contract

| Input | Rule |
|---|---|
| `parameterValue` | any JSON-ish value. Only `string` with `charAt(0) === '='` is evaluated; everything else (incl. `number`, `boolean`, `null`, `undefined`, objects not containing `=` leaves) returns **identity** |
| `data` | object with property access; may be augmented by the caller (`extend`, `extendOptional`, `__sanitize`, extended functions, `process`, deny/allow globals). The slice must not assume `$json` exists |
| `returnObjectAsString` | only honoured for `typeof value === 'object' && value !== null` |
| recursion | arrays: element-wise with `siblingParameters = {}`; plain objects: entry-wise with `siblingParameters = <that object>`; `null`/`undefined` short-circuit |

## 3. Output contract (template algebra)

```
T := chunk*                                   chunk := TEXT | '{{' JS '}}' | '{{' JS (EOF)
pure := chunks == [TEXT(''), CODE]             // ONE code chunk and a text chunk of length exactly 0
```

| # | Rule | Vector (observed) |
|---|---|---|
| O1 | `pure` ⇒ raw JS value (any type, incl. `undefined`, `NaN`, objects, `DateTime`). Any character outside the braces — **including a single space** — makes it non-`pure` | `={{1}} → 1` · `={{ {a:1} }} → {a:1}` · `={{ undefined }} → undefined` · `= {{1}} → " 1"` (string) · `={{ 1 }}  → "1  "` |
| O2 | non-`pure` ⇒ `Array.map(part).join('')` with `undefined`/`null` → `""`, `false → "false"`, `0 → "0"`, `NaN → "NaN"`, object → `"[object Object]"` | `=a{{undefined}}b → "ab"` · `=x{{0}}y → "x0y"` · `=a{{ {a:1} }}b → "a[object Object]b"` |
| O2b | two adjacent code chunks are joined too (never raw), and a chunk that evaluates to `undefined`/`null` contributes `""` | `={{1}}{{2}} → "12"` · `={{ $json.a }}{{ $json.b }} → "1"` (b missing) |
| O3 | single `=` stripped; second `=` is literal text | `={{1}} → 1` · `=={{1}} → "=1"` |
| O4 | `"="` → `""`; `"=abc"` → `"abc"` (empty template short-circuits before parsing) | `12B2` |
| O5 | bare text (no braces) after `=` is **not** evaluated as JS | `={{1+1}} → 2` · `=1+1 → "1+1"` |
| O6 | empty code chunk is an error, not empty string | `={{}} → ApplicationError("invalid syntax")` |
| O7 | unmatched `}}` is text; unmatched `{{` is evaluated | `=a}} → "a}}"` · `=x{{1 → "x1"` |
| O8 | escaping: a `\` run of odd length before a delimiter escapes it (eval splitter); even length is normalised `\`→`\` in TEXT chunks and does **not** escape | `=\{{a}} → "\{{a}}"`(text) · `=\\{{1}} → "\" + 1` |
| O9 | `returnObjectAsString` ⇒ `[<Type>: <json>]` with `Date` ISO in workflow timezone, luxon `toString()`, `JSON.stringify` otherwise; invalid luxon ⇒ `ApplicationError("invalid DateTime")`; `null` never reaches it | `→ "[Object: {\"a\": 1}]"` · `"[Array: [1,2]]"` · `"[Date: 1969-12-31T19:00:00.000-05:00]"` |
| O10 | a `function` result ⇒ `ApplicationError("this is a function, please add ()")`, except a value named `DateTime` ⇒ `ApplicationError("this is a DateTime, please access its methods")` | `={{ $now.constructor }}` blocked earlier by C1 |
| O11 | `string` results are returned as-is even if they look like JSON | `={{ "1" }} → "1"` |

## 4. Sandbox contract (normative, order matters)

```
C1  before any parsing: if /\.\s*constructor/ matches the (un-extended) source text
    → ExpressionError("Expression contains invalid constructor function call",
                       { causeDetailed: "Constructor override attempt is not allowed due to security concerns",
                         runIndex, itemIndex })
C2  globals visible to a template = exactly:  allow-list(initializeGlobalContext)
    ∪ { …data keys }   — deny-list entries are present-but-empty ({}), never absent
C3  identifier resolution:   ("name" in data) ? data.name : global.name
    with EXEMPT = { isFinite, isNaN, NaN, Date, RegExp, Math, undefined, this, window, global }
C4  `this` → { process:{}, require:{}, module:{}, Buffer:{} };  `globalThis` → {}
C5  member access with a statically known key is validated against
    { __proto__, prototype, constructor, getPrototypeOf, mainModule, binding, _linkedBinding,
      _load, prepareStackTrace, __lookupGetter__, __lookupSetter__, __defineGetter__,
      __defineSetter__, caller, arguments, getBuiltinModule, dlopen, execve, loadEnvFile }
    violation → ExpressionError('Cannot access "<k>" due to security concerns') at COMPILE time
C6  member access with a dynamic key is routed through data.__sanitize(key) and therefore throws
    at RUN time — inside the try/catch ⇒ observed value is `undefined`, not an error
C7  banned syntax, each with its own error class: WithStatement, reserved bindings
    (`___n8n_data`, `__sanitize`), class extension of Function/GeneratorFunction/AsyncFunction/
    AsyncGeneratorFunction or of a non-identifier base, unsafe/computed destructuring
C8  bare `$` (not as callee, not as a top-level `obj.$` property read) →
    ExpressionError('Cannot access "$" without calling it as a function')
C9  process access is n8n's own subset {arch, env, platform, pid, ppid, release, version, versions};
    `env` is {} unless N8N_BLOCK_ENV_ACCESS_IN_NODE === 'false'.
    KNOWN UPSTREAM DEFECT: `version` is assigned process.pid — preserve (see §7 DEV-1)
C10 runtime errors inside a code chunk are swallowed unless they are
    ExpressionError|ExpressionExtensionError; a swallowed chunk yields `undefined` (pure) or "" (O2)
```

## 5. Extension-syntax contract

| # | Rule |
|---|---|
| X1 | detection is textual: `EXPRESION_EXTENSION_REGEX = /(\$if\|\.(\s*<methods>\s*)(\?\.)?)\s*\(/` applied to code chunks after removing the **first** quoted span; if nothing matches **or** `hasNativeMethod(template)` is true ⇒ return the input unchanged |
| X2 | transform: `a.m(args)` → `extend(a, "m", [args])`; nested chains nest left-to-right; trailing `;` stripped; bare-object chunks parsed as `(<obj>)`; unparseable chunk ⇒ `ExpressionExtensionError("invalid syntax")` |
| X3 | `$if(c, a, b)` is rewritten **syntactically** to `c ? a : b` (it is not a runtime function) |
| X4 | `$min $max $average $not $ifEmpty $numberList $zip` are runtime values from `extendedFunctions`, injected into `data`; they are never rewritten |
| X5 | `?.` combined with an extension method is lowered to `global.chainCancelTokenN / chainValueN` assignments (numbering per transform call); an implementation may use any equivalent that preserves short-circuit-to-`undefined` semantics, but must not write to a host global (DEV-3) |
| X6 | results are memoised for the process lifetime in `EXTENDED_SYNTAX_CACHE` keyed by the raw source text (same text ⇒ same output) |
| X7 | runtime dispatch order for `extend(value, name, args)`: Array → date-like string (auto-`new Date`, except `toDate`/`toDateTime`) → string → number → `DateTime`/`Date` → object → boolean → native method with that name → generic (`isEmpty`, `isNotEmpty`) → `ExpressionExtensionError` with the "only callable on type(s) …" message |
| X8 | surface (must match exactly): String 33 · Array 26 · Date 18 · Object 15 · Number 12 · Boolean 5 methods; list in `observations.json → PIPE-12["12C2_extension_inventory"]` |

## 6. Errors

| Class | Trigger | Notes |
|---|---|---|
| `ExpressionError` | C1, C5, C6, C7, C8 | `context.runIndex/itemIndex` filled by this slice; `context.parameter` is filled by the **consumer** (core), never here |
| `ExpressionExtensionError` (+ subclasses for C7) | X2, X7 | subclasses are `instanceof ExpressionError` — order of `catch` matters for consumers |
| `ApplicationError('invalid syntax')` | any `SyntaxError` escaping compile/parse | message must stay verbatim (UI matches on it) |
| `ApplicationError('this is a function, please add ()' / 'this is a DateTime, please access its methods' / 'invalid DateTime')` | O10, O9 | |
| frontend-only beautification | `IS_FRONTEND && TypeError && /is not a function/` | must not fire on the backend |

## 7. Deviations allowed / recorded

| ID | Item | Decision required |
|---|---|---|
| DEV-1 | `process.version` → pid (anatomy finding D2) | **keep as-is** (compat) unless Agent 5 records an approved deviation |
| DEV-2 | two splitters with different escape rules (§3 O8, anatomy D3) | keep both; a unification is a **behaviour change** and needs golden re-snapshot |
| DEV-3 | `global.chain*` lowering (X5) | may be replaced by an equivalent local-scope form; must produce identical values for `=a{{x?.isEmpty()}}b` |
| DEV-4 | unbounded caches (X6, tournament compile cache) | implementation may bound them; observable behaviour unchanged |

## 8. Non-goals (do not implement here)

`$json`/`$node`/`$parameter` resolution (→ [`variable-lookup.contract.md`](variable-lookup.contract.md)) · parameter fetching, `ensureType`, `extractValue`, schema validation, `cleanupParameterData` · `additionalKeys` construction · editor autocomplete.

## 9. Acceptance criteria (a Rust/other-language port is DONE when)

1. Every vector of §3, §4, §5 replays byte-identically against `observations.json` (the file is the
   oracle; `tests/reference/expression/*` remain the shared golden set and must stay green).
2. `isExpression` + strip + walk identity rules hold for a 10 000-case random parameter tree
   (fuzz: no crash, no mutation of input, key order preserved).
3. All 39 sandbox cases (`12D`) reproduce: same class, same message, same "swallowed → `undefined`" outcomes.
4. Extension surface diff is empty (X8) and `$if`/`?.` rewrites match X3/X5 semantics.
5. Deterministic given a fixed `data`: same input template + same data ⇒ same value, no global state
   other than the explicitly allowed caches (DEV-4).
