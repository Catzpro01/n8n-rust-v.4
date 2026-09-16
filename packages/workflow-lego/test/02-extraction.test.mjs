/**
 * Gate 2 — extraction integrity + TypeScript build.
 *
 * The isolated unit is a *derived* artifact: the LEGO-owned sources copied from
 * the pinned reference, with only declared port specifiers rewritten. This test
 * does not trust the extractor — it re-verifies the claim independently:
 *
 *   1. the extraction ran and produced every owned file
 *   2. reverting the recorded rewrites reproduces the reference bytes exactly
 *   3. no extracted file imports anything outside the LEGO except its ports
 *   4. the isolated unit compiles (TypeScript build PASS) with only ports available
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST } from '../../../tools/workflow-boundary-map.mjs';

const PKG = join(fileURLToPath(import.meta.url), '..', '..');
const REPO = join(PKG, '..', '..');
const REF_SRC = join(REPO, 'reference/n8n/packages/workflow/src');
const EXTRACT = join(PKG, '.extract');

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', ...opts });

test('extraction produces every owned file and is byte-faithful', () => {
	const result = run(process.execPath, [join(REPO, 'tools/workflow-isolation-extract.mjs')]);
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

	const rewrites = JSON.parse(readFileSync(join(EXTRACT, 'rewrites.json'), 'utf8'));
	assert.deepEqual(rewrites.ownedFiles.sort(), [...MANIFEST.owns.files].sort());

	const declaredPorts = new Set(MANIFEST.ports.map((p) => p.adapter.replace(/^src\//, '').replace(/\.ts$/, '')));
	const declaredDeviations = new Set((MANIFEST.deviations ?? []).map((d) => d.id));

	// Independently re-derive the expected extraction: scan the reference source
	// in order and apply the recorded rewrites positionally. If the extractor did
	// anything besides these specifier substitutions, the comparison fails.
	const specifierRe = /((?:^|\n)[ \t]*(?:import|export)[\s\S]*?from\s+['"])([^'"]+)(['"]\s*;)|((?:^|\n)[ \t]*import\s+['"])([^'"]+)(['"]\s*;)/g;

	for (const { file, edits } of rewrites.rewrites) {
		const reference = readFileSync(join(REF_SRC, `${file}.ts`), 'utf8');
		const extracted = readFileSync(join(EXTRACT, 'src', `${file}.ts`), 'utf8');

		specifierRe.lastIndex = 0;
		const matches = [];
		let m;
		while ((m = specifierRe.exec(reference)) !== null) matches.push({ spec: m[2] ?? m[5], match: m[0], index: m.index });

		let expected = '';
		let cursor = 0;
		let editIndex = 0;
		for (const match of matches) {
			const edit = edits[editIndex];
			const isRewritten = edit && edit.from === match.spec;
			if (!isRewritten) continue;
			assert.ok(edit.to.startsWith('./') || edit.to.startsWith('../'), `unexpected rewrite target ${edit.to}`);
			const portModule = edit.port.replace('@lego/ports/', 'ports/');
			assert.ok(declaredPorts.has(portModule), `rewrite to undeclared port ${edit.port}`);
			if (edit.via === 'deviation') assert.ok(declaredDeviations.has(edit.deviation), `undeclared deviation ${edit.deviation}`);
			expected += reference.slice(cursor, match.index) + match.match.split(`'${match.spec}'`).join(`'${edit.to}'`);
			cursor = match.index + match.match.length;
			editIndex++;
		}
		assert.equal(editIndex, edits.length, `${file}: ${edits.length - editIndex} recorded rewrite(s) do not occur in the reference source`);
		expected += reference.slice(cursor);
		assert.equal(extracted, expected, `${file}: extraction is not a pure import rewrite`);
	}
});

test('extracted sources only import LEGO-owned modules or declared ports', () => {
	const ownedFiles = new Set(MANIFEST.owns.files);
	const files = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir)) {
			const abs = join(dir, entry);
			if (statSync(abs).isDirectory()) {
				if (entry !== 'lego') walk(abs);
			} else if (entry.endsWith('.ts')) files.push(abs);
		}
	};
	walk(join(EXTRACT, 'src'));

	assert.ok(files.length >= MANIFEST.owns.files.length);
	const importRe = /from\s+['"]([^'"]+)['"]/g;
	for (const abs of files) {
		const src = readFileSync(abs, 'utf8');
		let m;
		while ((m = importRe.exec(src)) !== null) {
			const spec = m[1];
			if (!spec.startsWith('.')) {
				assert.ok(spec.startsWith('./lego/') || spec.startsWith('../lego/'), `${abs}: imports external module ${spec}`);
				continue;
			}
			const target = join(abs, '..', spec).replace(/\\/g, '/');
			const relToExtract = target.replace(join(EXTRACT, 'src').replace(/\\/g, '/'), '').replace(/^\//, '');
			// directory imports (e.g. './common') resolve to <dir>/index
			const owned =
				ownedFiles.has(relToExtract) ||
				ownedFiles.has(`${relToExtract}/index`) ||
				[...ownedFiles].some((f) => f.startsWith(`${relToExtract}/`));
			assert.ok(
				spec.includes('lego/ports/') || owned,
				`${abs}: imports non-owned module ${spec} (${relToExtract})`,
			);
		}
	}
});

test('isolated unit compiles: TypeScript build PASS', () => {
	const tsc = join(PKG, 'node_modules', '.bin', 'tsc');
	assert.ok(existsSync(tsc), 'typescript is not installed — run `npm install` in packages/workflow-lego');
	const result = spawnSync(tsc, ['-p', join(EXTRACT, 'tsconfig.json')], { cwd: PKG, encoding: 'utf8' });
	assert.equal(result.status, 0, `tsc failed:\n${result.stdout}\n${result.stderr}`);
	assert.ok(existsSync(join(EXTRACT, 'dist', 'model-api.js')), 'isolated model API was not emitted');
});
