#!/usr/bin/env node
/**
 * Workflow LEGO — kernel snapshot generator / drift gate.
 *
 * The isolated LEGO needs a handful of *values* even when the reference runtime
 * is absent (strict port mode): the connection-type vocabulary, the starting
 * node types and the renameable-content node sets.
 *
 * Those values are duplicated — but never hand-copied. This tool parses the
 * pinned reference sources, resolves the constant references and either:
 *   --write : regenerates packages/workflow-lego/src/kernel/snapshots.ts
 *   --check : fails if the committed snapshot differs from the reference
 *
 * Usage: node tools/workflow-kernel-conformance.mjs [--write|--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './workflow-boundary-map.mjs';

const SRC = join(REPO, 'reference/n8n/packages/workflow/src');
const OUT = join(REPO, 'packages/workflow-lego/src/kernel/snapshots.ts');

const constantsSrc = readFileSync(join(SRC, 'constants.ts'), 'utf8');
const interfacesSrc = readFileSync(join(SRC, 'interfaces.ts'), 'utf8');
const globalStateSrc = readFileSync(join(SRC, 'global-state.ts'), 'utf8');

/* ---------------- parse exported constants ---------------- */
const raw = new Map();
const declRe = /export const ([A-Z0-9_]+)\s*(?::[^=]+)?=\s*([\s\S]*?);\n/g;
let m;
while ((m = declRe.exec(constantsSrc)) !== null) raw.set(m[1], m[2].trim());

const str = (s) => {
	const mm = /^'([^']*)'$/.exec(s);
	return mm ? mm[1] : null;
};

const resolveValue = (expr, depth = 0) => {
	if (depth > 10) return null;
	const direct = str(expr);
	if (direct !== null) return direct;

	// array: [A, B, C]
	const arr = /^\[([\s\S]*)\]$/.exec(expr);
	if (arr) {
		const parts = arr[1]
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		return parts.map((p) => {
			const s = str(p);
			if (s !== null) return s;
			if (raw.has(p)) return resolveValue(raw.get(p), depth + 1);
			return `UNRESOLVED(${p})`;
		});
	}

	// new Set([...])  /  new Set([...] as const) etc.
	const set = /^new Set\(\s*\[([\s\S]*?)\]\s*\)$/.exec(expr);
	if (set) {
		const items = set[1]
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map((p) => {
				const s = str(p);
				if (s !== null) return s;
				if (raw.has(p)) return resolveValue(raw.get(p), depth + 1);
				return `UNRESOLVED(${p})`;
			});
		return items;
	}

	if (raw.has(expr)) return resolveValue(raw.get(expr), depth + 1);
	return `UNRESOLVED(${expr})`;
};

const need = [
	'STARTING_NODE_TYPES',
	'MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE',
	'NODES_WITH_RENAMABLE_CONTENT',
	'NODES_WITH_RENAMABLE_FORM_HTML_CONTENT',
	'NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT',
];
const resolved = {};
for (const name of need) {
	if (!raw.has(name)) throw new Error(`constant ${name} not found in reference constants.ts`);
	resolved[name] = resolveValue(raw.get(name));
	for (const v of Array.isArray(resolved[name]) ? resolved[name] : [resolved[name]]) {
		if (typeof v === 'string' && v.startsWith('UNRESOLVED')) throw new Error(`${name}: ${v}`);
	}
}

/* ---------------- parse NodeConnectionTypes ---------------- */
const nctMatch = /export const NodeConnectionTypes = \{([\s\S]*?)\} as const;/.exec(interfacesSrc);
if (!nctMatch) throw new Error('NodeConnectionTypes not found in reference interfaces.ts');
const nodeConnectionTypes = {};
for (const line of nctMatch[1].split('\n')) {
	const kv = /^\s*([A-Za-z0-9_]+):\s*'([^']*)',?\s*$/.exec(line);
	if (kv) nodeConnectionTypes[kv[1]] = kv[2];
}

