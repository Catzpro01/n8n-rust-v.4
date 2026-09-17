/**
 * Gate 10 — live equivalence with the reference (the oracle).
 *
 * `fixtures/data-proxy.golden.json` is what makes the gate runnable offline; THIS
 * file is what makes that goldens file trustworthy: it runs the same probes against
 * the installed n8n-workflow@2.9.1 / n8n-core@2.9.1 in the SAME process, with the
 * same Workflow fixture, the same run data and the same expression engine — the only
 * variable is whose `WorkflowDataProxy` / execute-context code is under test.
 *
 * If gate 04 and this gate ever disagree, the golden is stale (the runtime moved, or
 * someone edited fixtures/ by hand). That is a bug in the artifacts, not noise.
 *
 * Needs the oracle: `scripts/setup-reference-runtime.sh`. When it is absent this test
 * FAILS with instructions rather than skipping, because a silently-skipped
 * equivalence gate is indistinguishable from a passing one. Set
 * ENGINE_ALLOW_NO_ORACLE=1 to downgrade that to a loud diagnostic — that is what the
 * offline-only integration gate uses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
	DECLARED_DEVIATIONS,
	buildDataProxy,
	buildExecuteContext,
	buildFixture,
	compareProbes,
	loadCorpus,
	oracle,
	prepareDi,
	probeKey,
	referenceRootHash,
} from '../helpers/harness.mjs';

const PKG = resolve(import.meta.dirname, '..', '..');
const corpus = loadCorpus();
const golden = JSON.parse(readFileSync(join(PKG, 'fixtures', 'data-proxy.golden.json'), 'utf8'));

let runtime = null;
let oracleError = null;
try {
	runtime = prepareDi(oracle());
} catch (error) {
	oracleError = error;
}

function requireOracle(t) {
	if (runtime) return true;
	const message = `reference runtime unavailable — oracle equivalence NOT RUN (${String(oracleError?.message ?? oracleError).split('\n')[0]})
    install with: scripts/setup-reference-runtime.sh
    offline runs may set ENGINE_ALLOW_NO_ORACLE=1 to see this as a diagnostic instead`;
	if (process.env.ENGINE_ALLOW_NO_ORACLE === '1') {
		t.diagnostic(message);
		return false;
	}
	assert.fail(message);
}

const buildSide = (scenario, side, asContext = false) => {
	const fixture = buildFixture(scenario, runtime, side);
	return asContext ? buildExecuteContext(fixture, runtime, side) : buildDataProxy(fixture, runtime, side);
};

/** Every probe the goldens record, flattened to `{scenario, key, path, flags}`. */
const allProbes = [
	...corpus.scenarios.flatMap((scenario) =>
		scenario.probes.map((path) => ({
			kind: 'proxy',
			scenario: scenario.name,
			key: probeKey(path),
			path,
		})),
	),
	...corpus.contextScenarios.flatMap((scenario) =>
		Object.entries(golden.contextMethods[scenario.name].results).map(([key, record]) => ({
			kind: 'context',
			scenario: scenario.name,
			key,
			path: record._path,
			skip: Boolean(record._skip),
			oracleDependent: Boolean(record._oracleDependent),
		})),
	),
];

test('the oracle artifact is the pinned one', (t) => {
	if (!requireOracle(t)) return;
	assert.equal(
		runtime.version,
		golden.$runtimeVersion,
		`the installed runtime (${runtime.version}) is not what the goldens were recorded from (${golden.$runtimeVersion}); re-record with test/helpers/record-golden.mjs`,
	);
	const rootHash = referenceRootHash();
	if (rootHash && golden.$referenceRootHash) {
		assert.equal(golden.$referenceRootHash, rootHash, 'goldens were recorded against a different reference tree');
	}
});

test('goldens carry reference provenance, not self-grading', (t) => {
	requireOracle(t);
	assert.match(golden.$source, /reference/i, '$source must name the reference as the origin');
	// The provenance line states the negative outright ("values were NOT produced by the
	// reconstruction"), so match that sentence rather than a bare substring.
	assert.match(golden.$source, /NOT produced by the reconstruction/i);
});

