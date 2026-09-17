import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

export const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = join(PKG, '..', '..');
export const REF_SRC = join(REPO, 'reference', 'n8n', 'packages', 'workflow', 'src');
export const FIXTURES = join(REPO, 'tests', 'reference', 'connection');
export const HARNESS_NM = join(REPO, 'tests', 'reference', 'harness', 'node_modules');

/** Resolve the pinned reference runtime the same way the JS harness does (harness node_modules) unless overridden. */
export function referencePkg() {
	if (process.env.LEGO_REFERENCE_PKG) return process.env.LEGO_REFERENCE_PKG;
	const local = join(HARNESS_NM, 'n8n-workflow');
	return existsSync(join(local, 'package.json')) ? local : 'n8n-workflow';
}
process.env.LEGO_REFERENCE_PKG ??= referencePkg();

/** JSON-plain view, same normalisation as tests/reference/harness/connection.js. */
export const plain = (v) =>
	JSON.parse(JSON.stringify(v, (_, x) => (x instanceof Set ? [...x] : x instanceof Map ? Object.fromEntries(x) : x)));
