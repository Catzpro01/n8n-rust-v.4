/**
 * WorkflowDataProxy — node-side read surface, reconstructed 1:1 from the
 * pinned reference (n8n 2.9.4).
 *
 * Provenance (all `packages/workflow/src/`):
 *   workflow-data-proxy.ts:44-47      isScriptingNode
 *   workflow-data-proxy.ts:60-92      constructor (14 positional args, order frozen)
 *   workflow-data-proxy.ts:103-111    returnExecutionData (binaryMode 'combined')
 *   workflow-data-proxy.ts:118-165    nodeContextGetter
 *   workflow-data-proxy.ts:167-186    selfGetter
 *   workflow-data-proxy.ts:287-360    nodeParameterGetter ($parameter / $rawParameter)
 *   workflow-data-proxy.ts:368-379    getNodeExecutionOrPinnedData
 *   workflow-data-proxy.ts:400-501    getNodeExecutionData
 *   workflow-data-proxy.ts:517-620    nodeDataGetter ($node[Name], $json/$binary/$data)
 *   workflow-data-proxy.ts:636-676    prevNodeGetter ($prevNode)
 *   workflow-data-proxy.ts:684-716    workflowGetter ($workflow)
 *   workflow-data-proxy.ts:724-749    nodeGetter ($node)
 *   workflow-data-proxy.ts:1108-1368  $() node accessor (paired-item accessors deferred, see below)
 *   workflow-data-proxy.ts:1372-1452  $input
 *   workflow-data-proxy.ts:1453-1568  getDataProxy base object + top-level proxy trap
 *   workflow-data-proxy-helpers.ts:3-12 getPinDataIfManualExecution
 *
 * SURFACE COVERAGE — the symbols below are NOT PORTED. They never return a
 * value that could silently differ from n8n: reading them throws
 * `NotPortedError` (a named error carrying the reference line number). The list
 * is machine-readable in `manifest/port-surface.json` and is asserted by
 * `test/05-surface-coverage.test.mjs`.
 *
 *   deferred: $fromAI / $fromai / $fromAi, $tool,
 *             $agentInfo (agent-node branch only — the non-agent answer `undefined` IS ported),
 *             $('n').pairedItem / .itemMatching / .item, $getPairedItem,
 *             augmentObject / augmentArray (scripting-node copy-on-write)
 *
 * Ported but needing an injected capability, so they raise rather than answer without it:
 * `$jmesPath` / `$jmespath` (module `jmespath`) and `$now` / `$today` / `DateTime` /
 * `Interval` / `Duration` (module `luxon`).
 *
 * The reference imports `luxon` and `jmespath` at module scope (workflow-data-proxy.ts:6-7);
 * this package keeps `src/` free of bare specifiers (gate 01), so both are injected through the
 * ctor's options object. "Not injected" is never "undefined": every dependent sandbox key is
 * installed as a throwing accessor, because a key that exists but answers nothing reads as
 * implemented (the ISSUE-016 pattern).
 *
 * `luxon` is optional and injected: when supplied (the equivalence harness
 * injects the copy installed with the reference runtime) `$now`, `$today` and
 * the `Settings.defaultZone` write in the constructor reproduce the reference
 * exactly, including its ambient side effect. When absent those accessors throw
 * `NotPortedError` instead of guessing a value.
 */

import {
	AGENT_LANGCHAIN_NODE_TYPE,
	BINARY_MODE_COMBINED,
	NodeConnectionTypes,
	SCRIPTING_NODE_TYPES,
} from './constants.mjs';
import { ApplicationError, ExpressionError } from './errors.mjs';
import { getContext as readNodeContext } from './run-execution-data.mjs';
import { createEnvProvider, createEnvProviderState } from './workflow-data-proxy-env-provider.mjs';
import { deepCopy, get as lodashGet, isResourceLocatorValue } from './utils.mjs';

/** packages/workflow/src/workflow-data-proxy.ts:44 */
const isScriptingNode = (nodeName, workflow) => {
	const node = workflow.getNode(nodeName);

	return node && SCRIPTING_NODE_TYPES.includes(node.type);
};

/** packages/workflow/src/workflow-data-proxy-helpers.ts:3 */
export function getPinDataIfManualExecution(workflow, nodeName, mode) {
	if (mode !== 'manual') {
		return undefined;
	}
	return workflow.getPinDataOfNode(nodeName);
}

/**
 * Declared-divergence marker. Everything this port does not implement raises it,
 * so an unported symbol can never masquerade as `undefined` (which n8n returns
 * for several of these paths).
 */
export class NotPortedError extends Error {
	name = 'NotPortedError';

	constructor(symbol, reference) {
		super(
			`[reconstructed-engine] "${symbol}" is not ported yet (reference: ${reference}). ` +
				'See packages/reconstructed-engine/manifest/port-surface.json → deferred[].',
		);
		this.symbol = symbol;
		this.reference = reference;
	}
}

