/**
 * Port runtime for the Connection LEGO — same protocol as packages/workflow-lego/src/ports/runtime.ts.
 *
 *   LEGO_PORT_MODE=reference (default) → pinned reference runtime (n8n-workflow@2.9.1 = n8n 2.9.4 artifact)
 *   LEGO_PORT_MODE=strict              → standalone adapter with no reference runtime on the module graph
 *
 * LEGO_REFERENCE_PKG may point at another n8n-workflow install (absolute path).
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export type PortMode = 'reference' | 'strict';
const nodeRequire = createRequire(import.meta.url);
let cached: { mode: PortMode; impl: unknown } | null = null;

export function portMode(): PortMode {
	return process.env.LEGO_PORT_MODE === 'strict' ? 'strict' : 'reference';
}

export function impl<T>(): T {
	const mode = portMode();
	if (cached?.mode !== mode) {
		const mod = (mode === 'strict' ? nodeRequire('../adapters/strict/index.ts') : nodeRequire('../adapters/reference/index.ts')) as {
			ports?: unknown;
			default?: unknown;
		};
		cached = { mode, impl: mod.ports ?? mod.default ?? mod };
	}
	return cached.impl as T;
}

export function referencePackage(): string {
	return process.env.LEGO_REFERENCE_PKG ?? 'n8n-workflow';
}

/**
 * require() rooted at the reference runtime package. Fails loud (not with an opaque createRequire TypeError)
 * when the pinned runtime is not installed — reference mode is meaningless without it.
 */
export function referenceRequire(): NodeRequire {
	const pkg = referencePackage();
	if (!isAbsolute(pkg) || !existsSync(join(pkg, 'package.json'))) {
		throw new Error(
			`connection-lego: reference runtime not installed — set LEGO_REFERENCE_PKG to the absolute path of an ` +
				`n8n-workflow@2.9.1 install (n8n 2.9.4 artifact). Got: ${JSON.stringify(pkg)}. ` +
				`Strict mode (LEGO_PORT_MODE=strict) needs no runtime.`,
		);
	}
	return createRequire(join(pkg, 'package.json'));
}
