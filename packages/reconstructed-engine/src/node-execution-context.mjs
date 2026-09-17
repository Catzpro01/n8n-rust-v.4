/**
 * Node Execution Context — the node-side data-access surface, reconstructed
 * 1:1 from the pinned reference (n8n 2.9.4).
 *
 * Provenance (packages/core/src/execution-engine/node-execution-context/):
 *   node-execution-context.ts:58-69      constructor + fields
 *   node-execution-context.ts:71-253     identity, graph, settings, inputs/outputs accessors
 *   node-execution-context.ts:297-395    credentials access (_getCredentials guard chain)
 *   node-execution-context.ts:414-428    additionalKeys + getNodeParameter
 *   node-execution-context.ts:434-529    _getNodeParameter (expression resolution + option pipeline)
 *   node-execution-context.ts:531-545    evaluateExpression, prepareOutputData
 *   base-execute-context.ts:38-133       BaseExecuteContext (run data, input items, metadata, wait)
 *   base-execute-context.ts:146-190      getInputItems / getInputSourceData / getWorkflowDataProxy
 *   base-execute-context.ts:192-215      sendMessageToUI
 *   execute-context.ts:52-131            ExecuteContext (helper bag, getNodeParameter binding)
 *   execute-context.ts:186-193,212-231   isStreaming, getInputData, logNodeOutput
 *   utils/cleanup-parameter-data.ts      cleanupParameterData
 *   utils/get-additional-keys.ts         additionalKeys (delegated to ./additional-keys.mjs)
 *
 * CLASS HIERARCHY mirrors the reference (NodeExecutionContext → BaseExecuteContext →
 * ExecuteContext) so a node type written against n8n sees the same method
 * resolution order, the same `this` fields and the same binding of
 * `getNodeParameter` (arity 4 on the base class with itemIndex fixed to 0,
 * re-bound on ExecuteContext to take `itemIndex` as the 2nd argument — a real
 * behavioural difference, see test/07-context.test.mjs case C-04).
 *
 * DEPENDENCY SEAMS (constructor's optional 15th argument, `deps`)
 *   deps.nodeHelpers  NodeHelpers used for display/feature decisions.
 *                     Default: the pinned reference runtime's NodeHelpers.
 *   deps.luxon        used by cleanupParameterData + sendMessageToUI date handling.
 *                     Default: the reference runtime's luxon.
 *   deps.instanceId   replaces the reference's `Container.get(InstanceSettings)`;
 *                     the DI lookup is NOT ported (declared deviation, see
 *                     manifest/port-surface.json → deviations).
 *   When a seam is unavailable and a method needs it, that method throws
 *   NotPortedError — it never guesses.
 */

import { CHAT_TRIGGER_NODE_TYPE, NodeConnectionTypes, WAIT_INDEFINITELY } from './constants.mjs';
import { ApplicationError, ExpressionError, NodeOperationError } from './errors.mjs';
import { deepCopy, get as lodashGet } from './utils.mjs';
import { getContext } from './run-execution-data.mjs';
import { NotPortedError, WorkflowDataProxy } from './workflow-data-proxy.mjs';
import { getAdditionalKeys } from './additional-keys.mjs';
import { referenceRuntime } from './reference-runtime.mjs';

/**
 * Re-exported for the existing import sites; the definition (and the single
 * source of truth for the literal) lives in ./constants.mjs, exactly as the
 * reference imports it from n8n-workflow's constants.
 */
export { CHAT_TRIGGER_NODE_TYPE };

/**
 * packages/core/.../node-execution-context/utils/request-helper-functions.ts +
 * node-execution-context.ts:414-421 — the three node types allowed to read any
 * credential (hardcoded in the reference "for security reasons").
 */
const HTTP_REQUEST_NODE_TYPE = 'n8n-nodes-base.httpRequest';
const HTTP_REQUEST_TOOL_NODE_TYPE = 'n8n-nodes-base.httpTool';
const HTTP_REQUEST_AS_TOOL_NODE_TYPE = 'n8n-nodes-base.httpRequestTool';

/**
 * utils/cleanup-parameter-data.ts:10 — converts luxon DateTimes found anywhere in
 * a resolved parameter to strings ("only valid data gets returned"). Without
 * luxon there is nothing to detect, so the value is returned untouched.
 */
