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
| `src/utils.mjs` | DELTA-01/DELTA-06-aware ports of the `utils.ts` surface: `isObject`, `isObjectEmpty`, `base64DecodeUTF8`, `replaceCircularReferences`/`jsonStringify`, `fileTypeFromMimeType`, `assert`, `isTraversableObject`/`removeCircularRefs`, `randomInt`/`randomString`, `hasKey`, `isSafeObjectProperty`/`setSafeObjectProperty`, `isDomainAllowed`, `isCommunityPackageName`, `sanitizeFilename` |
| `src/json-repair.mjs` | `jsonrepair@3.13.1` (ISC) ported verbatim — the default `repairJSONParser` of `jsonParse`, closing DELTA-05's no-op repair path |
| `src/type-validation.mjs` | `validateFieldType`, the `tryToParse*` parsers, `getValueDescription`, `jsonParse`, `isBinaryValue` (DELTA-04 injected date-time factory, DELTA-05 injected JS-object parser) |
| `src/filter-parameter.mjs` | `validateFilterParameter` + `FilterError` (validation half) and `executeFilter`/`executeFilterCondition`/`arrayContainsValue` (execution half) |
| `src/parameter-issues.mjs` | `getNodeParametersIssues`, `getParameterIssues`, `mergeIssues`, `getContext` — the parameter-issues engine |
| `src/deep-copy.mjs` | `utils.ts` `deepCopy` (verbatim: `toJSON`-first, cycle-safe, plain-object clones) |
| `src/expression-helpers.mjs` | `isExpression` (detection only — no evaluation) |
| `src/parameter-utils.mjs` | `resolveRelativePath`, `getParameterValueByPath`, `renameFormFields`, the value guards |
| `src/parameter-type-validation.mjs` | `validateNodeParameters` + `assertParamIs*` (whole reference file) |
| `src/properties.mjs` | `mergeNodeProperties`, `getVersionedNodeType`, naming (`makeNodeName`, `makeDescription`, `isDefaultNodeName`), tool detection (`isTool`, `isToolType`, `isHitlToolType`), `getToolDescriptionForNode`, `getSubworkflowId`, property guards |
| `src/errors.mjs` | validation-boundary `NodeOperationError` + `OperationalError` + the `@n8n/errors` `ApplicationError` (see ISSUE-024) |
| `src/node-reference-parser.mjs` | `node-reference-parser-utils.ts` (whole file): `hasDotNotationBannedChar`, `backslashEscape`, `dollarEscape`, `applyAccessPatterns`, `extractReferencesInNodeExpressions` + the private expression/candidate parsers |
| `src/lodash-lite.mjs` | DELTA-01: the `lodash/{get,isEqual,isObject,escapeRegExp,mapValues,cloneDeep}` subset (`cloneDeep` ≠ the reference `deepCopy`: it keeps `Date`/`RegExp`/`Map`/`Set`/cycles) |

**Not owned** (explicitly out of scope, contract §12.2 item 8): workflow validation
(`validateWorkflow` and friends, reconstructed in `packages/validation-lego`). Everything this
package's boundary names — `node-helpers.ts` L1-1949, `node-parameters/filter-parameter.ts`,
`node-reference-parser-utils.ts`, `utils.ts` `jsonParse` incl. the `jsonrepair` path and
`errors/**` — is reconstructed.

## Verify

```bash
npm test                 # 136 tests (node:test), no install step
node ../../tools/node-lego-differential.mjs   # needs: npm install in packages/workflow-lego
node ../../tools/node-lego-coverage.mjs       # gate N08: reference surface classified
node ../../tools/node-lego-gate.mjs           # gates N01…N08
```

The differential runs 27 scenario groups twice — against this package and against the
**published `n8n-workflow@2.9.1` build** (the version the pinned commit ships, a declared
devDependency of `packages/workflow-lego`) — and compares values, thrown class names/messages
and error field shapes: **1797 agree / 0 diverge** (2 NOT-DIFFABLE surfaces:
`renameFormFields`, private `getPropertyValues`). A divergence is a bug in the port.
`cloneDeep`/`mapValues`/`escapeRegExp` are not re-exported by the published build, so those are
compared against the reference build's own bundled `lodash` instead.
Date-times are compared with the reference's own luxon injected as the DELTA-04 factory, so the
format cascade is identical on both sides; the built-in dependency-free factory is what ships.

Falsifiability: injecting a behavioral mutation (e.g. dropping the `checkConditions`
empty-actual-values rule, `deepCopy`'s `toJSON` handling, `applyAccessPatterns`' `$`-escaping,
the `itemMatching` access-pattern order, `cloneDeep`'s `Date` branch, jsonrepair's
Python-constant branch or its trailing-comma repair) produces one or more `DIVERGE` lines — the
harness is not vacuous.

## Boundaries

* zero runtime dependencies; every import is relative or `node:*` (gate `N02`)
* `reference/n8n/**` is read-only and hash-pinned (gate `N04`)
* cross-LEGO reuse (errors, cron, scheduling) stays behind explicit ports — see
  `docs/isolation/CROSS-AGENT-ISSUES.md` ISSUE-024 for the `NodeOperationError` consolidation
