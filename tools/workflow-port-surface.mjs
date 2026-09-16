#!/usr/bin/env node
/**
 * Workflow LEGO — port surface extractor.
 *
 * For every LEGO-owned source file, finds the import specifiers that cross the
 * LEGO boundary and lists the exact symbols each port module must provide.
 *
 * This is what keeps `packages/workflow-lego/src/ports/*` honest: the ports may
 * not export more or less than the model actually consumes.
 *
 * Usage: node tools/workflow-port-surface.mjs [--json out.json] [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, analyse, MANIFEST, resolveSpecifier } from './workflow-boundary-map.mjs';

const SRC = join(REPO, 'reference/n8n/packages/workflow/src');
const report = analyse();

/** specifier -> port module id (from manifest.extraction.portSpecifiers) */
const SPEC_MAP = MANIFEST.extraction.portSpecifiers;
const resolvePort = (file, spec) => {
	if (spec.startsWith('.')) {
		const moduleId = resolveSpecifier(file, spec);
		if (!moduleId) return null;
		const scoped = SPEC_MAP[`${file}|${moduleId}`];
		if (scoped) return scoped;
		const declared = report.crossings.find((c) => c.from === file && c.to === moduleId);
		return declared && (declared.port || declared.deviation) ? SPEC_MAP[moduleId] ?? null : null;
	}
	const declared = report.externalCrossings.find((c) => c.from === file && c.to === spec);
	return declared && declared.port ? SPEC_MAP[spec] ?? null : null;
};

const IMPORT_BLOCK_RE =
	/(?:^|\n)[ \t]*import\s+(type\s+)?([\s\S]*?)\s*from\s+['"]([^'"]+)['"]\s*;|(?:^|\n)[ \t]*import\s+['"]([^'"]+)['"]\s*;/g;

const portNeeds = {};
for (const file of MANIFEST.owns.files) {
	const src = readFileSync(join(SRC, `${file}.ts`), 'utf8');
	IMPORT_BLOCK_RE.lastIndex = 0;
	let m;
	while ((m = IMPORT_BLOCK_RE.exec(src)) !== null) {
		const typeOnly = Boolean(m[1]);
		const clause = (m[2] ?? '').trim();
		const spec = m[3] ?? m[4];
		if (spec === undefined) continue;
		const port = resolvePort(file, spec);
		if (!port) continue;

		const entry = (portNeeds[port] ??= { module: port, kind: typeOnly ? 'type' : 'value', symbols: [], usedBy: [] });
		entry.usedBy.push(`${file} (${spec})`);
		if (clause.startsWith('*')) {
			entry.symbols.push(`* as ${clause.replace(/^\*\s*as\s*/, '').trim()}`);
			continue;
		}
		const names = clause
			.replace(/^type\s+/, '')
			.replace(/[{}]/g, '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map((s) => s.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim());
		entry.symbols.push(...names);
	}
}

for (const entry of Object.values(portNeeds)) {
	entry.symbols = [...new Set(entry.symbols)].sort();
	entry.usedBy = [...new Set(entry.usedBy)].sort();
}

const out = {
	generatedAt: new Date().toISOString(),
	note: 'Exact symbols each port must provide for the LEGO-owned sources to compile.',
	ports: Object.fromEntries(Object.entries(portNeeds).sort(([a], [b]) => a.localeCompare(b))),
};

const args = process.argv.slice(2);
const argOf = (f) => {
	const i = args.indexOf(f);
	return i === -1 ? null : args[i + 1];
};
if (argOf('--json')) writeFileSync(argOf('--json'), JSON.stringify(out, null, 2));

console.log('Required port surface (from actual imports in owned files):\n');
for (const [port, entry] of Object.entries(out.ports)) {
	console.log(`${port}  [${entry.kind}]`);
	console.log(`   symbols : ${entry.symbols.join(', ')}`);
	console.log(`   used by : ${entry.usedBy.join(', ')}`);
}

if (args.includes('--check')) {
	// assert every declared port in the manifest is actually consumed, and vice versa
	const moduleOf = (port) => `@lego/${port.adapter.replace(/^src\//, '').replace(/\.ts$/, '')}`;
	const declared = new Map(MANIFEST.ports.map((p) => [moduleOf(p), p.id]));
	const consumed = new Set(Object.keys(out.ports));
	const problems = [];
	for (const m of consumed) if (!declared.has(m)) problems.push(`consumed but not declared in manifest: ${m}`);
	for (const [m, id] of declared) if (!consumed.has(m)) problems.push(`declared in manifest but never consumed: ${id} (${m})`);
	if (problems.length) {
		console.error('\nPORT SURFACE DRIFT:');
		for (const p of problems) console.error(`  - ${p}`);
		process.exitCode = 1;
	} else {
		console.log('\nPort surface check: PASS (manifest ports == consumed ports)');
	}
}
