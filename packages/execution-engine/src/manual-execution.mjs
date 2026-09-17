/**
 * ManualExecutionService — orchestrates manual and partial workflow executions.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/cli/src/manual-execution.service.ts
 *     - getExecutionStartNode
 *     - runManually
 */

import assert from 'node:assert/strict';
import { createRunExecutionData } from './run-execution-data.mjs';
import { WorkflowExecute } from './workflow-execute.mjs';
import {
	DirectedGraph,
	TOOL_EXECUTOR_NODE_NAME,
	filterDisabledNodes,
	isTool,
	recreateNodeExecutionStack,
	rewireGraph,
} from './partial-execution.mjs';

export class ManualExecutionService {
	constructor(logger, options = {}) {
		this.logger = logger ?? { debug() {}, info() {}, warn() {}, error() {} };
		this.workflowExecuteFactory =
			options.workflowExecuteFactory ??
			((additionalData, mode, executionData) =>
				new WorkflowExecute(additionalData, mode, executionData));
	}

	getExecutionStartNode(data, workflow) {
		let startNode;

		// If the user chose a trigger to start from we honor this.
		if (data?.triggerToStartFrom?.name) {
			startNode = workflow.getNode(data.triggerToStartFrom.name) ?? undefined;
		}

		// Old logic for partial executions v1
		if (
			data?.startNodes?.length === 1 &&
			Object.keys(data.pinData ?? {}).includes(data.startNodes[0].name)
		) {
			startNode = workflow.getNode(data.startNodes[0].name) ?? undefined;
		}

		return startNode;
	}

	async runManually(
		data,
		workflow,
		additionalData,
		executionId,
		pinData,
	) {
		if (data.triggerToStartFrom?.data && data.startNodes?.length) {
			this.logger.debug(
				`Execution ID ${executionId} had triggerToStartFrom. Starting from that trigger.`,
				{ executionId },
			);
			const startNodes = data.startNodes.map((startNode) => {
				const node = workflow.getNode(startNode.name);
				assert.ok(node, `Could not find a node named "${startNode.name}" in the workflow.`);
				return node;
			});
			const runData = { [data.triggerToStartFrom.name]: [data.triggerToStartFrom.data] };

			let nodeExecutionStack = [];
			let waitingExecution = {};
			let waitingExecutionSource = {};

			if (data.destinationNode?.nodeName !== data.triggerToStartFrom.name) {
				const recreatedStack = recreateNodeExecutionStack(
					filterDisabledNodes(DirectedGraph.fromWorkflow(workflow)),
					new Set(startNodes),
					runData,
					data.pinData ?? {},
				);
				nodeExecutionStack = recreatedStack.nodeExecutionStack;
				waitingExecution = recreatedStack.waitingExecution;
				waitingExecutionSource = recreatedStack.waitingExecutionSource;
			}

			const executionData = createRunExecutionData({
				resultData: {
					runData,
					pinData,
				},
				executionData: {
					nodeExecutionStack,
					waitingExecution,
					waitingExecutionSource,
				},
			});

			if (data.destinationNode) {
				executionData.startData = { destinationNode: data.destinationNode };
			}

			const workflowExecute = this.workflowExecuteFactory(
				additionalData,
				data.executionMode,
				executionData,
			);
			return workflowExecute.processRunExecutionData(workflow);
		} else if (data.runData === undefined || data.executionMode === 'evaluation') {
			// Full Execution
			this.logger.debug(`Execution ID ${executionId} will run executing all nodes.`, {
				executionId,
			});

			const startNode = this.getExecutionStartNode(data, workflow);
			const additionalRunFilterNodes = [];

			if (data.destinationNode) {
				const destinationNode = workflow.getNode(data.destinationNode.nodeName);
				assert.ok(
					destinationNode,
					`Could not find a node named "${data.destinationNode.nodeName}" in the workflow.`,
				);

				const destinationNodeType = workflow.nodeTypes?.getByNameAndVersion?.(
					destinationNode.type,
					destinationNode.typeVersion,
				);

				// Rewire graph to be able to execute the destination tool node
				if (isTool(destinationNodeType?.description, destinationNode.parameters)) {
					const graph = rewireGraph(
						destinationNode,
						DirectedGraph.fromWorkflow(workflow),
						data.agentRequest,
					);

					workflow = graph.toWorkflow({
						...workflow,
					});

					// Save original destination
					if (data.executionData) {
						data.executionData.startData = data.executionData.startData ?? {};
						data.executionData.startData.originalDestinationNode = data.destinationNode;
					}

					// Set destination to Tool Executor
					data.destinationNode = { nodeName: TOOL_EXECUTOR_NODE_NAME, mode: 'inclusive' };

					// One manual execution may run multiple tools, if the tool is connected through HITL node
					// Allow execution by adding to runFilter
					const connectedTools = workflow.getParentNodes(TOOL_EXECUTOR_NODE_NAME, 'ALL_NON_MAIN') ?? [];
					for (const connectedTool of connectedTools) {
						additionalRunFilterNodes.push(connectedTool);
					}
				}
			}

			// Can execute without webhook so go on
			const workflowExecute = this.workflowExecuteFactory(additionalData, data.executionMode);
			return workflowExecute.run({
				workflow,
				startNode,
				destinationNode: data.destinationNode,
				pinData: data.pinData,
				triggerToStartFrom: data.triggerToStartFrom,
				additionalRunFilterNodes,
			});
		} else {
			assert.ok(
				data.destinationNode,
				'a destinationNodeName is required for the new partial execution flow',
			);

			// Partial Execution
			this.logger.debug(`Execution ID ${executionId} is a partial execution.`, { executionId });
			// Execute only the nodes between start and destination nodes
			const workflowExecute = this.workflowExecuteFactory(additionalData, data.executionMode);

			return workflowExecute.runPartialWorkflow2(
				workflow,
				data.runData,
				data.pinData,
				data.dirtyNodeNames,
				data.destinationNode,
				data.agentRequest,
			);
		}
	}
}
