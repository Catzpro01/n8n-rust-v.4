/**
 * Golden recorder — regenerates fixtures/data-proxy.golden.json from the PINNED
 * REFERENCE runtime, never from the reconstruction.
 *
 *   node packages/reconstructed-engine/test/helpers/record-golden.mjs
 *
 * Why the reference produces the goldens: a golden recorded from the code under
 * test is self-confirming — the failure mode ISSUE-017 records ("35 green
 * fixtures and a proven behavioural divergence coexist happily"). Recording from
 * n8n-workflow@2.9.1 / n8n-core@2.9.1 means the offline suite asserts n8n's
 * behaviour even where the runtime is not installed.
 *
 * Each record keeps its probe path (`_path`) so a consumer re-executes exactly
 * what was recorded; stringified keys are display-only.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	buildDataProxy,
	encodeArgs,
	buildExecuteContext,
	buildFixture,
	comparable,
	isDeclaredDeviation,
	loadCorpus,
	oracle,
	prepareDi,
	probeKey,
	serialize,
} from '../helpers/harness.mjs';
import { resolvePath } from '../helpers/serialize.mjs';

const encodeArgsPath = (path) =>
	path.map((step) => (typeof step === 'string' ? step : { '()': encodeArgs(step['()']) }));

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(PKG_DIR, 'fixtures');

const runtime = prepareDi(oracle());
const corpus = loadCorpus();

const referenceRootHash = (() => {
	try {
		const manifest = JSON.parse(
			readFileSync(
				resolve(PKG_DIR, '..', 'workflow-lego', 'manifest', 'reference.sha256.json'),
				'utf8',
			),
		);
		return manifest.rootHash ?? manifest.digest ?? null;
	} catch {
		return null;
	}
})();

const dataProxy = {};
for (const scenario of corpus.scenarios) {
	const fixture = buildFixture(scenario, runtime, 'reference');
	const proxy = buildDataProxy(fixture, runtime, 'reference');
	const probes = {};
	for (const path of scenario.probes) {
		probes[probeKey(path)] = { _path: path, ...(await comparable(proxy, path)) };
	}
	const deferred = {};
	if (scenario.name === corpus.scenarios[0].name) {
		for (const path of corpus.deferredProbes.probes) {
			deferred[probeKey(path)] = { _path: path, ...(await comparable(proxy, path)) };
		}
	}
	dataProxy[scenario.name] = {
		_why: scenario._why,
		probes,
		...(Object.keys(deferred).length ? { deferredProbes: deferred } : {}),
	};
}

const CONTEXT_METHOD_CALLS = [
	['getNode', []],
	['getMode', []],
	['getWorkflow', []],
	['getInputData', []],
	['getInputData', [0]],
	['getInputData', [1]],
	['getInputData', [9]],
	['getInputSourceData', []],
	['getInputSourceData', [0, 'main']],
	['continueOnFail', []],
	['getExecuteData', []],
	['getTimezone', []],
	['getWorkflowSettings', []],
	['getKnownNodeTypes', []],
	['getRestApiUrl', []],
	['getInstanceBaseUrl', []],
	['getExecutionContext', []],
	['getExecutionId', []],
	['getChatTrigger', []],
	['getWorkflowStaticData', ['']],
	['getParentNodes', ['Set']],
	['getChildNodes', ['Manual Trigger']],
	['getRunnerStatus', ['js']],
	['getNodeInputs', []],
	['getNodeOutputs', []],
	['isNodeFeatureEnabled', ['anything']],
	['setSignatureValidationRequired', []],
	['logNodeOutput', ['{"a":1}']],
	['logNodeOutput', ['not json']],
	['sendMessageToUI', ['hello']],
	['isToolExecution', []],
	['getParentCallbackManager', []],
	['addInputData', []],
	['addOutputData', []],
	['isStreaming', []],
	['sendResponse', [{ body: {} }]],
	['getCredentials', ['httpHeaderAuth', 0]],
	['getCredentialsProperties', ['httpHeaderAuth']],
	// The five the port does NOT implement. Recorded anyway so the oracle gate can
	// assert they are STILL deviations: an undeclared, silently-returning-undefined
	// accessor is the failure mode this package is most afraid of.
	['getInstanceId', []],
	['getSignedResumeUrl', []],
	['sendChunk', ['text', 0, 'hi']],
	['logAiEvent', ['x', 'y']],
	['getInputConnectionData', ['ai_tool', 0]],
];

const HOST_DEPENDENT_PROBES = new Set([
	'getNodeInputs()',
	'getNodeOutputs()',
	'isNodeFeatureEnabled("anything")',
	'getCredentials("httpHeaderAuth",0)',
]);

const contextMethods = {};
for (const scenario of corpus.contextScenarios) {
	const fixture = buildFixture(scenario, runtime, 'reference');
	const refCtx = buildExecuteContext(fixture, runtime, 'reference');

	const calls = CONTEXT_METHOD_CALLS.map(([method, args]) => [
		method,
		args.map((a) => (a === 'Set' && method === 'getParentNodes' ? fixture.node.name : a)),
	]);

	const results = {};
	for (const [method, args] of calls) {
		const key = `${method}(${args.map((a) => JSON.stringify(a) ?? 'undefined').join(',')})`;
		const path = [method, { '()': encodeArgs(args) }];
		results[key] = { _path: path, ...(await comparable(refCtx, [method, { '()': args }])) };
	}

	// Four of these probes reach through the host (NodeHelpers / the credential
	// registry), which the offline fixture deliberately does not model. Stamping them
	// lets test/04 compare fully when the oracle is installed and still assert "must
	// raise, never return a value" when it is not — so the gate degrades honestly
	// instead of either going red on an environment detail or going quiet on a real bug.
	for (const key of Object.keys(results)) {
		if (HOST_DEPENDENT_PROBES.has(key)) results[key]._oracleDependent = true;
		if (isDeclaredDeviation(key)) results[key]._deviation = true;
	}

	const prefix = ['getWorkflowDataProxy', { '()': [0] }];
	results['getWorkflowDataProxy(0).$json'] = {
		_path: [...encodeArgsPath(prefix), '$json'],
		...(await comparable(refCtx, [...prefix, '$json'])),
	};
	results['getWorkflowDataProxy(0).$node'] = {
		_path: [...encodeArgsPath(prefix), '$node', 'Manual Trigger', 'json'],
		...(await comparable(refCtx, [...prefix, '$node', 'Manual Trigger', 'json'])),
	};
	results['getNodeParameter("value",0)'] = {
		_path: ['getNodeParameter', { '()': encodeArgs(['value', 0, undefined, { skipValidation: true }]) }],
		...(await comparable(refCtx, [
			'getNodeParameter',
			{ '()': ['value', 0, undefined, { skipValidation: true }] },
		])),
	};
	results['evaluateExpression("{{ 1 + 1 }}")'] = {
		_path: ['evaluateExpression', { '()': ['{{ 1 + 1 }}'] }],
		...(await comparable(refCtx, ['evaluateExpression', { '()': ['{{ 1 + 1 }}'] }])),
	};
	results['prepareOutputData'] = {
		_path: [
			'prepareOutputData',
			{ '()': encodeArgs([[{ json: { a: 1 } }]]) },
		],
		...(await comparable(refCtx, [
			'prepareOutputData',
			{ '()': [[{ json: { a: 1 } }]] },
		])),
	};
	results['setMetadata+getExecuteData'] = {
		_skip: true,
		...(await (async () => {
			try {
				refCtx.setMetadata({ k: 'v' });
				return { ok: true, serialized: serialize(refCtx.getExecuteData().metadata) };
			} catch (error) {
				return { ok: false, error: { name: error?.name, message: error?.message } };
			}
		})()),
	};

	contextMethods[scenario.name] = { _why: scenario._why, results };
}

const out = {
	$generatedBy: 'packages/reconstructed-engine/test/helpers/record-golden.mjs',
	$source: 'pinned reference runtime — values were NOT produced by the reconstruction',
	$runtimeVersion: runtime.version,
	$referenceRootHash: referenceRootHash,
	$recordedAt: new Date().toISOString(),
	dataProxy,
	contextMethods,
};

mkdirSync(FIXTURES, { recursive: true });
writeFileSync(join(FIXTURES, 'data-proxy.golden.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(
	`wrote fixtures/data-proxy.golden.json (${Object.keys(dataProxy).length} proxy scenarios, ${Object.keys(contextMethods).length} context scenarios)`,
);

// n8n-core keeps a handle open (DI-provided logger). The recorder is a build-time
// script, so it exits explicitly rather than hanging the gate.
process.exit(0);