export function cleanupParameterData(inputData, luxon) {
	if (typeof inputData !== 'object' || inputData === null) {
		return;
	}

	if (Array.isArray(inputData)) {
		inputData.forEach((value) => cleanupParameterData(value, luxon));
		return;
	}

	const isDateTime = luxon?.DateTime?.isDateTime ?? (() => false);

	Object.keys(inputData).forEach((key) => {
		const value = inputData[key];
		if (typeof value === 'object') {
			if (isDateTime(value)) {
				inputData[key] = value.toString();
			} else {
				cleanupParameterData(value, luxon);
			}
		}
	});
}

export class NodeExecutionContext {
	constructor(
		workflow,
		node,
		additionalData,
		mode,
		runExecutionData = null,
		runIndex = 0,
		connectionInputData = [],
		executeData = undefined,
		deps = {},
	) {
		this.workflow = workflow;
		this.node = node;
		this.additionalData = additionalData;
		this.mode = mode;
		this.runExecutionData = runExecutionData;
		this.runIndex = runIndex;
		this.connectionInputData = connectionInputData;
		this.executeData = executeData;

		const runtime = referenceRuntime();
		this.nodeHelpers = deps.nodeHelpers ?? runtime?.workflow?.NodeHelpers ?? null;
		this.luxon = deps.luxon ?? runtime?.luxon ?? null;
		this.instanceId = deps.instanceId;
		this.runtime = runtime;

		// @Memoized fields in the reference are per-instance caches; identity
		// stability is observable (workflowSettings is frozen once).
		this.__memo = new Map();
	}

