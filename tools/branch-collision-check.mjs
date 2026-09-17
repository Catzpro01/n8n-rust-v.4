#!/usr/bin/env node
/**
 * Cross-branch path-collision check.
 *
 * Two branches that both target `main` can ship the SAME file path with
 * DIFFERENT content. Git will not warn until merge time, and by then the
 * "conflict" is a silent clobber of one reconstruction by another — which is
 * exactly what happened between `packages/api-lego`, `packages/credentials-lego`,
 * `packages/scheduler-lego` and `packages/execution-data-lego` on two lanes
 * (see ISSUE-024 in docs/isolation/CROSS-AGENT-ISSUES.md).
 *
 * This tool makes that visible *before* the merge.
 *
 * Usage:
 *   node tools/branch-collision-check.mjs                      # every origin/* branch
 *   node tools/branch-collision-check.mjs <ref> <ref> [...]    # explicit refs
 *   node tools/branch-collision-check.mjs --scope packages/    # limit the walk
 *
 * Exit code: 0 = no collisions, 1 = collisions found, 2 = usage error.
 */

import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();

function git(args) {
	return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function listTreeWithHashes(ref, scope) {
	const out = git(['ls-tree', '-r', ref]);
	const map = new Map();
	for (const line of out.split('\n')) {
		if (!line) continue;
		const [meta, path] = line.split('\t');
		if (!path || (scope && !path.startsWith(scope))) continue;
		const parts = meta.split(/\s+/);
		const hash = parts[2];
		map.set(path, hash);
	}
	return map;
}

function shortLabel(ref) {
	return ref.replace(/^refs\/(heads|remotes\/origin)\//, '');
}

const args = process.argv.slice(2);
let scope = '';
const refs = [];

for (let i = 0; i < args.length; i++) {
	if (args[i] === '--scope') scope = args[++i] ?? '';
	else if (args[i].startsWith('--')) {
		console.error(`unknown flag: ${args[i]}`);
		process.exit(2);
	} else refs.push(args[i]);
}

const targets =
	refs.length > 0
		? refs
		: git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'])
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0 && !line.endsWith('/HEAD'));

if (targets.length < 2) {
	console.error('need at least two refs to compare');
	process.exit(2);
}

console.log(`comparing ${targets.length} refs${scope ? ` (scope: ${scope})` : ''}`);

const trees = new Map();
const unreadable = [];
for (const ref of targets) {
	try {
		trees.set(ref, listTreeWithHashes(ref, scope));
	} catch (error) {
		unreadable.push(ref);
		console.error(`  ! cannot read ${ref}: ${String(error.message).split('\n')[0]}`);
	}
}

// A ref we could not read is NOT a clean result. Skipping the pair and then reporting
// "no collisions / safe to merge in any order" turns a typo'd or unfetched branch name into a
// green light — the exact false negative this tool exists to prevent. Reproduced before the fix:
//   node tools/branch-collision-check.mjs --scope crates/ bogus-a bogus-b
//   -> "No path collisions with differing content. Safe to merge in any order." (exit 0)
// Fail as a usage error instead (exit 2, per the contract in the header).
if (unreadable.length > 0) {
	console.error(
		`\nREFUSED: ${unreadable.length} of ${targets.length} ref(s) unreadable — ` +
			`cannot claim anything about collisions.\n` +
			`Fetch them first (git fetch origin <branch>) or fix the ref name.`,
	);
	process.exit(2);
}

let totalCollisions = 0;
const byPackage = new Map();

for (let i = 0; i < targets.length; i++) {
	for (let j = i + 1; j < targets.length; j++) {
		const a = targets[i];
		const b = targets[j];
		const filesA = trees.get(a);
		const filesB = trees.get(b);
		if (!filesA || !filesB) continue;

		let sharedCount = 0;
		let differing = 0;
		for (const [path, ha] of filesA.entries()) {
			const hb = filesB.get(path);
			if (hb) {
				sharedCount++;
				if (ha !== hb) {
					differing++;
					const pkg = path.split('/').slice(0, 2).join('/');
					if (!byPackage.has(pkg)) byPackage.set(pkg, new Set());
					byPackage.get(pkg).add(path);
				}
			}
		}

		if (sharedCount > 0) {
			totalCollisions += differing;
			console.log(
				`\n${shortLabel(a)}  <->  ${shortLabel(b)}\n` +
					`  shared paths: ${sharedCount}   differing content: ${differing}`,
			);
		}
	}
}

if (totalCollisions === 0) {
	console.log('\nNo path collisions with differing content. Safe to merge in any order.');
	process.exit(0);
}

console.log(`\nCOLLISIONS: ${totalCollisions} path(s) differ across branches.`);
console.log('Affected packages (top level):');
for (const [pkg, paths] of [...byPackage.entries()].sort((x, y) => y[1].size - x[1].size)) {
	console.log(`  ${pkg} — ${paths.size} colliding file(s)`);
	for (const path of [...paths].slice(0, 5)) console.log(`      ${path}`);
	if (paths.size > 5) console.log(`      … ${paths.size - 5} more`);
}
console.log(
	'\nResolve by namespacing one side (e.g. packages/<owner>-<lane>-lego/) or by ' +
		'agreeing a single owner per lane BEFORE merging, otherwise the last merge silently wins.',
);
process.exit(1);
