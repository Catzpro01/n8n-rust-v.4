/**
 * Node LEGO — reference-surface coverage audit (gate `N08`).
 *
 * The contract claims (§12.1/§12.2) that every symbol the Node Model boundary names is either
 * reconstructed in `packages/node-lego`, deliberately internal, or explicitly out of scope with a
 * named owner. This tool makes that claim mechanical: it extracts the exported symbols of the 17
 * pinned reference files the contract's module map is built from, and requires every one of them
 * to appear in exactly one manifest below.
 *
 * The manifest is the single place where scope decisions live; the gate fails when
 *   * a reference symbol is unclassified (a silent gap — e.g. the node-reference parser and the
 *     `jsonrepair` recovery were unclassified until their slices landed),
 *   * a `ported` symbol is missing from `src/index.mjs` or from `contracts/node.contract.md`
 *     (documentation drift), or
 *   * an entry no longer exists in the reference (stale manifest).
 *
 * `deferred` entries are legitimate scope, but they must name the task that will close them; the
 * gate reports them in its evidence line so they cannot be forgotten silently.
 *
 * Run: `node tools/node-lego-coverage.mjs` (exit 0 = classified, 1 = drift, 2 = harness problem).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const REFERENCE = join(REPO, 'reference/n8n/packages/workflow/src');

/** The pinned files contract §12.1 takes its line anchors from. */
const BOUNDARY_FILES = [
	'node-helpers.ts',
	'node-validation.ts',
	'node-parameters/path-utils.ts',
	'node-parameters/rename-node-utils.ts',
	'node-parameters/node-parameter-value-type-guard.ts',
	'node-parameters/parameter-type-validation.ts',
	'node-parameters/filter-parameter.ts',
	'type-guards.ts',
	'type-validation.ts',
	'utils.ts',
	'expressions/expression-helpers.ts',
	'node-reference-parser-utils.ts',
	'errors/node-operation.error.ts',
	'errors/abstract/node.error.ts',
	'errors/abstract/execution-base.error.ts',
	'errors/base/operational.error.ts',
	'errors/base/base.error.ts',
];

/**
 * Scope manifest. Keys are reference symbols; values are the classification only when it needs a
 * reason (`outOfScope` / `deferred`). Everything the port exports is derived, not listed, so the
 * manifest cannot drift from `src/index.mjs` silently.
 */
const OUT_OF_SCOPE = {
	// DELTA-02: the error *hierarchy* stays outside the LEGO — only the two concrete classes the
	// Node Model raises are reconstructed (`NodeOperationError`, `OperationalError`).
	BaseError: 'DELTA-02 — error hierarchy outside the LEGO',
	NodeError: 'DELTA-02 — error hierarchy outside the LEGO',
	ExecutionBaseError: 'DELTA-02 — error hierarchy outside the LEGO',
	BaseErrorOptions: 'TypeScript-only type (no runtime surface)',
	OperationalErrorOptions: 'TypeScript-only type (no runtime surface)',
	Primitives: 'TypeScript-only type (no runtime surface)',
	NodeCredentialIssue: 'TypeScript-only type (no runtime surface)',
	NodeValidationIssue: 'TypeScript-only type (no runtime surface)',
	// Implemented and pinned in a peer LEGO whose boundary owns the symbol.
	dedupe: 'owned by packages/workflow-lego (`ports/utils.ts`) and packages/workflow-model-lego',
	isAssignmentValue: 'owned by packages/validation-lego (`src/type-guards.ts`)',
	isNodeConnectionType: 'owned by packages/validation-lego (`src/type-guards.ts`)',
	isINodePropertyCollection: 'owned by packages/validation-lego (`src/type-guards.ts`)',
	isINodePropertiesList: 'owned by packages/validation-lego (`src/type-guards.ts`)',
	isINodePropertyCollectionList: 'owned by packages/validation-lego (`src/type-guards.ts`)',
};

/** Implemented inside the package but deliberately not part of the exported surface. */
const INTERNAL = {
	isValidResourceLocatorParameterValue:
		'used by `parameter-issues.mjs` (reference `type-guards.ts` L47-57); not re-exported',
};

/** Real scope that is not done yet — each entry names the task that owns it. */
const DEFERRED = {
	sleep: 'TASK-UTILS-02 — needs an injectable timer seam (rule E01)',
	sleepWithAbort:
		'TASK-UTILS-02 — needs an injectable timer + a boundary-local `ManualExecutionCancelledError`',
	updateDisplayOptions: 'TASK-UTILS-02 — needs a lodash `merge` subset (DELTA-01 follow-up)',
};