	#memoized(key, compute) {
		if (!this.__memo.has(key)) {
			this.__memo.set(key, compute());
		}
		return this.__memo.get(key);
	}

	get logger() {
		return this.#memoized('logger', () => this.additionalData.logger ?? quietLogger);
	}

	getExecutionContext() {
		return this.runExecutionData?.executionData?.runtimeData;
	}

	getExecutionId() {
		return this.additionalData.executionId;
	}

	getNode() {
		return deepCopy(this.node);
	}

	getWorkflow() {
		const { id, name, active } = this.workflow;
		return { id, name, active };
	}

	getMode() {
		return this.mode;
	}

	getWorkflowStaticData(type) {
		return this.workflow.getStaticData(type, this.node);
	}

	getChildNodes(nodeName, options) {
		const output = [];
		const nodeNames = this.workflow.getChildNodes(nodeName);

		for (const n of nodeNames) {
			const node = this.workflow.nodes[n];
			const entry = {
				name: node.name,
				type: node.type,
				typeVersion: node.typeVersion,
				disabled: node.disabled ?? false,
			};

			if (options?.includeNodeParameters) {
				entry.parameters = node.parameters;
			}

			output.push(entry);
		}
		return output;
	}

	getParentNodes(nodeName, options) {
		const output = [];
		const nodeNames = this.workflow.getParentNodes(
			nodeName,
			options?.connectionType,
			options?.depth,
		);

		for (const n of nodeNames) {
			const node = this.workflow.nodes[n];
			const entry = {
				name: node.name,
				type: node.type,
				typeVersion: node.typeVersion,
				disabled: node.disabled ?? false,
			};

			if (options?.includeNodeParameters) {
				entry.parameters = node.parameters;
			}

			output.push(entry);
		}
		return output;
	}

	/**
	 * node-execution-context.ts:160 — "needed for sub-nodes where the parent nodes
	 * are not available". Note the redundant `nodes[node.name]` lookup and that the
	 * loop returns the *first* match, not the last: both are reference behaviour.
	 */
	getChatTrigger() {
		for (const node of Object.values(this.workflow.nodes)) {
			if (this.workflow.nodes[node.name].type === CHAT_TRIGGER_NODE_TYPE) {
				return this.workflow.nodes[node.name];
			}
		}

		return null;
	}

	get workflowSettings() {
		return this.#memoized('workflowSettings', () => Object.freeze(structuredClone(this.workflow.settings)));
	}

	getWorkflowSettings() {
		return this.workflowSettings;
	}

	get nodeType() {
		return this.#memoized('nodeType', () => {
			const { type, typeVersion } = this.node;
			return this.workflow.nodeTypes.getByNameAndVersion(type, typeVersion);
		});
	}

	get nodeFeatures() {
		return this.#memoized('nodeFeatures', () => {
			this.#requireNodeHelpers('getNodeFeatures');
			return this.nodeHelpers.getNodeFeatures(
				this.nodeType.description.features,
				this.node.typeVersion,
			);
		});
	}

	isNodeFeatureEnabled(featureName) {
		return this.nodeFeatures[featureName] ?? false;
	}

	get nodeInputs() {
		return this.#memoized('nodeInputs', () => {
			this.#requireNodeHelpers('getNodeInputs');
			return this.nodeHelpers
				.getNodeInputs(this.workflow, this.node, this.nodeType.description)
				.map((input) => (typeof input === 'string' ? { type: input } : input));
		});
	}

	getNodeInputs() {
		return this.nodeInputs;
	}

	get nodeOutputs() {
		return this.#memoized('nodeOutputs', () => {
			this.#requireNodeHelpers('getNodeOutputs');
			return this.nodeHelpers
				.getNodeOutputs(this.workflow, this.node, this.nodeType.description)
				.map((output) => (typeof output === 'string' ? { type: output } : output));
		});
	}

	/**
	 * node-execution-context.ts:221 — `disabled` IS honoured here, unlike plain
	 * graph traversal (the asymmetry ISSUE-015 records for the Workflow LEGO).
	 */
	getConnectedNodes(connectionType) {
		return this.workflow
			.getParentNodes(this.node.name, connectionType, 1)
			.map((nodeName) => this.workflow.getNode(nodeName))
			.filter((node) => !!node)
			.filter((node) => node.disabled !== true);
	}

	getConnections(destination, connectionType) {
		return this.workflow.connectionsByDestinationNode[destination.name]?.[connectionType] ?? [];
	}

	getNodeOutputs() {
		return this.nodeOutputs;
	}

	getKnownNodeTypes() {
		return this.workflow.nodeTypes.getKnownTypes();
	}

	getRestApiUrl() {
		return this.additionalData.restApiUrl;
	}

	getInstanceBaseUrl() {
		return this.additionalData.instanceBaseUrl;
	}

	/**
	 * Reference resolves `InstanceSettings` through the DI container. Declared
	 * deviation: the DI lookup is not ported; the host passes `deps.instanceId`.
	 */
	getInstanceId() {
		if (this.instanceId === undefined) {
			throw new NotPortedError(
				'getInstanceId',
				'node-execution-context.ts:247 (Container.get(InstanceSettings))',
			);
		}
		return this.instanceId;
	}

	setSignatureValidationRequired() {
		if (this.runExecutionData) this.runExecutionData.validateSignature = true;
	}

	getSignedResumeUrl() {
		throw new NotPortedError(
			'getSignedResumeUrl',
			'node-execution-context.ts:253 (HMAC + InstanceSettings, persistence/crypto LEGO)',
		);
	}

	getTimezone() {
		return this.workflow.timezone;
	}

	getCredentialsProperties(type) {
		return this.additionalData.credentialsHelper.getCredentialsProperties(type);
	}

	/** node-execution-context.ts:297 — guard chain, ported branch by branch. */
	async _getCredentials(type, executeData, connectionInputData, itemIndex) {
		const { workflow, node, additionalData, mode, runExecutionData, runIndex } = this;
		// Get the NodeType as it has the information if the credentials are required
		const nodeType = workflow.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);

		// Hardcode for now for security reasons that only a single node can access
		// all credentials
		const fullAccess = [
			HTTP_REQUEST_NODE_TYPE,
			HTTP_REQUEST_TOOL_NODE_TYPE,
			HTTP_REQUEST_AS_TOOL_NODE_TYPE,
		].includes(node.type);

		let nodeCredentialDescription;
		if (!fullAccess) {
			if (nodeType.description.credentials === undefined) {
				throw new NodeOperationError(node, `Node type "${node.type}" does not have any credentials defined`, {
					level: 'warning',
				});
			}

			nodeCredentialDescription = nodeType.description.credentials.find(
				(credentialTypeDescription) => credentialTypeDescription.name === type,
			);
			if (nodeCredentialDescription === undefined) {
				throw new NodeOperationError(
					node,
					`Node type "${node.type}" does not have any credentials of type "${type}" defined`,
					{ level: 'warning' },
				);
			}

			if (
				!this.#displayParameter(
					additionalData.currentNodeParameters || node.parameters,
					nodeCredentialDescription,
					node,
					nodeType.description,
					node.parameters,
				)
			) {
				// Credentials should not be displayed even if they would be defined
				throw new NodeOperationError(node, 'Credentials not found');
			}
		}

		// Check if node has any credentials defined
		if (!fullAccess && !node.credentials?.[type]) {
			// If none are defined check if the credentials are required or not
			if (nodeCredentialDescription?.required === true) {
				// Credentials are required so error
				if (!node.credentials) {
					throw new NodeOperationError(node, 'Node does not have any credentials set', {
						level: 'warning',
					});
				}
				if (!node.credentials[type]) {
					throw new NodeOperationError(
						node,
						`Node does not have any credentials set for "${type}"`,
						{ level: 'warning' },
					);
				}
			} else {
				// Credentials are not required
				throw new NodeOperationError(node, 'Node does not require credentials');
			}
		}

		if (fullAccess && !node.credentials?.[type]) {
			// Make sure that fullAccess nodes still behave like before that if they
			// request access to credentials that are currently not set it returns undefined
			throw new NodeOperationError(node, 'Credentials not found');
		}

		let expressionResolveValues;
		if (connectionInputData && runExecutionData && runIndex !== undefined) {
			expressionResolveValues = {
				connectionInputData,
				itemIndex: itemIndex || 0,
				node,
				runExecutionData,
				runIndex,
				workflow,
			};
		}

		const nodeCredentials = node.credentials ? node.credentials[type] : {};

		additionalData.executionContext = this.getExecutionContext();
		const decryptedDataObject = await additionalData.credentialsHelper.getDecrypted(
			additionalData,
			nodeCredentials,
			type,
			mode,
			executeData,
			false,
			expressionResolveValues,
		);

		return decryptedDataObject;
	}

	#displayParameter(currentNodeParameters, credentialDescription, node, nodeTypeDescription, parameters) {
		this.#requireNodeHelpers('displayParameter');
		return this.nodeHelpers.displayParameter(
			currentNodeParameters,
			credentialDescription,
			node,
			nodeTypeDescription,
			parameters,
		);
	}

	get additionalKeys() {
		return this.#memoized('additionalKeys', () =>
			getAdditionalKeys(this.additionalData, this.mode, this.runExecutionData),
		);
	}

	#requireNodeHelpers(symbol) {
		if (!this.nodeHelpers?.[symbol]) {
			throw new NotPortedError(`NodeHelpers.${symbol}`, 'packages/workflow/src/node-helpers.ts');
		}
	}

	/**
	 * node-execution-context.ts:423 — on the base class `getNodeParameter` has NO
	 * itemIndex parameter: the item index is hardcoded to 0. ExecuteContext re-binds
	 * it. Getting this wrong changes which item every non-Code node reads.
	 */
	getNodeParameter(parameterName, fallbackValue, options) {
		const itemIndex = 0;
		return this._getNodeParameter(parameterName, itemIndex, fallbackValue, options);
	}

	_getNodeParameter(parameterName, itemIndex, fallbackValue, options) {
		const { workflow, node, mode, runExecutionData, runIndex, connectionInputData, executeData } =
			this;

		const nodeType = workflow.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);

		const value = lodashGet(node.parameters, parameterName, fallbackValue);

		if (value === undefined) {
			throw new ApplicationError('Could not get parameter', { extra: { parameterName } });
		}

		if (options?.rawExpressions) {
			return value;
		}

		const { additionalKeys } = this;

		let returnData;

		try {
			returnData = workflow.expression.getParameterValue(
				value,
				runExecutionData,
				runIndex,
				itemIndex,
				node.name,
				connectionInputData,
				mode,
				additionalKeys,
				executeData,
				false,
				{},
				options?.contextNode?.name,
			);
			cleanupParameterData(returnData, this.luxon);
		} catch (e) {
			if (
				e instanceof ExpressionError &&
				node.continueOnFail &&
				node.type === 'n8n-nodes-base.set'
			) {
				// https://linear.app/n8n/issue/PAY-684
				returnData = [{ name: undefined, value: undefined }];
			} else {
				if (e.context) e.context.parameter = parameterName;
				e.cause = value;
				throw e;
			}
		}

		// This is outside the try/catch because it throws errors with proper messages
		if (options?.extractValue) {
			throw new NotPortedError(
				'getNodeParameter({ extractValue })',
				'node-execution-context.ts:505 → utils/extract-value.ts (node-parameters LEGO)',
			);
		}

		if (options?.ensureType) {
			throw new NotPortedError(
				'getNodeParameter({ ensureType })',
				'node-execution-context.ts:512 → utils/ensure-type.ts',
			);
		}

		if (!options?.skipValidation) {
			throw new NotPortedError(
				'getNodeParameter(schema validation)',
				'node-execution-context.ts:521 → utils/validate-value-against-schema.ts (validation LEGO)',
			);
		}

		return returnData;
	}

	evaluateExpression(expression, itemIndex = 0) {
		return this.workflow.expression.resolveSimpleParameterValue(
			`=${expression}`,
			{},
			this.runExecutionData,
			this.runIndex,
			itemIndex,
			this.node.name,
			this.connectionInputData,
			this.mode,
			this.additionalKeys,
			this.executeData,
		);
	}

	async prepareOutputData(outputData) {
		return [outputData];
	}
}

