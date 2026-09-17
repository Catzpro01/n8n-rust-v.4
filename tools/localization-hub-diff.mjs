#!/usr/bin/env node
/**
 * Phase 4G — Cross-branch localization hub diff (merge intelligence, not a merge).
 *
 * Two branches can each grow the localization line without seeing each other. This tool answers the
 * only questions that matter before merging them, with numbers instead of impressions:
 *
 *   1. locale sets   — does the other revision speak the same six languages?
 *   2. key sets      — which keys exist only there, only here, or on both sides?
 *   3. TEXT CONFLICT — overlapping keys whose texts differ (the only true blocker)
 *   4. surface gap   — which of their Phase 4B exports `src/index.ts` does not re-export yet
 *   5. file collision— files both branches changed against `--base`, i.e. manual merge work
 *   6. script names  — package.json script names that collide with a different command
 *
 * A *superset* catalogue is compatible by design (see `withoutCatalogueOwnedKeys()`): overlays fill
 * gaps, the catalogue owns its keys, and `catalogueOverlaps()` reports divergence for review. So the
 * verdict is `RECONCILIATION REQUIRED` only for text divergence or script-name clashes — growth is
 * not a conflict.
 *
 * usage:
 *   node tools/localization-hub-diff.mjs --their-ref <rev> [--base <rev>] [--json <path>] [--quiet]
 *   node tools/localization-hub-diff.mjs --their-ref <rev> --check      # exit 1 on a real conflict
 *
 * `--their-ref` must already be fetched locally (e.g. `git fetch origin <sha>`); the tool never
 * touches the network.
 *
 * exit: 0 = compatible (or report-only), 1 = conflict found (with `--check`) or unusable input
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVICE_PATH = 'packages/workflow-lego/src/backend-localization-service.ts';
const INDEX_PATH = 'packages/workflow-lego/src/index.ts';
const PACKAGE_PATH = 'package.json';
const DEFAULT_OUT = join(ROOT, 'docs', 'isolation', 'evidence', 'localization-hub-diff.json');

const argv = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(name);

const theirRef = flag('--their-ref');
const baseRef = flag('--base');
const OUT = flag('--json', DEFAULT_OUT);
const QUIET = has('--quiet');
const CHECK = has('--check');

if (!theirRef) {
	console.error('usage: node tools/localization-hub-diff.mjs --their-ref <rev> [--base <rev>] [--json <path>] [--check]');
	process.exit(2);
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

/* --- reading both sides ------------------------------------------------------------------ */

const theirSource = git('show', `${theirRef}:${SERVICE_PATH}`);
const theirPackage = JSON.parse(git('show', `${theirRef}:${PACKAGE_PATH}`));
const theirIndexSource = git('show', `${theirRef}:${INDEX_PATH}`);

const ours = {
	service: await import(join(ROOT, 'packages/workflow-lego/src/backend-localization-service.ts')),
	envelope: await import(join(ROOT, 'packages/workflow-lego/src/localization-envelope.ts')),
	vocabulary: await import(join(ROOT, 'packages/workflow-lego/src/localization-vocabulary.ts')),
};

/**
 * Promoted symbol names, read from the barrel's export blocks.
 *
 * `src/index.ts` re-exports the whole package, including modules that use the reference's
 * extension-less import style — Node cannot import the barrel directly, so the list is parsed the
 * same way gate check G8 does it.
 */
function parsePromoted(source) {
	const names = new Set();
	for (const block of source.matchAll(/export\s*\{([\s\S]*?)\}\s*from\s*'([^']+)'/g)) {
		for (const raw of block[1].split(',')) {
			const name = raw.trim().replace(/^type\s+/, '').trim();
			if (name) names.add(name);
		}
	}
	return names;
}
const ourPackage = JSON.parse(readFileSync(join(ROOT, PACKAGE_PATH), 'utf8'));
const ourIndexSource = readFileSync(join(ROOT, INDEX_PATH), 'utf8');

/* --- parsing the counterpart hub --------------------------------------------------------- */

