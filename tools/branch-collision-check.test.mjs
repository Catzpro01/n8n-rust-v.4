#!/usr/bin/env node
/**
 * tools/branch-collision-check.test.mjs
 *
 * Regression tests for the cross-branch collision detector contributed under ISSUE-024.
 *
 * The tool's own contract (see its header) is:
 *   exit 0 = clean · exit 1 = collisions found · exit 2 = misuse
 *
 * The bug these tests pin (found by arena/01a0aff6, agent-5): when a ref could not be read the
 * tool logged a warning, skipped that pair, and still fell through to
 * "No path collisions with differing content. Safe to merge in any order." with exit 0.
 * A typo'd or unfetched branch name therefore produced a GREEN result — the exact false
 * negative the tool exists to prevent. It now refuses with exit 2.
 *
 * The collision cases run against a throwaway git repository in the OS temp dir (via
 * GIT_DIR/GIT_WORK_TREE, which execFileSync inherits through process.env), so this test never
 * creates commits, branches, or checkouts in the real repository.
 *
 * Run: node tools/branch-collision-check.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools', 'branch-collision-check.mjs');

let failures = 0;
let checks = 0;

function check(name, condition, detail = '') {
	checks += 1;
	if (condition) {
		console.log(`[PASS] ${name}`);
	} else {
		failures += 1;
		console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
	}
}

function git(gitDir, args) {
	return execFileSync('git', args, {
		cwd: gitDir,
		encoding: 'utf8',
		env: { ...process.env, GIT_DIR: path.join(gitDir, '.git'), GIT_WORK_TREE: gitDir },
	});
}

function runTool(args, gitDir) {
	const env = gitDir
		? { ...process.env, GIT_DIR: path.join(gitDir, '.git'), GIT_WORK_TREE: gitDir }
		: process.env;
	try {
		const stdout = execFileSync('node', [TOOL, ...args], {
			cwd: ROOT,
			encoding: 'utf8',
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { code: 0, stdout, stderr: '' };
	} catch (error) {
		return {
			code: error.status,
			stdout: String(error.stdout ?? ''),
			stderr: String(error.stderr ?? ''),
		};
	}
}

/**
 * Build a throwaway repo with three commits:
 *   sideA     — packages/probe-lego/src/index.mjs = "owner-a version"
 *   sideB     — same path, "owner-b version"            (=> real collision)
 *   identical — same tree as sideA                      (=> must be clean)
 */
function makeScratchRepo() {
	const dir = mkdtempSync(path.join(tmpdir(), 'collision-probe-'));
	git(dir, ['init', '--quiet', '--initial-branch=main']);
	git(dir, ['config', 'user.name', 'collision-probe']);
	git(dir, ['config', 'user.email', 'probe@local']);

	const probe = path.join(dir, 'packages', 'probe-lego', 'src');
	mkdirSync(probe, { recursive: true });
	const file = path.join(probe, 'index.mjs');

	const commit = (message) => {
		git(dir, ['add', '-A']);
		git(dir, ['commit', '--quiet', '--no-verify', '-m', message]);
		return git(dir, ['rev-parse', 'HEAD']).trim();
	};

	writeFileSync(file, 'export const owner = "a";\n');
	const sideA = commit('probe side A');

	writeFileSync(file, 'export const owner = "b";\n');
	const sideB = commit('probe side B');

	git(dir, ['branch', '--quiet', 'identical', sideA]);

	return { dir, sideA, sideB, identical: sideA };
}

let repo = null;
try {
	repo = makeScratchRepo();
} catch (error) {
	check('scratch repository could be created', false, String(error.message).split('\n')[0]);
}

try {
	// -----------------------------------------------------------------------
	// 1. The regression itself: unreadable refs must never report "safe to merge".
	// -----------------------------------------------------------------------

	const bogus = runTool(['bogus-ref-alpha', 'bogus-ref-beta'], repo?.dir);
	check(
		'unreadable refs refuse with exit 2 (usage error), not exit 0',
		bogus.code === 2,
		`exit ${bogus.code}`,
	);
	check(
		'unreadable refs do not print the "Safe to merge in any order" all-clear',
		!/Safe to merge in any order/.test(bogus.stdout),
		'stdout still contains the all-clear',
	);
	check(
		'unreadable refs say why they were refused',
		/REFUSED/.test(bogus.stderr) && /unreadable/.test(bogus.stderr),
		'stderr missing the REFUSED explanation',
	);

	if (repo) {
		// One good ref plus one bad ref is still a refusal — the comparison is incomplete.
		const mixed = runTool([repo.sideA, 'bogus-ref-gamma'], repo.dir);
		check(
			'one readable + one unreadable ref also refuses with exit 2',
			mixed.code === 2,
			`exit ${mixed.code}`,
		);

		// -------------------------------------------------------------------
		// 2. Real detections still work (guard against over-correcting to "always exit 2").
		// -------------------------------------------------------------------

		const scope = 'packages/';

		const differing = runTool(['--scope', scope, repo.sideA, repo.sideB], repo.dir);
		check(
			'same path with differing content is reported as a collision (exit 1)',
			differing.code === 1,
			`exit ${differing.code}`,
		);
		check(
			'the colliding path is named in the report',
			differing.stdout.includes('packages/probe-lego/src/index.mjs'),
			'path not named',
		);

		const same = runTool(['--scope', scope, repo.sideA, repo.identical], repo.dir);
		check(
			'identical content at the same path is clean (exit 0)',
			same.code === 0,
			`exit ${same.code}`,
		);

		const disjoint = runTool(['--scope', 'crates/', repo.sideA, repo.sideB], repo.dir);
		check(
			'a scope neither ref touches is clean (exit 0)',
			disjoint.code === 0,
			`exit ${disjoint.code}`,
		);
	}
} finally {
	if (repo) {
		rmSync(repo.dir, { recursive: true, force: true });
	}
}

console.log(`\nRESULT: ${checks - failures}/${checks} CHECKS PASSED`);
process.exit(failures > 0 ? 1 : 0);
