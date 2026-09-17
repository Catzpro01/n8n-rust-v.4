/**
 * Gate 1 — boundary integrity / "1:1 reuse" proof.
 *  - every owned file exists in the pinned reference and its sha256 equals manifest/ownership.json
 *  - the strict adapter's vendored files are byte-identical to the reference except the import path rewrite
 *  - the kernel vocabulary equals the reference `NodeConnectionTypes`
 *  - the package has no import from other packages/* (seam-only rule)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { PKG, REF_SRC } from './_setup.mjs';

const manifest = JSON.parse(readFileSync(join(PKG, 'manifest', 'ownership.json'), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');

test('owned + consumed reference files exist and match the pinned sha256', () => {
	for (const [rel, expected] of Object.entries(manifest.owns.pinnedSha256)) {
		const src = readFileSync(join(REF_SRC, rel));
		assert.equal(sha(src), expected, `${rel} drifted from the pinned reference`);
	}
});

test('strict adapter vendors the reference sources verbatim (only the interfaces import path differs)', () => {
	for (const rel of Object.keys(manifest.owns.pinnedSha256)) {
		const ref = readFileSync(join(REF_SRC, rel), 'utf8');
		const vendored = readFileSync(join(PKG, 'src', 'adapters', 'strict', 'vendored', basename(rel)), 'utf8');
		const norm = (s) =>
			s
				.replace(/from '\.\.\/interfaces'/g, "from '<KERNEL>'")
				.replace(/from '\.'/g, "from '<KERNEL>'")
				.replace(/from '\.\.\/\.\.\/\.\.\/kernel\/vocabulary\.ts'/g, "from '<KERNEL>'")
				.replace(/from '(\.\/[^']+)\.ts'/g, "from '$1'");
		assert.equal(norm(vendored), norm(ref), `${rel}: vendored body is not the reference body`);
	}
});

test('kernel vocabulary equals reference NodeConnectionTypes (interfaces.ts)', async () => {
	const src = readFileSync(join(REF_SRC, 'interfaces.ts'), 'utf8');
	const m = src.match(/export const NodeConnectionTypes = \{([\s\S]*?)\} as const;/);
	assert.ok(m, 'NodeConnectionTypes not found in reference interfaces.ts');
	const expected = Object.fromEntries([...m[1].matchAll(/(\w+): '([^']+)'/g)].map((x) => [x[1], x[2]]));
	const { NodeConnectionTypes } = await import('../src/kernel/vocabulary.ts');
	assert.deepEqual({ ...NodeConnectionTypes }, expected);
});

test('no cross-package import: src/** never imports another packages/* LEGO or reference/n8n source', () => {
	const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
	for (const file of walk(join(PKG, 'src'))) {
		const text = readFileSync(file, 'utf8');
		assert.doesNotMatch(text, /from '[^']*(workflow-lego|node-lego|validation-lego|core-lego|reference\/n8n)/, file);
		assert.doesNotMatch(text, /require\('[^']*(workflow-lego|node-lego|validation-lego|core-lego|reference\/n8n)/, file);
	}
});