/**
 * Extract `NATIVE_DICTIONARIES` from a localization-hub source: locale blocks at indentation 1,
 * quoted keys below them. Nested groups (the file's `MessageValue` allows them) are flattened with
 * a dot prefix, so `{ a: { b: 'x' } }` reports as `a.b`.
 */
function parseDictionaries(source) {
	const start = source.indexOf('export const NATIVE_DICTIONARIES');
	if (start < 0) throw new Error('NATIVE_DICTIONARIES not found in the counterpart hub');
	const rest = source.slice(start + 1);
	const end = rest.search(/^export const /m);
	const block = end < 0 ? rest : rest.slice(0, end);

	const locales = {};
	const stack = [];
	for (const line of block.split('\n')) {
		const locale = /^[\t ]{1,2}([a-z]{2}(?:-[A-Za-z]+)?):\s*\{/.exec(line);
		if (locale && stack.length === 0) {
			stack.push({ name: locale[1], depth: 1 });
			locales[locale[1]] = locales[locale[1]] ?? {};
			continue;
		}
		const nested = /^[\t ]+([A-Za-z_$][\w$]*|'[^']+'):\s*\{/.exec(line);
		const key = /^[\t ]+'(?:[^'\\]|\\.)*':\s*'(.*)'(?:,|\s)*$/.exec(line);
		if (key) {
			const prefix = stack.slice(1).map((s) => s.name).join('.');
			const name = /^[\t ]+'((?:[^'\\]|\\.)*)':/.exec(line)[1];
			locales[stack[0]?.name][prefix ? `${prefix}.${name}` : name] = key[1];
			continue;
		}
		if (nested && stack.length > 0) {
			stack.push({ name: nested[1].replace(/^'|'$/g, ''), depth: stack.length });
			continue;
		}
		if (/^[\t ]{1,3}\},?\s*$/.test(line) && stack.length > 1) stack.pop();
		else if (/^[\t ]{0,2}\},?\s*$/.test(line) && stack.length === 1) stack.pop();
	}
	return locales;
}

const their = {
	dictionaries: parseDictionaries(theirSource),
	values: Object.keys(theirPackage.scripts ?? {}),
};

const ourDictionaries = {};
for (const locale of Object.keys(ours.service.NATIVE_DICTIONARIES)) {
	ourDictionaries[locale] = {
		...(ours.service.NATIVE_DICTIONARIES[locale] ?? {}),
		...(ours.envelope.ENVELOPE_DICTIONARY_EXTENSION[locale] ?? {}),
		...(ours.vocabulary.PRODUCT_DICTIONARY_EXTENSION[locale] ?? {}),
	};
}

/* --- comparisons ------------------------------------------------------------------------- */

const theirLocales = Object.keys(their.dictionaries).sort();
const ourLocales = Object.keys(ourDictionaries).sort();

const theirKeys = new Set(Object.values(their.dictionaries).flatMap((d) => Object.keys(d)));
const ourKeys = new Set(Object.values(ourDictionaries).flatMap((d) => Object.keys(d)));

const onlyTheirs = [...theirKeys].filter((k) => !ourKeys.has(k)).sort();
const onlyOurs = [...ourKeys].filter((k) => !theirKeys.has(k)).sort();
const shared = [...theirKeys].filter((k) => ourKeys.has(k)).sort();

const conflicts = [];
let identicalPairs = 0;
for (const locale of ourLocales.filter((l) => theirLocales.includes(l))) {
	for (const key of shared) {
		const mine = ourDictionaries[locale]?.[key];
		const theirs = their.dictionaries[locale]?.[key];
		if (mine === undefined || theirs === undefined) continue;
		if (mine === theirs) identicalPairs++;
		else conflicts.push({ locale, key, ours: mine, theirs });
	}
}