export class WorkflowDataProxy {
	constructor(
		workflow,
		runExecutionData,
		runIndex,
		itemIndex,
		activeNodeName,
		connectionInputData,
		siblingParameters,
		mode,
		additionalKeys,
		executeData,
		defaultReturnRunIndex = -1,
		selfData = {},
		contextNodeName = activeNodeName,
		// reference :77 declares this as a TS parameter property (`private`).
		envProviderState = undefined,
		// DECLARED DEVIATION (additive, 15th): the only way to inject luxon — and jmespath,
		// which the reference imports as a bare specifier (workflow-data-proxy.ts:6) while
		// this package keeps src/ free of bare specifiers (gate 01). Absent either one, the
		// dependent accessors raise instead of answering.
		{ luxon, jmespath } = {},
	) {
		this.envProviderState = envProviderState;
		this.workflow = workflow;
		this.runIndex = runIndex;
		this.itemIndex = itemIndex;
		this.activeNodeName = activeNodeName;
		this.siblingParameters = siblingParameters;
		this.mode = mode;
		this.additionalKeys = additionalKeys;
		this.executeData = executeData;
		this.defaultReturnRunIndex = defaultReturnRunIndex;
		this.selfData = selfData;
		this.contextNodeName = contextNodeName;
		this.luxon = luxon;
		this.jmespath = jmespath;

		// Reference: scripting nodes get an augmentObject/augmentArray wrapper
		// (copy-on-write proxies, workflow-data-proxy.ts:84-90). Declared
		// deviation — read behaviour is identical, see port-surface.json →
		// deviations[].augment.
		this.runExecutionData = runExecutionData;
		this.connectionInputData = connectionInputData;

		this.timezone = workflow.settings?.timezone ?? 'America/New_York';

		if (this.luxon?.Settings) {
			// 1:1 with workflow-data-proxy.ts:92 — an ambient write the isolation
			// ledger records as ISSUE-006 (global-mutable-state). It is kept
			// because parity outranks cleanliness at this stage, but it is now
			// *visible* behind an injected capability instead of an import.
			this.luxon.Settings.defaultZone = this.timezone;
		}
	}

	/**
	 * workflow-data-proxy.ts:1061 `private agentInfo()` — same name, same slot on the
	 * prototype (gate 05 compares the class method-for-method, and TS `private` is compile-time
	 * only, so the reference really does expose this at runtime). Only the first guard is
	 * ported: the reference returns `undefined` unless the active node is
	 * `AGENT_LANGCHAIN_NODE_TYPE`, and everything past that guard (connected tools, memory
	 * detection, unconnected-tool discovery, buildAgentToolInfo) belongs to the agent-runtime
	 * LEGO — which is exactly what `manifest/port-surface.json → deferred` says.
	 */
	agentInfo() {
		const agentNode = this.workflow.getNode(this.activeNodeName);
		if (agentNode?.type !== AGENT_LANGCHAIN_NODE_TYPE) return undefined;
		throw new NotPortedError(
			'$agentInfo',
			'workflow-data-proxy.ts:1061-1108 — agent tool metadata; needs the agent-runtime LEGO',
		);
	}

	/**
	 * packages/workflow/src/workflow-data-proxy.ts:103
	 * Returns execution data, conditionally extracting only 'json' from the item
	 * based on the workflow 'binaryMode' setting.
	 */
	returnExecutionData(data, fullItem = false) {
		if (fullItem) return data;
		if (this.workflow.settings?.binaryMode !== BINARY_MODE_COMBINED) return data;

		if (Array.isArray(data)) {
			return data.map((i) => i.json);
		}

		return data.json;
	}

	/** packages/workflow/src/workflow-data-proxy.ts:118 */
	nodeContextGetter(nodeName) {
		const that = this;
		const node = this.workflow.nodes[nodeName];

		if (!that.runExecutionData?.executionData && that.connectionInputData.length > 0) {
			return {}; // incoming connection has pinned data, so stub context object
		}

		if (!that.runExecutionData?.executionData && !that.runExecutionData?.resultData) {
			throw new ExpressionError(
				"The workflow hasn't been executed yet, so you can't reference any context data",
				{
					runIndex: that.runIndex,
					itemIndex: that.itemIndex,
					type: 'no_execution_data',
				},
			);
		}

		return new Proxy(
			{},
			{
				has: () => true,
				ownKeys(target) {
					if (Reflect.ownKeys(target).length === 0) {
						// Target object did not get set yet
						Object.assign(target, that.contextReader(node));
					}

					return Reflect.ownKeys(target);
				},
				getOwnPropertyDescriptor() {
					return {
						enumerable: true,
						configurable: true,
					};
				},
				get(_, name) {
					if (name === 'isProxy') return true;

					name = name.toString();
					const contextData = that.contextReader(node);

					return contextData[name];
				},
			},
		);
	}

	/**
	 * Seam for `NodeHelpers.getContext(runExecutionData, 'node', node)`. It delegates
	 * to the ONE implementation of that accessor (./run-execution-data.mjs) instead of
	 * re-implementing it here — an earlier copy normalised `node` to `node?.name` and
	 * thereby swallowed the "node parameter has to be set" error the reference raises
	 * for an unknown node name. The golden harness caught it; the fix is to share.
	 */
	contextReader(node) {
		return readNodeContext(this.runExecutionData, 'node', node);
	}

	/** packages/workflow/src/workflow-data-proxy.ts:167 */
	selfGetter() {
		const that = this;

		return new Proxy(
			{},
			{
				has: () => true,
				ownKeys(target) {
					return Reflect.ownKeys(target);
				},

				get(_, name) {
					if (name === 'isProxy') return true;
					name = name.toString();
					return that.selfData[name];
				},
			},
		);
	}

