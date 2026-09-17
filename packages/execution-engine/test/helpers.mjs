/**
 * Fixtures shared by the execution-engine suites.
 * Node definitions are plain objects — no n8n runtime, no dependencies.
 */

import { NodeTypesRegistry, ReconstructedWorkflow, WorkflowExecute } from '../src/index.mjs';

export function node(name, type, parameters = {}, extra = {}) {
	return {
		name,
		type,
		typeVersion: 1,
		parameters,
		position: extra.position ?? [0, 0],
		disabled: extra.disabled ?? false,
		...extra,
	};
}

export function typeDefinition(name, { execute, trigger, poll, webhook, outputs, inputs, group = [], customOperations } = {}) {
	return {
		description: {
			name,
			group,
			inputs: inputs ?? ['main'],
			outputs: outputs ?? ['main'],
		},
		execute,
		trigger,
		poll,
		webhook,
		customOperations,
	};
}

export function createWorkflow({ nodes, connections = {}, settings = {}, nodeTypes = {} } = {}) {
	const registry = new NodeTypesRegistry();
	for (const [type, definition] of Object.entries(nodeTypes)) {
		registry.register(type, definition.version ?? 1, definition.definition ?? definition);
	}

	return new ReconstructedWorkflow({
		id: 'fixture-workflow',
		name: 'Fixture Workflow',
		nodes,
		connections,
		settings,
		nodeTypes: registry,
	});
}

/** Runs a workflow and returns the engine + the IRun-shaped result. */
export async function executeWorkflow(workflow, options = {}) {
	const engine = new WorkflowExecute(workflow, options.engineOptions ?? {});
	const run = await engine.run(options);
	return { engine, run };
}

/** Records the order in which lifecycle hooks fire. */
export function createRecordingHooks(order) {
	return {
		async runHook(name, args) {
			order.push({ name, node: typeof args?.[0] === 'string' ? args[0] : undefined });
		},
	};
}

export function itemsOf(run, nodeName, runIndex = 0, outputIndex = 0) {
	return run.data.resultData.runData[nodeName]?.[runIndex]?.data?.main?.[outputIndex];
}

export function taskOf(run, nodeName, runIndex = 0) {
	return run.data.resultData.runData[nodeName]?.[runIndex];
}
