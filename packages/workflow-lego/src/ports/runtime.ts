/**
 * Port runtime — resolves which implementation backs the ports.
 *
 *   LEGO_PORT_MODE=reference (default)
 *        Ports are bound to the pinned reference runtime (`n8n-workflow@2.9.1`,
 *        the artifact n8n 2.9.4 ships). No behavior change by construction.
 *
 *   LEGO_PORT_MODE=strict
 *        Ports are bound to standalone implementations that never touch the
 *        reference runtime. Used to prove the LEGO has no hidden coupling:
 *        the model still loads and its port-independent outputs are identical.
 *
 * The adapter module is required lazily so that `strict` mode never puts the
 * reference runtime (or third-party deps such as jssha) into the module graph.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

export type PortMode = 'reference' | 'strict';

const nodeRequire = createRequire(__filename);

let cached: { mode: PortMode; impl: unknown } | null = null;

export function portMode(): PortMode {
	return process.env.LEGO_PORT_MODE === 'strict' ? 'strict' : 'reference';
}

export function impl<T>(): T {
	const mode = portMode();
	if (cached?.mode !== mode) {
		// adapters export `ports` (named) and the same object as default
		const mod = (mode === 'strict'
			? nodeRequire('../adapters/strict')
			: nodeRequire('../adapters/reference')) as { ports?: unknown; default?: unknown };
		cached = { mode, impl: mod.ports ?? mod.default ?? mod };
	}
	return cached.impl as T;
}

/**
 * Location of the pinned reference runtime.
 * Defaults to the installed artifact; override with LEGO_REFERENCE_PKG (absolute
 * path to the n8n-workflow package directory) to run against another install.
 */
export function referencePackage(): string {
	return process.env.LEGO_REFERENCE_PKG ?? 'n8n-workflow';
}

/** require() rooted at the reference runtime package. */
export function referenceRequire(): NodeRequire {
	const pkg = referencePackage();
	return createRequire(join(pkg, 'package.json'));
}
