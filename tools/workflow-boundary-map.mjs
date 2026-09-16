#!/usr/bin/env node
/**
 * Phase 2 — Workflow LEGO boundary mapper (read-only analysis).
 *
 * Single source of truth for the boundary: packages/workflow-lego/manifest/ownership.json
 *
 * Reports against reference/n8n/packages/workflow (n8n 2.9.4, read-only):
 *   1. internal import graph of src/**
 *   2. external (non-relative) module dependencies
 *   3. inbound consumers of the package across the monorepo
 *   4. every boundary crossing mapped to a declared port + drift check
 *
 * Usage: node tools/workflow-boundary-map.mjs [--json out.json] [--md out.md] [--check]
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(REPO, 'reference/n8n');
const PKG = join(REF, 'packages/workflow');
const SRC = join(PKG, 'src');
const MANIFEST_PATH = join(REPO, 'packages/workflow-lego/manifest/ownership.json');
const EXPECT_PATH = join(REPO, 'packages/workflow-lego/manifest/boundary.expectations.json');

export const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
export const OWNED_FILES = MANIFEST.owns.files; // canonical, extension-less ids

const args = process.argv.slice(2);
const argOf = (flag) => {
	const i = args.indexOf(flag);
	return i === -1 ? null : args[i + 1];
};

/* ------------------------------------------------------------------ */
const walk = (dir, out = []) => {
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		const s = statSync(p);
		if (s.isDirectory()) {
			if (['node_modules', 'dist', '.turbo'].includes(e)) continue;
			walk(p, out);
		} else if (/\.(ts|mts|cts)$/.test(e)) out.push(p);
	}
	return out;
};

export const key = (f) => f.replace(/\.(ts|mts|cts)$/, '');
const srcFiles = walk(SRC).map((f) => relative(SRC, f)).sort();
const fileSet = new Set(srcFiles.map(key));

/**
 * Canonical module id for a relative import inside the reference package:
 * extension-less and relative to src/, directory imports resolve to <dir>/index.
 */
export const resolveSpecifier = (fromFile, spec) => {
	const base = resolve(SRC, dirname(fromFile), spec);
	const rel = relative(SRC, base);
	if (rel === '' || rel === '.') return fileSet.has('index') ? 'index' : null;
	for (const cand of [rel, `${rel}.ts`, `${rel}/index`, `${rel}/index.ts`]) {
		if (fileSet.has(cand)) return cand;
	}
	return null;
};

const IMPORT_RE = /(?:^|\n)[ \t]*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
const SIDE_RE = /(?:^|\n)[ \t]*import\s+['"]([^'"]+)['"]/g;

export function buildGraph() {
	const graph = {};
	for (const rawFile of srcFiles) {
		const file = key(rawFile);
		const src = readFileSync(join(SRC, rawFile), 'utf8');
		const specs = new Set();
		for (const re of [IMPORT_RE, SIDE_RE]) {
			re.lastIndex = 0;
			let m;
			while ((m = re.exec(src)) !== null) specs.add(m[1]);
		}
		const internal = new Set();
		const external = new Set();
		const unresolved = new Set();
		for (const spec of specs) {
			if (spec.startsWith('.')) {
				const r = resolveSpecifier(file, spec);
				if (r) internal.add(r);
				else unresolved.add(spec);
			} else {
				external.add(spec);
			}
		}
		graph[file] = {
			internal: [...internal].sort(),
			external: [...external].sort(),
			unresolved: [...unresolved],
		};
	}
	return { graph, srcFiles };
}

/** Which port, if any, declares a given (from → to) crossing. */
export function portFor(portList, moduleId) {
	for (const p of portList) {
		if ((p.replaces ?? []).includes(moduleId)) return p.id;
	}
	return null;
}

/** Declared deviations: known boundary defects that are normalized by the extraction. */
export function deviationFor(from, to) {
	return (MANIFEST.deviations ?? []).find((d) => d.file === from && d.edge === `${from} -> ${to}`) ?? null;
}

/** Canonical module id -> port module id (manifest.extraction.portSpecifiers, non file-scoped). */
export function extractionPortFor(moduleId) {
	const specifiers = MANIFEST.extraction.portSpecifiers;
	return specifiers[moduleId] ?? null;
}