const quietLogger = {
	error() {},
	warn() {},
	info() {},
	debug() {},
};

export class BaseExecuteContext extends NodeExecutionContext {
	constructor(
		workflow,
		node,
		additionalData,
		mode,
		runExecutionData,
		runIndex,
		connectionInputData,
		inputData,
		executeData,
		abortSignal = undefined,
		deps = {},
	) {
		super(
			workflow,
			node,
			additionalData,
			mode,
			runExecutionData,
			runIndex,
			connectionInputData,
			executeData,
			deps,
		);
		this.runExecutionData = runExecutionData;
		this.connectionInputData = connectionInputData;
		this.inputData = inputData;
		this.executeData = executeData;
		this.abortSignal = abortSignal;
	}

	getExecutionContext() {
		return this.runExecutionData.executionData?.runtimeData;
	}

	getExecutionCancelSignal() {
		return this.abortSignal;
	}

	onExecutionCancellation(handler) {
		const fn = () => {
			this.abortSignal?.removeEventListener('abort', fn);
			handler();
		};
		this.abortSignal?.addEventListener('abort', fn);
	}

	getExecuteData() {
		return this.executeData;
	}

	setMetadata(metadata) {
		this.executeData.metadata = {
			...(this.executeData.metadata ?? {}),
			...metadata,
		};
	}

