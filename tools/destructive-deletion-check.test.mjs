#!/usr/bin/env node
/**
 * tools/destructive-deletion-check.test.mjs
 *
 * Regression tests for the delete/modify conflict detector.
 *
 * Contract (same shape as tools/branch-collision-check.mjs):
 *   exit 0 = clean · exit 1 = destructive deletions found · exit 2 = misuse
 *
 * The case that matters, reproduced from ISSUE-027: `arena/01a0aff7` (PR #16) carries a commit
 * that empties `crates/` down to `.gitkeep` while other branches still ship the workspace. The
 * sibling collision detector cannot see it, because a deleted path has no blob on one side and
 * therefore never enters a blob-hash comparison of shared paths.
 *
 * Cases run against a throwaway git repository in the OS temp dir (via GIT_DIR/GIT_WORK_TREE,
 * which execFileSync inherits through process.env), so this test never creates commits,
 * branches, or checkouts in the real repository.
 *
 * Run: node tools/destructive-deletion-check.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools', 'destructive-deletion-check.mjs');

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

function git(dir, args) {
	return execFileSync('git', args, {
		cwd: dir,
		encoding: 'utf8',
		env: { ...process.env, GIT_DIR: path.join(dir, '.git'), GIT_WORK_TREE: dir },
	});
}

function runTool(args, dir) {
	try {
		const stdout = execFileSync('node', [TOOL, ...args], {
			cwd: ROOT,
			encoding: 'utf8',
			env: dir
				? { ...process.env, GIT_DIR: path.join(dir, '.git'), GIT_WORK_TREE: dir }
				: process.env,
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
 * Build a throwaway repo shaped like the ISSUE-027 conflict:
 *
 *   base       crates/n8n-common/src/lib.rs  +  crates/n8n-common/Cargo.toml
 *   keeper     unchanged (still ships both)
 *   deleter    both files removed, crates/ reduced to .gitkeep
 *   additive   base files intact PLUS a new file the base never had
 */
function makeScratchRepo() {
	const dir = mkdtempSync(path.join(tmpdir(), 'destructive-probe-'));
	git(dir, ['init', '--quiet', '--initial-branch=main']);
	git(dir, ['config', 'user.name', 'destructive-probe']);
	git(dir, ['config', 'user.email', 'probe@local']);

	const crateDir = path.join(dir, 'crates', 'n8n-common', 'src');
	mkdirSync(crateDir, { recursive: true });
	const lib = path.join(crateDir, 'lib.rs');
	const manifest = path.join(dir, 'crates', 'n8n-common', 'Cargo.toml');

	const commit = (message) => {
		git(dir, ['add', '-A']);
		git(dir, ['commit', '--quiet', '--no-verify', '-m', message]);
		return git(dir, ['rev-parse', 'HEAD']).trim();
	};

	writeFileSync(lib, 'pub fn common() {}\n');
	writeFileSync(manifest, '[package]\nname = "n8n-common"\n');
	const keeper = commit('base + keeper: full crate');

	// additive: keeps everything, adds a file the base never had
	writeFileSync(path.join(crateDir, 'extra.rs'), 'pub fn extra() {}\n');
	const additive = commit('additive: base files intact plus a new one');

	// deleter: remove both base files, leave a .gitkeep so the directory survives
	unlinkSync(lib);
	unlinkSync(manifest);
	unlinkSync(path.join(crateDir, 'extra.rs'));
	writeFileSync(path.join(dir, 'crates', '.gitkeep'), '');
	const deleter = commit('deleter: remove premature Rust artifacts');

	return { dir, keeper, additive, deleter };
}

let repo = null;
try {
	repo = makeScratchRepo();
} catch (error) {
	check('scratch repository could be created', false, String(error.message).split('\n')[0]);
}

try {
	// 1. Misuse: unreadable refs must never be reported as clean (ISSUE-026, same failure mode).
	const bogus = runTool(['bogus-ref-alpha', 'bogus-ref-beta'], repo?.dir);
	check('unreadable refs refuse with exit 2, not exit 0', bogus.code === 2, `exit ${bogus.code}`);
	check(
		'unreadable refs do not print the clean all-clear',
		!/No destructive deletions/.test(bogus.stdout),
		'stdout still contains the all-clear',
	);
	check(
		'unreadable refs say why they were refused',
		/REFUSED/.test(bogus.stderr),
		'stderr missing the REFUSED explanation',
	);

	if (repo) {
		const scope = 'crates/';

		// 2. The ISSUE-027 shape: one branch deletes what another still ships.
		const hit = runTool(['--scope', scope, repo.deleter, repo.keeper], repo.dir);
		check(
			'a path one ref deleted and another still ships is reported (exit 1)',
			hit.code === 1,
			`exit ${hit.code}`,
		);
		// The tool labels refs by the string it was given, so assert on the SHA and on which
		// side of the sentence each ref landed on.
		const deleterLine = hit.stdout
			.split('\n')
			.find((l) => l.includes('deletes') && l.includes('still ships')) ?? '';
		check(
			'the deleter is named, not the keeper',
			deleterLine.trimStart().startsWith(repo.deleter) &&
				deleterLine.includes(`${repo.keeper} still ships`) &&
				/deletes 2 path\(s\)/.test(deleterLine),
			deleterLine || 'no deleter line in output',
		);
		check(
			'the lost paths are named',
			hit.stdout.includes('crates/n8n-common/src/lib.rs') &&
				hit.stdout.includes('crates/n8n-common/Cargo.toml'),
			'lost paths not named',
		);

		// 3. Detection is symmetric — swapping the argument order must not hide it.
		const swapped = runTool(['--scope', scope, repo.keeper, repo.deleter], repo.dir);
		check(
			'detection is symmetric under argument order (exit 1)',
			swapped.code === 1,
			`exit ${swapped.code}`,
		);

		// 4. No deletion anywhere -> clean.
		const clean = runTool(['--scope', scope, repo.keeper, repo.additive], repo.dir);
		check(
			'two refs that both keep the base paths are clean (exit 0)',
			clean.code === 0,
			`exit ${clean.code}\n${clean.stdout}`,
		);

		// 5. A file the base never had is not a destructive deletion — otherwise the tool would
		//    just be reporting every lane's new work.
		check(
			'a path absent from the merge base is not reported as deleted',
			!/extra\.rs/.test(clean.stdout),
			'extra.rs leaked into the report',
		);

		// 6. A scope that neither ref touches is clean.
		const disjoint = runTool(['--scope', 'packages/', repo.deleter, repo.keeper], repo.dir);
		check(
			'a scope neither ref touches is clean (exit 0)',
			disjoint.code === 0,
			`exit ${disjoint.code}`,
		);

		// 7. Three refs at once: the deleter is still singled out against both keepers.
		const triple = runTool(
			['--scope', scope, repo.keeper, repo.additive, repo.deleter],
			repo.dir,
		);
		check(
			'three-ref comparison still isolates the deleter (exit 1)',
			triple.code === 1,
			`exit ${triple.code}`,
		);
	}
} finally {
	if (repo) {
		rmSync(repo.dir, { recursive: true, force: true });
	}
}

console.log(`\nRESULT: ${checks - failures}/${checks} CHECKS PASSED`);
process.exit(failures > 0 ? 1 : 0);
