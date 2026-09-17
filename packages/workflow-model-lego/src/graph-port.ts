import type { GraphPort } from './interfaces';

/**
 * Resolution of the **graph port** — dependency CD-02 of
 * `contracts/connection.contract.md` §6.
 *
 * `common/get-connected-nodes.ts`, `get-child-nodes.ts`, `get-parent-nodes.ts` and
 * `map-connections-by-destination.ts` are owned by the **Connection LEGO**
 * (`contracts/connection.contract.md` §7), and `Workflow` only consumes them. Rather than
 * carrying a third copy of that traversal code, this package resolves the real implementation
 * from `packages/connection-lego` at runtime.
 *
 * Resolved lazily and through `require` (not a static import) for two reasons:
 *
 * 1. `tsc` must not reach outside this package's `rootDir`, so the port is typed structurally
 *    (`GraphPort`) instead of imported as a type;
 * 2. the sibling package has to be built first (`npm --prefix packages/connection-lego run build`),
 *    and failing loudly with an actionable message is better than a module-resolution crash.
 *
 * A host can inject its own implementation via `WorkflowParameters.graphPort` — which is also how
 * the conformance suite proves the port is wired to the real Connection LEGO rather than a stub.
 */

const CONNECTION_LEGO = '../../connection-lego/dist/index.js';

let cached: GraphPort | undefined;

export function resolveGraphPort(explicit?: GraphPort): GraphPort {
	if (explicit) return explicit;
	if (cached) return cached;

	let mod: unknown;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		mod = require(CONNECTION_LEGO);
	} catch (error) {
		throw new Error(
			`Connection LEGO (graph port CD-02) is not available at ${CONNECTION_LEGO}: ` +
				`${(error as Error).message}. ` +
				'Run: npm --prefix packages/connection-lego run build',
		);
	}

	const candidate = mod as Partial<GraphPort>;
	const required: Array<keyof GraphPort> = [
		'getConnectedNodes',
		'getChildNodes',
		'getParentNodes',
		'mapConnectionsByDestination',
	];
	const missing = required.filter((symbol) => typeof candidate[symbol] !== 'function');
	if (missing.length > 0) {
		throw new Error(
			`Connection LEGO at ${CONNECTION_LEGO} does not satisfy GraphPort; missing: ${missing.join(', ')}`,
		);
	}

	cached = candidate as GraphPort;
	return cached;
}

/** Test seam: drop the cached resolution. */
export function resetGraphPort(): void {
	cached = undefined;
}
