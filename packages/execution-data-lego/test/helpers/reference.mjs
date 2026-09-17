/**
 * Resolves the pinned reference runtime so the A/B parity suite can diff this
 * LEGO against the real n8n packages.
 *
 * Discovery order mirrors scripts/run-lego-tests.sh:
 *   $LEGO_REFERENCE_RUNTIME  ->  <repo>/.runtime/node_modules
 *
 * Returns `null` when the runtime is not installed; the parity suite then
 * reports SKIP instead of a false green.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../../..');

export function findRuntime() {
	const candidates = [process.env.LEGO_REFERENCE_RUNTIME, path.join(REPO_ROOT, '.runtime/node_modules')];
	for (const dir of candidates) {
		if (!dir) continue;
		if (existsSync(path.join(dir, 'n8n-workflow/package.json')) && existsSync(path.join(dir, 'n8n-core/package.json'))) {
			return dir;
		}
	}
	return null;
}

let cached;

/**
 * @returns {null | {
 *   dir: string,
 *   workflow: any,
 *   core: any,
 *   prettyBytes: (n: number) => string,
 *   versions: Record<string,string>,
 *   coreUtil: (name: string) => any,
 *   workflowModule: (relPath: string) => any,
 * }}
 */
export function loadReference() {
	if (cached !== undefined) return cached;

	const dir = findRuntime();
	if (!dir) {
		cached = null;
		return cached;
	}

	const require = createRequire(path.join(dir, '__lego__.cjs'));
	const version = (name) => require(path.join(dir, name, 'package.json')).version;

	cached = {
		dir,
		workflow: require(path.join(dir, 'n8n-workflow')),
		core: require(path.join(dir, 'n8n-core')),
		prettyBytes: require(path.join(dir, 'pretty-bytes')),
		versions: {
			'n8n-workflow': version('n8n-workflow'),
			'n8n-core': version('n8n-core'),
			'pretty-bytes': version('pretty-bytes'),
		},
		coreUtil: (name) =>
			require(path.join(dir, 'n8n-core/dist/execution-engine/node-execution-context/utils', `${name}.js`)),
		workflowModule: (relPath) => require(path.join(dir, 'n8n-workflow/dist/cjs', `${relPath}.js`)),
	};

	return cached;
}

export const SKIP_REASON =
	'reference runtime not installed — run: bash scripts/setup-reference-runtime.sh';
