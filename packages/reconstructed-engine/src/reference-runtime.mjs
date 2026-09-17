/**
 * Reference-runtime seam.
 *
 * The reconstructed engine must be loadable on its own, but every gate that
 * proves it matches n8n needs the pinned reference package (n8n-workflow@2.9.1,
 * the artifact n8n 2.9.4 ships). This module resolves that package once, in the
 * same order as `scripts/run-lego-tests.sh`, and reports "unavailable" instead
 * of throwing — so a missing runtime degrades to "oracle NOT RUN", never to a
 * false PASS.
 *
 * `ENGINE_NO_RUNTIME=1` suppresses the seam completely — even when .runtime exists on
 * disk. Without that, "offline mode" would be a property of the shell wrapper only, and
 * a captured offline transcript could secretly be a live run (gate 08 checks this).
 *
 * Search order (first hit wins):
 *   1. $LEGO_LIVE_RUNTIME/node_modules
 *   2. <repo>/.runtime/node_modules            (scripts/setup-reference-runtime.sh)
 *   3. /home/user/.n8n-live/node_modules       (the VPS runtime)
 *   4. bare specifier (node_modules above this package)
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const suppressed = () => process.env.ENGINE_NO_RUNTIME === '1';

const CANDIDATES = [
	process.env.LEGO_LIVE_RUNTIME && join(process.env.LEGO_LIVE_RUNTIME, 'node_modules'),
	join(PKG_DIR, '.runtime', 'node_modules'),
	'/home/user/.n8n-live/node_modules',
].filter(Boolean);

const tryFrom = (dir, name) => {
	if (dir && existsSync(join(dir, name, 'package.json'))) {
		return require(join(dir, name));
	}
	return undefined;
};

let resolvedDir = null;

const load = (name) => {
	for (const dir of CANDIDATES) {
		const mod = tryFrom(dir, name);
		if (mod) {
			resolvedDir ??= dir;
			return mod;
		}
	}
	if (suppressed()) return null;
	try {
		return require(name);
	} catch {
		return null;
	}
};

let cache = null;

/** Resolved reference runtime, or null. Never throws. */
export function referenceRuntime() {
	if (cache) return cache;
	if (suppressed()) return null;
	const workflow = load('n8n-workflow');
	if (!workflow) return null;
	cache = {
		workflow,
		// Directory the packages were resolved from: needed to `require` their own
		// dependencies (@n8n/di, luxon, lodash) with the right resolution roots.
		dir: resolvedDir,
		core: load('n8n-core'),
		luxon: load('luxon'),
		lodashGet: load('lodash/get'),
		version: (() => {
			try {
				return require(join(
					CANDIDATES.find((dir) => existsSync(join(dir, 'n8n-workflow', 'package.json'))) ?? '',
					'n8n-workflow',
					'package.json',
				)).version;
			} catch {
				return 'unknown';
			}
		})(),
	};
	return cache;
}

export function requireReferenceRuntime(what = 'the reference runtime') {
	const runtime = referenceRuntime();
	if (!runtime) {
		throw new Error(
			`${what} is required for this check. Run: scripts/setup-reference-runtime.sh ` +
				'(installs n8n-workflow@2.9.1 / n8n-core@2.9.1 / n8n-nodes-base@2.9.1 into .runtime)',
		);
	}
	return runtime;
}
