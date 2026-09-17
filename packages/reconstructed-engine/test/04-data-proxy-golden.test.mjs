/**
 * Gate 04 — data-proxy + node-context against the reference-recorded goldens.
 *
 * fixtures/data-proxy.golden.json is recorded from n8n-workflow@2.9.1 /
 * n8n-core@2.9.1 by test/helpers/record-golden.mjs, so this file asserts
 * n8n 2.9.4 behaviour with NO runtime installed. The live oracle
 * (test/oracle/10-reference-equivalence.test.mjs) re-derives the same probes
 * from the runtime and must agree; if the two ever disagree, the golden is stale.
 *
 * Offline caveat, stated rather than hidden: this file drives a WorkflowStub
 * (test/helpers/workflow-stub.mjs) instead of the real Workflow, because the
 * stub throws on anything it does not model. A stub bug therefore shows up as a
 * FAILURE here, never as a false pass, and is additionally caught by the oracle
 * test which uses the real Workflow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WorkflowDataProxy } from '../src/workflow-data-proxy.mjs';
import { ExecuteContext } from '../src/node-execution-context.mjs';
import { createRunExecutionData, getContext } from '../src/run-execution-data.mjs';
import { getAdditionalKeys } from '../src/additional-keys.mjs';
import { WorkflowStub } from './helpers/workflow-stub.mjs';
import { referenceRuntime } from '../src/reference-runtime.mjs';
import { comparable } from './helpers/serialize.mjs';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(PKG_DIR, p), 'utf8'));
const golden = readJson('fixtures/data-proxy.golden.json');
const corpus = readJson('fixtures/corpus.json');

/**
 * Whether the oracle is installed decides only HOW host-dependent probes are
 * asserted (full comparison vs "must raise"); see test/04's node-context loop.
 */
const oracleAvailable = Boolean(referenceRuntime());

/** Same fixture shape the oracle harness builds, with the stub as the host. */
function build(scenario) {
	const overrides = scenario.nodeOverrides ?? {}; // keyed by node NAME
	const nodes = Object.values(corpus.nodes).map((node) => ({
		...structuredClone(node),
		...(overrides[node.name] ?? {}),
	}));

	const workflow = new WorkflowStub({
		nodes,
		connections: structuredClone(scenario.connections ?? {}),
		settings: structuredClone(scenario.settings ?? {}),
		pinData: scenario.pinData ? structuredClone(scenario.pinData) : undefined,
		name: 'reconstruction corpus workflow',
	});

	const runExecutionData = createRunExecutionData({
		resultData: { runData: structuredClone(scenario.runData ?? {}) },
		executionData: { contextData: structuredClone(scenario.contextData ?? {}) },
	});

	const activeNodeName = scenario.activeNodeName ?? nodes[0].name;
	const node = workflow.nodes[activeNodeName];
	const mode = scenario.mode ?? 'manual';
	const connectionInputData = structuredClone(scenario.connectionInputData ?? []);
	const inputData = scenario.inputData
		? structuredClone(scenario.inputData)
		: { main: [connectionInputData] };
	const executeData = scenario.executeData
		? { ...structuredClone(scenario.executeData), node }
		: { node, data: { main: [connectionInputData] }, source: null };

	const additionalData = {
		executionId: 'exec-oracle-1',
		variables: { myVar: 'var-value' },
		webhookWaitingBaseUrl: 'http://localhost:5678/webhook-waiting',
		formWaitingBaseUrl: 'http://localhost:5678/form-waiting',
		restApiUrl: 'http://localhost:5678/api/v1/',
		instanceBaseUrl: 'http://localhost:5678',
		credentialsHelper: {},
		hooks: { handlers: {}, runHook: async () => {} },
		logAiEvent: async () => {},
		getRunExecutionData: async () => undefined,
	};

	return {
		workflow,
		node,
		runExecutionData,
		executeData,
		connectionInputData,
		inputData,
		additionalData,
		additionalKeys: getAdditionalKeys(additionalData, mode, runExecutionData),
		mode,
		runIndex: scenario.runIndex ?? 0,
		itemIndex: scenario.itemIndex ?? 0,
		activeNodeName,
		siblingParameters: scenario.siblingParameters ?? {},
	};
}

/** jmespath arrives through the same seam the reference runtime is loaded from (null offline). */
const injectedJmespath = () => referenceRuntime()?.jmespath;