/* ---------------- parse default timezone ---------------- */
const tz = /let globalState: GlobalState = \{ defaultTimezone: '([^']+)' \}/.exec(globalStateSrc);
if (!tz) throw new Error('default timezone not found in global-state.ts');

/* ---------------- emit ---------------- */
const q = (s) => `'${String(s).replace(/'/g, "\\'")}'`;
const setLiteral = (items, indent = '\t') =>
	`new Set<string>([\n${items.map((i) => `${indent}${q(i)},`).join('\n')}\n])`;

const generated = `/**
 * Kernel snapshots — values the LEGO needs even when the reference runtime is
 * absent (strict port mode).
 *
 * GENERATED FILE — do not edit by hand.
 *   generator : tools/workflow-kernel-conformance.mjs
 *   source    : reference/n8n/packages/workflow/src (n8n 2.9.4, commit b6dc2787c45677a29a9612cd27eb911302961a83)
 *   verify    : node tools/workflow-kernel-conformance.mjs --check
 *
 * These are the only duplicated values in the isolation layer. The drift gate
 * re-parses the reference source and fails when they diverge.
 */

/** from src/interfaces.ts — \`NodeConnectionTypes\` */
export const NODE_CONNECTION_TYPES = {
${Object.entries(nodeConnectionTypes)
	.map(([k, v]) => `\t${k}: ${q(v)},`)
	.join('\n')}
} as const;

/** from src/constants.ts — \`STARTING_NODE_TYPES\` (references resolved) */
export const STARTING_NODE_TYPES: string[] = [
${resolved.STARTING_NODE_TYPES.map((i) => `\t${q(i)},`).join('\n')}
];

/** from src/constants.ts */
export const MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE = ${q(resolved.MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE)};

/** from src/constants.ts */
export const NODES_WITH_RENAMABLE_CONTENT = ${setLiteral(resolved.NODES_WITH_RENAMABLE_CONTENT)};

/** from src/constants.ts */
export const NODES_WITH_RENAMABLE_FORM_HTML_CONTENT = ${setLiteral(resolved.NODES_WITH_RENAMABLE_FORM_HTML_CONTENT)};

/** from src/constants.ts */
export const NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT = ${setLiteral(resolved.NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT)};

/** from src/global-state.ts — initial value of \`globalState.defaultTimezone\` */
export const DEFAULT_TIMEZONE = ${q(tz[1])};
`;

const args = process.argv.slice(2);
if (args.includes('--write')) {
	writeFileSync(OUT, generated);
	console.log(`wrote ${OUT}`);
	console.log(`  STARTING_NODE_TYPES            : ${resolved.STARTING_NODE_TYPES.length} entries`);
	console.log(`  NODES_WITH_RENAMABLE_CONTENT   : ${resolved.NODES_WITH_RENAMABLE_CONTENT.length} entries`);
	console.log(`  NodeConnectionTypes            : ${Object.keys(nodeConnectionTypes).length} entries`);
	console.log(`  defaultTimezone                : ${tz[1]}`);
} else if (args.includes('--check')) {
	let committed = '';
	try {
		committed = readFileSync(OUT, 'utf8');
	} catch {
		console.error(`MISSING ${OUT} — run: node tools/workflow-kernel-conformance.mjs --write`);
		process.exitCode = 1;
	}
	if (committed && committed !== generated) {
		console.error('KERNEL SNAPSHOT DRIFT: packages/workflow-lego/src/kernel/snapshots.ts differs from the reference source.');
		console.error('Regenerate with: node tools/workflow-kernel-conformance.mjs --write');
		const c = committed.split('\n');
		const g = generated.split('\n');
		for (let i = 0; i < Math.max(c.length, g.length); i++) {
			if (c[i] !== g[i]) console.error(`  line ${i + 1}:\n    committed: ${c[i]}\n    reference: ${g[i]}`);
		}
		process.exitCode = 1;
	} else if (committed) {
		console.log('Kernel snapshot check: PASS (snapshots match the pinned reference source)');
	}
} else {
	console.log(JSON.stringify({ nodeConnectionTypes, resolved, defaultTimezone: tz[1] }, null, 2));
}
