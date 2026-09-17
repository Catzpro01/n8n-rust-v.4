import type { NodeHelpersPort } from './interfaces';

/**
 * Resolution of the **Node Model port** — dependency CD-05 of `contracts/connection.contract.md` §6
 * / `contracts/node.contract.md` §2.
 *
 * The Workflow aggregate calls two `NodeHelpers` functions and owns neither:
 * `getNodeParameters` (constructor defaults) and `getNodeOutputs` (`getParentMainInputNode`).
 * Both are reconstructed by `packages/node-lego`, so this package resolves that implementation
 * instead of carrying a copy — the same policy as `graph-port.ts` for CD-02.
 *
 * `packages/node-lego` is dependency-free ESM with no build step; Node ≥ 22.12 can `require()` an
 * ESM module that has no top-level await, which is what makes this work from a CommonJS package.
 * A host can still inject its own implementation through `WorkflowParameters.nodeHelpersPort`.
 */

const NODE_LEGO = '../../node-lego/src/index.mjs';

let cached: NodeHelpersPort | undefined;

export function resolveNodeHelpersPort(explicit?: NodeHelpersPort): NodeHelpersPort | undefined {
	if (explicit) return explicit;
	if (cached) return cached;

	let mod: unknown;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		mod = require(NODE_LEGO);
	} catch {
		// Not fatal: the port is only needed when a node type actually resolves. Callers that
		// never resolve a node type (every reference fixture does not) work without it.
		return undefined;
	}

	const candidate = mod as Partial<NodeHelpersPort>;
	const missing = (['getNodeOutputs', 'getNodeParameters'] as const).filter(
		(k) => typeof candidate[k] !== 'function',
	);
	if (missing.length > 0) {
		throw new Error(
			`Node LEGO at ${NODE_LEGO} does not satisfy NodeHelpersPort; missing: ${missing.join(', ')}`,
		);
	}

	cached = candidate as NodeHelpersPort;
	return cached;
}

/** Test seam: drop the cached resolution. */
export function resetNodeHelpersPort(): void {
	cached = undefined;
}
