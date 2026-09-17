#!/usr/bin/env node
/**
 * tools/destructive-deletion-check.mjs
 *
 * Cross-branch check for the conflict class that `tools/branch-collision-check.mjs`
 * structurally cannot see: a path that one branch DELETED and another branch still SHIPS.
 *
 * Why a second tool. The collision detector compares blob hashes of paths that exist on BOTH
 * sides. A deleted path has no blob on one side, so it never enters that comparison and the
 * detector reports "no collisions". Yet this is the more dangerous class — merging the deleting
 * branch removes files the other branch depends on, and git raises no conflict for a path only
 * one side touched. Found in anger as ISSUE-027: `arena/01a0aff7` (PR #16) carries commit
 * `4fd6a7e0`, which empties `crates/` down to `.gitkeep` (22 files / 2825 deletions) while
 * `arena/01a0aff6` and `main` still ship the Rust workspace. Measured: 32 paths.
 *
 * Semantics. For every pair of refs, take `git merge-base --octopus A B`. A path counts as
 * destructively deleted by ref X when it is present at that merge base and absent from X's tree.
 * It is reported when some OTHER ref in the set still carries it. Anchoring on the merge base
 * keeps files a branch simply never had out of the report, so the output is an actionable list
 * rather than a diff of unrelated lanes.
 *
 * Exit codes match the contract of the sibling tool:
 *   0 = no destructive deletions
 *   1 = at least one path would be deleted by one ref while another ref still ships it
 *   2 = misuse (fewer than two refs, or a ref that could not be read — see ISSUE-026; a tool
 *       that answers "clean" for a ref it never read is worse than no tool at all)
 *
 * Usage:
 *   node tools/destructive-deletion-check.mjs                    # every origin/* branch
 *   node tools/destructive-deletion-check.mjs <ref> <ref> [...]  # explicit refs
 *   node tools/destructive-deletion-check.mjs --scope crates/    # limit the walk
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim() ||
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
let scope = '';
const refs = [];
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === '--scope') {
		scope = argv[++i] ?? '';
	} else if (argv[i].startsWith('--scope=')) {
		scope = argv[i].slice('--scope='.length);
	} else {
		refs.push(argv[i]);
	}
}

function git(args) {
	return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function listPaths(ref) {
	const out = git(['ls-tree', '-r', '--name-only', ref]);
	const set = new Set();
	for (const line of out.split('\n')) {
		if (!line) continue;
		if (scope && !line.startsWith(scope)) continue;
		set.add(line);
	}
	return set;
}

function mergeBase(a, b) {
	try {
		return git(['merge-base', '--octopus', a, b]).trim();
	} catch {
		// Unrelated histories: no merge base, therefore nothing that can be "deleted from common".
		return '';
	}
}

function shortLabel(ref) {
	return ref.replace(/^refs\/(heads|remotes\/origin)\//, '');
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
		trees.set(ref, listPaths(ref));
	} catch (error) {
		unreadable.push(ref);
		console.error(`  ! cannot read ${ref}: ${String(error.message).split('\n')[0]}`);
	}
}

// ISSUE-026: never answer "clean" for a ref we could not read.
if (unreadable.length > 0) {
	console.error(
		`\nREFUSED: ${unreadable.length} of ${targets.length} ref(s) unreadable — ` +
			`cannot claim anything about deletions.\n` +
			`Fetch them first (git fetch origin <branch>) or fix the ref name.`,
	);
	process.exit(2);
}

let totalLost = 0;
const deleters = new Map();

for (let i = 0; i < targets.length; i++) {
	for (let j = i + 1; j < targets.length; j++) {
		const a = targets[i];
		const b = targets[j];
		const base = mergeBase(a, b);
		if (!base) {
			console.log(`\n${shortLabel(a)}  <->  ${shortLabel(b)}\n  no merge base — skipped`);
			continue;
		}

		let basePaths;
		try {
			basePaths = listPaths(base);
		} catch (error) {
			console.error(
				`\nREFUSED: merge base ${base.slice(0, 8)} of ${shortLabel(a)}/${shortLabel(b)} ` +
					`is not readable in this clone (shallow?).\n` +
					`Run: git fetch --unshallow origin`,
			);
			process.exit(2);
		}

		const treeA = trees.get(a);
		const treeB = trees.get(b);

		// deleted by A, still shipped by B
		const lostByA = [...basePaths].filter((p) => !treeA.has(p) && treeB.has(p));
		// deleted by B, still shipped by A
		const lostByB = [...basePaths].filter((p) => !treeB.has(p) && treeA.has(p));

		if (lostByA.length > 0 || lostByB.length > 0) {
			totalLost += lostByA.length + lostByB.length;
			console.log(
				`\n${shortLabel(a)}  <->  ${shortLabel(b)}   (merge base ${base.slice(0, 8)})`,
			);
			for (const [deleter, kept, lost] of [
				[a, b, lostByA],
				[b, a, lostByB],
			]) {
				if (lost.length === 0) continue;
				if (!deleters.has(deleter)) deleters.set(deleter, new Set());
				for (const p of lost) deleters.get(deleter).add(p);
				console.log(
					`  ${shortLabel(deleter)} deletes ${lost.length} path(s) that ` +
						`${shortLabel(kept)} still ships:`,
				);
				for (const p of lost.slice(0, 12)) console.log(`      ${p}`);
				if (lost.length > 12) console.log(`      … and ${lost.length - 12} more`);
			}
		}
	}
}

if (totalLost === 0) {
	console.log('\nNo destructive deletions: no ref drops a common path another ref still ships.');
	process.exit(0);
}

// totalLost counts (path, victim-pair) incidences, so a ref that deletes the same 22 paths
// against two keepers contributes 44. The deduplicated per-ref count below is the number to act
// on; label both so the two cannot be misread as disagreeing.
const uniqueLost = new Set();
for (const paths of deleters.values()) for (const p of paths) uniqueLost.add(p);
console.log(
	`\nDESTRUCTIVE: ${uniqueLost.size} distinct path(s) removed across ${deleters.size} ref(s) ` +
		`(${totalLost} ref-pair incidences).`,
);
console.log('Deleting refs (distinct paths each would remove):');
for (const [ref, paths] of deleters) {
	console.log(`  ${shortLabel(ref)} — ${paths.size}`);
}
console.log(
	'\nMerging a deleting branch after the other lands removes these files with no git conflict.\n' +
		'Rebase the deleting branch onto the lineage that needs them and restore the paths, or drop\n' +
		'the manifest/config that still declares them, BEFORE merging. See ISSUE-027.',
);
process.exit(1);