	getContext(type) {
		return getContext(this.runExecutionData, type, this.node);
	}

	/** base-execute-context.ts:103 */
	async getCredentials(type, itemIndex) {
		return await this._getCredentials(type, this.executeData, this.connectionInputData, itemIndex);
	}

	/** Returns if execution should be continued even if there was an error */
	continueOnFail() {
		const onError = lodashGet(this.node, 'onError', undefined);

		if (onError === undefined) {
			return lodashGet(this.node, 'continueOnFail', false);
		}

		return ['continueRegularOutput', 'continueErrorOutput'].includes(onError);
	}

	async putExecutionToWait(waitTill) {
		this.runExecutionData.waitTill = waitTill;
		if (this.additionalData.setExecutionStatus) {
			this.additionalData.setExecutionStatus('waiting');
		}
	}

	async executeWorkflow(workflowInfo, inputData, parentCallbackManager, options) {
		if (options?.parentExecution) {
			if (
				!options.parentExecution.executionContext &&
				options.parentExecution.executionId === this.getExecutionId()
			) {
				options.parentExecution.executionContext = this.getExecutionContext();
			}
		}
		const result = await this.additionalData.executeWorkflow(workflowInfo, this.additionalData, {
			...options,
			parentWorkflowId: this.workflow.id,
			inputData,
			parentWorkflowSettings: this.workflow.settings,
			node: this.node,
			parentCallbackManager,
		});

		// If a sub-workflow execution goes into the waiting state
		if (result.waitTill) {
			// then put the parent workflow execution also into the waiting state,
			// but do not use the sub-workflow `waitTill` to avoid WaitTracker resuming
			// the parent execution at the same time as the sub-workflow
			await this.putExecutionToWait(WAIT_INDEFINITELY);
		}

		return result;
	}

