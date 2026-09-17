import type { Workflow } from './workflow';

/**
 * Resolution of the **Expression port** — the last Workflow instance property
 * (`workflow.expression`), TASK-WORKFLOW-MODEL-04.
 *
 * The reference declares `expression: Expression;` (`workflow.ts:72`), imports the class
 * (`workflow.ts:20`) and assigns it as the **last** constructor statement, immediately after
 * `this.timezone = …` (`workflow.ts:134`). `Expression` takes the aggregate itself
 * (`reference/n8n/packages/workflow/src/expression.ts:181` — `constructor(private readonly
 * workflow: Workflow) {}`). The class is reconstructed by `packages/expression-lego`
 * (`src/expression.mjs:186`), so — same policy as `graph-port.ts` (CD-02) and `node-port.ts`
 * (CD-05) — this package resolves that implementation instead of carrying a copy.
 *
 * Unlike `packages/node-lego`, the Expression LEGO has **runtime dependencies**
 * (`luxon`, `jmespath`) and no `index.mjs`; `src/expression.mjs` is the entry. Resolution is
 * therefore **eager in the Workflow constructor** (reference-faithful, option_c of the filed
 * task): when the package or its dependencies are missing the constructor throws a loud error
 * naming the prerequisite — it never silently produces `expression === undefined` (the failure
 * mode ISSUE-027 was about). Prerequisite: `npm install --prefix packages/expression-lego`.
 *
 * `packages/expression-lego` is ESM with no top-level await; Node ≥ 22.12 can `require()` it
 * from this CommonJS-built package. A host can inject its own port through
 * `WorkflowParameters.expressionPort`.
 */

/** Structural shape of the resolved `Expression` constructor (verified: ctor.length === 1). */
export interface ExpressionInstance {
	/** The aggregate itself — the reference stores it as its only own property. */
	readonly workflow: unknown;
	[key: string]: unknown;
}

export interface ExpressionPort {
	Expression: new (workflow: unknown) => ExpressionInstance;
}

const EXPRESSION_LEGO = '../../expression-lego/src/expression.mjs';

let cached: ExpressionPort | undefined;

export function resolveExpressionPort(
	explicit?: ExpressionPort,
	load: () => unknown = () => require(EXPRESSION_LEGO),
): ExpressionPort {
	if (explicit) return explicit;
	if (cached) return cached;

	let mod: unknown;
	try {
		mod = load();
	} catch (error) {
		throw new Error(
			`Expression LEGO (expression port) is not available at ${EXPRESSION_LEGO}: ` +
				`${(error as Error).message}. ` +
				'The reference assigns `workflow.expression` in the Workflow constructor ' +
				'(workflow.ts:134); run: npm install --prefix packages/expression-lego',
		);
	}

	const candidate = mod as Partial<ExpressionPort>;
	if (typeof candidate.Expression !== 'function') {
		throw new Error(
			`Expression LEGO (expression port) at ${EXPRESSION_LEGO} did not export an ` +
				'`Expression` constructor — the port cannot be wired silently. ' +
				'Run: npm install --prefix packages/expression-lego',
		);
	}

	cached = candidate as ExpressionPort;
	return cached;
}

/** Test seam: forget the cached resolution (see `graph-port.ts` `resetGraphPort`). */
export function resetExpressionPort(): void {
	cached = undefined;
}

/** For the port's own documentation of the aggregate it points back at. */
export type ExpressionWorkflow = Workflow;