const proxyUnderTest = (fixture, deps = { jmespath: injectedJmespath() }) =>
	new WorkflowDataProxy(
		fixture.workflow,
		fixture.runExecutionData,
		fixture.runIndex,
		fixture.itemIndex,
		fixture.activeNodeName,
		fixture.connectionInputData,
		fixture.siblingParameters,
		fixture.mode,
		fixture.additionalKeys,
		fixture.executeData,
		-1,
		{},
		fixture.activeNodeName,
		// The 15th argument is this port's injection seam. jmespath is passed when the
		// host has it (the reference imports it directly, so the golden's side always did);
		// with no runtime installed the probes above fall back to "must raise" instead.
		// luxon is deliberately NOT injected here: gate 04 grades the data proxy without a
		// date provider, and gate 10 is where luxon-backed probes are compared.
		undefined,
		deps,
	).getDataProxy();

const contextUnderTest = (fixture) =>
	new ExecuteContext(
		fixture.workflow,
		fixture.node,
		fixture.additionalData,
		fixture.mode,
		fixture.runExecutionData,
		fixture.runIndex,
		fixture.connectionInputData,
		fixture.inputData,
		fixture.executeData,
		[],
		undefined,
	);

test('goldens carry reference provenance', () => {
	assert.match(golden.$source, /NOT produced by the reconstruction/);
	assert.equal(golden.$runtimeVersion, '2.9.1', 'goldens must come from the n8n 2.9.4 dependency set');
	assert.ok(golden.$recordedAt, 'goldens must record when they were taken');
});

test('the corpus and the golden cover exactly the same probes', () => {
	// A probe added to the corpus without re-recording the golden must fail here,
	// otherwise the gate would silently test less than the corpus claims.
	for (const scenario of corpus.scenarios) {
		const want = Object.keys(golden.dataProxy[scenario.name].probes).sort();
		const mine = scenario.probes.map((path) => probeKeyOf(path)).sort();
		assert.deepEqual(mine, want, `probe set drift in scenario ${scenario.name}`);
	}
	const deferred = Object.keys(golden.dataProxy[corpus.scenarios[0].name].deferredProbes).sort();
	assert.deepEqual(
		corpus.deferredProbes.probes.map((path) => probeKeyOf(path)).sort(),
		deferred,
		'deferred probe set drift',
	);
});

const probeKeyOf = (path) =>
	path
		.map((step) =>
			typeof step === 'string'
				? step
				: `(${(step['()'] ?? []).map((a) => JSON.stringify(a) ?? 'undefined').join(',')})`,
		)
		.join('.');

for (const scenario of corpus.scenarios) {
	test(`data-proxy :: ${scenario.name}`, async (t) => {
		const fixture = build(scenario);
		const proxy = proxyUnderTest(fixture);
		const expected = golden.dataProxy[scenario.name].probes;

		const diffs = [];
		let injectedOnly = 0;
		for (const [name, want] of Object.entries(expected)) {
			if (want._oracleDependent && !oracleAvailable) {
				// The golden's value for this probe needs a capability the HOST injects
				// (jmespath for $jmesPath/$jmespath, the credential registry for others).
				// Offline the port has nothing to delegate to, so the assertion that remains
				// true — and is enforced — is that it raises instead of answering.
				const actual = await comparable(proxy, want._path);
				if (actual.ok) {
					diffs.push(
						`  ${name} (needs an injected capability)\n    returned ${actual.serialized} with no host to delegate to — it must raise`,
					);
				}
				injectedOnly++;
				continue;
			}
			const actual = await comparable(proxy, want._path);
			if (JSON.stringify(strip(want)) !== JSON.stringify(actual)) {
				diffs.push(
					`  ${name}\n    n8n 2.9.4 (golden): ${JSON.stringify(strip(want))}\n    reconstruction    : ${JSON.stringify(actual)}`,
				);
			}
		}
		assert.deepEqual(diffs, [], `\n${diffs.join('\n')}`);
		if (injectedOnly) {
			t.diagnostic(
				`${injectedOnly} probe(s) graded as must-raise only (needs a host-injected capability, and no reference runtime is installed)`,
			);
		}
	});
}