	async getExecutionDataById(executionId) {
		return await this.additionalData.getRunExecutionData(executionId);
	}

	/**
	 * base-execute-context.ts:160 — note `inputData.length < inputIndex` (NOT `<=`):
	 * asking for an index equal to the length does not throw here, it falls through
	 * to `inputData[connectionType][inputIndex]` and yields `undefined`. That is the
	 * reference behaviour and the boundary case is pinned by test/07-context.test.mjs.
	 */
	getInputItems(inputIndex, connectionType) {
		const inputData = this.inputData[connectionType];
		if (inputData.length < inputIndex) {
			throw new ApplicationError('Could not get input with given index', {
				extra: { inputIndex, connectionType },
			});
		}

		const allItems = inputData[inputIndex];
		if (allItems === null) {
			throw new ApplicationError('Input index was not set', {
				extra: { inputIndex, connectionType },
			});
		}

		return allItems;
	}

	getInputSourceData(inputIndex = 0, connectionType = NodeConnectionTypes.Main) {
		if (this.executeData?.source === null) {
			// Should never happen as n8n sets it automatically
			throw new ApplicationError('Source data is missing');
		}
		return this.executeData.source[connectionType][inputIndex];
	}

	getWorkflowDataProxy(itemIndex) {
		return new WorkflowDataProxy(
			this.workflow,
			this.runExecutionData,
			this.runIndex,
			itemIndex,
			this.node.name,
			this.connectionInputData,
			{},
			this.mode,
			this.additionalKeys,
			this.executeData,
			-1,
			{},
			this.node.name,
			undefined,
			{ luxon: this.luxon },
		).getDataProxy();
	}

	// eslint-disable-next-line
	sendMessageToUI(...args) {
		if (this.mode !== 'manual') {
			return;
		}
		try {
			if (this.additionalData.sendDataToUI) {
				args = args.map((arg) => {
					// prevent invalid dates from being logged as null
					if (arg?.isLuxonDateTime && arg.invalidReason) return { ...arg };

					// log valid dates in human readable format, as in browser
					if (arg?.isLuxonDateTime) return new Date(arg.ts).toString();
					if (arg instanceof Date) return arg.toString();

					return arg;
				});

				this.additionalData.sendDataToUI('sendConsoleMessage', {
					source: `[Node: "${this.node.name}"]`,
					messages: args,
				});
			}
		} catch (error) {
			this.logger.warn(`There was a problem sending message to UI: ${error.message}`);
		}
	}

	logAiEvent(eventName, msg) {
		return this.additionalData.logAiEvent(eventName, {
			executionId: this.additionalData.executionId ?? 'unsaved-execution',
			nodeName: this.node.name,
			workflowName: this.workflow.name ?? 'Unnamed workflow',
			nodeType: this.node.type,
			workflowId: this.workflow.id ?? 'unsaved-workflow',
			msg,
		});
	}

	getRunnerStatus(taskType) {
		return this.additionalData.getRunnerStatus?.(taskType) ?? { available: true };
	}
}