	/** packages/workflow/src/workflow-data-proxy.ts:287 */
	nodeParameterGetter(nodeName, resolveValue = true) {
		const that = this;
		const node = this.workflow.nodes[nodeName];

		// `node` is `undefined` only in expressions in credentials

		return new Proxy(node?.parameters ?? {}, {
			has: () => true,
			ownKeys(target) {
				return Reflect.ownKeys(target);
			},
			getOwnPropertyDescriptor() {
				return {
					enumerable: true,
					configurable: true,
				};
			},
			get(target, name) {
				if (name === 'isProxy') return true;
				if (name === 'toJSON') return () => deepCopy(target);

				name = name.toString();

				let returnValue;
				if (name[0] === '&') {
					const key = name.slice(1);
					if (!that.siblingParameters.hasOwnProperty(key)) {
						throw new ApplicationError('Could not find sibling parameter on node', {
							extra: { nodeName, parameter: key },
						});
					}
					returnValue = that.siblingParameters[key];
				} else {
					if (!node.parameters.hasOwnProperty(name)) {
						// Parameter does not exist on node
						return undefined;
					}

					returnValue = node.parameters[name];
				}

				// Avoid recursion
				if (returnValue === `={{ $parameter.${name} }}`) return undefined;

				if (isResourceLocatorValue(returnValue)) {
					if (returnValue.__regex && typeof returnValue.value === 'string') {
						const expr = new RegExp(returnValue.__regex);
						const extracted = expr.exec(returnValue.value);
						if (extracted && extracted.length >= 2) {
							returnValue = extracted[1];
						} else {
							return returnValue.value;
						}
					} else {
						returnValue = returnValue.value;
					}
				}

				if (resolveValue && typeof returnValue === 'string' && returnValue.charAt(0) === '=') {
					// The found value is an expression so resolve it
					return that.workflow.expression.getParameterValue(
						returnValue,
						that.runExecutionData,
						that.runIndex,
						that.itemIndex,
						that.activeNodeName,
						that.connectionInputData,
						that.mode,
						that.additionalKeys,
						that.executeData,
						false,
						{},
						that.contextNodeName,
					);
				}

				return returnValue;
			},
		});
	}

	/** packages/workflow/src/workflow-data-proxy.ts:368 */
	getNodeExecutionOrPinnedData({ nodeName, branchIndex, runIndex, shortSyntax = false }) {
		try {
			return this.getNodeExecutionData(nodeName, shortSyntax, branchIndex, runIndex);
		} catch (e) {
			const pinData = getPinDataIfManualExecution(this.workflow, nodeName, this.mode);
			if (pinData) {
				return pinData;
			}

			throw e;
		}
	}

	/** packages/workflow/src/workflow-data-proxy.ts:400 */
	getNodeExecutionData(nodeName, shortSyntax = false, outputIndex, runIndex) {
		const that = this;

		let executionData;
		if (!shortSyntax) {
			// Long syntax got used to return data from node in path

			if (that.runExecutionData === null) {
				throw new ExpressionError(
					"The workflow hasn't been executed yet, so you can't reference any output data",
					{
						runIndex: that.runIndex,
						itemIndex: that.itemIndex,
					},
				);
			}

			if (!that.workflow.getNode(nodeName)) {
				throw new ExpressionError("Referenced node doesn't exist", {
					runIndex: that.runIndex,
					itemIndex: that.itemIndex,
					nodeCause: nodeName,
					descriptionKey: 'nodeNotFound',
				});
			}

			if (
				!that.runExecutionData.resultData.runData.hasOwnProperty(nodeName) &&
				!getPinDataIfManualExecution(that.workflow, nodeName, that.mode)
			) {
				throw new ExpressionError(`Node '${nodeName}' hasn't been executed`, {
					messageTemplate:
						'An expression references this node, but the node is unexecuted. Consider re-wiring your nodes or checking for execution first, i.e. {{ $if( $("{{nodeName}}").isExecuted, <action_if_executed>, "") }}',
					functionality: 'pairedItem',
					descriptionKey: isScriptingNode(nodeName, that.workflow)
						? 'pairedItemNoConnectionCodeNode'
						: 'pairedItemNoConnection',
					type: 'no_execution_data',
					nodeCause: nodeName,
					runIndex: that.runIndex,
					itemIndex: that.itemIndex,
				});
			}

			runIndex = runIndex === undefined ? that.defaultReturnRunIndex : runIndex;
			runIndex =
				runIndex === -1 ? that.runExecutionData.resultData.runData[nodeName].length - 1 : runIndex;

			if (that.runExecutionData.resultData.runData[nodeName].length <= runIndex) {
				throw new ExpressionError(`Run ${runIndex} of node "${nodeName}" not found`, {
					runIndex: that.runIndex,
					itemIndex: that.itemIndex,
				});
			}

			const taskData = that.runExecutionData.resultData.runData[nodeName][runIndex].data;

			if (!taskData.main?.length || taskData.main[0] === null) {
				throw new ExpressionError('No data found from `main` input', {
					runIndex: that.runIndex,
					itemIndex: that.itemIndex,
				});
			}

			// Check from which output to read the data.
			// Depends on how the nodes are connected.
			// (example "IF" node. If node is connected to "true" or to "false" output)
			if (outputIndex === undefined) {
				const nodeConnection = that.workflow.getNodeConnectionIndexes(
					that.contextNodeName,
					nodeName,
					NodeConnectionTypes.Main,
				);

				if (nodeConnection === undefined) {
					throw new ExpressionError(`connect "${that.contextNodeName}" to "${nodeName}"`, {
						runIndex: that.runIndex,
						itemIndex: that.itemIndex,
					});
				}
				outputIndex = nodeConnection.sourceIndex;
			}

			if (outputIndex === undefined) {
				outputIndex = 0;
			}

			if (taskData.main.length <= outputIndex) {
				throw new ExpressionError(`Node "${nodeName}" has no branch with index ${outputIndex}.`, {
					runIndex: that.runIndex,
					itemIndex: that.itemIndex,
				});
			}

			executionData = taskData.main[outputIndex];
		} else {
			// Short syntax got used to return data from active node
			executionData = that.connectionInputData;
		}

		return executionData;
	}

