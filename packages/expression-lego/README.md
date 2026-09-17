# @lego/expression — Expression LEGO

Evaluates `{{ ... }}` expressions with variable proxy scoping.

**Status:** ISOLATED → VERIFIED (Phase 3)
**Owner:** Agent 3
**Reference:** n8n 2.9.4 `packages/workflow/src/expression.ts`, `workflow-data-proxy.ts`, `expression-sandboxing.ts`, `extensions/*`

## Owns

- `Expression` class, `isExpression`, evaluator proxy, sandbox hooks
- `WorkflowDataProxy` including `getPairedItem` algorithm, env provider, pin-data helper
- Extension syntax + extension libraries (`extensions/*`)
- `augmentObject`/`augmentArray` (copy-on-write for scripting nodes)
- Expression error classes and context taxonomy
- `IWorkflowDataProxyData`, `IWorkflowDataProxyAdditionalKeys`, `ProxyInput` shapes

## Does NOT own

- `getAdditionalKeys` ($execution, $vars, $secrets) — n8n-core
- Parameter lookup, extractValue, ensureType, schema validation, cleanupParameterData — n8n-core
- Workflow graph API, INode, NodeHelpers — other LEGOs
- Choosing connectionInputData — engine

## Invariants

E1 Only strings starting with `=` are evaluated
E2 Per item, fresh proxy per leaf
E3 $json/$input never touch runData; $('X')/$node never touch connectionInputData except pairing
E4 Pairing requires pairedItem, source, runData chain, X upstream
E5 Default branch for $('X') from graph, not run data
E6 Pin data honoured only in manual mode
E7 Missing property → undefined; missing node/data → throw
E8 Sandbox: constructor rejected, __proto__/prototype/with/class extension/bare $ rejected, process.env empty unless allowed