export class ExecuteContext extends BaseExecuteContext {
	constructor(
		workflow,
		node,
		additionalData,
		mode,
		runExecutionData,
		runIndex,
		connectionInputData,
		inputData,
		executeData,
		closeFunctions,
		abortSignal,
		subNodeExecutionResults = undefined,
		deps = {},
	) {
		super(
			workflow,
			node,
			additionalData,
			mode,
			runExecutionData,
			runIndex,
			connectionInputData,
			inputData,
			executeData,
			abortSignal,
			deps,
		);
		this.closeFunctions = closeFunctions;
		this.subNodeExecutionResults = subNodeExecutionResults;

		this.hints = [];

		// execute-context.ts:107 — the helper bag. Everything the reference pulls from
		// request/binary/filesystem/dedup/data-table helpers belongs to other LEGOs;
		// the seam is declared instead of faked, so a missing capability is loud.
		this.helpers = {
			normalizeItems: deps.helpers?.normalizeItems,
			returnJsonArray: deps.helpers?.returnJsonArray,
			copyInputItems: deps.helpers?.copyInputItems,
			constructExecutionMetaData: deps.helpers?.constructExecutionMetaData,
		};

		// execute-context.ts:131 — `getNodeParameter` is re-bound, per-instance, to
		// the itemIndex-taking signature. Not inherited: the base keeps arity 3.
		this.getNodeParameter = (parameterName, itemIndex, fallbackValue, options) =>
			this._getNodeParameter(parameterName, itemIndex, fallbackValue, options);
	}

	isStreaming() {
		// Check if we have sendChunk handlers
		const handlers = this.additionalData.hooks?.handlers?.sendChunk?.length;
		const hasHandlers = handlers !== undefined && handlers > 0;

		// Check if streaming was enabled for this execution
		const streamingEnabled = this.additionalData.streamingEnabled === true;

		// Check current execution mode supports streaming
		const executionModeSupportsStreaming = ['manual', 'webhook', 'integrated', 'chat'];
		const isStreamingMode = executionModeSupportsStreaming.includes(this.mode);

		return hasHandlers && isStreamingMode && streamingEnabled;
	}

	async sendChunk(type, itemIndex, content) {
		const node = this.getNode();
		const metadata = {
			nodeId: node.id,
			nodeName: node.name,
			itemIndex,
			runIndex: this.runIndex,
			timestamp: Date.now(),
		};

		const parsedContent = typeof content === 'string' ? content : JSON.stringify(content);

		const message = {
			type,
			content: parsedContent,
			metadata,
		};

		await this.additionalData.hooks?.runHook('sendChunk', [message]);
	}

	getInputData(inputIndex = 0, connectionType = NodeConnectionTypes.Main) {
		if (!this.inputData.hasOwnProperty(connectionType)) {
			// Return empty array because else it would throw error when nothing is connected to input
			return [];
		}
		return super.getInputItems(inputIndex, connectionType) ?? [];
	}

	/**
	 * execute-context.ts:164 delegates to utils/get-input-connection-data.ts (533
	 * lines of AI-connection plumbing owned by the connection LEGO). Declared as a
	 * gap: calling it fails loudly instead of returning partial data.
	 */
	async getInputConnectionData() {
		throw new NotPortedError(
			'getInputConnectionData',
			'execute-context.ts:164 → utils/get-input-connection-data.ts (connection LEGO)',
		);
	}

	logNodeOutput(...args) {
		if (this.mode === 'manual') {
			const parsedLogArgs = args.map((arg) =>
				typeof arg === 'string' ? jsonParseSafe(arg) : arg,
			);
			this.sendMessageToUI(...parsedLogArgs);
			return;
		}

		if (process.env.CODE_ENABLE_STDOUT === 'true') {
			console.log(`[Workflow "${this.getWorkflow().id}"][Node "${this.node.name}"]`, ...args);
		}
	}

	async sendResponse(response) {
		await this.additionalData.hooks?.runHook('sendResponse', [response]);
	}

	/** @deprecated use ISupplyDataFunctions.addInputData */
	addInputData() {
		throw new ApplicationError('addInputData should not be called on IExecuteFunctions');
	}

	/** @deprecated use ISupplyDataFunctions.addOutputData */
	addOutputData() {
		throw new ApplicationError('addOutputData should not be called on IExecuteFunctions');
	}

	getParentCallbackManager() {
		return this.additionalData.parentCallbackManager;
	}

	addExecutionHints(...hints) {
		this.hints.push(...hints);
	}

	/** Returns true if the node is being executed as an AI Agent tool */
	isToolExecution() {
		return false;
	}
}

/** execute-context.ts:222 — jsonParse(arg, { fallbackValue: arg }) */
const jsonParseSafe = (arg) => {
	try {
		return JSON.parse(arg);
	} catch {
		return arg;
	}
};

export { NotPortedError };