	/** packages/workflow/src/workflow-data-proxy.ts:517 */
	nodeDataGetter(nodeName, shortSyntax = false, throwOnMissingExecutionData = true) {
		const that = this;
		const node = this.workflow.nodes[nodeName];

		return new Proxy(
			{ binary: undefined, data: undefined, json: undefined },
			{
				has: () => true,
				get(target, name, receiver) {
					if (name === 'isProxy') return true;
					name = name.toString();

					if (!node) {
						throw new ExpressionError('Referenced node does not exist', {
							messageTemplate: 'Make sure to double-check the node name for typos',
							functionality: 'pairedItem',
							descriptionKey: isScriptingNode(nodeName, that.workflow)
								? 'pairedItemNoConnectionCodeNode'
								: 'pairedItemNoConnection',
							type: 'paired_item_no_connection',
							nodeCause: nodeName,
							runIndex: that.runIndex,
							itemIndex: that.itemIndex,
						});
					}

					if (['binary', 'data', 'json'].includes(name)) {
						const executionData = that.getNodeExecutionOrPinnedData({
							nodeName,
							shortSyntax,
						});

						if (executionData.length === 0 && !throwOnMissingExecutionData) {
							return undefined;
						}

						// Ultra-simple execution-based validation: if no execution data exists, throw error
						if (executionData.length === 0) {
							throw new ExpressionError(`Node '${nodeName}' hasn't been executed`, {
								messageTemplate:
									'An expression references this node, but the node is unexecuted. Consider re-wiring your nodes or checking for execution first, i.e. {{ $if( $("{{nodeName}}").isExecuted, <action_if_executed>, "") }}',
								functionality: 'pairedItem',
								descriptionKey: isScriptingNode(nodeName, that.workflow)
									? 'pairedItemNoConnectionCodeNode'
									: 'pairedItemNoConnection',
								type: 'no_execution_data',
								nodeCause: nodeName,
								runIndex: that.runIndex,
								itemIndex: that.itemIndex,
							});
						}

						if (executionData.length <= that.itemIndex) {
							throw new ExpressionError(
								`"${nodeName}" node has ${executionData.length} item(s) but you're trying to access item ${that.itemIndex}`,
								{
									messageTemplate:
										'Adjust your expression to access an existing item index (0-{{maxIndex}})',
									functionality: 'pairedItem',
									descriptionKey: 'pairedItemInvalidIndex',
									type: 'no_execution_data',
									nodeCause: nodeName,
									runIndex: that.runIndex,
									itemIndex: that.itemIndex,
								},
							);
						}

						if (['data', 'json'].includes(name)) {
							// JSON-Data
							return executionData[that.itemIndex].json;
						}
						if (name === 'binary') {
							// Binary-Data
							const returnData = {};

							if (!executionData[that.itemIndex].binary) {
								return returnData;
							}

							const binaryKeyData = executionData[that.itemIndex].binary;
							for (const keyName of Object.keys(binaryKeyData)) {
								returnData[keyName] = {};

								const binaryData = binaryKeyData[keyName];
								for (const propertyName in binaryData) {
									if (propertyName === 'data') {
										// Skip the data property
										continue;
									}
									returnData[keyName][propertyName] = binaryData[propertyName];
								}
							}

							return returnData;
						}
					} else if (name === 'context') {
						return that.nodeContextGetter(nodeName);
					} else if (name === 'parameter') {
						// Get node parameter data
						return that.nodeParameterGetter(nodeName);
					} else if (name === 'runIndex') {
						if (!that.runExecutionData?.resultData.runData[nodeName]) {
							return -1;
						}
						return that.runExecutionData.resultData.runData[nodeName].length - 1;
					}

					return Reflect.get(target, name, receiver);
				},
			},
		);
	}

	/** packages/workflow/src/workflow-data-proxy.ts:636 */
	prevNodeGetter() {
		const allowedValues = ['name', 'outputIndex', 'runIndex'];
		const that = this;

		return new Proxy(
			{},
			{
				has: () => true,
				ownKeys() {
					return allowedValues;
				},
				getOwnPropertyDescriptor() {
					return {
						enumerable: true,
						configurable: true,
					};
				},
				get(target, name, receiver) {
					if (name === 'isProxy') return true;

					if (!that.executeData?.source) {
						// Means the previous node did not get executed yet
						return undefined;
					}

					const sourceData = that.executeData.source.main[0];

					if (name === 'name') {
						return sourceData.previousNode;
					}
					if (name === 'outputIndex') {
						return sourceData.previousNodeOutput || 0;
					}
					if (name === 'runIndex') {
						return sourceData.previousNodeRun || 0;
					}

					return Reflect.get(target, name, receiver);
				},
			},
		);
	}

