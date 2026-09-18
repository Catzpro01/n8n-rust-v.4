# @lego/expression (Agent 4)

1:1 **JavaScript/TypeScript** port of the n8n v2.9.4 Expression evaluator
(`packages/workflow/src/expression.ts` + `workflow-data-proxy.ts`), replacing
the placeholder Rust crate `crates/n8n-expression/`.

> ZERO Rust. Pure Node.js. Memenuhi kontrak `contracts/expression.contract.md`.

## What is exported

| Export | Purpose |
|---|---|
| `Expression` | Main class with `getParameterValue()` — resolves `={{ ... }}` templates, walks nested objects/arrays. |
| `isExpression(v)` | Type guard: only strings starting with `=` are evaluated (E1). |
| `WorkflowDataProxy` | Builds the `$json / $binary / $input / $(name) / $node / $items / $parameter / $now / $jmespath / $env / ...` proxy. |
| `ExpressionError` | Data/node/pairing/sandbox errors (with `context.type / descriptionKey / nodeCause`). |
| `ApplicationError` | Syntax/invalid-call errors (e.g. `"invalid syntax"`). |
| `ExpressionExtensionError` | n8n extension-method errors. |

## Behaviour verified

All 6 golden reference cases in `tests/reference/expression/*` PASS against this
port:

- `01-json-access` — `$json`, `$data`, type preservation, interpolation, out-of-range errors.
- `02-input-access` — `$input.first/last/all/item/params`, `$thisItem`, `$prevNode`, `$itemIndex/$position`.
- `03-node-data-access` — `$('X')`, `$node[X]`, `$items`, `$item`, pairing (1-hop), pin-data, branch/run errors.
- `04-multiple-items` — multi-hop pairing through a 2-output IF node, default-branch selection, `$jmespath`.
- `05-missing-property` — `undefined` semantics, syntax errors, undefined variables, `$env` denial, `.constructor` block, null-runData fallback.
- `06-expression-inside-parameter` — nested object/array recursion, resource-locator (`__rl`), `'='` edge cases, literal-brace escape, `$parameter`, `$now`, `.toUpperCase()`, `.isEmpty()` extension, `$workflow`, scalar meta variables.

## Scripts

```bash
npm run check   # node --check every file (syntax proof)
npm test        # node:test runner — 6/6 expression golden cases
```
