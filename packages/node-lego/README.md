# @lego/node — Node Model LEGO (Phase 3, JavaScript)

Dependency-free ESM reconstruction of the **pure-function surface of the n8n Node Model**
(pinned reference: `n8n@2.9.4`, commit `b6dc2787`, `n8n-workflow@2.9.1`). Phase 2 isolated the
model and proved the boundary (`docs/isolation/node.md`, `contracts/node.contract.md`); this
package makes that surface runnable.

## What it owns

| Module | Content |
| :--- | :--- |
| `src/connection-io.mjs` | `NodeConnectionTypes`, `getConnectionTypes`, `getNodeInputs`, `getNodeOutputs` (incl. the `continueErrorOutput` append), `isSubNodeType`, `isTriggerNode`, `isExecutable`, `nodeAcceptsInputType`, `nodeHasOutputType` |
| `src/conditions.mjs` | `checkConditions` (every `_cnd` operator + the empty-actual-values rule), `getNodeFeatures` |
| `src/display.mjs` | `displayParameter`, `displayParameterPath`, `getPropertyValues` (`/root`, `@version`, `@tool`, `@feature`, `__rl`) |
| `src/node-validation.mjs` | `validateNodeCredentials`, `isNodeConnected`, `isTriggerLikeNode` (`node-validation.ts`, whole file) |
| `src/parameter-resolution.mjs` | `getNodeParameters` + the private dependency order (`getParameterDependencies`, `getParameterResolveOrder`) |
| `src/deep-copy.mjs` | `utils.ts` `deepCopy` (verbatim: `toJSON`-first, cycle-safe, plain-object clones) |
| `src/expression-helpers.mjs` | `isExpression` (detection only — no evaluation) |
| `src/parameter-utils.mjs` | `resolveRelativePath`, `getParameterValueByPath`, `renameFormFields`, the value guards |
| `src/parameter-type-validation.mjs` | `validateNodeParameters` + `assertParamIs*` (whole reference file) |
| `src/properties.mjs` | `mergeNodeProperties`, `getVersionedNodeType`, naming (`makeNodeName`, `makeDescription`, `isDefaultNodeName`), tool detection (`isTool`, `isToolType`, `isHitlToolType`), `getToolDescriptionForNode`, `getSubworkflowId`, property guards |
| `src/errors.mjs` | validation-boundary `NodeOperationError` + the `@n8n/errors` `ApplicationError` (see ISSUE-024) |
| `src/lodash-lite.mjs` | DELTA-01: the `lodash/{get,isEqual,cloneDeep}` subset |

**Not owned** (explicitly out of scope, contract §12.2): the parameter-issues engine
(`getNodeParametersIssues`, `getParameterIssues`, `mergeIssues`), `getContext`, webhook path
helpers and `filter-parameter.ts` (expressions track).

## Verify

```bash
npm test                 # 58 tests (node:test), no install step
node ../../tools/node-lego-differential.mjs   # needs: npm install in packages/workflow-lego
node ../../tools/node-lego-gate.mjs           # gates N01…N07
```

The differential runs 18 scenario groups twice — against this package and against the
**published `n8n-workflow@2.9.1` build** (the version the pinned commit ships, a declared
devDependency of `packages/workflow-lego`) — and compares values, thrown class names/messages
and error field shapes: **315 agree / 0 diverge** (2 NOT-DIFFABLE surfaces:
`renameFormFields`, private `getPropertyValues`). A divergence is a bug in the port.

Falsifiability: injecting a behavioral mutation (e.g. dropping the `checkConditions`
empty-actual-values rule or `deepCopy`'s `toJSON` handling) produces a `DIVERGE` — the
harness is not vacuous.

## Boundaries

* zero runtime dependencies; every import is relative or `node:*` (gate `N02`)
* `reference/n8n/**` is read-only and hash-pinned (gate `N04`)
* cross-LEGO reuse (errors, cron, scheduling) stays behind explicit ports — see
  `docs/isolation/CROSS-AGENT-ISSUES.md` ISSUE-024 for the `NodeOperationError` consolidation
