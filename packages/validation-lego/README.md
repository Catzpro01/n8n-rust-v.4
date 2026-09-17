# @lego/validation — Validation LEGO (module 04)

Phase 2 structural isolation of **schema & type validation** from
`reference/n8n/packages/workflow` (n8n 2.9.4), laid out per the seam-based core directive
(sibling of `packages/workflow-lego`).

**1:1, not rewritten.** `type-validation.ts`, `type-guards.ts`, `schemas.ts` are consumed as the
original symbols of the pinned runtime artifact (`n8n-workflow@2.9.1`) — gate 2 asserts identity
(`lego.validateFieldType === reference.validateFieldType`). The only new code is `src/rules/`,
the opt-in enforcement capability arbitrated in ISSUE-003 Option A. **Rust: not started.**

| path | role |
| :--- | :--- |
| `manifest/ownership.json` | owns / doesNotOwn / ports / inbound edges / public surface / oracles |
| `manifest/schema-surface.json` | the 45 owned zod schemas (barrel exposes 7 more from execution files — not ours) |
| `src/ports/` | declared outer boundary: kernel types, `ApplicationError`, `jsonParse`, luxon/zod/lodash |
| `src/adapters/reference/` | binds the surface to the pinned runtime |
| `src/rules/workflow-rules.ts` | NEW capability: `validateWorkflow` → `{valid, errors[]}` (zero imports) |
| `src/validation-surface.ts` | **the seam** downstream LEGOs consume |
| `test/` | 13 gates: boundary (sha256 pin, import closure, schema surface, rules standalone), surface parity (identity), equivalence (229 + 352 + 1125 recorded fixtures + D01–D14 oracle), strict isolation (rules pass D01–D14 with the runtime blocked; reference part fails loudly without it) |

```bash
node --test packages/validation-lego/test/*.test.mjs      # needs the n8n 2.9.4 runtime (N8N_RUNTIME or LEGO_REFERENCE_PKG)
```

Consumers: `tests/reference/agent-4/validation/` (fixture generators + anti-drift tests) and any LEGO
needing `isNodeConnectionType`, `INodeSchema`, `validateFieldType`, or the rule engine. Cross-boundary
notes and the Rust port specification: `docs/isolation/validation.md`,
`docs/isolation/validation-rust-port-spec.md`.