	/** packages/workflow/src/workflow-data-proxy.ts:684 */
	workflowGetter() {
		const allowedValues = ['active', 'id', 'name'];
		const that = this;

		return new Proxy(
			{},
			{
				has: () => true,
				ownKeys() {
					return allowedValues;
				},
				getOwnPropertyDescriptor() {
					return {
						enumerable: true,
						configurable: true,
					};
				},
				get(target, name, receiver) {
					if (name === 'isProxy') return true;

					if (allowedValues.includes(name.toString())) {
						const value = that.workflow[name];

						if (value === undefined && name === 'id') {
							throw new ExpressionError('save workflow to view', {
								description: 'Please save the workflow first to use $workflow',
								runIndex: that.runIndex,
								itemIndex: that.itemIndex,
							});
						}

						return value;
					}

					return Reflect.get(target, name, receiver);
				},
			},
		);
	}

	/** packages/workflow/src/workflow-data-proxy.ts:724 */
	nodeGetter() {
		const that = this;
		return new Proxy(
			{},
			{
				has: () => true,
				get(_, name) {
					if (name === 'isProxy') return true;

					const nodeName = name.toString();

					if (that.workflow.getNode(nodeName) === null) {
						throw new ExpressionError("Referenced node doesn't exist", {
							runIndex: that.runIndex,
							itemIndex: that.itemIndex,
							nodeCause: nodeName,
							descriptionKey: 'nodeNotFound',
						});
					}

					return that.nodeDataGetter(nodeName);
				},
			},
		);
	}