for (const scenario of corpus.contextScenarios) {
	test(`node-context :: ${scenario.name}`, async (t) => {
		const fixture = build(scenario);
		const ctx = contextUnderTest(fixture);
		const expected = golden.contextMethods[scenario.name].results;

		const diffs = [];
		let hostOnly = 0;
		for (const [name, want] of Object.entries(expected)) {
			if (want._skip) continue; // recorded by the reference, asserted by the dedicated checks below
			if (want._deviation) {
				// Declared NOT-PORTED surface (see manifest/port-surface.json → deferred[]):
				// the reference value is unattainable by design, so what is asserted here is
				// "the port raises, loudly" — gate 10 asserts the reference still differs.
				const actual = await comparable(ctx, want._path);
				if (actual.ok) {
					diffs.push(
						`  ${name} (declared deviation)\n    the port returned ${actual.serialized} for a symbol declared NOT ported — it must raise NotPortedError`,
					);
				} else if (actual.error?.name !== 'NotPortedError') {
					diffs.push(
						`  ${name} (declared deviation)\n    expected NotPortedError, got ${actual.error?.name}: ${actual.error?.message}`,
					);
				}
				continue;
			}
			if (want._oracleDependent && !oracleAvailable) {
				// The reference value for this probe is produced by the HOST (NodeHelpers,
				// credential registry), so it is not comparable offline. What IS always
				// true is that a missing host capability must raise, not answer undefined.
				const actual = await comparable(ctx, want._path);
				if (actual.ok) {
					diffs.push(
						`  ${name} (host-dependent)\n    returned ${actual.serialized} where the port has nothing to delegate to — it must raise`,
					);
				}
				hostOnly++;
				continue;
			}
			const actual = await comparable(ctx, want._path);
			if (JSON.stringify(strip(want)) !== JSON.stringify(actual)) {
				diffs.push(
					`  ${name}\n    n8n 2.9.4 (golden): ${JSON.stringify(strip(want))}\n    reconstruction    : ${JSON.stringify(actual)}`,
				);
			}
		}
		if (hostOnly) t.diagnostic(`${hostOnly} host-dependent probe(s) checked as "must raise" only (oracle not installed)`);
		// setMetadata+getExecuteData has no probe path: it is checked by the test below.
		assert.deepEqual(diffs, [], `\n${diffs.join('\n')}`);

		// Reference: setMetadata merges into executeData.metadata (base-execute-context.ts:66)
		const fresh = contextUnderTest(build(scenario));
		fresh.setMetadata({ a: 1 });
		fresh.setMetadata({ b: 2, a: 3 });
		assert.deepEqual(fresh.getExecuteData().metadata, { a: 3, b: 2 });
	});
}

/** Golden bookkeeping (`_path` drives the probe, `_oracleDependent` how it is judged)
 * is metadata about the record, not part of the compared value. */
const strip = ({ _path, _oracleDependent, ...rest }) => rest;

test('deferred symbols fail loudly instead of returning a value', async () => {
	const scenario = corpus.scenarios[0];
	const fixture = build(scenario);
	const proxy = proxyUnderTest(fixture);

	// Every probe listed as deferred must NOT silently return a value. Where n8n
	// itself returns undefined, matching it is fine — anything else is a gap.
	const reference = golden.dataProxy[scenario.name].deferredProbes ?? {};
	for (const path of corpus.deferredProbes.probes) {
		const key = probeKeyOf(path);
		const actual = await comparable(proxy, path);
		const want = reference[key];
		if (!actual.ok) {
			assert.equal(
				actual.error.name,
				'NotPortedError',
				`${key}: deferred symbols must throw NotPortedError, got ${actual.error?.name}`,
			);
			continue;
		}
		assert.ok(
			want && want.ok && want.serialized === actual.serialized,
			`${key}: returned a value (${actual.serialized}) that the reference does not produce (${JSON.stringify(want)})`,
		);
	}
});

test('getContext mirrors the reference mutation-on-read', () => {
	const runExecutionData = createRunExecutionData({ executionData: { contextData: {} } });
	assert.deepEqual(Object.keys(runExecutionData.executionData.contextData), []);
	const ctx = getContext(runExecutionData, 'node', { name: 'Set' });
	assert.deepEqual(Object.keys(runExecutionData.executionData.contextData), ['node:Set']);
	assert.equal(ctx, runExecutionData.executionData.contextData['node:Set'], 'same object identity');
	assert.throws(() => getContext(runExecutionData, 'bogus', { name: 'Set' }), /Unknown context type/);
	assert.throws(() => getContext(runExecutionData, 'node'), /the node parameter has to be set/);
	assert.deepEqual(Object.keys(getContext(runExecutionData, 'flow')), []);
});

