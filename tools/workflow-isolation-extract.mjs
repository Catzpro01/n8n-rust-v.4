#!/usr/bin/env node
/**
 * Workflow LEGO — isolation extractor.
 *
 * Builds the *isolated unit*: a standalone copy of the LEGO-owned sources where
 * every dependency leaving the LEGO has been replaced by a declared port.
 *
 * Guarantees enforced here:
 *   1. Only LEGO-owned files from the pinned reference are copied.
 *   2. The ONLY edits are import specifiers that map to a declared port
 *      (manifest.extraction.portSpecifiers). Reverting those specifiers must
 *      reproduce the reference file byte-for-byte — otherwise extraction fails.
 *   3. Nothing under reference/n8n/** is written to.
 *   4. Relative specifiers in the copied LEGO sources that end in `.ts` are
 *      normalized to extensionless form (ISSUE-027): the isolated unit builds
 *      with a CommonJS/node10 tsconfig that does not set
 *      `allowImportingTsExtensions`, so extension-style imports (valid under
 *      Node type-stripping) would break G06/G08. Recorded in rewrites.json
 *      under `legoSpecifierNormalizations` for auditing.
 *
 * Output layout (default packages/workflow-lego/.extract):
 *   src/<owned file>.ts          copy of the owned sources (paths preserved)
 *   src/lego/**                  copy of packages/workflow-lego/src (ports, adapters, kernel)
 *   src/model-api.ts             generated barrel: the isolated unit's public surface
 *   rewrites.json                every edit made, for auditing
 *   tsconfig.json                build config (CommonJS, strict)
 *
 * Usage: node tools/workflow-isolation-extract.mjs [--out <dir>]
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { REPO, MANIFEST, analyse, resolveSpecifier } from './workflow-boundary-map.mjs';

const PKG_DIR = join(REPO, 'packages/workflow-lego');
const REF_SRC = join(REPO, 'reference/n8n/packages/workflow/src');

const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = resolve(outArg === -1 ? join(PKG_DIR, '.extract') : args[outArg + 1]);

const SPEC_MAP = MANIFEST.extraction.portSpecifiers;
const report = analyse();
const crossingIndex = new Set(report.crossings.map((c) => `${c.from}|${c.to}`));

/* specifier -> port module id, honouring file-scoped entries and declared crossings */
function mapSpecifier(file, spec) {
	if (!spec.startsWith('.')) {
		// external package: only mapped when the edge is a declared crossing
		const declared = report.externalCrossings.find((c) => c.from === file && c.to === spec);
		if (!declared) return null;
		if (!SPEC_MAP[spec]) {
			throw new Error(`external crossing ${file} -> ${spec} has no port mapping in manifest.extraction.portSpecifiers`);
		}
		return { port: SPEC_MAP[spec], via: 'port', deviation: null };
	}
	const moduleId = resolveSpecifier(file, spec);
	if (!moduleId) return null;
	const scoped = SPEC_MAP[`${file}|${moduleId}`];
	if (scoped) {
		const dev = (MANIFEST.deviations ?? []).find((d) => d.file === file && d.edge === `${file} -> ${moduleId}`);
		if (!dev) throw new Error(`file-scoped specifier mapping for ${file}|${moduleId} has no declared deviation`);
		return { port: scoped, via: 'deviation', deviation: dev.id };
	}
	if (!crossingIndex.has(`${file}|${moduleId}`)) return null; // inside the LEGO (owned -> owned)
	if (!SPEC_MAP[moduleId]) {
		throw new Error(`crossing ${file} -> ${moduleId} (spec '${spec}') is not mapped to a port in manifest.extraction.portSpecifiers`);
	}
	return { port: SPEC_MAP[moduleId], via: 'port', deviation: null };
}

/* ------------------------------------------------------------------ */
/* 1. reset output                                                     */
/* ------------------------------------------------------------------ */
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'src'), { recursive: true });
cpSync(join(PKG_DIR, 'src'), join(OUT, 'src/lego'), { recursive: true });

/* ISSUE-027: normalize `.ts`-extension relative specifiers in the LEGO copy.
 * Extension-style imports are valid for Node type-stripping but break the
 * isolated-unit build (.extract/tsconfig.json has no allowImportingTsExtensions,
 * TS5097 → G06/G08 red). Stripping is compile- and runtime-safe for CJS output
 * (node10 resolves './x' → './x.ts', emitted require('./x') → './x.js'). */
