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

## Convergence addendum (second worker, `927608bc`)

This task was executed concurrently and independently a second time (claimed from `PLANNED`
while this implementation was still unpushed): same option_c design, same 13/13 + identity +
loud-failure test shape, lane **65/65** + `tsc` 0 + isolation 11/11 + `verify:all` exit 0 on
its own tree. Per first-landed rule the implementation above stands and the duplicate was
yielded in full — code, tests, YAML and MAP row are the first worker's, independently
re-verified here (**66/66**, `tsc` 0). Two deliberate deviations in the duplicate are recorded
so nobody re-derives them: (1) it required the **barrel** `expression-lego/index.mjs`
(contract §1 surface) rather than deep `src/expression.mjs` — dropped as behaviorally
identical (`expression.mjs` already pulls the barrel's whole graph) and the filing specifies
the deep entry; (2) it typed the instance with a nominal brand rather than the structural
`ExpressionInstance` — dropped as less informative than what landed. Net-new kept from the
duplicate: the lane-README `Expression` ports-table correction ("not instantiated" →
resolved) + `Prerequisites` section, and the root README bullet — docs only, zero code churn.
