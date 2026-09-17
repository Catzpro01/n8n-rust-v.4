import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';

import {
	DirectedGraph,
	ManualExecutionService,
	NodeTypesRegistry,
	ReconstructedWorkflow,
	TOOL_EXECUTOR_NODE_NAME,
	WorkflowExecute,
	WorkflowRunner,
	filterDisabledNodes,
	isTool,
	recreateNodeExecutionStack,
	rewireGraph,
} from '../src/index.mjs';

function createDummyWorkflow(nodes = [], connections = {}) {
	const registry = new NodeTypesRegistry();
	registry.register('n8n-nodes-base.manualTrigger', 1, {
		description: { name: 'n8n-nodes-base.manualTrigger', group: ['trigger'], inputs: [], outputs: ['main'] },
	});
	registry.register('n8n-nodes-base.scheduleTrigger', 1, {
		description: { name: 'n8n-nodes-base.scheduleTrigger', group: ['trigger'], inputs: [], outputs: ['main'] },
	});
	registry.register('n8n-nodes-base.code', 1, {
		description: { name: 'n8n-nodes-base.code', group: [], inputs: ['main'], outputs: ['main'] },
	});
	registry.register('n8n-nodes-base.toolTest', 1, {
		description: { name: 'n8n-nodes-base.toolTest', group: [], inputs: ['main'], outputs: ['ai_tool'] },
	});
	registry.register('n8n-nodes-base.vectorStore', 1, {
		description: { name: 'n8n-nodes-base.vectorStore', group: [], inputs: ['main'], outputs: ['main'] },
	});

	return new ReconstructedWorkflow({
		id: 'wf-test',
		name: 'Test Workflow',
		nodes,
		connections,
		nodeTypes: registry,
	});
}

