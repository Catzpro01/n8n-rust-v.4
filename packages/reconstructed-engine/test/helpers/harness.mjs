/**
 * Test harness — runs the SAME probe against the pinned reference runtime and
 * against the reconstruction, and diffs the results.
 *
 * Shared-vs-owned:
 *   The Workflow object, the run data, the expression engine and the node
 *   definitions are IDENTICAL instances on both sides (they belong to the
 *   Workflow / Expression LEGOs, both VERIFIED). The only thing that differs is
 *   the code under test — so a difference is attributable, not ambiguous.
 *   Run data is deep-copied per side, because the reference's `getContext`
 *   mutates on read and the two sides must not contaminate each other.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { referenceRuntime, requireReferenceRuntime } from '../../src/reference-runtime.mjs';
import { WorkflowDataProxy as ReconstructedDataProxy } from '../../src/workflow-data-proxy.mjs';
import { ExecuteContext as ReconstructedExecuteContext } from '../../src/node-execution-context.mjs';
import { createRunExecutionData as myCreateRunExecutionData } from '../../src/run-execution-data.mjs';
import { getAdditionalKeys as myGetAdditionalKeys } from '../../src/additional-keys.mjs';
import { comparable, encodeArgs, probeKey, serialize } from './serialize.mjs';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_DIR = resolve(PKG_DIR, '..', '..');
const require = createRequire(import.meta.url);

export { comparable, encodeArgs, probeKey, serialize };

/**
 * The pinned reference tree hash (n8n 2.9.4 / commit b6dc2787c) recorded by the
 * Workflow LEGO's manifest. Every artifact this package generates stamps it, so
 * a reviewer can tell which tree a golden or a surface list was derived from.
 */
export function referenceRootHash() {
	try {
		const manifest = JSON.parse(
			readFileSync(resolve(PKG_DIR, '..', 'workflow-lego', 'manifest', 'reference.sha256.json'), 'utf8'),
		);
		return manifest.rootHash ?? manifest.digest ?? null;
	} catch {
		return null;
	}
}

export function oracle() {
	return requireReferenceRuntime('The reference runtime');
}

/**
 * n8n-core resolves InstanceSettings through the DI container, so the reference
 * ExecuteContext cannot even be constructed unless the container can answer.
 * A stub is installed once per process.
 */
export function prepareDi(runtime) {
	const fromRuntime = runtime.dir ? createRequire(join(runtime.dir, 'noop.js')) : require;
	const { Container } = fromRuntime('@n8n/di');
	const { InstanceSettings } = fromRuntime('@n8n/backend-common');
	try {
		Container.set(InstanceSettings, {
			instanceId: 'oracle-instance',
			hmacSignatureSecret: 'oracle',
			encryptionKey: 'oracle',
			isDocker: false,
			n8nFolder: PKG_DIR,
			n8nUserData: PKG_DIR,
		});
	} catch {
		/* already installed */
	}
	return runtime;
}

export function loadCorpus() {
	// Imported lazily so `import` of this module never depends on fs ordering.
	const { readFileSync } = require('node:fs');
	return JSON.parse(readFileSync(join(PKG_DIR, 'fixtures', 'corpus.json'), 'utf8'));
}

/**
 * A nodeTypes registry that returns `undefined` for every type. Not a shortcut:
 * `Workflow`'s constructor re-applies parameter defaults ONLY for known types
 * (workflow.ts:109-118) and would otherwise rewrite the parameters under test.
 */
const opaqueNodeTypes = {
	getByNameAndVersion: () => undefined,
	getKnownTypes: () => ({}),
};

/**
 * Builds one corpus scenario. `side` selects which implementation produces the
 * run data and the additional keys, so the factories themselves are under test.
 */