	/** packages/workflow/src/workflow-data-proxy.ts:759-1568 */
	getDataProxy(opts) {
		const that = this;

		/**
		 * reference 1500-1504 binds ONE handler to three keys (`$fromAI`/`$fromAi`/
		 * `$fromai`): a workflow that mis-cases the name must behave exactly like the
		 * correct spelling, never fall through to a silent `undefined`. The handler
		 * itself (fromAI placeholder resolution) belongs to the Expression LEGO and is
		 * declared NOT PORTED — but the keys exist and raise, so the sandbox shape
		 * matches and the failure is loud.
		 */
		const fromAiDeferred = () => {
			throw new NotPortedError('$fromAI', 'workflow-data-proxy.ts:1038-1108 (handleFromAi)');
		};

		/**
		 * packages/workflow/src/workflow-data-proxy.ts:777 — not a shortcut: this
		 * wrapper rewrites the message for scripting nodes (`functionOverrides`) and,
		 * when the referenced node is pinned in a manual run, replaces it entirely
		 * with "Unpin '<node>' to execute". Ported verbatim.
		 */
		const createExpressionError = (message, context) => {
			if (isScriptingNode(that.activeNodeName, that.workflow) && context?.functionOverrides) {
				// If the node in which the error is thrown is a function node,
				// display a different error message in case there is one defined
				message = context.functionOverrides.message || message;
				context.description = context.functionOverrides.description || context.description;
				// The error will be in the code and not on an expression on a parameter
				// so remove the messageTemplate as it would overwrite the message
				context.messageTemplate = undefined;
			}

			if (context?.nodeCause) {
				const nodeName = context.nodeCause;
				const pinData = getPinDataIfManualExecution(that.workflow, nodeName, that.mode);

				if (pinData) {
					if (!context) {
						context = {};
					}
					message = `Unpin '${nodeName}' to execute`;
					context.messageTemplate = undefined;
					context.descriptionKey = 'pairedItemPinned';
				}

				if (context.moreInfoLink && (pinData || isScriptingNode(nodeName, that.workflow))) {
					const moreInfoLink =
						' <a target="_blank" href="https://docs.n8n.io/data/data-mapping/data-item-linking/item-linking-errors/">More info</a>';

					context.description += moreInfoLink;
					if (context.descriptionTemplate) context.descriptionTemplate += moreInfoLink;
				}
			}

			return new ExpressionError(message, {
				runIndex: that.runIndex,
				itemIndex: that.itemIndex,
				...context,
			});
		};

		/** packages/workflow/src/workflow-data-proxy.ts:821 (used by the deferred paired-item path) */
		const createMissingPairedItemError = (nodeCause, usedMethodName = 'pairedItem') => {
			const pinData = getPinDataIfManualExecution(that.workflow, nodeCause, that.mode);
			const message = pinData
				? `Using the ${usedMethodName} method doesn't work with pinned data in this scenario. Please unpin '${nodeCause}' and try again.`
				: `Paired item data for ${usedMethodName} from node '${nodeCause}' is unavailable. Ensure '${nodeCause}' is providing the required output.`;

			return new ExpressionError(message, {
				runIndex: that.runIndex,
				itemIndex: that.itemIndex,
				functionality: 'pairedItem',
				descriptionKey: isScriptingNode(nodeCause, that.workflow)
					? 'pairedItemNoInfoCodeNode'
					: 'pairedItemNoInfo',
				nodeCause,
				causeDetailed: `Missing pairedItem data (node '${nodeCause}' probably didn't supply it)`,
				type: 'paired_item_no_info',
			});
		};
		void createMissingPairedItemError;

		/**
		 * `$(nodeName)` — packages/workflow/src/workflow-data-proxy.ts:1108.
		 * Paired-item accessors (.item / .pairedItem / .itemMatching) are NOT PORTED.
		 */
		const dollarAccessor = (nodeName, resolveFullItem) => {
			if (!nodeName) {
				nodeName = that.prevNodeGetter().name;
				if (!nodeName) {
					throw createExpressionError('When calling $(), please specify a node');
				}
			}

			const referencedNode = that.workflow.getNode(nodeName);
			if (referencedNode === null) {
				throw createExpressionError("Referenced node doesn't exist", {
					runIndex: that.runIndex,
					itemIndex: that.itemIndex,
					nodeCause: nodeName,
					descriptionKey: 'nodeNotFound',
				});
			}

			const ensureNodeExecutionData = () => {
				if (
					!that.runExecutionData?.resultData?.runData.hasOwnProperty(nodeName) &&
					!getPinDataIfManualExecution(that.workflow, nodeName, that.mode)
				) {
					throw createExpressionError(`Node '${nodeName}' hasn't been executed`, {
						messageTemplate:
							'An expression references this node, but the node is unexecuted. Consider re-wiring your nodes or checking for execution first, i.e. {{ $if( $("{{nodeName}}").isExecuted, <action_if_executed>, "") }}',
						functionality: 'pairedItem',
						descriptionKey: isScriptingNode(nodeName, that.workflow)
							? 'pairedItemNoConnectionCodeNode'
							: 'pairedItemNoConnection',
						type: 'no_execution_data',
						nodeCause: nodeName,
						runIndex: that.runIndex,
						itemIndex: that.itemIndex,
					});
				}
			};

			const branchIndexFor = () =>
				// default to the output the active node is connected to
				that.workflow.getNodeConnectionIndexes(that.activeNodeName, nodeName)?.sourceIndex ?? 0;

			return new Proxy(
				{},
				{
					has: () => true,
					ownKeys() {
						return [
							'pairedItem',
							'isExecuted',
							'itemMatching',
							'item',
							'first',
							'last',
							'all',
							'context',
							'params',
						];
					},
					get(target, property, receiver) {
						if (property === 'isProxy') return true;

						if (property === 'isExecuted') {
							return (
								that.runExecutionData?.resultData?.runData.hasOwnProperty(nodeName) ?? false
							);
						}

						if (['pairedItem', 'itemMatching', 'item'].includes(property)) {
							throw new NotPortedError(
								`$('${nodeName}').${property}`,
								'workflow-data-proxy.ts:1183-1290',
							);
						}

						if (property === 'first') {
							ensureNodeExecutionData();
							return (branchIndex, runIndex) => {
								branchIndex = branchIndex ?? branchIndexFor();
								const executionData = that.getNodeExecutionOrPinnedData({
									nodeName,
									branchIndex,
									runIndex,
								});
								if (executionData[0]) {
									return that.returnExecutionData(executionData[0], resolveFullItem);
								}
								return undefined;
							};
						}
						if (property === 'last') {
							ensureNodeExecutionData();
							return (branchIndex, runIndex) => {
								branchIndex = branchIndex ?? branchIndexFor();
								const executionData = that.getNodeExecutionOrPinnedData({
									nodeName,
									branchIndex,
									runIndex,
								});
								if (!executionData.length) return undefined;
								if (executionData[executionData.length - 1]) {
									return that.returnExecutionData(
										executionData[executionData.length - 1],
										resolveFullItem,
									);
								}
								return undefined;
							};
						}
						if (property === 'all') {
							ensureNodeExecutionData();
							return (branchIndex, runIndex) => {
								branchIndex = branchIndex ?? branchIndexFor();

								return that.returnExecutionData(
									that.getNodeExecutionOrPinnedData({ nodeName, branchIndex, runIndex }),
									resolveFullItem,
								);
							};
						}
						if (property === 'context') {
							return that.nodeContextGetter(nodeName);
						}
						if (property === 'params') {
							return that.workflow.getNode(nodeName)?.parameters;
						}
						return Reflect.get(target, property, receiver);
					},
				},
			);
		};

		const base = {
			$: (nodeName, resolveFullItem) => dollarAccessor(nodeName, resolveFullItem),

			/** packages/workflow/src/workflow-data-proxy.ts:1372 */
			$input: new Proxy(
				{},
				{
					has: () => true,
					ownKeys() {
						return ['all', 'context', 'first', 'item', 'last', 'params'];
					},
					getOwnPropertyDescriptor() {
						return {
							enumerable: true,
							configurable: true,
						};
					},
					get(target, property, receiver) {
						if (property === 'isProxy') return true;

						// The reference reaches the same state through a DIFFERENT expression:
						// `placeholdersDataInputData` comes from
						// `runData[active][runIndex].inputOverride` when the active node already
						// has run data and from `connectionInputData[runIndex]?.json` otherwise,
						// and it guards the fromAI placeholder lookup — not the item getters
						// (workflow-data-proxy.ts:1061-1079). Copying that expression here instead
						// would make `$input.all()` raise for an item that carries only `binary`,
						// where n8n answers. The behavioural equivalence of this shortcut is not a
						// claim: fixtures/corpus.json pins it with three scenarios
						// (input-placeholder-sourcing-edge, input-placeholder-from-input-override,
						// input-override-ai-tool-placeholder) and gate 07 catches both directions
						// of the mistake — removing the guard AND replacing it with the reference's
						// own placeholder expression.
						if (that.connectionInputData.length === 0) {
							throw createExpressionError('No execution data available', {
								runIndex: that.runIndex,
								itemIndex: that.itemIndex,
								type: 'no_execution_data',
							});
						}

						if (property === 'item') {
							return that.returnExecutionData(that.connectionInputData[that.itemIndex]);
						}
						if (property === 'first') {
							return (...args) => {
								if (args.length) {
									throw createExpressionError('$input.first() should have no arguments');
								}

								const result = that.connectionInputData;
								if (result[0]) {
									return that.returnExecutionData(result[0]);
								}
								return undefined;
							};
						}
						if (property === 'last') {
							return (...args) => {
								if (args.length) {
									throw createExpressionError('$input.last() should have no arguments');
								}

								const result = that.connectionInputData;
								if (result.length && result[result.length - 1]) {
									return that.returnExecutionData(result[result.length - 1]);
								}
								return undefined;
							};
						}
						if (property === 'all') {
							return () => {
								const result = that.connectionInputData;
								if (result.length) {
									return that.returnExecutionData(result);
								}
								return [];
							};
						}

						if (['context', 'params'].includes(property)) {
							// For the following properties we need the source data so fail in case it is missing
							// for some reason (even though that should actually never happen)
							if (!that.executeData?.source) {
								throw createExpressionError('Can’t get data for expression', {
									messageTemplate: 'Can’t get data for expression under ‘%%PARAMETER%%’ field',
									functionOverrides: {
										message: 'Can’t get data',
									},
									description:
										'Apologies, this is an internal error. See details for more information',
									causeDetailed: 'Missing sourceData (probably an internal error)',
									runIndex: that.runIndex,
								});
							}

							const sourceData = that.executeData.source.main[0];

							if (property === 'context') {
								return that.nodeContextGetter(sourceData.previousNode);
							}
							if (property === 'params') {
								return that.workflow.getNode(sourceData.previousNode)?.parameters;
							}
						}

						return Reflect.get(target, property, receiver);
					},
				},
			),

			$binary: {}, // Placeholder
			$data: {}, // Placeholder
			// reference 1458-1462: a Proxy object, NOT a function — `$env.FOO` must go
			// through the block check on every property read.
			$env: createEnvProvider(
				that.runIndex,
				that.itemIndex,
				that.envProviderState ?? createEnvProviderState(),
			),
			$evaluateExpression: (expression, itemIndex) => {
				itemIndex = itemIndex || that.itemIndex;
				return that.workflow.expression.getParameterValue(
					`=${expression}`,
					that.runExecutionData,
					that.runIndex,
					itemIndex,
					that.activeNodeName,
					that.connectionInputData,
					that.mode,
					that.additionalKeys,
					that.executeData,
					false,
					{},
					that.contextNodeName,
				);
			},
			// this is legacy syntax that is not documented
			$item: (itemIndex, runIndex) => {
				const defaultReturnRunIndex = runIndex === undefined ? -1 : runIndex;
				const dataProxy = new WorkflowDataProxy(
					this.workflow,
					this.runExecutionData,
					this.runIndex,
					itemIndex,
					this.activeNodeName,
					this.connectionInputData,
					that.siblingParameters,
					that.mode,
					that.additionalKeys,
					that.executeData,
					defaultReturnRunIndex,
					{},
					that.contextNodeName,
					undefined,
					{ luxon: that.luxon },
				);
				return dataProxy.getDataProxy();
			},
			// reference 1500-1504: ONE handler bound to three keys, because a workflow
			// that mis-cases `$fromai` must get the same behaviour, not a silent
			// undefined. The handler itself (fromAI placeholder resolution) belongs to
			// the Expression/fromAI LEGO and is declared NOT PORTED — but the keys
			// exist, so the sandbox shape matches and the failure is loud.
			$fromAI: fromAiDeferred,
			$fromAi: fromAiDeferred,
			$fromai: fromAiDeferred,
			// this is a legacy syntax that is not documented
			$items: (nodeName, outputIndex, runIndex) => {
				if (nodeName === undefined) {
					nodeName = that.prevNodeGetter().name;
					const node = this.workflow.nodes[nodeName];
					let result = that.connectionInputData;
					// reference has no optional chaining here: an unresolvable previous
					// node throws a TypeError, and that IS the n8n behaviour.
					if (node.executeOnce === true) {
						result = result.slice(0, 1);
					}
					if (result.length) {
						return result;
					}
					return [];
				}

				outputIndex = outputIndex || 0;
				runIndex = runIndex === undefined ? -1 : runIndex;

				return that.getNodeExecutionData(nodeName, false, outputIndex, runIndex);
			},
			$tool: {}, // Placeholder
			$json: {}, // Placeholder
			$node: this.nodeGetter(),
			$self: this.selfGetter(),
			$parameter: this.nodeParameterGetter(this.activeNodeName),
			$rawParameter: this.nodeParameterGetter(this.activeNodeName, false),
			$prevNode: this.prevNodeGetter(),
			$runIndex: this.runIndex,
			$mode: this.mode,
			$workflow: this.workflowGetter(),
			$itemIndex: this.itemIndex,
			$jmesPath: (data, query) => jmespathWrapper(that, data, query),

			// The reference puts the three luxon classes here (:1539-1543) as shorthand keys
			// for its module-scope import, and $now/$today just above (:1535-1536). This port
			// has no module-scope luxon: the classes and the two instances are installed
			// together in one loop below, so "no injected luxon" produces a loud
			// NotPortedError on all five keys instead of three `undefined`s and two errors.
			...that.additionalKeys,
			$getPairedItem: () => {
				throw new NotPortedError('$getPairedItem', 'workflow-data-proxy.ts:962');
			},

			// deprecated
			$jmespath: (data, query) => jmespathWrapper(that, data, query),
			$position: this.itemIndex,
			$thisItem: that.connectionInputData[that.itemIndex],
			$thisItemIndex: this.itemIndex,
			$thisRunIndex: this.runIndex,
			$nodeVersion: that.workflow.getNode(that.activeNodeName)?.typeVersion,
			$nodeId: that.workflow.getNode(that.activeNodeName)?.id,
			// reference :1556 `$agentInfo: this.agentInfo()`, and agentInfo() itself returns
			// undefined for every node type except the LangChain agent (:1061-1063). A bare
			// `undefined` here was faithful for the corpus and silently wrong for real agent
			// workflows — the inert-field pattern this package treats as a bug — so the node
			// type is checked. (Lazy where the reference is eager: the only observable
			// difference is that a malformed agent graph fails on read, not on construction.)
			get $agentInfo() {
				return that.agentInfo();
			},
			$webhookId: that.workflow.getNode(that.activeNodeName)?.webhookId,
		};

		// workflow-data-proxy.ts:1535-1536 + :1539-1543.
		//
		// `DateTime.now()` is called TWICE because the reference calls it twice. Deriving
		// $today from $now's instant looks like a bug fix (across a midnight boundary the two
		// can disagree by a day) but it is a behavioural deviation, and this package's job is
		// to be the contract the Rust port is written against — so the double sampling is
		// reproduced and gate 04 pins the call count with a fake luxon, which is the only way
		// to test a clock at all.
		const luxon = this.luxon;
		const luxonSandboxKeys = {
			DateTime: luxon?.DateTime,
			Interval: luxon?.Interval,
			Duration: luxon?.Duration,
			$now: luxon ? luxon.DateTime.now() : undefined,
			$today: luxon
				? luxon.DateTime.now().set({ hour: 0, minute: 0, second: 0, millisecond: 0 })
				: undefined,
		};
		for (const [symbol, value] of Object.entries(luxonSandboxKeys)) {
			if (value !== undefined) {
				base[symbol] = value;
				continue;
			}
			Object.defineProperty(base, symbol, {
				enumerable: true,
				get() {
					throw new NotPortedError(
						symbol,
						'workflow-data-proxy.ts:1535-1543 — needs luxon; this package injects it as `luxon` (see reference-runtime.mjs)',
					);
				},
			});
		}

		const throwOnMissingExecutionData = opts?.throwOnMissingExecutionData ?? true;

		return new Proxy(base, {
			has: () => true,
			get(target, name, receiver) {
				if (name === 'isProxy') return true;

				const JSON_ACCESS_KEYS = ['$data', '$json'];

				if (that.workflow.settings?.binaryMode === BINARY_MODE_COMBINED) {
					JSON_ACCESS_KEYS.push('$item');
				}

				if (typeof name === 'string' && JSON_ACCESS_KEYS.includes(name)) {
					return that
						.nodeDataGetter(that.contextNodeName, true, throwOnMissingExecutionData)
						?.json;
				}
				if (name === '$binary') {
					return that
						.nodeDataGetter(that.contextNodeName, true, throwOnMissingExecutionData)
						?.binary;
				}
				if (name === '$tool') {
					throw new NotPortedError('$tool', 'workflow-data-proxy.ts:1358');
				}

				return Reflect.get(target, name, receiver);
			},
		});
	}
}

