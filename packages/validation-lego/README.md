# Validation LEGO — Phase 3 Reconstruction

A pure Node.js/TypeScript reconstruction of the n8n **2.9.4** parameter type validation,
runtime Zod schemas, parameter value guards, and structural graph rules.

This package is on the JavaScript/TypeScript reconstruction track opened by
`docs/isolation/PHASE-3-OPENING-RECORD.md` (the separate Rust port track stays confined to
`crates/**` + `apps/**`). Phase 2 isolated the Validation boundary and contract; this delivers
code that sits behind them — the `IMPLEMENTED → VERIFIED` steps of the LEGO cycle
(`PROJECT_RULES.md`: `DISCOVERED → ISOLATED → CONTRACTED → IMPLEMENTED (NODE.JS/TS) → VERIFIED → INTEGRATED`).
Sibling Phase-3 packages: `packages/execution-engine/`, `packages/expression-lego/`, `packages/connection-lego/`.

| Field | Value |
| :--- | :--- |
| Reference | n8n `2.9.4`, commit `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Contract | `contracts/validation.contract.md` (§10 ownership) |
| Isolation blueprint | `docs/isolation/validation.md` |
| Acceptance set | `docs/isolation/validation-golden-cases.md` (Cases A, B, C, D) + reference parity |
| Result | **20/20 test suites pass** — 50+ assertions covering Cases A/B/C/D, differential parity against reference runtime, and 2 negative controls |

## What is reconstructed

| file here | reference source | lines | role |
| :--- | :--- | ---: | :--- |
| `src/interfaces.ts` | `interfaces.ts` (type-only subset) | ~400 | Re-declared types for self-contained compilation |
| `src/errors.ts` | `@n8n/errors` (`ApplicationError`) | 33 | ApplicationError matching frozen constructor name and shape |
| `src/utils.ts` | `utils.ts` (`jsonParse`, `parseJSObject`) | 75 | JSON parsing with JavaScript object expression fallback |
| `src/type-guards.ts` | `type-guards.ts` | 110 | 14 structural parameter and connection type guards |
| `src/type-validation.ts` | `type-validation.ts` | 481 | `validateFieldType`, `tryToParse*`, `getValueDescription` |
| `src/schemas.ts` | `schemas.ts` | 499 | Zod runtime schemas mirroring interface types 1:1 |
| `src/workflow-rules.ts` | `workflow-rules.ts` (ISSUE-003 Option A) | 186 | `validateWorkflow`, `NodeUniqueness`, `DanglingConnections`, `detectCycles` |
| `src/index.ts` | `index.ts` | 20 | Public facade re-exporting the entire boundary |

## Reference quirks and frozen semantics reproduced

The contract forbids a reconstruction from altering observed reference behaviour:

- **Shape-only time validation:** `tryToParseTime` validates against `hh:mm(:ss)` format only — values like `25:99` are accepted (reproduced verbatim).
- **Frozen error messages:** Error strings for alphanumeric, options, binary, jwt, datetime, and default expectations match n8n 2.9.4 character-for-character.
- **Pass-through on unknown types:** `validateFieldType` passes through unrecognized field types with `{ valid: true, newValue: value }`.
- **URL auto-prefixing:** `tryToParseUrl` automatically prepends `https://` if `://` is missing, both in the returned parsed string and in error messages.
- **Cycle detection is opt-in:** `validateWorkflow` defaults to `allowCycles: true` for n8n reference parity (supporting runtime loops like `Loop Over Items`). Strict DAG checks require `{ allowCycles: false }`.
- **Main-only cycle check:** Cycle detection considers only `main` connections; AI connections (`ai_*`) are excluded per contract §11.8.
- **Disabled nodes validated structurally:** Disabled nodes are checked for uniqueness and structural integrity; skipping disabled nodes is an execution/runtime concern, not validation.

## Run it

```bash
npm install --prefix packages/validation-lego --prefer-offline
npm --prefix packages/validation-lego test
npm --prefix packages/validation-lego run typecheck
```

Or from the repository root: `npm run validation-lego:test`.

## Why the tests can be trusted

The suite includes **differential testing against the pinned reference runtime** (`n8n-workflow`)
as well as **two negative controls**:

1. A flawed boolean validator that accepts loose strings is rejected by the oracle.
2. A permissive cycle checker that ignores cycles when `allowCycles: false` is rejected.
