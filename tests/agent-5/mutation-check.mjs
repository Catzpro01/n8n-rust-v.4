#!/usr/bin/env node
/**
 * AGENT-5 · LEGO PERSISTENCE — mutation check for tools/localization-leak-gate.mjs
 *
 * A green gate is only evidence if the gate can go red. This script injects a
 * known defect into the reconstructed sources, re-runs the gate, and asserts
 * that the expected check FAILS. Every mutation is reverted afterwards, even
 * when the gate behaves unexpectedly.
 *
 * usage: node tests/agent-5/mutation-check.mjs
 * exit : 0 = every mutation was caught, 1 = at least one defect slipped through
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE = join(REPO, 'tools', 'localization-leak-gate.mjs');

const STORE = join(REPO, 'packages/reconstructed-engine/src/persistence-locale-store.ts');
const SETTINGS = join(REPO, 'packages/workflow-lego/src/settings-localization-adapter.ts');
const DIGEST = join(REPO, 'tools/model-digest-runner.cjs');

/** Each mutation must flip at least one of `expect` to FAIL. */
const MUTATIONS = [
	{
		id: 'M01-drop-arabic-key',
		why: 'a translation missing in one locale is the exact leak the rule forbids',
		file: STORE,
		from: "\t\t'execution.status.crashed': 'تعطل',\n",
		to: '',
		expect: ['G02', 'G07'],
	},
	{
		id: 'M02-latin-inside-chinese',
		why: 'untranslated English inside a Han string',
		file: STORE,
		from: "'execution.status.running': '运行中',",
		to: "'execution.status.running': 'Running中',",
		expect: ['G04', 'G06'],
	},
	{
		id: 'M03-placeholder-drift',
		why: 'a renamed {count} placeholder breaks interpolation in one locale only',
		file: STORE,
		from: "'Вы действительно хотите удалить выбранные выполнения ({count})?'",
		to: "'Вы действительно хотите удалить выбранные выполнения ({amount})?'",
		expect: ['G03'],
	},
	{
		id: 'M04-syntax-error',
		why: 'brokerage rule “no syntax error in the bundle” must be machine-enforced',
		file: DIGEST,
		from: '\n',
		to: '\nfunction ( { oops\n',
		expect: ['G01'],
		append: true,
	},
	{
		id: 'M05-rust-in-typescript',
		why: 'ZERO RUST — a Rust item inside the JS/TS reconstruction must be caught',
		file: STORE,
		from: 'export const PERSISTENCE_DEFAULT_LOCALE',
		to: 'pub fn main() {}\nexport const PERSISTENCE_DEFAULT_LOCALE',
		expect: ['G09'],
	},
	{
		id: 'M06-settings-locale-regression',
		why: 'the Phase-4A id/en-only settings regression must never come back',
		file: SETTINGS,
		from: "\t{ code: 'jv', label: 'Javanese', nativeName: 'Basa Jawa', direction: 'ltr' },\n",
		to: '',
		expect: ['G08'],
	},
	{
		id: 'M07-persistence-write-dropped',
		why: 'if the preference is never written, hydration silently falls back',
		file: STORE,
		from: '\t\t\tthis.storage.setItem(this.storageKey, locale);',
		to: '\t\t\t/* mutated: persistence dropped */',
		expect: ['G10'],
	},
];

const EVIDENCE = join(tmpdir(), 'localization-leak-gate.mutation.json');

function runGate() {
	rmSync(EVIDENCE, { force: true });
	const res = spawnSync(process.execPath, [GATE, '--json', EVIDENCE, '--quiet'], {
		cwd: REPO,
		encoding: 'utf8',
	});
	let evidence = { checks: [], summary: {} };
	try {
		evidence = JSON.parse(readFileSync(EVIDENCE, 'utf8'));
	} catch {
		/* the gate crashed before writing evidence — exit code still counts */
	}
	return { status: res.status ?? 1, evidence };
}

const results = [];

for (const mutation of MUTATIONS) {
	const original = readFileSync(mutation.file, 'utf8');
	if (!mutation.append && !original.includes(mutation.from)) {
		results.push({ ...mutation, caught: false, note: 'anchor text not found — mutation stale' });
		continue;
	}
	let mutated;
	if (mutation.append) {
		mutated = original + mutation.to;
	} else {
		mutated = original.replace(mutation.from, mutation.to);
	}
	if (mutated === original) {
		results.push({ ...mutation, caught: false, note: 'mutation did not change the file' });
		continue;
	}

	let outcome;
	try {
		writeFileSync(mutation.file, mutated, 'utf8');
		outcome = runGate();
	} finally {
		writeFileSync(mutation.file, original, 'utf8');
	}

	const failedIds = outcome.evidence.checks
		.filter((check) => check.status !== 'PASS')
		.map((check) => check.id);
	const caught = mutation.expect.some((id) => failedIds.includes(id)) && outcome.status !== 0;
	results.push({
		id: mutation.id,
		why: mutation.why,
		expected: mutation.expect,
		failedChecks: failedIds,
		gateExit: outcome.status,
		caught,
	});
}

const restored = spawnSync(process.execPath, [GATE, '--quiet'], { cwd: REPO, encoding: 'utf8' });

console.log('MUTATION CHECK — tools/localization-leak-gate.mjs');
for (const result of results) {
	const mark = result.caught ? '✓' : '✗';
	console.log(
		`${mark} ${result.id} — ${result.why}\n    expected ${JSON.stringify(result.expected)} · ` +
			`failed ${JSON.stringify(result.failedChecks ?? [])} · gate exit ${result.gateExit}` +
			(result.note ? ` · ${result.note}` : ''),
	);
}
const missed = results.filter((result) => !result.caught);
console.log(
	`\nMUTATION CHECK: ${results.length - missed.length}/${results.length} defects caught · ` +
		`restored tree gate exit ${restored.status} · VERDICT ${missed.length === 0 && restored.status === 0 ? 'PASS' : 'FAIL'}`,
);
process.exit(missed.length === 0 && restored.status === 0 ? 0 : 1);