describe('ManualExecutionService', () => {
	const logger = { debug() {}, info() {}, warn() {}, error() {} };
	const manualExecutionService = new ManualExecutionService(logger);

	describe('getExecutionStartNode', () => {
		it('should return undefined when no startNodes or triggerToStartFrom', () => {
			const workflow = createDummyWorkflow([]);
			const startNode = manualExecutionService.getExecutionStartNode({}, workflow);
			assert.equal(startNode, undefined);
		});

		it('should return startNode when data.startNodes has 1 node and pinData has matching key', () => {
			const workflow = createDummyWorkflow([
				{ name: 'node1', type: 'n8n-nodes-base.code' },
				{ name: 'node2', type: 'n8n-nodes-base.code' },
			]);
			const data = {
				pinData: {
					node1: [{ json: { a: 1 } }],
					node2: [{ json: { b: 2 } }],
				},
				startNodes: [{ name: 'node2' }],
			};
			const startNode = manualExecutionService.getExecutionStartNode(data, workflow);
			assert.equal(startNode?.name, 'node2');
		});

		it('should return triggerToStartFrom trigger node', () => {
			const workflow = createDummyWorkflow([
				{ name: 'node1', type: 'n8n-nodes-base.code' },
				{ name: 'node3', type: 'n8n-nodes-base.manualTrigger' },
			]);
			const data = {
				pinData: {
					node1: [{ json: { a: 1 } }],
				},
				triggerToStartFrom: { name: 'node3' },
			};
			const startNode = manualExecutionService.getExecutionStartNode(data, workflow);
			assert.equal(startNode?.name, 'node3');
		});

		it('should return undefined, even if manual trigger node is available when no triggerToStartFrom', () => {
			const workflow = createDummyWorkflow([
				{ name: 'Wed 12:00', type: 'n8n-nodes-base.scheduleTrigger' },
				{ name: 'When clicking Execute workflow', type: 'n8n-nodes-base.manualTrigger' },
			]);
			const data = {
				startNodes: [{ name: 'Wed 12:00' }],
				triggerToStartFrom: undefined,
			};
			const startNode = manualExecutionService.getExecutionStartNode(data, workflow);
			assert.equal(startNode, undefined);
		});
	});

	describe('DirectedGraph', () => {
		it('builds graph, queries connections, and clones cleanly', () => {
			const nodeA = { name: 'A', type: 'n8n-nodes-base.code' };
			const nodeB = { name: 'B', type: 'n8n-nodes-base.code' };
			const nodeC = { name: 'C', type: 'n8n-nodes-base.code' };

			const graph = new DirectedGraph();
			graph.addNodes(nodeA, nodeB, nodeC);
			assert.equal(graph.hasNode('A'), true);
			assert.equal(graph.hasNode('Z'), false);

			graph.addConnection({ from: nodeA, to: nodeB, type: 'main' });
			graph.addConnection({ from: nodeB, to: nodeC, type: 'main' });

			assert.equal(graph.getDirectParentConnections(nodeB).length, 1);
			assert.equal(graph.getDirectChildConnections(nodeB).length, 1);
			assert.equal(graph.getChildren(nodeA).size, 2);
			assert.equal(graph.getParentConnections(nodeC).size, 2);

			const cloned = graph.clone();
			assert.equal(cloned.hasNode('A'), true);
			assert.equal(cloned.hasNode('C'), true);
		});

		it('removes node with reconnectConnections = true', () => {
			const nodeA = { name: 'A', type: 'n8n-nodes-base.code' };
			const nodeB = { name: 'B', type: 'n8n-nodes-base.code' };
			const nodeC = { name: 'C', type: 'n8n-nodes-base.code' };

			const graph = new DirectedGraph();
			graph.addNodes(nodeA, nodeB, nodeC);
			graph.addConnection({ from: nodeA, to: nodeB, type: 'main' });
			graph.addConnection({ from: nodeB, to: nodeC, type: 'main' });

			const rewired = graph.removeNode(nodeB, { reconnectConnections: true });
			assert.equal(rewired.length, 1);
			assert.equal(rewired[0].from.name, 'A');
			assert.equal(rewired[0].to.name, 'C');
			assert.equal(graph.hasNode('B'), false);
			assert.equal(graph.getDirectChildConnections(nodeA)[0].to.name, 'C');
		});

		it('detects cycles using Tarjan strongly connected components', () => {
			const node1 = { name: 'n1' };
			const node2 = { name: 'n2' };
			const node3 = { name: 'n3' };

			const graph = new DirectedGraph();
			graph.addNodes(node1, node2, node3);
			graph.addConnection({ from: node1, to: node2 });
			graph.addConnection({ from: node2, to: node3 });
			graph.addConnection({ from: node3, to: node1 });

			const scc = graph.getStronglyConnectedComponents();
			const cycle = scc.find((set) => set.size === 3);
			assert.ok(cycle);
			assert.equal(cycle.has(node1), true);
			assert.equal(cycle.has(node2), true);
			assert.equal(cycle.has(node3), true);
		});
	});

	describe('isTool and filterDisabledNodes', () => {
		it('isTool identifies tool outputs and retrieve-as-tool vector stores', () => {
			assert.equal(isTool({ outputs: ['ai_tool'] }), true);
			assert.equal(isTool({ outputs: [{ type: 'ai_tool' }] }), true);
			assert.equal(isTool({ name: 'n8n-nodes-base.vectorStore' }, { mode: 'retrieve-as-tool' }), true);
			assert.equal(isTool({ name: 'n8n-nodes-base.vectorStore' }, { mode: 'search' }), false);
			assert.equal(isTool({ outputs: ['main'] }), false);
			assert.equal(isTool(undefined), false);
		});

		it('filterDisabledNodes strips disabled nodes and reconnects main stream', () => {
			const node1 = { name: 'n1', disabled: false };
			const node2 = { name: 'n2', disabled: true };
			const node3 = { name: 'n3', disabled: false };

			const graph = new DirectedGraph();
			graph.addNodes(node1, node2, node3);
			graph.addConnection({ from: node1, to: node2, type: 'main' });
			graph.addConnection({ from: node2, to: node3, type: 'main' });

			const filtered = filterDisabledNodes(graph);
			assert.equal(filtered.hasNode('n2'), false);
			assert.equal(filtered.getDirectChildConnections(node1)[0].to.name, 'n3');
		});
	});

	describe('rewireGraph', () => {
		it('rewires tool output and connects to virtual ToolExecutor', () => {
			const toolNode = { name: 'testTool', type: 'n8n-nodes-base.toolTest', id: 'tool-id' };
			const agentNode = { name: 'agentNode', type: 'agent', id: 'agent-id' };
			const chatNode = { name: 'chatTrigger', type: 'chat' };

			const graph = new DirectedGraph();
			graph.addNodes(chatNode, agentNode, toolNode);
			graph.addConnection({ from: chatNode, to: agentNode, type: 'main' });
			graph.addConnection({ from: toolNode, to: agentNode, type: 'ai_tool' });

			const rewired = rewireGraph(toolNode, graph, { tool: { name: 'calculator' }, query: { q: '1+1' } });
			assert.equal(rewired.hasNode(TOOL_EXECUTOR_NODE_NAME), true);
			assert.equal(rewired.hasNode('agentNode'), false);

			const toolExecNode = [...rewired.getNodes().values()].find((n) => n.name === TOOL_EXECUTOR_NODE_NAME);
			assert.equal(toolExecNode?.type, '@n8n/n8n-nodes-langchain.toolExecutor');
			assert.equal(toolNode.rewireOutputLogTo, 'ai_tool');
		});
	});

	describe('recreateNodeExecutionStack', () => {
		it('throws when graph contains disabled nodes', () => {
			const node = { name: 'n1', disabled: true };
			const graph = new DirectedGraph();
			graph.addNode(node);

			assert.throws(
				() => recreateNodeExecutionStack(graph, new Set([node])),
				/Graph contains disabled nodes/,
			);
		});

		it('creates execution stack for root nodes with default input item', () => {
			const node = { name: 'start', disabled: false };
			const graph = new DirectedGraph();
			graph.addNode(node);

			const { nodeExecutionStack } = recreateNodeExecutionStack(graph, new Set([node]));
			assert.equal(nodeExecutionStack.length, 1);
			assert.equal(nodeExecutionStack[0].node.name, 'start');
			assert.deepEqual(nodeExecutionStack[0].data.main, [[{ json: {} }]]);
		});

		it('recreates execution stack with pinned data and run data', () => {
			const start = { name: 'start', disabled: false };
			const next = { name: 'next', disabled: false };

			const graph = new DirectedGraph();
			graph.addNodes(start, next);
			graph.addConnection({ from: start, to: next, type: 'main' });

			const runData = {
				start: [
					{
						data: {
							main: [[{ json: { val: 42 } }]],
						},
					},
				],
			};

			const { nodeExecutionStack } = recreateNodeExecutionStack(graph, new Set([next]), runData);
			assert.equal(nodeExecutionStack.length, 1);
			assert.equal(nodeExecutionStack[0].node.name, 'next');
			assert.deepEqual(nodeExecutionStack[0].data.main, [[{ json: { val: 42 } }]]);
		});
	});

	describe('runManually', () => {
		it('processes triggerToStartFrom with data and calls processRunExecutionData', async () => {
			let capturedAdditionalData;
			let capturedMode;
			let capturedExecutionData;
			let processRunCalled = false;

			const customService = new ManualExecutionService(logger, {
				workflowExecuteFactory: (ad, mode, execData) => {
					capturedAdditionalData = ad;
					capturedMode = mode;
					capturedExecutionData = execData;
					return {
						processRunExecutionData: async (wf) => {
							processRunCalled = true;
							return { status: 'success', data: execData };
						},
					};
				},
			});

			const workflow = createDummyWorkflow([
				{ name: 'triggerNode', type: 'n8n-nodes-base.manualTrigger' },
				{ name: 'startNode', type: 'n8n-nodes-base.code' },
			]);

			const triggerData = {
				startTime: 100,
				executionTime: 50,
				data: { main: [[{ json: { triggered: true } }]] },
			};

			const data = {
				executionMode: 'manual',
				triggerToStartFrom: {
					name: 'triggerNode',
					data: triggerData,
				},
				startNodes: [{ name: 'startNode' }],
			};

			const result = await customService.runManually(
				data,
				workflow,
				{ user: 'tester' },
				'exec-123',
			);

			assert.equal(processRunCalled, true);
			assert.equal(capturedMode, 'manual');
			assert.equal(capturedAdditionalData.user, 'tester');
			assert.deepEqual(capturedExecutionData.resultData.runData, {
				triggerNode: [triggerData],
			});
		});

		it('includes destinationNode in startData when triggerToStartFrom is provided', async () => {
			let capturedExecutionData;

			const customService = new ManualExecutionService(logger, {
				workflowExecuteFactory: (ad, mode, execData) => {
					capturedExecutionData = execData;
					return {
						processRunExecutionData: async () => ({ status: 'success' }),
					};
				},
			});

			const workflow = createDummyWorkflow([
				{ name: 'triggerNode', type: 'n8n-nodes-base.manualTrigger' },
				{ name: 'startNode', type: 'n8n-nodes-base.code' },
			]);

			const data = {
				executionMode: 'manual',
				triggerToStartFrom: {
					name: 'triggerNode',
					data: { data: { main: [[{ json: {} }]] } },
				},
				startNodes: [{ name: 'startNode' }],
				destinationNode: { nodeName: 'destNode', mode: 'inclusive' },
			};

			await customService.runManually(data, workflow, {}, 'exec-456');
			assert.deepEqual(capturedExecutionData.startData.destinationNode, {
				nodeName: 'destNode',
				mode: 'inclusive',
			});
		});

		it('calls workflowExecute.run for full execution when runData is undefined', async () => {
			let capturedRunOptions;

			const customService = new ManualExecutionService(logger, {
				workflowExecuteFactory: () => ({
					run: async (opts) => {
						capturedRunOptions = opts;
						return { status: 'success' };
					},
				}),
			});

			const workflow = createDummyWorkflow([
				{ name: 'codeNode', type: 'n8n-nodes-base.code' },
			]);

			const data = {
				executionMode: 'manual',
				runData: undefined,
			};

			await customService.runManually(data, workflow, {}, 'exec-789');
			assert.ok(capturedRunOptions);
			assert.equal(capturedRunOptions.workflow, workflow);
			assert.deepEqual(capturedRunOptions.additionalRunFilterNodes, []);
		});

		it('calls workflowExecute.run for full execution when executionMode is evaluation', async () => {
			let runCalled = false;

			const customService = new ManualExecutionService(logger, {
				workflowExecuteFactory: () => ({
					run: async () => {
						runCalled = true;
						return { status: 'success' };
					},
				}),
			});

			const workflow = createDummyWorkflow([
				{ name: 'codeNode', type: 'n8n-nodes-base.code' },
			]);

			const data = {
				executionMode: 'evaluation',
				runData: { some: 'data' },
			};

			await customService.runManually(data, workflow, {}, 'exec-eval');
			assert.equal(runCalled, true);
		});

		it('rewires graph when destination node is an AI tool in full execution', async () => {
			let capturedRunOptions;

			const customService = new ManualExecutionService(logger, {
				workflowExecuteFactory: () => ({
					run: async (opts) => {
						capturedRunOptions = opts;
						return { status: 'success' };
					},
				}),
			});

			const toolNode = {
				name: 'myTool',
				type: 'n8n-nodes-base.toolTest',
				id: 't-1',
			};
			const agentNode = {
				name: 'myAgent',
				type: 'n8n-nodes-base.code',
				id: 'a-1',
			};

			const workflow = createDummyWorkflow(
				[toolNode, agentNode],
				{
					myTool: { ai_tool: [[{ node: 'myAgent', type: 'ai_tool', index: 0 }]] },
				},
			);

			const data = {
				executionMode: 'manual',
				destinationNode: { nodeName: 'myTool', mode: 'inclusive' },
				executionData: { startData: {} },
			};

			await customService.runManually(data, workflow, {}, 'exec-tool');

			assert.equal(data.destinationNode.nodeName, TOOL_EXECUTOR_NODE_NAME);
			assert.deepEqual(data.executionData.startData.originalDestinationNode, {
				nodeName: 'myTool',
				mode: 'inclusive',
			});
			assert.equal(capturedRunOptions.destinationNode.nodeName, TOOL_EXECUTOR_NODE_NAME);
		});

		it('does not rewire graph when destination node is a normal node', async () => {
			let capturedRunOptions;

			const customService = new ManualExecutionService(logger, {
				workflowExecuteFactory: () => ({
					run: async (opts) => {
						capturedRunOptions = opts;
						return { status: 'success' };
					},
				}),
			});

			const codeNode = {
				name: 'codeNode',
				type: 'n8n-nodes-base.code',
			};
			const workflow = createDummyWorkflow([codeNode]);

			const data = {
				executionMode: 'manual',
				destinationNode: { nodeName: 'codeNode', mode: 'inclusive' },
			};

			await customService.runManually(data, workflow, {}, 'exec-normal');
			assert.equal(data.destinationNode.nodeName, 'codeNode');
			assert.equal(capturedRunOptions.destinationNode.nodeName, 'codeNode');
		});

		it('throws error when destinationNode is missing for partial execution', async () => {
			const workflow = createDummyWorkflow([
				{ name: 'codeNode', type: 'n8n-nodes-base.code' },
			]);

			const data = {
				executionMode: 'manual',
				runData: { codeNode: [{ data: { main: [[{ json: {} }]] } }] },
				destinationNode: undefined,
			};

			await assert.rejects(
				async () => manualExecutionService.runManually(data, workflow, {}, 'exec-err'),
				/a destinationNodeName is required for the new partial execution flow/,
			);
		});

		it('delegates to runPartialWorkflow2 for partial execution with destinationNode', async () => {
			let partialCalled = false;
			let capturedArgs;

			const customService = new ManualExecutionService(logger, {
				workflowExecuteFactory: () => ({
					runPartialWorkflow2: async (...args) => {
						partialCalled = true;
						capturedArgs = args;
						return { status: 'success' };
					},
				}),
			});

			const workflow = createDummyWorkflow([
				{ name: 'codeNode', type: 'n8n-nodes-base.code' },
				{ name: 'destNode', type: 'n8n-nodes-base.code' },
			]);

			const runData = { codeNode: [{ data: { main: [[{ json: { x: 1 } }]] } }] };
			const pinData = { destNode: [{ json: { y: 2 } }] };
			const dirtyNodeNames = ['codeNode'];
			const destinationNode = { nodeName: 'destNode', mode: 'inclusive' };
			const agentRequest = { tool: { name: 'calculator' } };

			const data = {
				executionMode: 'manual',
				runData,
				pinData,
				dirtyNodeNames,
				destinationNode,
				agentRequest,
			};

			await customService.runManually(data, workflow, {}, 'exec-partial', pinData);

			assert.equal(partialCalled, true);
			assert.equal(capturedArgs[0], workflow);
			assert.deepEqual(capturedArgs[1], runData);
			assert.deepEqual(capturedArgs[2], pinData);
			assert.deepEqual(capturedArgs[3], dirtyNodeNames);
			assert.deepEqual(capturedArgs[4], destinationNode);
			assert.deepEqual(capturedArgs[5], agentRequest);
		});
	});

	describe('WorkflowRunner delegation to ManualExecutionService', () => {
		it('WorkflowRunner calls runManually when executionData is undefined in manual mode', async () => {
			let manualRunCalled = false;

			const manualService = new ManualExecutionService(logger, {
				workflowExecuteFactory: () => ({
					run: async () => ({
						status: 'success',
						data: { resultData: { runData: {} } },
					}),
				}),
			});

			// Wrap runManually to spy on it
			const originalRunManually = manualService.runManually.bind(manualService);
			manualService.runManually = async (...args) => {
				manualRunCalled = true;
				return originalRunManually(...args);
			};

			const mockActiveExecutions = {
				attachWorkflowExecution() {},
				resolveExecutionResponsePromise() {},
				finalizeExecution() {},
				stopExecution() {},
			};

			const runner = new WorkflowRunner({
				logger,
				activeExecutions: mockActiveExecutions,
				manualExecutionService: manualService,
			});

			const workflow = createDummyWorkflow([
				{ name: 'start', type: 'n8n-nodes-base.code' },
			]);

			const data = {
				executionMode: 'manual',
				workflowData: workflow,
			};

			await runner.runMainProcess(data, { user: 'test-user' });
			assert.equal(manualRunCalled, true);
		});
	});
});
