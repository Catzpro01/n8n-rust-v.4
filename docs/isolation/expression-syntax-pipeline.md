# Isolation Record: `{{ … }}` Expression Syntax Pipeline — TASK-PIPE-12

**Worker:** Agent 6 (peran sesaat: *Expression & Scoping Specialist*) · **Branch:** `agent-6` / work branch `arena/01a0ace1-n8n-rust-v-4`
**Tasks:** `TASK-PIPE-12` (evaluation of `{{ … }}`) — companion record: [`variable-lookup-scoping.md`](variable-lookup-scoping.md) (`TASK-PIPE-13`)
**Reference:** n8n `2.9.4` (`reference/n8n`, upstream commit `b6dc2787c45677a29a9612cd27eb911302961a83`)
**Runtime observed:** `n8n-workflow@2.9.1`, `n8n-core@2.9.1`, `@n8n/tournament@1.0.6`, `luxon@3.7.2`, Node `v22.22.3`
**Status:** `ISOLATED` (anatomy + boundary + 461 machine-recorded observations, PIPE-12 slice: 266). **No Rust was written; `crates/`, `apps/`, `packages/workflow-lego/`, `contracts/expression.contract.md` untouched.**
**Contract:** [`contracts/expression-syntax.contract.md`](../../contracts/expression-syntax.contract.md)

> This record is a **slice** of the Expression LEGO already documented in
> [`docs/isolation/expression.md`](expression.md) (Agent 3). That document maps the *whole*
> LEGO; this one dissects **only the syntax-resolution half** — from `isExpression()` to the
> value returned by `Expression.renderExpression()` — down to the level needed to port it
> without guesswork. Where the two disagree, this record is the *observed* behaviour and the
> disagreement is listed in §10 rather than silently overwritten.

---

## 1. What was dissected (file inventory, actual LOC)

| Stage | File (`reference/n8n/packages/…`) | LOC | Role in the pipeline |
|---|---|---|---|
| S1 detection | `workflow/src/expressions/expression-helpers.ts` | 9 | `isExpression(v)` ⇔ `typeof v === 'string' && v.charAt(0) === '='` |
| S2 orchestration | `workflow/src/expression.ts` | 714 | `Expression.resolveSimpleParameterValue()` L378, `renderExpression()` L480, `initializeGlobalContext()` L183, `convertObjectValueToString()` L336, `getParameterValue()` L604 (recursive walk) |
| S3 global seeding | `workflow/src/expression.ts` L183-326 | ~140 | deny-list (`data.x = {}`) + allow-list (`Date`, `Math`, safe `Object`, safe `Error`, …) written **into the data proxy object** |
| S4 extension syntax | `workflow/src/extensions/expression-extension.ts` | 633 | `extendSyntax()` L579, `extendTransform()`, `extend()`/`extendOptional()`, `EXTENDED_SYNTAX_CACHE` |
| S4b chunking (extension) | `workflow/src/extensions/expression-parser.ts` | 100 | **n8n's own** `splitExpression` / `joinExpression` / `escapeCode` |
| S5 evaluator proxy | `workflow/src/expression-evaluator-proxy.ts` | 21 | builds `new Tournament(errorHandler, undefined, undefined, { before:[ThisSanitizer], after:[PrototypeSanitizer, DollarSignValidator] })` |
| S6 chunking (eval) | `@n8n/tournament/src/ExpressionSplitter.ts` | — | **tournament's own** `splitExpression` (different escape rules, `normalizeBackslashes`) |
| S7 codegen | `@n8n/tournament/src/ExpressionBuilder.ts` | — | `getExpressionCode()`: tmpl-compatible JS generation, try/catch wrap, `v || v===0 \|\| v===false ? v : ''` |
| S7b scope rewrite | `@n8n/tournament/src/VariablePolyfill.ts` | — | every free identifier → `("<name>" in ___n8n_data) ? ___n8n_data.<name> : global.<name>` |
| S8 sandbox hooks | `workflow/src/expression-sandboxing.ts` | 563 | `ThisSanitizer`, `PrototypeSanitizer`, `DollarSignValidator`, `__sanitize`, `EMPTY_CONTEXT`, `SAFE_GLOBAL` |
| S9 execution | `@n8n/tournament/src/FunctionEvaluator.ts` | — | `new Function('E', code)` + `fn.call(data, errorHandler)`; per-template compile cache |
| Extension libs | `workflow/src/extensions/{string,number,date,array,object,boolean}-extensions.ts`, `extended-functions.ts`, `extensions.ts` | 3183 | the runtime functions `extend()` dispatches to |
| Errors | `workflow/src/errors/expression*.error.ts`, `workflow/src/utils.ts` (`unsafeObjectProperties` L368) | — | error taxonomy + property deny-list |