export function analyse() {
	const { graph } = buildGraph();
	const ownedSet = new Set(OWNED_FILES);
	const missingOwned = OWNED_FILES.filter((f) => !fileSet.has(f));

	/* outbound crossings: owned file -> not owned file, grouped by import specifier */
	const crossings = [];
	for (const f of [...ownedSet].sort()) {
		for (const dep of graph[f]?.internal ?? []) {
			if (ownedSet.has(dep)) continue;
			const dev = deviationFor(f, dep);
			crossings.push({
				from: f,
				to: dep,
				spec: `./${dep}`,
				port: portFor(MANIFEST.ports, dep) ?? (dev ? MANIFEST.extraction.portSpecifiers[`${f}|${dep}`] ?? null : null),
				deviation: dev?.id ?? null,
			});
		}
	}
	/* external npm packages used by owned files */
	const externalCrossings = [];
	for (const f of [...ownedSet].sort()) {
		for (const dep of graph[f]?.external ?? []) {
			externalCrossings.push({ from: f, to: dep, spec: dep, port: portFor(MANIFEST.ports, dep) });
		}
	}

	/* inbound edges: not owned file -> owned file */
	const inbound = [];
	for (const f of Object.keys(graph)) {
		if (ownedSet.has(f)) continue;
		for (const dep of graph[f].internal) {
			if (ownedSet.has(dep)) inbound.push({ from: f, to: dep });
		}
	}

	/* transitive closure of owned files (what the LEGO pulls in at compile scope) */
	const closure = new Set();
	const stack = [...ownedSet];
	while (stack.length) {
		const f = stack.pop();
		if (closure.has(f)) continue;
		closure.add(f);
		for (const d of graph[f]?.internal ?? []) stack.push(d);
	}

	/* monorepo consumers */
	const PKGS = join(REF, 'packages');
	const consumers = { root: 0, rootByPackage: {}, subpath: 0, subpathBySpec: {} };
	for (const pkg of readdirSync(PKGS)) {
		const pkgDir = join(PKGS, pkg);
		if (!statSync(pkgDir).isDirectory() || pkg === 'workflow') continue;
		for (const f of walk(pkgDir)) {
			let src;
			try {
				src = readFileSync(f, 'utf8');
			} catch {
				continue;
			}
			const re = /from\s+['"](n8n-workflow(?:\/[^'"]*)?)['"]/g;
			let m;
			while ((m = re.exec(src)) !== null) {
				if (m[1] === 'n8n-workflow') {
					consumers.root++;
					consumers.rootByPackage[pkg] = (consumers.rootByPackage[pkg] ?? 0) + 1;
				} else {
					consumers.subpath++;
					consumers.subpathBySpec[m[1]] = (consumers.subpathBySpec[m[1]] ?? 0) + 1;
				}
			}
		}
	}

	const undeclared = [...crossings, ...externalCrossings].filter(
		(c) => c.port === null && !c.deviation && !isKernelType(c),
	);
	return {
		generatedAt: new Date().toISOString(),
		lego: MANIFEST.lego,
		reference: { package: 'reference/n8n/packages/workflow', srcFileCount: srcFiles.length },
		owned: { files: OWNED_FILES, missing: missingOwned, count: OWNED_FILES.length },
		closure: [...closure].sort(),
		crossings: crossings.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
		externalCrossings: externalCrossings.sort((a, b) => a.from.localeCompare(b.from)),
		undeclared,
		inbound: inbound.sort((a, b) => a.from.localeCompare(b.from)),
		consumers,
		graph,
	};
}

/** type-only couplings are still crossings, but they carry no runtime edge. */
function isKernelType(c) {
	return c.to === 'interfaces' || c.to === 'types';
}