export function buildFixture(scenario, runtime, side) {
	const overrides = scenario.nodeOverrides ?? {}; // keyed by node NAME
	const nodes = Object.values(loadCorpus().nodes).map((node) => ({
		...structuredClone(node),
		...(overrides[node.name] ?? {}),
	}));

	const workflow = new runtime.workflow.Workflow({
		id: 'wf-oracle',
		name: 'reconstruction corpus workflow',
		nodes,
		connections: structuredClone(scenario.connections ?? {}),
		active: false,
		nodeTypes: opaqueNodeTypes,
		settings: structuredClone(scenario.settings ?? {}),
		pinData: scenario.pinData ? structuredClone(scenario.pinData) : undefined,
	});

	const createRunExecutionData =
		side === 'reference' ? runtime.workflow.createRunExecutionData : myCreateRunExecutionData;

	const runExecutionData = createRunExecutionData({
		resultData: { runData: structuredClone(scenario.runData ?? {}) },
		executionData: { contextData: structuredClone(scenario.contextData ?? {}) },
	});

	const activeNodeName = scenario.activeNodeName ?? nodes[0].name;
	const node = workflow.nodes[activeNodeName];
	const runIndex = scenario.runIndex ?? 0;
	const itemIndex = scenario.itemIndex ?? 0;
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
		currentNodeParameters: undefined,
		variables: { myVar: 'var-value' },
		webhookWaitingBaseUrl: 'http://localhost:5678/webhook-waiting',
		formWaitingBaseUrl: 'http://localhost:5678/form-waiting',
		restApiUrl: 'http://localhost:5678/api/v1/',
		instanceBaseUrl: 'http://localhost:5678',
		credentialsHelper: {},
		hooks: { handlers: {}, runHook: async () => {} },
		sendDataToUI: undefined,
		logAiEvent: async () => {},
		getRunExecutionData: async () => undefined,
	};

	const additionalKeys =
		side === 'reference'
			? runtime.core.getAdditionalKeys(additionalData, mode, runExecutionData)
			: myGetAdditionalKeys(additionalData, mode, runExecutionData);

	return {
		workflow,
		node,
		runExecutionData,
		executeData,
		connectionInputData,
		inputData,
		additionalData,
		additionalKeys,
		mode,
		runIndex,
		itemIndex,
		activeNodeName,
		siblingParameters: scenario.siblingParameters ?? {},
	};
}

export function buildDataProxy(fixture, runtime, side) {
	const args = [
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
	];

	if (side === 'reference') {
		return new runtime.workflow.WorkflowDataProxy(...args).getDataProxy();
	}
	return new ReconstructedDataProxy(...args, undefined, { luxon: runtime.luxon, jmespath: runtime.jmespath }).getDataProxy();
}

export function buildExecuteContext(fixture, runtime, side) {
	const ctxArgs = [
		fixture.workflow,
		fixture.node,
		fixture.additionalData,
		fixture.mode,
		fixture.runExecutionData,
		fixture.runIndex,
		fixture.connectionInputData,
		fixture.inputData,
		fixture.executeData,
		[], // closeFunctions
		undefined, // abortSignal
	];

	if (side === 'reference') {
		return new runtime.core.ExecuteContext(...ctxArgs);
	}
	return new ReconstructedExecuteContext(...ctxArgs, undefined, {
		nodeHelpers: runtime.workflow.NodeHelpers,
		luxon: runtime.luxon,
		jmespath: runtime.jmespath,
	});
}

/** Runs one probe path on both sides and returns the diff (empty array === parity). */
export async function compareProbes({ refRoot, myRoot, path }) {
	const ref = await compareSide(refRoot, path);
	const mine = await compareSide(myRoot, path);
	const diffs = [];

	if (ref.ok !== mine.ok) {
		diffs.push(`ok-mismatch: reference ok=${ref.ok}, reconstruction ok=${mine.ok}`);
	} else if (ref.ok) {
		if (ref.serialized !== mine.serialized) {
			diffs.push(
				`value-mismatch:\n    reference:      ${ref.serialized}\n    reconstruction: ${mine.serialized}`,
			);
		}
	} else if (JSON.stringify(ref.error) !== JSON.stringify(mine.error)) {
		diffs.push(
			`error-mismatch:\n    reference:      ${JSON.stringify(ref.error)}\n    reconstruction: ${JSON.stringify(mine.error)}`,
		);
	}
	return { ref, mine, diffs };
}

async function compareSide(root, path) {
	const result = await comparable(root, path);
	return result;
}

/** Probes the reference accepts and the reconstruction does not (declared deviations). */
/**
 * Symbols where the port deliberately differs from the reference. Kept EMPTY for
 * `sendChunk` / `logAiEvent`: both were listed here earlier in the task, and the
 * oracle gate turned out to agree with the reference exactly — a declaration that
 * stops being true is a documentation bug, so it was removed rather than left as a
 * permit. Anything added here must also appear in manifest/port-surface.json.
 */
export const DECLARED_DEVIATIONS = [
	'getInstanceId()',
	'getInputConnectionData("ai_tool",0)',
	'getSignedResumeUrl()',
];

export function isDeclaredDeviation(name) {
	return DECLARED_DEVIATIONS.some((d) => name === d || name.startsWith(`${d}.`));
}