const LEGO_EXT_SPECS = [
	/(\bfrom\s+['"]\.[^'"]*?)\.ts(['"])/g,           // import/export ... from './x.ts'
	/(\bimport\s*\(\s*['"]\.[^'"]*?)\.ts(['"])/g,    // dynamic import('./x.ts')
	/(\brequire\s*\(\s*['"]\.[^'"]*?)\.ts(['"])/g,   // require('./x.ts')
	/(\bimport\s+['"]\.[^'"]*?)\.ts(['"])/g,         // bare import './x.ts'
];
const legoSpecifierNormalizations = [];
{
	const legoRoot = join(OUT, 'src', 'lego');
	const stack = [legoRoot];
	while (stack.length > 0) {
		const dir = stack.pop();
		for (const entry of readdirSync(dir)) {
			const abs = join(dir, entry);
			if (statSync(abs).isDirectory()) {
				stack.push(abs);
			} else if (entry.endsWith('.ts')) {
				const before = readFileSync(abs, 'utf8');
				let after = before;
				let count = 0;
				for (const re of LEGO_EXT_SPECS) {
					const hits = after.match(re);
					if (hits) count += hits.length;
					after = after.replace(re, '$1$2');
				}
				if (after !== before) {
					writeFileSync(abs, after);
					legoSpecifierNormalizations.push({ file: relative(OUT, abs).split(sep).join('/'), specifiers: count });
				}
			}
		}
	}
}

const IMPORTS_RE = /((?:^|\n)[ \t]*(?:import|export)[\s\S]*?from\s+['"])([^'"]+)(['"]\s*;)|((?:^|\n)[ \t]*import\s+['"])([^'"]+)(['"]\s*;)/g;

const rewrites = [];
const written = [];

/* ------------------------------------------------------------------ */
/* 2. copy + rewrite owned sources                                     */
/* ------------------------------------------------------------------ */
for (const file of MANIFEST.owns.files) {
	const source = readFileSync(join(REF_SRC, `${file}.ts`), 'utf8');
	const outFile = join(OUT, 'src', `${file}.ts`);
	mkdirSync(dirname(outFile), { recursive: true });

	const edits = [];
	// single scan builds both the transformed output and the reverted source
	const matches = [];
	IMPORTS_RE.lastIndex = 0;
	let m;
	while ((m = IMPORTS_RE.exec(source)) !== null) {
		const spec = m[2] ?? m[5];
		if (spec === undefined) continue;
		const mapped = mapSpecifier(file, spec);
		if (!mapped) continue;
		const portFile = join(OUT, 'src', 'lego', 'ports', `${mapped.port.replace('@lego/ports/', '')}.ts`);
		let rel = relative(dirname(outFile), portFile).split(sep).join('/').replace(/\.ts$/, '');
		if (!rel.startsWith('.')) rel = `./${rel}`;
		matches.push({ index: m.index, match: m[0], spec, rel, mapped });
	}

	let transformed = '';
	let reverted = '';
	let cursor = 0;
	for (const { index, match, spec, rel, mapped } of matches) {
		transformed += source.slice(cursor, index) + match.split(`'${spec}'`).join(`'${rel}'`);
		reverted += source.slice(cursor, index) + match;
		cursor = index + match.length;
		edits.push({ from: spec, to: rel, port: mapped.port, via: mapped.via, deviation: mapped.deviation ?? null });
	}
	transformed += source.slice(cursor);
	reverted += source.slice(cursor);

	// integrity: reverting the rewrites must reproduce the reference bytes exactly
	if (reverted !== source) {
		throw new Error(`extraction of ${file} is not a pure import rewrite — refusing to continue`);
	}

	writeFileSync(outFile, transformed);
	written.push(file);
	rewrites.push({ file, edits });
}

/* ------------------------------------------------------------------ */
/* 3. generated public surface of the isolated unit                    */
/* ------------------------------------------------------------------ */
const surface = MANIFEST.publicSurface;
const lines = [
	'/**',
	' * GENERATED by tools/workflow-isolation-extract.mjs — the isolated unit\u2019s public surface.',
	' *',
	' * Everything the Workflow LEGO exposes. Consumed by the equivalence tests and,',
	' * in Phase 3+, by the Rust implementation of the very same surface.',
	' */',
	"export { Workflow, type WorkflowParameters } from './workflow';",
	"export {",
	'\tgetChildNodes,',
	'\tgetParentNodes,',
	'\tgetConnectedNodes,',
	'\tgetNodeByName,',
	'\tmapConnectionsByDestination,',
	"} from './common';",
	"export {",
	'\tbuildAdjacencyList,',
	'\tparseExtractableSubgraphSelection,',
	'\tgetRootNodes,',
	'\tgetLeafNodes,',
	'\thasPath,',
	'\tgetInputEdges,',
	'\tgetOutputEdges,',
	"\ttype IConnectionAdjacencyList,",
	"\ttype ExtractableSubgraphData,",
	"\ttype ExtractableErrorResult,",
	"} from './graph/graph-utils';",
	"export { calculateWorkflowChecksum, type WorkflowSnapshot } from './workflow-checksum';",
	"export { compareConnections, type ConnectionsDiff, type INodeConnectionsDiff } from './connections-diff';",
	'',
];
writeFileSync(join(OUT, 'src', 'model-api.ts'), lines.join('\n'));

/* ------------------------------------------------------------------ */
/* 4. build config                                                     */
/* ------------------------------------------------------------------ */
const tsconfig = {
	compilerOptions: {
		target: 'ES2022',
		lib: ['ES2022'],
		module: 'commonjs',
		moduleResolution: 'node10',
		strict: true,
		esModuleInterop: true,
		allowSyntheticDefaultImports: true,
		skipLibCheck: true,
		forceConsistentCasingInFileNames: true,
		resolveJsonModule: true,
		declaration: true,
		sourceMap: false,
		outDir: 'dist',
		rootDir: 'src',
		types: ['node'],
	},
	include: ['src/**/*.ts'],
};
writeFileSync(join(OUT, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n');

writeFileSync(
	join(OUT, 'rewrites.json'),
	JSON.stringify(
		{
			generatedAt: new Date().toISOString(),
			reference: MANIFEST.reference,
			ownedFiles: written,
			publicSurface: surface,
			rewrites,
			legoSpecifierNormalizations,
		},
		null,
		2,
	) + '\n',
);

console.log(`isolated unit written to ${relative(REPO, OUT)}`);
console.log(`  owned files copied : ${written.length}`);
console.log(`  port rewrites      : ${rewrites.reduce((a, r) => a + r.edits.length, 0)} across ${rewrites.length} files`);
console.log(`  .ts-ext normalized : ${legoSpecifierNormalizations.reduce((a, n) => a + n.specifiers, 0)} specifier(s) across ${legoSpecifierNormalizations.length} LEGO file(s) (ISSUE-027)`);
const byPort = {};
for (const r of rewrites) for (const e of r.edits) byPort[e.port] = (byPort[e.port] ?? 0) + 1;
for (const [port, n] of Object.entries(byPort).sort()) console.log(`    ${port} : ${n}`);