**Not part of this slice** (see §9): `WorkflowDataProxy` (PIPE-13), n8n-core post-processing, editor autocomplete.

---

## 2. The pipeline, stage by stage (call chain verified against source)

```text
Expression.getParameterValue(value, …)                       [expression.ts L604]
  ├─ typeof value !== 'object'  ──► resolveSimpleParameterValue(value, {})          (leaf)
  ├─ Array.isArray(value)       ──► map(leaf) with siblingParameters = {}
  ├─ value === null/undefined   ──► returned as-is
  └─ plain object               ──► resolve each key with siblingParameters = value
                                     └─ if returnObjectAsString → convertObjectValueToString(obj)

Expression.resolveSimpleParameterValue(parameterValue, siblingParameters, …)  [L378]
  1. !isExpression(v)                         → return v unchanged            (S1)
  2. v = v.substr(1)                          → strip the single leading '='
  3. data = new WorkflowDataProxy(…).getDataProxy()                ── PIPE-13 record
  4. data.process = { arch, env: blocked?, platform, pid, ppid, release,
                      version: process.pid,   ← upstream defect, see §10-D2
                      versions }                                   (expression.ts L424)
  5. Expression.initializeGlobalContext(data)  → deny-list + allow-list ON data (S3)
  6. data.extend = extend; data.extendOptional = extendOptional
  7. Object.defineProperty(data, '__sanitize', { value: sanitizer, writable:false })
  8. Object.assign(data, extendedFunctions)    → $min,$max,$average,$not,$ifEmpty,$numberList,$zip
  9. if (/\.\s*constructor/gm.test(v)) throw ExpressionError      ← TEXT scan, pre-parse (L452)
 10. extended = extendSyntax(v)                 ← may replace the source text  (S4)
 11. returnValue = this.renderExpression(extended, data)          (S5…S9)
 12. typeof returnValue === 'function':
         name === 'DateTime' → ApplicationError('this is a DateTime, please access its methods')
         else               → ApplicationError('this is a function, please add ()')
     typeof returnValue === 'string' → returned as-is
     object && returnObjectAsString  → convertObjectValueToString()
     otherwise → returned raw (number/boolean/null/undefined/DateTime/object/array)

Expression.renderExpression(expr, data)                        [L480]
  try   { return evaluateExpression(expr, data) }              → Tournament.execute
  catch { ExpressionError|ExpressionExtensionError → rethrow
          SyntaxError → ApplicationError('invalid syntax')
          TypeError && IS_FRONTEND && "…is not a function" → ApplicationError(<msg>) }
  → falls through and returns **null** only for errors not matched above
    (in practice unreachable for expressions containing any member access — see §10-D1)
```

`Expression.getSimpleParameterValue()` / `getComplexParameterValue()` (L505/L543) reuse the same
leaf path but with `createEmptyRunExecutionData()` and empty input — and
`getComplexParameterValue` resolves the tree **twice** (outer pass, then inner pass), so a string
produced by the first pass that itself starts with `=` is evaluated a second time.

---

## 3. Grammar of a template parameter (S1 + S6, as executed)

A parameter value is a *template*, not an expression. Grammar inferred and confirmed by
observation (`12A`, `12B2`):

```
template   := chunk*                       chunk := TEXT | CODE
TEXT       := any chars; "\\\\" → "\" (eval splitter only), "\{{" and "\}}" are literals
CODE       := "{{" js-source "}}"          js-source parsed by esprima-next (tolerant, no statements expected)
CODE_OPEN  := "{{" js-source EOF           legal! hasClosingBrackets=false, still evaluated (§10-C3)
param      := ("=" template) | non_string_value
```

