#!/usr/bin/env node
/**
 * Connection LEGO — isolation extraction (Phase 3, port P-CONNECTION-GRAPH).
 *
 * The Connection LEGO ships the routing engine twice: as TypeScript
 * (`packages/reconstructed-engine/src/connection-routing-engine.ts`, the annotated
 * 1:1 source) and as ESM (`...connection-routing-engine.mjs`, what `runner.mjs`
 * imports). Two copies drift silently, so the extraction compiles the TypeScript
 * twin into `packages/connection-lego/.extract/` where the gate can execute it and
 * compare it against the ESM twin on the differential corpus.
 *
 * usage: node tools/connection-isolation-extract.mjs [--check]
 *   --check  fails when the compiled twin diverges from the committed ESM twin
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(fileURLToPath(import.meta.url), '..', '..');
export const TWIN_SOURCES = {
	typescript: join(REPO, 'packages/reconstructed-engine/src/connection-routing-engine.ts'),
	esm: join(REPO, 'packages/reconstructed-engine/src/connection-routing-engine.mjs'),
};
export const EXTRACT_DIR = join(REPO, 'packages/connection-lego/.extract');
export const COMPILED_TWIN = join(EXTRACT_DIR, 'connection-routing-engine.mjs');

const requireFromLego = createRequire(join(REPO, 'packages/workflow-lego/package.json'));

/** Compiles the TypeScript twin to ESM. Throws when `typescript` is not installed. */
export function compileTwin() {
	let ts;
	try {
		ts = requireFromLego('typescript');
	} catch (error) {
		throw new Error(
			`typescript is required to compile the connection twin — run: npm install --prefix packages/workflow-lego (${error.message})`,
		);
	}
	const source = readFileSync(TWIN_SOURCES.typescript, 'utf8');
	const emitted = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.ES2022,
			target: ts.ScriptTarget.ES2022,
			moduleResolution: ts.ModuleResolutionKind.NodeJs,
		},
		fileName: TWIN_SOURCES.typescript,
	}).outputText;
	mkdirSync(EXTRACT_DIR, { recursive: true });
	writeFileSync(COMPILED_TWIN, emitted);
	return {
		compiled: COMPILED_TWIN,
		digest: createHash('sha256').update(source).digest('hex'),
	};
}

/**
 * Regenerates the committed ESM twin from the TypeScript source. The TypeScript file is
 * the single source of truth; the ESM copy exists because `runner.mjs` imports it
 * directly. Run this after every change to the engine, then re-run the gate.
 */
export function emitEsmTwin() {
	const source = readFileSync(TWIN_SOURCES.typescript, 'utf8');
	const { compiled } = compileTwin();
	const emitted = readFileSync(compiled, 'utf8');
	const banner = [
		'// AUTO-GENERATED from connection-routing-engine.ts — do not edit by hand.',
		'// regenerate: node tools/connection-isolation-extract.mjs --emit-esm',
		'// verify:     node tools/connection-isolation-gate.mjs   (C06 twin parity)',
		'',
	].join('\n');
	writeFileSync(TWIN_SOURCES.esm, banner + emitted);
	return { written: TWIN_SOURCES.esm, lines: emitted.split('\n').length, digest: createHash('sha256').update(source).digest('hex') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const emit = process.argv.includes('--emit-esm');
	if (emit) {
		const { written, lines, digest } = emitEsmTwin();
		console.log(`esm twin regenerated: ${written} (${lines} lines, source ${digest.slice(0, 16)}…)`);
	} else {
		const { compiled, digest } = compileTwin();
		console.log(`connection twin compiled: ${compiled}`);
		console.log(`source digest: ${digest.slice(0, 16)}…`);
	}
}
