/**
 * Resolves the pinned reference runtime for the A/B parity suite.
 * Mirrors scripts/run-lego-tests.sh discovery:
 *   $LEGO_REFERENCE_RUNTIME -> <repo>/.runtime/node_modules
 *
 * Returns `null` when absent; the parity suite then reports SKIP, never a
 * false green.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../../..');

export function findRuntime() {
	const candidates = [
		process.env.LEGO_REFERENCE_RUNTIME,
		path.join(REPO_ROOT, '.runtime/node_modules'),
	];
	for (const dir of candidates) {
		if (!dir) continue;
		if (
			existsSync(path.join(dir, 'n8n-workflow/package.json')) &&
			existsSync(path.join(dir, 'n8n-core/package.json'))
		) {
			return dir;
		}
	}
	return null;
}

let cached;

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
		cron: require(path.join(dir, 'cron')),
		versions: {
			'n8n-workflow': version('n8n-workflow'),
			'n8n-core': version('n8n-core'),
			cron: version('cron'),
		},
		/** n8n-core internals are not exported at top level — load by subpath. */
		coreModule: (relPath) => require(path.join(dir, 'n8n-core/dist', `${relPath}.js`)),
	};

	return cached;
}

export const SKIP_REASON =
	'reference runtime not installed — run: bash scripts/setup-reference-runtime.sh';
