/**
 * WorkflowDataProxy — the `$json` / `$node` / `$items` / `$input` variable set
 * that nodes and expressions run against.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/workflow-data-proxy.ts
 *   reference/n8n/packages/core/src/execution-engine/workflow-execute.ts L2479 (`getWorkflowDataProxy(0)`)
 *
 * SUBSET — see docs/isolation/execution.md §"Known deltas". Implemented:
 *   $json $binary $itemIndex $runIndex $node $items $input $parameter $parameters
 *   $execution $workflow $now $today $prevNode $env $getPairedItem
 * Not implemented (owned by later LEGOs): $vars, $secrets, $evaluateExpression,
 * $workflow.settings/versionId, AI/`$fromAI`, data tables, `$jmespath`, and the
 * full Luxon DateTime surface (a small shim is provided instead).
 */

import { ApplicationError } from './errors.mjs';

const NO_ITEM = Symbol('no-item');

/** Minimal Luxon-like wrapper so `$now.toISO()` / `$today.toFormat(...)` work. */
export class DataProxyDateTime {
	constructor(date = new Date()) {
		this.date = date instanceof Date ? date : new Date(date);
	}

	get year() { return this.date.getUTCFullYear(); }
	get month() { return this.date.getUTCMonth() + 1; }
	get day() { return this.date.getUTCDate(); }
	get hour() { return this.date.getUTCHours(); }
	get minute() { return this.date.getUTCMinutes(); }
	get second() { return this.date.getUTCSeconds(); }
	get millisecond() { return this.date.getUTCMilliseconds(); }

	toISO() { return this.date.toISOString(); }
	toJSDate() { return new Date(this.date.getTime()); }
	toMillis() { return this.date.getTime(); }
	toString() { return this.date.toISOString(); }
	toJSON() { return this.date.toISOString(); }

	/** Subset of Luxon's `toFormat`: yyyy MM dd HH mm ss SSS tokens. */
	toFormat(format) {
		const pad = (value, length = 2) => String(value).padStart(length, '0');
		return format
			.replace(/yyyy/g, String(this.year))
			.replace(/MM/g, pad(this.month))
			.replace(/dd/g, pad(this.day))
			.replace(/HH/g, pad(this.hour))
			.replace(/mm/g, pad(this.minute))
			.replace(/ss/g, pad(this.second))
			.replace(/SSS/g, pad(this.millisecond, 3));
	}
}

export class WorkflowDataProxy {
	constructor({
		workflow,
		runExecutionData,
		runIndex = 0,
		itemIndex = 0,
		activeNodeName,
		connectionInputData = [],
		inputData = {},
		executionData,
		mode = 'manual',
		additionalData = {},
	} = {}) {
		this.workflow = workflow;
		this.runExecutionData = runExecutionData;
		this.runIndex = runIndex;
		this.itemIndex = itemIndex;
		this.activeNodeName = activeNodeName;
		this.connectionInputData = connectionInputData;
		this.inputData = inputData;
		this.executionData = executionData;
		this.mode = mode;
		this.additionalData = additionalData;
		this._proxy = undefined;
	}

	/** Items a node produced in a given run/output, or `[]`. */
	getNodeOutput(nodeName, outputIndex = 0, runIndex = this.runIndex) {
		return this.runExecutionData?.resultData?.runData?.[nodeName]?.[runIndex]?.data?.main?.[outputIndex] ?? [];
	}

	getNodeRunData(nodeName, runIndex = this.runIndex) {
		return this.runExecutionData?.resultData?.runData?.[nodeName]?.[runIndex];
	}

	nodeExists(nodeName) {
		return this.workflow?.nodes?.[nodeName] !== undefined;
	}

	/**
	 * `$getPairedItem` — resolves an item by following `pairedItem` + `source`
	 * information (subset: one level, arrays use their first entry, and a
	 * `sourceOverwrite` is honoured). Returns the target item or `null`.
	 */
	getPairedItem(sourceNodeName, sourceData, pairedItemData, outputIndex = 0, runIndex = this.runIndex) {
		if (!pairedItemData) return null;

		const item = Array.isArray(pairedItemData) ? pairedItemData[0] : pairedItemData;
		if (!item || item.item === undefined) return null;

		const source = item.sourceOverwrite ?? sourceData;
		const previousNode = source?.previousNode ?? sourceNodeName;
		const previousNodeOutput = source?.previousNodeOutput ?? outputIndex;
		const previousNodeRun = source?.previousNodeRun ?? runIndex;

		const items = this.getNodeOutput(previousNode, previousNodeOutput, previousNodeRun);
		const found = items[item.item];
		return found ?? null;
	}

