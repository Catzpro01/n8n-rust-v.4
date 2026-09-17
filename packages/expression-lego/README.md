# Expression LEGO — Phase 3 reconstruction (pure Node.js)

1:1 **behavioral** reconstruction of the n8n `2.9.4` expression engine:

| Reference file (`reference/n8n/packages/workflow/src/`) | Reconstruction |
| :--- | :--- |
| `expression.ts` | `src/expression.mjs` (`Expression`, `getParameterValue`, deep leaf resolution) |
| `workflow-data-proxy.ts` | `src/data-proxy.mjs` (`WorkflowDataProxy`, `$('X')`, `$input`, pairing walk) |
| `expression-evaluator-proxy.ts` | `src/expression.mjs` (`evaluateExpression`, tournament-equivalent semantics) |
| `expression-sandboxing.ts` | `src/sandbox.mjs` (source-level hooks, `sanitizer`, global allow-list) |
| `extensions/*` | `src/extensions.mjs` (`extendSyntax` rewrite + `extend` resolver) |
| `augment-object.ts` | `src/augment-object.mjs` (copy-on-write views, invariant E15) |
| `workflow-data-proxy-env-provider.ts` | `src/support.mjs` (`$env` provider) |
| `workflow.ts` + `common/*` (graph queries only) | `src/graph-adapter.mjs` (consumes the Workflow LEGO surface) |

**Contract:** [`contracts/expression.contract.md`](../../contracts/expression.contract.md)
**Boundary:** owns `Expression`, `WorkflowDataProxy`, sandbox hooks, extension syntax,
error taxonomy. Does NOT own parameter lookup (`extractValue`/`ensureType`), the
Workflow graph API, or n8n-core's `getAdditionalKeys`.

## Verify

```bash
npm install            # luxon + jmespath (the same third-party deps n8n pins)
npm test               # 46 tests:
                       #   test/golden.test.mjs   6/6 golden cases vs observed n8n 2.9.4 runtime
                       #   test/contract.test.mjs 40 contract invariant checks (E1–E15, §3)
```

The golden suite replays `tests/reference/expression/*/case.json` probes (the same
format `tests/reference/harness/run.js` drives against the real runtime) and diffs
against the machine-recorded `expected.json` — **the expected files are observed
n8n 2.9.4 behavior, never hand-written**.

## Semantics notes (reconstruction deltas)

- Evaluation uses a `with(dataProxy)` scope instead of @n8n/tournament codegen:
  identical observable behavior (unqualified identifiers resolve against the data
  context, unknown identifiers read `undefined`, backend runtime `TypeError`s are
  swallowed, compile `SyntaxError` → `ApplicationError('invalid syntax')`).
- Sandbox AST hooks are enforced as pre-evaluation source checks; the rejected
  vectors and error types match (E9: `.constructor`, `__proto__`/`prototype`,
  `with`, class extension of `Function`-kind bases, bare `$`, unsafe destructuring).
- Statement-style programs (`{{ const x = 1; … }}`) evaluate; the completion value
  of a trailing declaration is `undefined` (tournament returns the last *expression*
  statement's value).
- Extension library covers the core method set (array/string/number/object/boolean/
  date subsets); unknown methods produce the reference
  `ExpressionExtensionError` taxonomy. Native methods (`.toUpperCase()`, `$input.first()`)
  pass through untouched, exactly like the reference `findExtendedFunction` fallback.

## Provenance

Task: `POOL-002-node-execution-context-data-proxy` (takeover of the FAILED agent-8
attempt, per STANDING-WORKER-PROTOCOL §4 work-stealing). Evidence:
`results/POOL-002-node-execution-context-data-proxy.md`.
