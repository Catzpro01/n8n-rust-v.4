#!/usr/bin/env node
/**
 * Ensure packages/persistence-lego/node_modules -> ../../.runtime/node_modules.
 *
 * Node ESM does not honour NODE_PATH, so the pinned reference runtime
 * (scripts/setup-reference-runtime.sh) is linked into the package — the exact
 * pattern proven by packages/expression-lego. The link is gitignored
 * (node_modules/) and resolved identically by src/*.mjs and test/*.mjs,
 * guaranteeing the SAME module instances (n8n-workflow, flatted, nanoid)
 * on both sides of every A/B parity comparison.
 *
 * The runtime must provide:
 *   - n8n-workflow@2.9.1  (jsonParse, migrateRunExecutionData — consumed read-only)
 *   - flatted@3.2.7       (execution_data wire format, pnpm catalog pin of @n8n/db)
 *   - nanoid@3.3.8        (generateNanoId, hoisted dep of the n8n packages)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(PKG, '..', '..');
const RUNTIME_MODULES = path.join(REPO, '.runtime', 'node_modules');
const LINK = path.join(PKG, 'node_modules');

for (const dep of ['n8n-workflow', 'flatted', 'nanoid']) {
	if (!fs.existsSync(path.join(RUNTIME_MODULES, dep))) {
		console.error(
			`reference runtime incomplete — '${dep}' missing from ${RUNTIME_MODULES}.\n` +
				'Run scripts/setup-reference-runtime.sh from the repo root first.',
		);
		process.exit(2);
	}
}

let ok = false;
try {
	ok = fs.readlinkSync(LINK) === '../../.runtime/node_modules';
} catch {
	ok = false;
}
if (!ok) {
	try {
		fs.rmSync(LINK, { recursive: true, force: true });
	} catch {}
	fs.symlinkSync('../../.runtime/node_modules', LINK, 'dir');
	console.log('runtime link OK: node_modules -> ../../.runtime/node_modules');
}