	/** `$node["Name"]` proxy — lazy, so unused nodes never throw. */
	getNodeProxy(nodeName) {
		const self = this;
		const lookup = (outputIndex = 0, runIndex = this.runIndex) => {
			const items = self.getNodeOutput(nodeName, outputIndex, runIndex);
			return items[self.itemIndex] ?? items[0] ?? NO_ITEM;
		};

		return {
			get name() { return nodeName; },
			get json() {
				const item = self.resolveNodeItem(nodeName);
				return item === NO_ITEM ? {} : (item.json ?? {});
			},
			get binary() {
				const item = self.resolveNodeItem(nodeName);
				return item === NO_ITEM ? undefined : item.binary;
			},
			get error() {
				const item = self.resolveNodeItem(nodeName);
				return item === NO_ITEM ? undefined : item.error;
			},
			get pairedItem() {
				const item = self.resolveNodeItem(nodeName);
				return item === NO_ITEM ? undefined : item.pairedItem;
			},
			get item() {
				const item = self.resolveNodeItem(nodeName);
				return item === NO_ITEM ? undefined : item;
			},
			get runIndex() { return self.runIndex; },
			itemMatching(itemIndex = self.itemIndex) {
				const items = self.getNodeOutput(nodeName, 0, self.runIndex);
				return items[itemIndex] ?? NO_ITEM;
			},
			all(outputIndex = 0, runIndex = self.runIndex) {
				return self.getNodeOutput(nodeName, outputIndex, runIndex);
			},
			lookup,
			isEmpty() {
				return self.getNodeOutput(nodeName).length === 0;
			},
		};
	}

	/**
	 * Resolve the item of another node for the current item: follow `pairedItem`
	 * back when the current input item has one, otherwise fall back to the same
	 * item index (upstream's `$node[..].json` compatibility behaviour).
	 */
	resolveNodeItem(nodeName) {
		if (!this.nodeExists(nodeName)) {
			throw new ApplicationError(`Can't get data for expression: node "${nodeName}" does not exist`, {
				extra: { nodeName, activeNodeName: this.activeNodeName },
			});
		}

		const currentItem = this.connectionInputData?.[this.itemIndex];
		const sourceData = this.executionData?.source?.main?.[currentItem?.pairedItem?.input ?? 0];
		const paired = this.getPairedItem(nodeName, sourceData, currentItem?.pairedItem);

		if (paired) return paired;

		const items = this.getNodeOutput(nodeName);
		return items[this.itemIndex] ?? items[0] ?? NO_ITEM;
	}

	get proxy() {
		if (this._proxy === undefined) this._proxy = this.buildProxy();
		return this._proxy;
	}

	buildProxy() {
		const self = this;
		const currentNode = this.workflow?.nodes?.[this.activeNodeName];
		const currentItem = this.connectionInputData?.[this.itemIndex];
		const nodeProxyCache = new Map();

		const $node = new Proxy(
			{},
			{
				get: (_target, name) => {
					if (typeof name !== 'string') return undefined;
					if (!nodeProxyCache.has(name)) nodeProxyCache.set(name, self.getNodeProxy(name));
					return nodeProxyCache.get(name);
				},
				has: (_target, name) => self.nodeExists(name),
			},
		);

		return {
			$json: currentItem?.json ?? {},
			$binary: currentItem?.binary ?? {},
			$itemIndex: this.itemIndex,
			$runIndex: this.runIndex,
			$node,
			$items: (nodeName, outputIndex = 0, runIndex = this.runIndex) => {
				if (!self.nodeExists(nodeName)) {
					throw new ApplicationError(`Can't get data for expression: node "${nodeName}" does not exist`, {
						extra: { nodeName, activeNodeName: self.activeNodeName },
					});
				}
				return self.getNodeOutput(nodeName, outputIndex, runIndex);
			},
			$input: {
				all: () => self.connectionInputData,
				first: () => self.connectionInputData[0],
				last: () => self.connectionInputData.at(-1),
				item: currentItem,
				params: currentNode?.parameters ?? {},
				context: {},
			},
			$parameter: currentNode?.parameters ?? {},
			$parameters: currentNode?.parameters ?? {},
			$execution: {
				id: self.additionalData.executionId ?? null,
				mode: self.mode,
				resumeUrl: self.additionalData.resumeUrl ?? null,
				customData: self.additionalData.customData ?? {},
			},
			$workflow: {
				id: self.workflow?.id,
				name: self.workflow?.name,
				active: self.workflow?.active ?? false,
			},
			$now: new DataProxyDateTime(),
			$today: new DataProxyDateTime(new Date(new Date().toISOString().slice(0, 10))),
			$prevNode: {
				name: this.executionData?.source?.main?.[currentItem?.pairedItem?.input ?? 0]?.previousNode,
				outputIndex: this.executionData?.source?.main?.[currentItem?.pairedItem?.input ?? 0]?.previousNodeOutput ?? 0,
				runIndex: this.executionData?.source?.main?.[currentItem?.pairedItem?.input ?? 0]?.previousNodeRun ?? 0,
			},
			$env: self.additionalData.env ?? {},
			$getPairedItem: (nodeName, sourceData, pairedItemData, outputIndex, runIndex) =>
				self.getPairedItem(nodeName, sourceData, pairedItemData, outputIndex, runIndex),
		};
	}
}

/**
 * `getPairedItem` free function for scopes without a proxy instance
 * (used by `splitErrorOutputs` in error-handling.mjs).
 */
export function resolvePairedItemJson(proxy, sourceData, pairedItemData, { runIndex = 0, outputIndex = 0 } = {}) {
	if (!proxy) return null;
	const source = Array.isArray(sourceData) ? sourceData[0] : sourceData;
	const nodeName = source?.previousNode;
	if (!nodeName) return null;
	const item = proxy.getPairedItem(nodeName, source, pairedItemData, outputIndex, runIndex);
	return item?.json ?? null;
}