test('$jmesPath hands jmespath a copy of the object, and the array case verbatim', () => {
	// Offline by design: a fake `jmespath` stands in for the host module, so this pins the
	// wrapper's two quirks even where no reference runtime exists to compare against.
	const scenario = corpus.scenarios.find((entry) => entry.name === 'jmespath-accessor');
	assert.ok(scenario, 'the corpus lost the jmespath scenario');
	const fixture = build(scenario);
	const seen = [];
	const fake = {
		// A stand-in that behaves like the real thing in the one way that matters: jmespath
		// stamps `__ident__` onto the objects it walks, i.e. it mutates its input.
		search(data, query) {
			// Snapshot BEFORE mutating: the assertions below are about what the wrapper
			// handed over, and a live reference would show this function's own mutation.
			seen.push({
				isArray: Array.isArray(data),
				keys: Object.keys(data),
				identity: data === stampSource,
				query,
			});
			if (Array.isArray(data)) data.push('mutated');
			else data.__ident__ = 'stamped';
			return null;
		},
	};
	const proxy = proxyUnderTest(fixture, { jmespath: fake });
	let stampSource = { foo: 'bar' };

	proxy.$jmesPath(stampSource, 'foo');
	assert.deepEqual(
		seen[0],
		{ isArray: false, keys: ['foo'], identity: false, query: 'foo' },
		'jmespath must receive a fresh copy, never the caller object',
	);
	assert.deepEqual(stampSource, { foo: 'bar' }, 'the caller object must not be the one jmespath walks');
	assert.ok(!('__ident__' in stampSource), 'engine bookkeeping leaked into user data');

	// Arrays are NOT copied by the reference (workflow-data-proxy.ts:770-774) — asserting
	// that asymmetry is the point: it is what makes this a real port and not a re-invention.
	const arr = [{ json: { a: 1 } }];
	stampSource = arr;
	proxy.$jmesPath(arr, '[*].json.a');
	assert.equal(seen[1].isArray, true);
	assert.equal(seen[1].identity, true, 'the array must reach jmespath by identity');
	assert.deepEqual(arr, [{ json: { a: 1 } }, 'mutated'], 'a copy here would hide the mutation');

	// $jmespath (lowercase alias) reaches the same wrapper — reference registers both.
	stampSource = { foo: 'bar' };
	proxy.$jmespath(stampSource, 'foo');
	assert.equal(seen.length, 3);
});

test('$jmesPath validates its arguments before touching the injected module', () => {
	const scenario = corpus.scenarios.find((entry) => entry.name === 'jmespath-accessor');
	const fixture = build(scenario);
	// No jmespath at all: the arity/type guard must still fire first, with the reference's
	// message and its runIndex/itemIndex details, exactly as workflow-data-proxy.ts:764-769.
	const proxy = proxyUnderTest(fixture, {});
	for (const bad of [
		['not-an-object', 'a'],
		[{ a: 1 }, 5],
		[{ a: 1 }],
		// NOT in this list on purpose: `typeof null === 'object'`, so null passes the guard and
		// the reference spreads it to `{}` and answers — pinned by the golden probe
		// `$jmesPath.(null,"a")` instead, because it is a value, not a raise.
	]) {
		let thrown;
		try {
			proxy.$jmesPath(...bad);
		} catch (error) {
			thrown = error;
		}
		assert.ok(thrown, `$jmesPath(${bad.map((b) => JSON.stringify(b)).join(', ')}) must raise`);
		assert.equal(thrown.name, 'ExpressionError');
		assert.equal(thrown.message, 'expected two arguments (Object, string) for this function');
		// The reference passes { runIndex, itemIndex } into WorkflowErrorOptions, and the
		// base class consumes them without re-exposing them: both sides own `details` and
		// `extra` as undefined. Probing that here is what stops a well-meant "improvement"
		// (surfacing the indices) from silently becoming a deviation.
		for (const key of ['details', 'extra', 'runIndex', 'itemIndex']) {
			assert.equal(thrown[key], undefined, `ExpressionError.${key} must stay unset, as in n8n 2.9.4`);
		}
	}
	// A *valid* call with no module is the one case that says "not ported" — loudly, never undefined.
	assert.throws(() => proxy.$jmesPath({ a: 1 }, 'a'), /NotPortedError/);
});
