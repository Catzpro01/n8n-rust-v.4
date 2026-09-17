# Workflow Model LEGO — Phase 3 reconstruction

A Node.js/TypeScript reconstruction of the n8n **2.9.4** `Workflow` aggregate, written 1:1 from the
pinned reference source and accepted by reference-recorded golden cases.

This is the Workflow LEGO (LEGO 01) on the JavaScript/TypeScript reconstruction track opened by
`docs/isolation/PHASE-3-OPENING-RECORD.md`; the separate Rust port track stays confined to
`crates/**` + `apps/**`. Sibling Phase-3 packages: `packages/connection-lego/`,
`packages/execution-engine/`, `packages/expression-lego/`.

| Field | Value |
| :--- | :--- |
| Reference | n8n `2.9.4`, commit `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Contract | `contracts/workflow.contract.md` (§6 frozen 15-symbol surface) |
| Acceptance set | `tests/reference/workflow-rust/fixtures.json` — groups `checksum`, `toJSON`, `rename` |
| Result | **26/26 tests pass** — 20 fixture cases + provenance, port integrity, a whitelist check and 3 negative controls |

## What is reconstructed

| file here | reference source |
| :--- | :--- |
| `src/workflow.ts` | `workflow.ts` (aggregate: `setNodes`, `setConnections`, `setPinData`, `setSettings`, `overrideStaticData`, `getNode`, `getNodes`, `getPinDataOfNode`, `renameNodeInParameterValue`, `renameNode`, `getChildNodes`, `getParentNodes`, `getConnectedNodes`) |
| `src/workflow-checksum.ts` | `workflow-checksum.ts` (surface symbol #14) |
| `src/observable-object.ts` | `observable-object.ts` (75 lines, verbatim) |
| `src/global-state.ts` | `global-state.ts` (`defaultTimezone`) |
| `src/node-reference-utils.ts` | `node-reference-parser-utils.ts` — the rewrite half (`applyAccessPatterns` + 3 helpers) |
| `src/rename-constants.ts` | `constants.ts:35-45,74-84` + `node-parameters/rename-node-utils.ts` |
| `src/errors.ts` | `@n8n/errors` `UserError`, structural |

## Ports, not copies

| Port | Contract | Resolution |
| :--- | :--- | :--- |
| graph traversal + destination index | CD-02 (`connection.contract.md` §7) | the **real** `packages/connection-lego` build, resolved at runtime (`src/graph-port.ts`). A test asserts identity with the sibling package's exports, so a third copy of the traversal cannot sneak in. |
| `NodeHelpers.getNodeParameters` | CD-05 (`node.contract.md` §2) | injected via `WorkflowParameters.nodeParametersPort`. If a node type *resolves* and no port was injected, the constructor **throws** instead of silently skipping default-parameter application. |
| `Expression` | `expression.contract.md` §1 | the **real** `packages/expression-lego` barrel, resolved at runtime (`src/expression-port.ts`); `this.expression = new Expression(this)` is the constructor's last statement, as in the reference. A test asserts constructor identity with the sibling package's export. Requires that package's runtime deps — see Prerequisites. |

## Prerequisites

`npm test` builds with the lane's own `typescript` devDependency and resolves two sibling
packages at runtime. `packages/node-lego` is dependency-free; `packages/expression-lego`
needs its runtime dependencies installed:

```sh
npm install --prefix packages/expression-lego   # luxon + jmespath; gitignored, absent on a fresh clone
```

Without them every `new Workflow()` throws a loud error naming this command (never a silent
`expression === undefined`). The N05-style differential additionally needs
`packages/workflow-lego/node_modules` (`n8n-workflow`), same as the other lanes.

## Reference behaviour reproduced on purpose

Each of these is asserted by a fixture, not assumed:

- **`nodes` is name-keyed in memory**, insertion-ordered, while the persisted shape is an array.
- **Duplicate names silently overwrite** — `setNodes` has no collision check (`toJSON/wf-dup`).
- **A node named `__proto__` never becomes an own key** (`toJSON/wf-proto`).
- **`settings` is an open bag** — unknown keys (`executionOrder`, `saveDataErrorExecution`) survive
  verbatim; `staticData` defaults to `{}` and `pinData` stays `undefined` (`toJSON/wf-all`).
- **`timezone` = `settings.timezone ?? defaultTimezone`**, ambient default `America/New_York`.
- **`renameNode` throws `UserError`** for 13 JS-prototype names, compared case-insensitively, and
  `error.constructor.name` is observable.
- **`renameNode` has no collision guard** — renaming `D` onto `C` replaces the object under `C`
  and leaves `C`'s edges alone (`rename/collision-overwrites`).
- **Defect D-08**: `renameNode` re-keys and rewrites the *source* map but never rebuilds
  `connectionsByDestinationNode`, so `getParentNodes('Beta')` → `[]` while
  `getParentNodes('B')` → `['A']` until `setConnections` runs again.
- **Checksum**: 9-field whitelist (`id`/`active`/`versionId`/timestamps/`staticData` excluded),
  recursive key sort (top-level *and* nested order irrelevant), array order significant.
- **`hasDotNotationBannedChar` carries a `g` flag and is used with `.test()`** — stateful by
  reference design, kept as written.
- **`null` parameter values become `{}`** through `renameNodeInParameterValue`
  (`typeof null === 'object'` in the reference).

One documented dependency substitution: the reference's `jssha` fallback in
`calculateWorkflowChecksum` is replaced by `node:crypto`. The WebCrypto branch (the one that runs
on Node ≥ 18) is byte-identical; both fallbacks emit the same lowercase hex, and the Phase-3
JavaScript track carries no runtime dependencies.

## Run it

```bash
npm install --prefix packages/workflow-model-lego
npm --prefix packages/workflow-model-lego test    # builds connection-lego, then tsc, then 26 assertions
npm --prefix packages/workflow-model-lego run typecheck

scripts/setup-reference-runtime.sh
node tests/reference/workflow-rust/build-fixtures.mjs --check   # oracle still matches the pin
```

Or from the repository root: `npm run workflow-model-lego:test`.

## Why the tests can be trusted

Three **negative controls** assert that plausible-but-wrong implementations are *rejected* by the
same oracle:

1. hashing without the recursive key sort — rejected by `checksum/key-order-invariance`;
2. "fixing" D-08 by rebuilding the destination index inside `renameNode` — rejected by
   `rename/d-08-stale-destination-index`;
3. adding a collision guard to `renameNode` — rejected by `rename/collision-overwrites`.

If any control starts passing, the oracle has stopped discriminating and the suite is worthless.

## Remaining fixture groups

`fixtures.json` has 35 cases in 5 groups. This package covers `checksum` (8), `toJSON` (6) and
`rename` (6); `traversal` (9) and `compareConnections` (6) are the Connection LEGO's and are
covered by `packages/connection-lego`. That closes all 35.