Rules that a port must reproduce exactly (all observed):

| # | Rule | Observation |
|---|---|---|
| G1 | Only `=` at **index 0** makes a string an expression; `{{1}}` without `=` stays literal text | `'{{1}}' → "{{1}}"`; `'1' → 1` (number untouched) |
| G2 | Exactly one `=` is stripped, so `'={{1}}' → 1` (number) but `'=={{1}}' → "=1"` (string) | `12B2`, `13D_extra.evaluate_expression_forms` |
| G3 | `'='` alone → `''`; `'=abc'` → `'abc'`; leading `=` of an empty template short-circuits in `Tournament.execute` (`if (!expr) return expr`) | `12B2` |
| G4 | Splitting is a left-to-right scan alternating between `/\{\{/` and `/\}\}/`; a bracket with an **odd** number of preceding backslashes is a literal, an **even** count is a delimiter | `12A`: `'\\{{a}}'` → text; `'\\\\{{a}}'` → text `\\` + code `a` |
| G5 | Unmatched closing `}}` is plain text; unmatched opening `{{` is **still evaluated** as code (`hasClosingBrackets:false`) | `'a}}' → 'a}}'`, `'x{{1' → 'x1'` |
| G6 | Text chunks are emitted verbatim **except** the eval splitter collapses `\\`→`\` before joining, so `=a\\b` renders `a\b` | `12A` row `"a\\\\b{{1}}"`: n8n text `a\\b` vs tournament text `a\b` |
| G7 | `{{}}` / `{{ }}` (empty code) is **not** an empty string — it throws `SyntaxError('Not a expression statement')` → `ApplicationError('invalid syntax')` | `12B.empty_code_only` |
| G8 | Nested/escaped braces inside code (`'{{"{{"}}'`) survive because the scan only tracks the *current* delimiter kind | `12A` |
| G9 | Multiple chunks ⇒ `parts.join('')` (string); single chunk ⇒ raw value | §4 |

**Divergence found (§10-C1): the pipeline contains TWO splitters with different escape semantics.**
`extensions/expression-parser.ts` matches `/(?<escape>\\|)(?<brackets>\{\{)/` — a *single* backslash
before `{{` always escapes it (it never counts runs) and it does **not** normalise double
backslashes. `@n8n/tournament/ExpressionSplitter` counts the backslash run (odd ⇒ escaped) and
normalises `\\`→`\` in text chunks. Because n8n's splitter is used **only** to decide whether the
extension transform applies, and tournament's splitter is used for the actual codegen, a template
can be classified "no extension needed" while its code chunks still get compiled — and
`=\\{{1}}` is evaluated as `=` + text + `1` by tournament while n8n's own splitter sees pure text.
Verified by the 3 divergent rows of `12A` (66 chunking observations recorded).

---

## 4. tmpl-compatibility codegen (S7) — the value rules

`getExpressionCode(expr, '___n8n_data', hooks)` emits a function body whose *shape* determines
the returned type. From `ExpressionBuilder.ts`, confirmed by observation:

```
chunks = splitExpression(expr)
if (chunks.length === 2 && chunks[0].text === ''):      // "pure" single-expression template
      →  return <expression>                            // raw JS value
else:                                                   // any literal text, or >1 chunk
      →  return [ part0, fn.call(this).toString(), … ].join('')   where
         fn = function (v) { try { v = <expr> } catch (e) { E(e, this) } ; return v || v === 0 || v === false ? v : '' }
```

| Template | Result | Why |
|---|---|---|
| `={{1}}` | `1` (number) | pure → raw value |
| `={{ "x" }}` | `'x'` | raw |
| `={{ [1,2] }}` | `[1,2]` | raw array |
| `={{ {a:1} }}` | `{a:1}` | bare `{` is re-wrapped in parentheses by `maybeWrapExpr` |
| `={{ true }}` / `={{ null }}` | `true` / `null` | `v===false`/`v===0` guard keeps falsies |
| `={{ undefined }}` | `undefined` | pure form has no `''` fallback |
| `=a{{undefined}}b` | `'ab'` | `join(['a','', 'b'])` — `undefined`/`null` render as `''` |
| `=a{{null}}b` | `'ab'` | same |
| `=a{{false}}b` | `'xfalsey'`→`'afalseb'` | `v===false ? v : ''` keeps `false`, `join` stringifies it |
| `=a{{0}}b` | `'a0b'` | `v===0` guard |
| `=a{{ {a:1} }}b` | `'a[object Object]b'` | `join` coercion, **not** `[Object: …]` |
| `=x{{ (()=>{throw new Error()})() }}` | `'x'` | chunk swallowed to `''` by try/catch + `E` |
| `={{ 1/0 }}`, `={{ NaN }}` | `Infinity`, `NaN` | JS semantics preserved |

Falsies/NaN are **observable differences** a port must not "clean up": they are the reason n8n
renders `0` and `false` inside text but drops `null`/`undefined`.

**`try`/`catch` wrap rule:** `shouldWrapInTry(parsed)` is evaluated **after** `jsVariablePolyfill`
(§5), so virtually every real expression contains a `MemberExpression` and is therefore wrapped.
Consequence (verified over 12 failing-expression probes): runtime errors *inside* a template do not
reach `renderExpression` — they are swallowed by the `E` handler, which n8n configures to
re-throw **only** `ExpressionError`/`ExpressionExtensionError` (`expression.ts` L56-59 +
`setErrorHandler`). So on the backend an error inside `{{ }}` degrades to `undefined`
(pure template) or `''` (template with text), and `renderExpression`'s `return null` is only
reachable for templates whose polyfilled AST contains no member/call node at all.
**This refines the "→ null" row in `docs/isolation/expression.md` §5.**

---

## 5. Sandbox model (S3 + S5 + S8)

The sandbox is **not** a realm/worker — it is (a) a compile-time AST rewrite, (b) an identifier
polyfill against a data object, (c) a `new Function` body executed with `this = data`.

```
tournament: new Function('E', code) ; fn.call(data, errorHandler)
   ⇒ `this` inside the template is the data proxy
   ⇒ every free identifier `x` becomes  ("x" in data) ? data.x : global.x
   ⇒ EXEMPT (never polyfilled): isFinite isNaN NaN Date RegExp Math undefined   (+ this/window/global)
```

Two consequences that the port must keep:

1. `has: () => true` on the data proxy makes `"<anything>" in data` **always true**, so the
   `global` fallback is dead for parameter evaluation: an unknown identifier evaluates to
   `data[x]` → `undefined` instead of throwing `ReferenceError`. Observed: `={{ notDefined }}`
   → `undefined`, `={{ nope?.x }}` → `undefined` (12 probes, no throw).
2. Deny-listed globals are present but *empty objects* (`data.eval = {}`), so `eval("1")` throws
   `TypeError: not a function` → swallowed (§4) → `undefined`. Denied code fails **silently**,
   it does not produce an error message. Confirmed for `require`, `eval`, `Function`, `Promise`,
   `Buffer`, `Object.defineProperty`, `Error.captureStackTrace` (all → `undefined`).

Hook order (from `expression-evaluator-proxy.ts`): `before: [ThisSanitizer]`,
`after: [PrototypeSanitizer, DollarSignValidator]` — and the text-level
`/\.\s*constructor/` scan runs **before** all of them (step 9 in §2).

| Mechanism | Source | Effect | Observed |
|---|---|---|---|
| `.constructor` text scan | `expression.ts` L452 | `ExpressionError('Expression contains invalid constructor function call')` | `constructor_direct`, `constructor_member` ✔ (matches literal text `}.constructor`, `a.constructor`) |
| static member/computed property check | `PrototypeSanitizer.visitMemberExpression` + `isSafeObjectProperty` (`utils.ts` L368-388: `__proto__`, `prototype`, `constructor`, `getPrototypeOf`, `mainModule`, `binding`, `_linkedBinding`, `_load`, `prepareStackTrace`, `__lookup*`, `__define*`, `caller`, `arguments`, `getBuiltinModule`, `dlopen`, `execve`, `loadEnvFile`) | `ExpressionError('Cannot access "<p>" due to security concerns')` at **compile** time | `proto_literal`, `proto_member`, `proto_computed`, `constructor_computed`, `error_prepare_set` ✔ |
| dynamic member access | rewritten to `obj[___n8n_data.__sanitize(key)]` | key validated at **runtime**; throwing is swallowed by the try/catch ⇒ `undefined` | `proto_dynamic`, `prototype_dynamic` → `undefined` (no error surfaced) |
| reserved-name binding ban | `PrototypeSanitizer` (`VariableDeclarator`, `Function`, `CatchClause`, `Assignment`, `Update`, `ForIn/Of`, `Class*`) | `ExpressionReservedVariableError` for `___n8n_data` / `__sanitize` | `reserved_shadow`, `sanitize_shadow` ✔ |
| `with` ban | `visitWithStatement` | `ExpressionWithStatementError` | ✔ |
| class-extension ban | `blockedBaseClasses` = `Function`, `GeneratorFunction`, `AsyncFunction`, `AsyncGeneratorFunction`; non-identifier superclass also blocked | `ExpressionClassExtensionError` / `ExpressionError('Cannot use dynamic class extension…')` | ✔ both |
| destructuring ban | `ObjectPattern` keys not in `unsafeObjectProperty`, computed keys banned | `ExpressionDestructuringError`, `ExpressionComputedDestructuringError` | ✔ both |
| bare `$` validator | `DollarSignValidator` | `ExpressionError('Cannot access "$" without calling it as a function')`; allowed as callee `$()` or as property `obj.$` | `bare_dollar`, `dollar_object` ✔; `dollar_property` (`{$:""}.$`) still rejected — the "allowed property" branch only accepts a top-level `ExpressionStatement`, so `={{ ({$:''}).$ }}` throws (12D) |
| `this` neutering | `ThisSanitizer` (`IIFE → .call(EMPTY_CONTEXT,…)`, `FunctionExpression → .bind(EMPTY_CONTEXT)`, `ThisExpression → (0,{process:…})`) | `this` evaluates to `{process:{},require:{},module:{},Buffer:{}}` | `this_expr`, `this_arrow_process` ✔ |
| `globalThis` | `visitIdentifier` replaces `globalThis` with `{}` unless it is a property name | `globalThis` → `{}`, `globalThis.process` → `undefined` | ✔ |
| spread of globals | `buildSafeSpreadArg`: `("process" in data) ? data.process : throw` | spreads **`data.process`**, i.e. n8n's own subset | `{...process}` → `{arch, env:{}, platform, pid, ppid, release, version, versions}` (12D) — leaks pid/ppid/release/versions, **by upstream design** |

`initializeGlobalContext` allow-list (what a template may use): `Date`, `DateTime`, `Interval`,
`Duration`, safe `Object`, `Array`+typed arrays, `Map/Set/WeakMap/WeakSet`, safe `Error` family,
`Intl`, `String`, `RegExp`, `Math`, `Number`, `BigInt`, `Infinity`, `NaN`, `isFinite`, `isNaN`,
`parseFloat`, `parseInt`, `JSON`, `ArrayBuffer`/`SharedArrayBuffer`/`Atomics`/`DataView`,
`encode*/decode*URI(Component)`, `Boolean`, `Symbol` — plus everything the data proxy itself
supplies (`$…`, `extend`, `extendOptional`, `__sanitize`, the extended functions, `process`).

---

## 6. Extension syntax (S4) — two sub-languages

`extendSyntax(parameterValue, forceExtend=false)` (`expression-extension.ts` L579):

1. split with **n8n's** splitter; keep only `code` chunks; for the detector, strip the **first**
   quoted literal per chunk: `c.text.replace(/("|').*?("|')/, '').trim()` (a single non-global,
   non-greedy alternation — see §10-C2).
2. if no chunk matches `EXPRESSION_EXTENSION_REGEX` **or** `hasNativeMethod(fullTemplate)` is true,
   return the input **unchanged** (fast path).
3. else look up / fill `EXTENDED_SYNTAX_CACHE` (module-global, never evicted) and rewrite each code
   chunk with `extendTransform` (recast+esprima-next), then re-`joinExpression`.
4. a chunk that fails to parse and does not start with `{` ⇒ `ExpressionExtensionError('invalid syntax')`;
   a trailing `;` is stripped from the printed code.

`EXPRESSION_EXTENSION_REGEX = /(\$if|\.(\s*(…methods)\s*)(\?\.)?)\s*\(/` — i.e. **only `$if` and
`.method(` forms trigger the transform.** `$min`, `$max`, `$average`, `$not`, `$ifEmpty`,
`$numberList`, `$zip` are *not* rewritten; they are runtime values injected in step 8 of §2 from
`extendedFunctions`. Observed (`12C`):

```
'{{ $json.a.isEmpty() }}'            → '{{ extend($json.a, "isEmpty", []) }}'
'{{ $json.a.trim().isEmpty() }}'      → '{{ extend($json.a.trim(), "isEmpty", []) }}'   (native inner call kept)
'{{ $if($json.a, "y", "n") }}'        → '{{ $json.a ? "y" : "n" }}'                     (syntactic rewrite, NOT a call)
'{{ "x".trim() }}'                    → unchanged (no extension method)
'{{ $min(1, 2) }}'                    → unchanged (resolved at runtime)
'{{ { data: 1 } }}'                   → unchanged (hasExpressionExtension false)
'{{ $json.a?.isEmpty() }}'            → '{{global.chainCancelToken1 = ((global.chainValue1 = $json.a) ?? undefined)
                                            === undefined, global.chainCancelToken1 === true ? undefined
                                            : extend(global.chainValue1, "isEmpty", [])}}'
'{{ "literal.isEmpty()" }}'           → hasExpressionExtension=true, extendSyntax leaves it unchanged
```

`?.` + extension ⇒ the optional chain is **lowered to assignments on `global.chainCancelTokenN` /
`global.chainValueN`** (`global` is the `var global = {}` declared by tournament's program, so the
write stays inside one evaluation, but it *is* a mutable global per template and the numbering is
per-`extendTransform` call). A Rust port needs a defined equivalent (suggested: pure
`&&`-guarded sequence, documented as a deviation, or an explicit local-binding block).

Runtime dispatch (`findExtendedFunction` → `extend`/`extendOptional`) resolves a call by the
**input type**, in this order: Array → string-that-looks-like-a-date (auto `new Date(input)` unless
the method is `toDate`/`toDateTime`) → string → number → `DateTime`/`Date` → object → boolean; then
falls back to a native method of the same name on the value, then to `genericExtensions`
(`isEmpty`, `isNotEmpty`). Unknown ⇒ `ExpressionExtensionError('<fn>() is only callable on type(s) …')`.

Surface inventory (recorded in `12C2`, so a port can be checked mechanically):
`String` 33 methods, `Array` 26, `Date` 18, `Object` 15, `Number` 12, `Boolean` 5;
`extendedFunctions` = `min, max, not, average, numberList, zip, $min, $max, $average, $not, $ifEmpty`.

---

## 7. Result post-processing **inside** this slice

Only `typeof`-driven coercion happens here (steps 12 in §2). Everything else belongs to the
consumer (n8n-core): `cleanupParameterData` (luxon→string), `ensureType`, `extractValue`,
`validateValueAgainstSchema`. Documented in PIPE-13 §11 and in `contracts/expression.contract.md`.

`convertObjectValueToString(value)` (L336): `DateTime` with `invalidReason` → `ApplicationError('invalid DateTime')`;
`null` → `'null'`; `Date` → `DateTime.fromJSDate(…, zone: workflow.settings.timezone ?? globalState).toISO()`;
luxon → `value.toString()`; else `JSON.stringify`; whitespace nudged (`,"`→`, "`, `":`→`": `)
and wrapped as `[<TypeName>: <json>]`. Observed forms: `[Object: {"a": 1}]`,
`[Array: [1,2]]`, `[Date: 1969-12-31T19:00:00.000-05:00]`, `[DateTime: 2026-…-04:00]`; `null`
stays `null` (the `returnObjectAsString` branch is not reached for null).

---

## 8. Invariants (normative, testable)

```
S1  isExpression(v) is the ONLY gate; it never throws and accepts every string starting with '='.
S2  exactly one leading '=' is stripped; no other trimming happens.
S3  evaluation never mutates the input value; objects/arrays produce new containers, key order kept.
S4  a pure single-chunk template returns the raw JS value; any template with literal text returns a string.
S5  in text mode: null|undefined -> "", false -> "false", 0 -> "0", {} -> "[object Object]", NaN -> "NaN".
S6  an empty code chunk ({{}}) is a syntax error, not an empty string.
S7  an unclosed '{{' is still evaluated; an unmatched '}}' is text.
S8  runtime errors raised inside a code chunk are swallowed unless they are (Expression|ExpressionExtension)Error.
S9  '.constructor' occurring in the source text is rejected before parsing; '__proto__'/'prototype'/
    'constructor' member access is rejected at compile time; dynamic keys are checked at run time.
S10 deny-listed globals are {} (not absent): using them fails silently with undefined.
S11 extendSyntax is a pure text→text rewrite with a process-lifetime cache keyed by the raw template.
S12 the extension transform only fires for '$if' or '.<extensionMethod>(' patterns.
S13 every leaf re-creates a WorkflowDataProxy; there is no per-parameter memoisation (only the
    extension-cache and tournament's per-template compile cache).
S14 `this`, `globalThis`, `window`, `global` and `process` never expose the real host objects.
```

---

## 9. Boundary decision (this slice)

```
                       ┌────────────────────────────────────────────┐
  parameter tree ───►  │ EXPRESSION-SYNTAX SLICE (PIPE-12)         │
  (Workflow LEGO)      │  detect · strip · seed · guard · extend · │
                       │  compile(tmpl-compat) · eval · coerce     │
                       └───────┬───────────────────────┬──────────┘
             data proxy object │                     │ source text it must resolve against
                       ┌───────▼──────────┐   ┌───────▼────────────────────┐
                       │ PIPE-13 LOOKUP   │   │ CONSUMERS (read-only)      │
                       │ WorkflowDataProxy│   │ core, webhooks, creds,     │
                       │ (see other doc)  │   │ task-runner, editor-ui     │
                       └──────────────────┘   └────────────────────────────┘
```

Owns: detection, the strip rule, the global seeding list, the `constructor` pre-scan, the
extension-syntax rewrite + extension runtime dispatch, the evaluator proxy + hook wiring, the
tmpl-compat codegen contract, the coercion rules, `ExpressionError` taxonomy producers.

Does **not** own: which value is looked up for `$json`/`$node`/`$parameter` (PIPE-13), parameter
fetching (`lodash.get`), `additionalKeys` contents, post-processing, the `Workflow` graph API,
node-type descriptions, the editor's own preview evaluator (frontend `IS_FRONTEND` branch).

**Hard requirement for the port:** the syntax slice and the lookup slice are separable. The
evaluator only needs `data` to be an object with `has`/`get`. Any Rust implementation can therefore
land PIPE-12 first (pure, deterministic, text-in/value-out) and PIPE-13 second, provided
`contracts/expression-syntax.contract.md` golden vectors are byte-identical.

---

## 10. Findings, deviations and risks (recorded, not fixed)

| ID | Finding | Evidence | Disposition |
|---|---|---|---|
| D1 | `renderExpression`'s `return null` is effectively unreachable for real expressions because the polyfilled AST always contains a member node ⇒ the chunk is wrapped and errors degrade to `undefined`/`''`. Agent 3's doc says "other errors ⇒ null/undefined". | `12D` + §4 | **Refine** the wording in `docs/isolation/expression.md`; keep behaviour as observed |
| D2 | `data.process.version` is assigned `process.pid` (`expression.ts` L424-433) → `={{ process.version }}` returns the PID number (`2275` in the recorded run). | `12D.process_version` | Preserve in compat tests; file as **upstream defect** note; Rust port must decide: fidelity (default) vs fix (needs a recorded deviation + Agent 5 approval) |
| D3 | Two splitters, two escape semantics (§3). | `12A` | Preserve **both** (they serve different stages) OR unify behind a recorded deviation |
| C2 | The quoted-literal strip in `extendSyntax` (`/("|').*?("|')/`) only removes the **first** quoted span and can hide a real extension call after it, e.g. `'{{ "a" + $json.x.isEmpty() }}'` is classified no-extension. | source L583-585 + `12C.quote_strip_quirk` (inverse case) | Reproduce verbatim; add a golden vector for the hidden-extension case |
| C3 | `hasClosingBrackets:false` unclosed `{{` evaluates. | `12B.unclosed_code` | Reproduce; editor UI must not assume well-formedness |
| C4 | `EXTENDED_SYNTAX_CACHE` and tournament's `_codeCache` are unbounded, module-global (per process). Memory growth is proportional to distinct template strings. | source; `PERFORMANCE-FINDINGS.md` has no entry | Recorded for the Rust design (bounded LRU candidate — behaviour-neutral) |
| C5 | `?.`+extension lowers to mutable `global.chain*` tokens. | `12C.optional_chain_ext` | Port must define equivalent; **must not** write to a real global |
| C6 | `IS_FRONTEND` is sniffed as `Object.keys(process).length === 0` — in a sandboxed/empty-env backend the branch can misfire (frontend-only `TypeError` beautification). | expression.ts L29-37 | Note; no behavioural change in 2.9.4 backend |
| C7 | `initializeGlobalContext` mutates the **shared** data proxy object, so any consumer that keeps the proxy (`getWorkflowDataProxy()`) and evaluates with it gets a *different* global set than a parameter expression — the raw proxy has no `process`/`JSON`/`Object` at all. | `13D_extra.global_seed_asymmetry` (all `undefined`) | Split of responsibilities documented in PIPE-13 §11; contract states seeding belongs to `Expression` |

---

## 11. Verification

| Check | Command | Result |
|---|---|---|
| Probe suite executed against the pinned runtime | `node docs/isolation/agent-6-probes/expression-probes.cjs <out>` | **461 entries recorded** (PIPE-12 266: 12A 66 · 12B 40 · 12B2 15 · 12C 50 · 12C2 17 · 12D 78; PIPE-13 172: 13A 90 · 13B 36 · 13C 12 · 13D 34; fixture 23), incl. **55 recorded throws**; every entry is a returned value or a typed error — nothing left UNKNOWN |
| Replay determinism | `node docs/isolation/agent-6-probes/determinism-check.cjs <committed.json> <rerun.json>` | `MATCH (only environment-dependent fields differ)` — verified 2026-09-17 |
| PIPE-12 sections | `12A` 66 · `12B` 40 · `12B2` 15 · `12C` 40 · `12D` 39 (+2) | all produced |
| Source anchors | every `file:line` in §1/§2/§5 re-read from `reference/n8n` (read-only, unmodified — `git status` clean for `reference/`) | ✔ |
| Rust not touched | `git diff --name-only` (this branch) contains no `crates/`, no `apps/` | ✔ |
| Existing LEGO gates unaffected | no file under `packages/workflow-lego/`, `tools/`, `tests/` modified | ✔ |
| Live VPS | not reachable from this sandbox; the 11/11 baseline is unchanged because no source under `reference/` or `packages/` was edited | pending Agent 5 |

Evidence files: [`agent-6-probes/observations.json`](agent-6-probes/observations.json)
(sha256 `6a5878218b9620e42fc450b82405ec61628fc338ca1c90464e2366889467f452`),
[`agent-6-probes/expression-probes.cjs`](agent-6-probes/expression-probes.cjs).
Re-run instructions: [`agent-6-probes/README.md`](agent-6-probes/README.md).

---

## 12. Coordination asks (for `CROSS-AGENT-ISSUES.md`, filed by the reviewing agent)

1. **Agent 3** — `docs/isolation/expression.md` §5: replace "other errors → null/undefined" with the
   D1 rule and add the G-series grammar table; add `12A`'s two-splitter divergence (D3) to §3.
2. **Agent 1** — `Workflow`'s constructor rewrites `node.parameters` (see PIPE-13 §6.3); the
   Workflow contract should state that side effect because it changes what `$parameter` can see.
3. **Agent 2** — `$parameter` visibility depends on `nodeType.description.properties`; please confirm
   in `contracts/node.contract.md` that node-type lookup is a *hard* dependency of the lookup slice.
4. **Agent 5** — the probe runner is deterministic except `$now`/`$today`/`pid`; if a gate is wanted,
   add `docs/isolation/agent-6-probes` to the verify list with the clock frozen (`faketime` or
   injected `now`), and confirm D2 is recorded as a compatibility item rather than a defect of our port.
