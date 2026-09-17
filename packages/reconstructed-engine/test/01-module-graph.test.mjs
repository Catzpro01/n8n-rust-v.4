/**
 * Gate 01 — module graph and isolation.
 *
 * The reconstruction must be loadable on its own: no reference source in the
 * import graph, no bare npm specifiers, and exactly ONE file allowed to reach for
 * an installed n8n package (`reference-runtime.mjs`, which degrades to `null`).
 * That is what makes the package usable as the Rust port's specification without
 * an oracle present, and it is the rule the sibling LEGO enforces with a build
 * step — here the check is a source scan, because this package is plain ESM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PKG = resolve(import.meta.dirname, '..');
const SRC = join(PKG, 'src');
const files = readdirSync(SRC).filter((f) => f.endsWith('.mjs')).sort();

const IMPORT_RE =
	/(?:^|\n)\s*(?:import|export)[^;\n]*?from\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Comments carry reference citations, so they must not count as code. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const specifiersOf = (file) => {
	const src = stripComments(readFileSync(join(SRC, file), 'utf8'));
	const out = [];
	for (const match of src.matchAll(IMPORT_RE)) out.push(match[1] ?? match[2]);
	return out;
};

test('src/: every import is relative (no bare specifier, no path escape)', () => {
	const offenders = [];
	for (const file of files) {
		for (const spec of specifiersOf(file)) {
			// node: builtins are not a dependency in the sense that matters (the
			// package still loads without npm install); anything else bare is.
			if (spec.startsWith('node:')) continue;
			const relative = spec.startsWith('./') || spec.startsWith('../');
			const staysInside = resolve(SRC, spec).startsWith(`${SRC}${process.platform === 'win32' ? '\\' : '/'}`);
			if (!relative || !staysInside) offenders.push(`${file} -> ${spec}`);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		'src/ may only import sibling files inside src/ (plus node: builtins). A bare specifier here is a real runtime dependency on the oracle.',
	);
});

test('src/: only reference-runtime.mjs may touch node_modules', () => {
	const seam = 'reference-runtime.mjs';
	const touching = files.filter(
		(f) =>
			f !== seam &&
			/\brequire\s*\(|createRequire|from ['"]n8n-|import\(\s*['"]n8n-|require\(\s*['"]n8n-/u.test(
				stripComments(readFileSync(join(SRC, f), 'utf8')),
			),
	);
	// `createRequire` is the tool that makes a bare require possible. The seam is the
	// only place that is allowed; a second user means the oracle is leaking into the graph.
	assert.deepEqual(
		touching,
		[],
		`these files reach for the reference runtime; move it behind src/reference-runtime.mjs: ${touching.join(', ')}`,
	);
});

test('src/: no file reads the reference source tree', () => {
	for (const file of files) {
		const src = readFileSync(join(SRC, file), 'utf8');
		assert.ok(
			!/from\s+['"][^'"]*reference\/n8n/.test(src) && !/require\([^)]*reference\/n8n/.test(src),
			`${file} imports from reference/n8n — provenance belongs in comments, dependencies in src/`,
		);
	}
});

test('src/: the whole graph loads with no oracle on the path', () => {
	// A child process with the runtime env vars stripped proves there is no hidden
	// dependency: importing src/ must never need n8n-workflow to be resolvable.
	const script = files
		.map((f) => `await import(${JSON.stringify(join(SRC, f))});`)
		.join('\n');
	// NODE_OPTIONS / NODE_TEST_CONTEXT must go: when this file runs inside a nested
	// `node --test` (gate 07 copies the package and runs the suite that way) the outer
	// runner leaves `--test-force-exit` in NODE_OPTIONS, the child refuses to start,
	// and a silent child would read as "the graph does not load".
	const env = { ...process.env, LEGO_LIVE_RUNTIME: '', NODE_PATH: '' };
	delete env.NODE_OPTIONS;
	delete env.NODE_TEST_CONTEXT;
	const out = execFileSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			`process.env.LEGO_LIVE_RUNTIME='';\n${script}\nconsole.log('LOADED ${files.length}')`,
		],
		{ encoding: 'utf8', env },
	);
	assert.match(out, new RegExp(`LOADED ${files.length}`));
});

test('src/: the seam reports "unavailable" instead of throwing when the oracle is missing', async () => {
	const mod = await import('../src/reference-runtime.mjs');
	// The seam must be safe to import unconditionally: it returns null, and the
	// explicit accessor is the one that throws with instructions.
	assert.equal(typeof mod.referenceRuntime, 'function');
	assert.equal(typeof mod.requireReferenceRuntime, 'function');
	const value = mod.referenceRuntime();
	assert.ok(value === null || typeof value === 'object');
	if (value) assert.equal(typeof value.dir, 'string', 'the seam must expose dir for createRequire');
});

test('src/: no module performs I/O or mutates globals at import time', () => {
	// ISSUE-006 (global mutable state): the reference writes `Settings.defaultZone`
	// at proxy construction. The port must not do that at IMPORT time.
	for (const file of files) {
		const src = readFileSync(join(SRC, file), 'utf8');
		const topLevel = src
			.split('\n')
			.filter(
				(line) => /^\S/.test(line) && !line.startsWith('import') && !line.startsWith('export'),
			)
			.join('\n');
		assert.doesNotMatch(
			topLevel,
			/Settings\.|Intl\.DateTime\.|process\.env\.[A-Z_]+\s*=/,
			`${file} mutates a global at module scope`,
		);
	}
});
