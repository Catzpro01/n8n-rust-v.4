# TASK-WORKFLOW-MODEL-04 — the last Workflow instance property: `expression`

**Status: SUCCESS** — the reconstructed aggregate now carries all **13/13** reference instance
properties. `workflow.expression` is an `Expression` **from the Expression LEGO** (identity-checked
against its export, not duck-typed), holding the aggregate itself, wired exactly where the reference
wires it. Lane suite 61 → **66/66**; `verify:all` real exit 0; live gate **10/10** (G09 digest
252×18 = 0 differences); tsc --strict build 0 errors.

## Design decision: option_c (as recommended by the filed task)

Eager, reference-faithful assignment (`workflow.ts:134` — the LAST constructor statement, after
`this.timezone`) with a **loud failure** when the port cannot resolve: the error names the exact
prerequisite (`npm install --prefix packages/expression-lego`) and never silently yields
`expression === undefined` (the ISSUE-027 failure mode). The failure mode is demonstrated by a
test (simulated bare-clone load + a module missing the constructor → both messages asserted).
Rationale: the toJSON fixtures use an explicit **projection** (`shape()` in
`conformance.test.mjs`), so the new own property does not perturb them — all 6 stayed green
without any golden change; and the prerequisite chain (typescript, connection-lego build) was
already a documented `npm install` prerequisite of this lane, so the eager requirement adds no
new failure class (ISSUE-022 precedent).

## Implementation

- `src/expression-port.ts` (new): cached resolver in the `graph-port.ts`/`node-port.ts` pattern;
  CJS `require('../../expression-lego/src/expression.mjs')` (that package has no `index.mjs`);
  structural `ExpressionPort`/`ExpressionInstance` types; `expressionPort` injection on
  `WorkflowParameters` (host/test seam); `resetExpressionPort()` test seam.
- `src/workflow.ts`: `expression: ExpressionInstance` declared in the reference position
  (between `nodeTypes` and `active`, `workflow.ts:72`); assigned last in the constructor
  (`workflow.ts:134`); header ports table + decision note updated (the old "deliberately not
  created" note is superseded by the filed task).
- `test/expression-property.test.mjs` (new, 5 tests): aggregate identity
  (`wf.expression.workflow === wf`), **instanceof** the Expression LEGO class, **13/13 property
  parity** against the verbatim reference field list (minus exactly the two documented lane-internal
  ports `graph`/`nodeHelpers`), loud-failure-mode demonstration (both error branches), README
  prerequisite documented.
- `README.md` (lane prerequisites), `docs/isolation/LEGO-MASTER-MAP.md` (task row).

## Reference anchors (from the filed task's verified_facts, re-checked)

`workflow.ts:72` declaration · `workflow.ts:20` import · `workflow.ts:134` last constructor
assignment · `expression.ts:181` `constructor(private readonly workflow: Workflow)` ·
Expression LEGO export at `src/expression.mjs:186`.

## Matrix

workflow-model-lego **66/66** · `verify:all` **real exit 0** (15 lanes) · live gate **10/10**
(G09: 252 comparisons × 18 workflows, 0 differences) · conformance 42/42 · boundary PASS ·
activation differential 65/0 · error-surface differential 4/14Δ/0.