/**
 * packages/workflow/src/workflow-data-proxy.ts:763-775 — `$jmesPath` / `$jmespath`.
 *
 * Module scope, not a class method: the reference defines `jmespathWrapper` next to the other
 * sandbox helpers and the class surface is compared method-for-method with it (gate 05), so
 * this port keeps the same shape and passes the instance in.
 *
 * Two details are the whole point and both are load-bearing:
 *  - the arity/type guard is checked BEFORE the module is touched, so a bad call raises
 *    the reference's ExpressionError even on a host that never supplied jmespath;
 *  - objects are spread into a copy because `jmespath.search` mutates what it walks
 *    (it stamps `__ident__` keys onto the nodes), and doing that to run data would leak
 *    engine bookkeeping into the user's `$json`. Arrays are passed through untouched,
 *    exactly as the reference does.
 */
function jmespathWrapper(proxy, data, query) {
	const that = proxy;
	if (typeof data !== 'object' || typeof query !== 'string') {
		throw new ExpressionError('expected two arguments (Object, string) for this function', {
			runIndex: that.runIndex,
			itemIndex: that.itemIndex,
		});
	}
	if (!that.jmespath) {
		throw new NotPortedError(
			'$jmesPath',
			'workflow-data-proxy.ts:763-775 — needs the jmespath module; this package injects it as `jmespath` (see reference-runtime.mjs)',
		);
	}
	if (!Array.isArray(data) && typeof data === 'object') {
		return that.jmespath.search({ ...data }, query);
	}
	return that.jmespath.search(data, query);
}

/** Re-exported so downstream LEGOs never import lodash directly (frozen port, node contract §11). */
export { lodashGet };
