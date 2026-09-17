/**
 * Consumed-surface adapter for the Persistence LEGO reconstruction.
 *
 * Everything this package does NOT own is consumed read-only from the pinned
 * reference runtime (the exact dependency set of n8n@2.9.4, installed by
 * scripts/setup-reference-runtime.sh into .runtime/ and linked here by
 * tools/ensure-runtime-link.mjs). Single seam — ported units never import
 * reference packages directly.
 *
 * Consumed (read-only):
 *   - n8n-workflow@2.9.1 :: jsonParse                (Workflow/Expresssion/kernel owned)
 *   - n8n-workflow@2.9.1 :: migrateRunExecutionData  (Execution Data LEGO, agent-3
 *                                                      contracts/execution-data.contract.md;
 *                                                      deep CJS dist import, same build the
 *                                                      reference runtime executes)
 *   - flatted@3.2.7       :: parse, stringify        (execution_data wire format; the REAL
 *                                                      pinned package — byte compatibility
 *                                                      is contractual, this is not a port)
 *   - nanoid@3.3.8        :: customAlphabet          (id generation; REAL pinned package)
 *
 * n8n-workflow@2.9.1 ships a broken dist/esm (extensionless internal imports),
 * so the package is loaded through the CJS `require` condition — identical
 * resolution to the expression-lego consumed seam.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const need = (value, name, from) => {
	if (value === undefined) {
		throw new Error(
			`[persistence-lego/consumed] '${name}' is not exported by '${from}'. ` +
				'Is .runtime the pinned dependency set of n8n@2.9.4? Run scripts/setup-reference-runtime.sh',
		);
	}
	return value;
};

const load = (path) => {
	try {
		return require(path);
	} catch (e) {
		throw new Error(
			`[persistence-lego/consumed] cannot require('${path}'): ${e.message}. ` +
				'Run scripts/setup-reference-runtime.sh, then tools/ensure-runtime-link.mjs',
		);
	}
};

const WF = load('n8n-workflow');
const RunExecutionDataCjs = load('n8n-workflow/dist/cjs/run-execution-data/run-execution-data.js');
const FLATTED = load('flatted');
const NANOID = load('nanoid');

/** n8n-workflow/utils.js :: jsonParse<T>(json, { fallbackValue }?) — consumed verbatim. */
export const jsonParse = need(WF.jsonParse, 'jsonParse', 'n8n-workflow');

/**
 * n8n-workflow run-execution-data.ts :: migrateRunExecutionData — consumed verbatim.
 * Owned by the Execution Data LEGO (agent-3); consumed from the pinned dist until
 * packages/execution-data-lego is merged main-side, per contract-first rule.
 */
export const migrateRunExecutionData = need(
	RunExecutionDataCjs.migrateRunExecutionData ?? WF.migrateRunExecutionData,
	'migrateRunExecutionData',
	'n8n-workflow',
);

/** flatted@3.2.7 parse/stringify — the byte-exact execution_data wire format. */
export const flattedParse = need(FLATTED.parse, 'parse', 'flatted');
export const flattedStringify = need(FLATTED.stringify, 'stringify', 'flatted');

/** nanoid@3.3.8 customAlphabet — canonical RNG wiring for generateNanoId. */
export const customAlphabet = need(NANOID.customAlphabet, 'customAlphabet', 'nanoid');

/** Versions pinned by n8n@2.9.4 (reported by tests for evidence). */
export const CONSUMED_VERSIONS = {
	'n8n-workflow': load('n8n-workflow/package.json').version,
	flatted: load('flatted/package.json').version,
	nanoid: load('nanoid/package.json').version,
};