/* ------------------------------------------------------------------ */
function mdReport(r) {
	const md = [];
	md.push('# Workflow LEGO — Dependency & Boundary Map', '');
	md.push(
		`> Generated by \`tools/workflow-boundary-map.mjs\` from \`${r.reference.package}\` (n8n ${MANIFEST.reference.pinnedVersion}, commit \`${MANIFEST.reference.pinnedCommit.slice(0, 12)}\`).`,
		'',
		`> Source files scanned: **${r.reference.srcFileCount}** · LEGO-owned files: **${r.owned.count}** · compile closure: **${r.closure.length}** · undeclared crossings: **${r.undeclared.length}**`,
		'',
		'## 1. LEGO-owned files',
		'',
		'| file | internal deps (owned) | crossings (declared ports) | external modules |',
		'| :--- | :--- | :--- | :--- |',
	);
	for (const f of r.owned.files) {
		const g = r.graph[f] ?? { internal: [], external: [] };
		const ownedDeps = g.internal.filter((d) => r.owned.files.includes(d));
		const cross = r.crossings.filter((c) => c.from === f);
		const ext = r.externalCrossings.filter((c) => c.from === f);
		md.push(
			`| \`${f}\` | ${ownedDeps.map((d) => `\`${d}\``).join(', ') || '—'} | ${cross
				.map((c) => `\`${c.to}\` → ${c.port ?? (isKernelType(c) ? '*(types only)*' : '**UNDECLARED**')}${c.deviation ? ` *(deviation ${c.deviation})*` : ''}`)
				.join('<br>') || '—'} | ${ext.map((c) => `\`${c.to}\` → ${c.port ?? '**UNDECLARED**'}`).join('<br>') || '—'} |`,
		);
	}
	md.push('', '## 2. Inbound edges (module → LEGO)', '');
	md.push('| from | to (owned) |', '| :--- | :--- |');
	for (const e of r.inbound) md.push(`| \`${e.from}\` | \`${e.to}\` |`);
	md.push('', '## 3. Monorepo consumers of `n8n-workflow`', '');
	md.push(`- root specifier: **${r.consumers.root}** import sites`);
	md.push(`- subpath specifiers: **${r.consumers.subpath}** import sites`);
	for (const [spec, n] of Object.entries(r.consumers.subpathBySpec).sort()) md.push(`  - \`${spec}\`: ${n}`);
	md.push('', '## 4. Declared ports', '');
	md.push('| port | role | provides | replaces |', '| :--- | :--- | :--- | :--- |');
	for (const p of MANIFEST.ports)
		md.push(`| \`${p.id}\` | ${p.role} | ${p.provides} | ${(p.replaces ?? []).map((x) => `\`${x}\``).join(', ') || '—'} |`);
	md.push('', '## 5. Undeclared crossings', '');
	if (r.undeclared.length === 0) md.push('None — every dependency leaving the LEGO is declared by a port.');
	else for (const u of r.undeclared) md.push(`- \`${u.from}\` → \`${u.to}\` (spec \`${u.spec}\`) **UNDECLARED**`);
	return md.join('\n') + '\n';
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const report = analyse();
	if (argOf('--json')) writeFileSync(argOf('--json'), JSON.stringify(report, null, 2));
	if (argOf('--md')) writeFileSync(argOf('--md'), mdReport(report));

	console.log(`src files scanned         : ${report.reference.srcFileCount}`);
	console.log(`LEGO owned files          : ${report.owned.count}${report.owned.missing.length ? ` (MISSING: ${report.owned.missing.join(', ')})` : ''}`);
	console.log(`compile closure           : ${report.closure.length}`);
	console.log(`outbound crossings        : ${report.crossings.length + report.externalCrossings.length}`);
	console.log(`undeclared crossings      : ${report.undeclared.length}`);
	console.log(`inbound edges             : ${report.inbound.length}`);
	console.log(`monorepo import sites     : ${report.consumers.root} root + ${report.consumers.subpath} subpath`);

	if (args.includes('--check')) {
		const expect = JSON.parse(readFileSync(EXPECT_PATH, 'utf8'));
		const problems = [];
		const currentCrossings = report.crossings
			.concat(report.externalCrossings)
			.map((c) => `${c.from} -> ${c.to}`)
			.sort();
		const baseline = expect.crossings.slice().sort();
		for (const c of currentCrossings) if (!baseline.includes(c)) problems.push(`NEW crossing: ${c}`);
		for (const c of baseline) if (!currentCrossings.includes(c)) problems.push(`REMOVED crossing: ${c}`);
		const currentInbound = report.inbound.map((e) => `${e.from} -> ${e.to}`).sort();
		const baselineIn = expect.inbound.slice().sort();
		for (const c of currentInbound) if (!baselineIn.includes(c)) problems.push(`NEW inbound: ${c}`);
		for (const c of baselineIn) if (!currentInbound.includes(c)) problems.push(`REMOVED inbound: ${c}`);
		for (const u of report.undeclared) problems.push(`UNDECLARED: ${u.from} -> ${u.to}`);
		if (report.owned.missing.length) problems.push(`MISSING owned files: ${report.owned.missing.join(', ')}`);
		if (existsSync(EXPECT_PATH) === false) problems.push('missing boundary.expectations.json');
		if (problems.length) {
			console.error(`\nBOUNDARY DRIFT DETECTED (${problems.length}):`);
			for (const p of problems) console.error(`  - ${p}`);
			process.exitCode = 1;
		} else {
			console.log('\nBoundary check: PASS (no drift vs packages/workflow-lego/manifest/boundary.expectations.json)');
		}
	}
}