/* ------------------------------------------------------------------ extraction */

const declared = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|function|class|enum|interface|type)\s+([A-Za-z0-9_$]+)/gm;
const reExport = /^export\s*\{([^}]*)\}/gm;

const referenceSymbols = new Map(); // symbol -> file
for (const file of BOUNDARY_FILES) {
	let text;
	try {
		text = readFileSync(join(REFERENCE, file), 'utf8');
	} catch (error) {
		console.error(`[HARNESS-ERROR] cannot read reference file ${file}: ${error.message}`);
		process.exit(2);
	}
	for (const match of text.matchAll(declared)) {
		if (!referenceSymbols.has(match[1])) referenceSymbols.set(match[1], file);
	}
	for (const match of text.matchAll(reExport)) {
		for (const part of match[1].split(',')) {
			const name = part.trim().split(' as ').pop()?.trim();
			if (name && !referenceSymbols.has(name)) referenceSymbols.set(name, file);
		}
	}
}

const INDEX = join(REPO, 'packages/node-lego/src/index.mjs');
const indexText = readFileSync(INDEX, 'utf8');
const contractPath = join(REPO, 'contracts/node.contract.md');
const contractText = readFileSync(contractPath, 'utf8');

const exportedByPort = (name) => new RegExp(`(?:^|[\\s,{])(?:as\\s+)?${name}(?=[\\s,}])`, 'm').test(indexText);

/* ------------------------------------------------------------------ checks */

const problems = [];
const buckets = { ported: [], internal: [], outOfScope: [], deferred: [] };

for (const [name, file] of [...referenceSymbols].sort()) {
	const explicit =
		OUT_OF_SCOPE[name] !== undefined
			? 'outOfScope'
			: INTERNAL[name] !== undefined
				? 'internal'
				: DEFERRED[name] !== undefined
					? 'deferred'
					: null;

	if (explicit) {
		buckets[explicit].push(name);
		continue;
	}

	if (exportedByPort(name)) {
		buckets.ported.push(name);
		if (!contractText.includes(name)) {
			problems.push(`${name} (${file}) is ported but not named in contracts/node.contract.md`);
		}
		continue;
	}

	problems.push(
		`${name} (${file}) is neither ported, internal, deferred nor explicitly out of scope — classify it in tools/node-lego-coverage.mjs`,
	);
}

// stale manifest entries: classified but no longer exported by the pinned reference
for (const [group, table] of [
	['outOfScope', OUT_OF_SCOPE],
	['internal', INTERNAL],
	['deferred', DEFERRED],
]) {
	for (const name of Object.keys(table)) {
		if (!referenceSymbols.has(name)) problems.push(`stale ${group} entry: ${name} (not exported by the reference)`);
	}
}

// the non-ported buckets must be documented too: the contract's §12.2 lists the scope decisions
for (const [group, names] of [
	['internal', buckets.internal],
	['deferred', buckets.deferred],
	['out-of-scope', buckets.outOfScope],
]) {
	for (const name of names) {
		if (!contractText.includes(name)) {
			problems.push(`${name} is classified as ${group} in the coverage manifest but not named in contracts/node.contract.md`);
		}
	}
}

/* ------------------------------------------------------------------ report */

console.log(
	`reference surface: ${referenceSymbols.size} symbols across ${BOUNDARY_FILES.length} pinned files`,
);
console.log(
	`  ported ${buckets.ported.length} · internal ${buckets.internal.length} · out-of-scope ${buckets.outOfScope.length} · deferred ${buckets.deferred.length}`,
);
if (buckets.deferred.length) {
	console.log('  deferred:');
	for (const name of buckets.deferred) console.log(`    - ${name}: ${DEFERRED[name]}`);
}
if (buckets.outOfScope.length) {
	console.log('  out-of-scope owners:');
	for (const name of buckets.outOfScope) console.log(`    - ${name}: ${OUT_OF_SCOPE[name]}`);
}

if (problems.length) {
	console.error(`\nNODE LEGO COVERAGE: ${problems.length} problem(s)`);
	for (const problem of problems) console.error(`  [DRIFT] ${problem}`);
	process.exit(1);
}

console.log(
	`\nNODE LEGO COVERAGE: OK — ${referenceSymbols.size} reference symbols classified ` +
		`(${buckets.ported.length} ported, ${buckets.internal.length} internal, ` +
		`${buckets.outOfScope.length} out-of-scope, ${buckets.deferred.length} deferred)`,
);