// Surface gap: their 4B exports my `index.ts` does not re-export (the merge impact that is real but
// mechanical — see `docs/isolation/localization-hub-diff` evidence).
const theirExports = [...theirSource.matchAll(/^export (?:const|function|class) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
const ourPromoted = parsePromoted(ourIndexSource);
const unpromoted = theirExports.filter((name) => !ourPromoted.has(name)).sort();
const theirTypes = [...theirSource.matchAll(/^export (?:interface|type) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
const unpromotedTypes = theirTypes.filter((name) => !new RegExp(`\\b${name}\\b`).test(ourIndexSource)).sort();

const fileCollisions = (() => {
	if (!baseRef) return null;
	const changed = (rev) => new Set(git('diff', '--name-only', baseRef, rev).split('\n').filter(Boolean));
	const oursChanged = changed('HEAD');
	const theirsChanged = changed(theirRef);
	return [...oursChanged].filter((f) => theirsChanged.has(f)).sort();
})();

const scriptCollisions = Object.entries(theirPackage.scripts ?? {})
	.filter(([name, command]) => name in (ourPackage.scripts ?? {}) && ourPackage.scripts[name] !== command)
	.map(([name, command]) => ({ name, ours: ourPackage.scripts[name], theirs: command }))
	.sort((a, b) => a.name.localeCompare(b.name));

const conflictFree = conflicts.length === 0 && scriptCollisions.length === 0;

/* --- report ------------------------------------------------------------------------------ */

const report = {
	tool: 'localization-hub-diff',
	generatedAt: new Date().toISOString(),
	theirRef,
	ourRef: 'HEAD',
	baseRef: baseRef ?? null,
	locales: { ours: ourLocales, theirs: theirLocales },
	keys: {
		ours: { total: ourKeys.size, perLocale: Object.fromEntries(ourLocales.map((l) => [l, Object.keys(ourDictionaries[l]).length])) },
		theirs: { total: theirKeys.size, perLocale: Object.fromEntries(theirLocales.map((l) => [l, Object.keys(their.dictionaries[l]).length])) },
		onlyOurs,
		onlyTheirs,
		shared,
	},
	overlaps: {
		identicalPairs,
		conflicts,
	},
	surfaceGap: {
		unpromotedRuntimeSymbols: unpromoted,
		unpromotedTypeNames: unpromotedTypes,
	},
	fileCollisions,
	scriptCollisions,
	verdict: conflictFree ? 'COMPATIBLE' : 'RECONCILIATION REQUIRED',
	notes: [
		'A superset catalogue is compatible by design: overlays fill gaps, the catalogue owns its keys.',
		'`unpromotedRuntimeSymbols` is mechanical work, not a conflict — add them to the src/index.ts export block.',
		fileCollisions === null ? '`--base <rev>` was not given, so file-level collisions were not computed.' : 'fileCollisions lists files both branches changed: those need a human merge.',
	],
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, '\t')}\n`);

if (!QUIET) {
	const line = (label, value) => console.log(`${label.padEnd(26)} ${value}`);
	console.log('=== LOCALIZATION HUB DIFF ===');
	line('their ref', theirRef);
	line('locales', `${ourLocales.length} ours / ${theirLocales.length} theirs`);
	line('keys', `${ourKeys.size} ours / ${theirKeys.size} theirs / ${shared.length} shared`);
	line('value pairs', `${identicalPairs} identical / ${conflicts.length} divergent`);
	line('keys only here', onlyOurs.length === 0 ? '—' : onlyOurs.join(', '));
	line('keys only there', onlyTheirs.length === 0 ? '—' : onlyTheirs.join(', '));
	line('unpromoted runtime', unpromoted.length === 0 ? '—' : unpromoted.join(', '));
	line('unpromoted types', unpromotedTypes.length === 0 ? '—' : unpromotedTypes.join(', '));
	line('file collisions', fileCollisions === null ? 'not computed (no --base)' : fileCollisions.length === 0 ? '—' : fileCollisions.join(', '));
	line('script collisions', scriptCollisions.length === 0 ? '—' : scriptCollisions.map((s) => s.name).join(', '));
	line('verdict', report.verdict);
	for (const conflict of conflicts.slice(0, 10)) {
		console.log(`  CONFLICT ${conflict.locale} ${conflict.key}\n     ours  : ${JSON.stringify(conflict.ours)}\n     theirs: ${JSON.stringify(conflict.theirs)}`);
	}
	console.log(`evidence: ${OUT}`);
}

process.exit(CHECK && !conflictFree ? 1 : 0);
