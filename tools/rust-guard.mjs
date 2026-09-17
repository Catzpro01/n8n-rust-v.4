#!/usr/bin/env node
/**
 * Rust guard — PROJECT_RULES rule 1 ("ZERO RUST") enforcement.
 *
 * The rule unconditionally forbids Rust sources inside the reserved implementation
 * directories; no phase transition relaxes it. Two harnesses also check this inline
 * (tests/compatibility/contract_conformance.mjs and tests/integration/boundary_audit.py);
 * this tool exists so the same rule can run independently, without Python or the
 * reference tree.
 *
 * Detection set is deliberately IDENTICAL to the two existing harnesses:
 * a file is an offender when its name ends with `.rs` or equals `Cargo.toml`.
 * `Cargo.lock` / `*.toml` / `target/` hits are reported as warnings only, so the
 * three guards can never disagree about what counts as a violation.
 *
 * usage: node tools/rust-guard.mjs [--json] [--path <dir>]...
 * exit:  0 = clean, 1 = violation, 2 = usage/IO error
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GUARDED_DIRS = ['crates', 'apps'];

const HARD_PATTERNS = [/\.rs$/, /^Cargo\.toml$/];
const SOFT_PATTERNS = [/^Cargo\.lock$/, /^rust-toolchain(\.toml)?$/, /^build\.rs$/];

/** Walk `dir` and collect { offenders, warnings } relative to REPO. */
export function scan(dir) {
	const offenders = [];
	const warnings = [];
	const roots = Array.isArray(dir) ? dir : [dir];
	const walk = (current) => {
		if (!existsSync(current)) return;
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				// node_modules / .git never hold project Rust sources.
				if (entry.name === 'node_modules' || entry.name === '.git') continue;
				walk(full);
				continue;
			}
			const rel = relative(REPO, full).split('\\').join('/');
			if (HARD_PATTERNS.some((rx) => rx.test(entry.name))) offenders.push(rel);
			else if (SOFT_PATTERNS.some((rx) => rx.test(entry.name))) warnings.push(rel);
			else if (entry.name.endsWith('.toml')) warnings.push(rel);
		}
	};
	for (const root of roots) walk(root);
	return { offenders: offenders.sort(), warnings: warnings.sort() };
}

function parseArgs(argv) {
	const opts = { json: false, paths: [] };
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === '--json') opts.json = true;
		else if (a === '--path') {
			const v = argv[++i];
			if (!v) {
				opts.error = '--path requires a value';
				return opts;
			}
			opts.paths.push(v);
		} else {
			opts.error = `unknown argument: ${a}`;
			return opts;
		}
	}
	return opts;
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.error) {
		process.stderr.write(`rust-guard: ${opts.error}\n`);
		return 2;
	}

	const targets = (opts.paths.length ? opts.paths : GUARDED_DIRS).map((p) => resolve(REPO, p));
	// A missing guarded directory is NOT a violation: absent means nothing to offend.
	const missing = targets.filter((t) => !existsSync(t));

	const found = { offenders: [], warnings: [] };
	for (const t of targets) {
		const r = scan(t);
		found.offenders.push(...r.offenders);
		found.warnings.push(...r.warnings);
	}
	found.offenders.sort();
	found.warnings.sort();
	const clean = found.offenders.length === 0;

	if (opts.json) {
		process.stdout.write(
			`${JSON.stringify(
				{
					guard: 'rust-guard',
					rule: 'PROJECT_RULES.md #1 ZERO RUST',
					scanned: targets.map((t) => relative(REPO, t) || '.'),
					missing: missing.map((t) => relative(REPO, t) || '.'),
					clean,
					offender_count: found.offenders.length,
					offenders: found.offenders,
					warning_count: found.warnings.length,
					warnings: found.warnings,
					checked_at: new Date().toISOString(),
				},
				null,
				2,
			)}\n`,
		);
		return clean ? 0 : 1;
	}

	const label = targets.map((t) => relative(REPO, t) || '.').join(', ');
	process.stdout.write('=== RUST GUARD (PROJECT_RULES #1 ZERO RUST) ===\n');
	process.stdout.write(`scanned: ${label}\n`);
	for (const w of found.warnings) process.stdout.write(`[warn] ${w}\n`);
	if (clean) {
		process.stdout.write(`RESULT: PASS — no .rs / Cargo.toml under ${label}\n`);
		return 0;
	}
	for (const o of found.offenders) process.stdout.write(`[FAIL] ${o}\n`);
	process.stdout.write(
		`RESULT: FAIL — ${found.offenders.length} Rust artifact(s) in reserved dirs; ` +
			`Rust is unconditionally forbidden by PROJECT_RULES.md #1\n`,
	);
	return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	let code = 2;
	try {
		code = main();
	} catch (err) {
		process.stderr.write(`rust-guard: ${err && err.message ? err.message : String(err)}\n`);
		code = 2;
	}
	process.exit(code);
}
