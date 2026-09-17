#!/usr/bin/env node
/**
 * Agent 5 — Zero Cross-Language Leak gate for the reconstructed engine.
 *
 * Scans every TypeScript module in `packages/reconstructed-engine/src/`, extracts
 * locale-shaped exports (`{ [locale]: { [key]: string } }`) and reports where a UI
 * string leaks across languages: missing keys, untranslated (identical prose) and
 * blank values.
 *
 *   node audit-locales.mjs            # regenerate docs/isolation/evidence/locale-leak-audit.json
 *   node audit-locales.mjs --check    # exit 1 if the audit drifted from the frozen evidence
 *   node audit-locales.mjs --strict   # exit 1 if any leak exists (merge-blocking)
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditLocaleDictionaries } from './src/universal-locale-enforcer.ts';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, 'src');
const evidence = resolve(here, '../../docs/isolation/evidence/locale-leak-audit.json');
const check = process.argv.includes('--check');
const strict = process.argv.includes('--strict');

const files = readdirSync(srcDir)
	.filter((f) => f.endsWith('.ts'))
	.sort();

const modules = {};
for (const f of files) {
	modules[f.replace(/\.ts$/, '')] = await import(pathToFileURL(join(srcDir, f)).href);
}

const report = auditLocaleDictionaries(modules);
report.generatedAt = new Date().toISOString();
report.modules = files.length;

const out = JSON.stringify(report, null, 2);

if (check) {
	if (!existsSync(evidence)) {
		console.error(`[FAIL] frozen evidence missing: ${evidence}`);
		process.exit(1);
	}
	const frozen = JSON.parse(readFileSync(evidence, 'utf8'));
	const drift =
		frozen.totals.findings !== report.totals.findings ||
		frozen.totals.dictionaries !== report.totals.dictionaries ||
		frozen.totals.keys !== report.totals.keys;
	if (drift) {
		console.error(
			`[FAIL] locale audit drifted: frozen ${JSON.stringify(frozen.totals)} vs now ${JSON.stringify(report.totals)}`,
		);
		process.exit(1);
	}
	console.log('[PASS] locale audit matches frozen evidence');
} else {
	mkdirSync(dirname(evidence), { recursive: true });
	writeFileSync(evidence, out + '\n');
	console.log(`wrote ${evidence}`);
}

for (const d of report.dictionaries) {
	console.log(
		`  ${d.clean ? 'clean ' : 'LEAK  '} ${d.name} — ${d.locales.join(',')} — keys ${JSON.stringify(d.keyCount)}` +
			` — missing ${d.missingKeys.length}, untranslated ${d.untranslated.length}, blank ${d.blankValues.length}`,
	);
}
console.log(
	`\ntotals: ${report.totals.dictionaries} dictionaries, ${report.totals.locales} locales, ` +
		`${report.totals.keys} keys, ${report.totals.findings} finding(s)`,
);

if (strict && !report.clean) {
	console.error('\n[FAIL] cross-language leak present (--strict)');
	process.exit(1);
}
process.exit(0);