test('the probe set in the goldens matches the corpus exactly', (t) => {
	requireOracle(t);
	const corpusKeys = new Set(allProbes.map((p) => `${p.kind}:${p.scenario}:${p.key}`));
	const goldenKeys = new Set();
	for (const [name, sc] of Object.entries(golden.dataProxy)) {
		for (const key of Object.keys(sc.probes)) goldenKeys.add(`proxy:${name}:${key}`);
	}
	for (const [name, sc] of Object.entries(golden.contextMethods)) {
		for (const key of Object.keys(sc.results)) goldenKeys.add(`context:${name}:${key}`);
	}
	assert.deepEqual(
		[...corpusKeys].sort(),
		[...goldenKeys].sort(),
		'the corpus grew or shrank without a re-record (run test/helpers/record-golden.mjs)',
	);
});

test('every probe is equivalent to the reference, or declared', async (t) => {
	if (!requireOracle(t)) return;
	const diffs = [];
	for (const probe of allProbes) {
		if (probe.skip) continue;
		const refRoot = buildSide(scenarioOf(probe), 'reference', probe.kind === 'context');
		const myRoot = buildSide(scenarioOf(probe), 'reconstruction', probe.kind === 'context');
		const { diffs: probeDiffs } = await compareProbes({ refRoot, myRoot, path: probe.path });
		if (!probeDiffs.length) continue;
		if (isDeclared(probe.key)) {
			t.diagnostic(`declared deviation: ${probe.scenario} :: ${probe.key}`);
			continue;
		}
		diffs.push(`  ${probe.kind} :: ${probe.scenario} :: ${probe.key}\n    ${probeDiffs.join('\n    ')}`);
	}
	assert.deepEqual(diffs, [], `\n${diffs.join('\n')}`);
});

function scenarioOf(probe) {
	return probe.kind === 'proxy'
		? corpus.scenarios.find((s) => s.name === probe.scenario)
		: corpus.contextScenarios.find((s) => s.name === probe.scenario);
}

const isDeclared = (key) => DECLARED_DEVIATIONS.some((d) => key === d || key.startsWith(`${d}.`));

/**
 * The declared deviations are the whole difference budget, so each must be REAL and
 * each must be COVERED. A deviation that quietly became equality means someone ported
 * the symbol and forgot to retire the note — that is how a manifest turns into fiction.
 */
test('declared deviations are covered and still deviations', async (t) => {
	if (!requireOracle(t)) return;
	const problems = [];
	for (const name of DECLARED_DEVIATIONS) {
		const probe = allProbes.find((p) => p.key === name && !p.skip);
		if (!probe) {
			problems.push(`${name}: declared as a deviation but no probe in the corpus exercises it`);
			continue;
		}
		const scenario = scenarioOf(probe);
		const refRoot = buildSide(scenario, 'reference', probe.kind === 'context');
		const myRoot = buildSide(scenario, 'reconstruction', probe.kind === 'context');
		const { diffs } = await compareProbes({ refRoot, myRoot, path: probe.path });
		if (!diffs.length) problems.push(`${name}: now matches the reference — retire the declaration (harness.mjs) and mark it ported in record-surface.mjs, then re-record`);
	}
	assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

test('manifest/port-surface.json is reproducible from this runtime', async (t) => {
	if (!requireOracle(t)) return;
	// Re-record into a throwaway copy: a test that rewrites tracked files would make
	// the working tree dirty every run, and "did it change because of the runtime or
	// because of the test?" is exactly the question this gate must answer.
	const dir = mkdtempSync(join(tmpdir(), 'engine-surface-'));
	try {
		cpSync(PKG, dir, { recursive: true, filter: (src) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(src) });
		const env = { ...process.env };
		delete env.NODE_OPTIONS;
		delete env.NODE_TEST_CONTEXT;
		env.LEGO_LIVE_RUNTIME ??= resolve(PKG, '..', '..', '.runtime');
		const result = spawnSync(process.execPath, ['test/helpers/record-surface.mjs'], {
			cwd: dir,
			encoding: 'utf8',
			timeout: 300_000,
			env,
		});
		assert.equal(result.status, 0, `record-surface failed in the copy:\n${result.stdout}\n${result.stderr}`);
		const normalize = (text) => {
			const parsed = JSON.parse(text);
			delete parsed.$recordedAt;
			// $referenceRootHash comes from packages/workflow-lego/manifest/, which a
			// /tmp copy does not have next to it — not evidence of drift.
			delete parsed.$referenceRootHash;
			return JSON.stringify(parsed, null, 2);
		};
		assert.equal(
			normalize(readFileSync(join(dir, 'manifest', 'port-surface.json'), 'utf8')),
			normalize(readFileSync(join(PKG, 'manifest', 'port-surface.json'), 'utf8')),
			'manifest/port-surface.json is stale against the installed runtime — re-record with test/helpers/record-surface.mjs',
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
