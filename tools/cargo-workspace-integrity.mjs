#!/usr/bin/env node
/**
 * Cargo workspace integrity gate.
 *
 * ZERO-RUST restoration branches may remove or archive `crates/**`. If a root
 * `Cargo.toml` remains, Cargo still treats the repository as a Rust workspace;
 * every declared `members` entry must therefore exist and contain a Cargo.toml.
 * This gate is intentionally lightweight and offline: it parses the root
 * manifest's `members = [...]` array well enough for this repository and fails
 * on dangling members.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const manifest = join(root, 'Cargo.toml');

if (!existsSync(manifest)) {
	console.log('Cargo workspace integrity: PASS (no root Cargo.toml)');
	process.exit(0);
}

const text = readFileSync(manifest, 'utf8');
const membersMatch = /members\s*=\s*\[([\s\S]*?)\]/m.exec(text);
if (!membersMatch) {
	console.log('Cargo workspace integrity: PASS (root Cargo.toml has no workspace members)');
	process.exit(0);
}

const members = [...membersMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const missing = [];
for (const member of members) {
	const memberDir = join(root, member);
	const memberManifest = join(memberDir, 'Cargo.toml');
	if (!existsSync(memberDir) || !existsSync(memberManifest)) {
		missing.push({ member, expected: memberManifest });
	}
}

if (missing.length > 0) {
	console.error('Cargo workspace integrity: FAIL');
	for (const item of missing) {
		console.error(`- dangling workspace member ${item.member} (missing ${item.expected})`);
	}
	process.exit(1);
}

console.log(`Cargo workspace integrity: PASS (${members.length} member(s))`);
