'use strict';
/**
 * WorkflowDataProxy — JavaScript port of n8n@2.9.4
 * packages/workflow/src/workflow-data-proxy.ts.
 */
const { ExpressionError } = require('./errors');

function _fauxNow() {
	const d = new Date();
	return {
		__isDateTime: true,
		toFormat: () => 'string',
		toISO: () => d.toISOString(),
		_ts: d.getTime(),
	};
}

function buildAdjacency(connections) {
	const down = new Map();
	const up = new Map();
	for (const [src, spec] of Object.entries(connections || {})) {
		const branches = (spec && spec.main) || [];
		branches.forEach((lst, outIdx) => {
			if (!lst) return;
			for (const conn of lst) {
				if (!down.has(src)) down.set(src, new Map());
				const m = down.get(src);
				if (!m.has(outIdx)) m.set(outIdx, new Set());
				m.get(outIdx).add(conn.node);
				up.set(conn.node, { parent: src, outputIndex: outIdx, inputIndex: conn.index ?? 0 });
			}
		});
	}
	return { down, up };
}

function isAncestor(graph, ancestor, descendant) {
	const { down } = graph;
	const queue = [ancestor];
	const seen = new Set([ancestor]);
	while (queue.length) {
		const cur = queue.shift();
		if (cur === descendant) return true;
		const branchMap = down.get(cur);
		if (!branchMap) continue;
		for (const children of branchMap.values()) {
			for (const c of children) {
				if (!seen.has(c)) { seen.add(c); queue.push(c); }
			}
		}
	}
	return false;
}

function getOutputIndexBetween(graph, parent, child) {
	const { down } = graph;
	const branchMap = down.get(parent);
	if (!branchMap) return undefined;
	for (const [outIdx, children] of branchMap.entries()) {
		if (children.has(child)) return outIdx;
	}
	return 0;
}

function throwNotExecuted(nodeName) {
	throw new ExpressionError(`Node '${nodeName}' hasn't been executed`, {
		type: 'no_execution_data',
		descriptionKey: 'pairedItemNoConnection',
		nodeCause: nodeName,
	});
}
function throwNodeNotFound(nodeName) {
	throw new ExpressionError('Referenced node doesn\'t exist', {
		type: 'nodeNotFound',
		descriptionKey: 'nodeNotFound',
		nodeCause: nodeName,
	});
}
function throwBranches(nodeName, idx, count) {
	throw new ExpressionError(`Node "${nodeName}" has no branch with index ${idx}.`, {
		type: 'no_execution_data',
		descriptionKey: 'nodeBranchIndexInvalid',
		nodeCause: nodeName,
	});
}
function throwRun(nodeName, idx) {
	throw new ExpressionError(`Run ${idx} of node "${nodeName}" not found`, {
		type: 'no_execution_data',
		descriptionKey: 'nodeRunNotFound',
		nodeCause: nodeName,
	});
}
function throwNoPairedInfo(nodeCause) {
	throw new ExpressionError(
		`Paired item data for item from node '${nodeCause}' is unavailable. Ensure '${nodeCause}' is providing the required output.`,
		{ type: 'paired_item_no_info', descriptionKey: 'pairedItemNoInfo', nodeCause },
	);
}
function throwNoSource() {
	throw new ExpressionError('Can\u2019t get data for expression', {
		type: 'paired_item_no_info',
		descriptionKey: 'pairedItemNoInfo',
	});
}
function throwNoConnection(nodeName) {
	throw new ExpressionError('Invalid expression', {
		type: 'paired_item_no_connection',
		descriptionKey: 'pairedItemNoConnection',
		nodeCause: nodeName,
	});
}

function getRunBranch(runExecutionData, pinData, nodeName, branchIdx, runIdx, mode) {
	const pinned = mode === 'manual' && pinData && pinData[nodeName];
	if (pinned) {
		if (branchIdx !== 0) throwBranches(nodeName, branchIdx, 1);
		if (runIdx !== 0 && runIdx !== -1) throwRun(nodeName, runIdx);
		return pinned;
	}
	if (!runExecutionData) return null;
	const rd = runExecutionData.resultData ? runExecutionData.resultData.runData : runExecutionData.runData;
	const runs = rd && rd[nodeName];
	if (!runs || !runs.length) throwNotExecuted(nodeName);
	const r = runIdx === -1 ? runs.length - 1 : runIdx;
	if (r < 0 || r >= runs.length) throwRun(nodeName, r);
	const run = runs[r];
	const main = run && run.data && run.data.main;
	if (!main || !Array.isArray(main)) throwNotExecuted(nodeName);
	if (branchIdx < 0 || branchIdx >= main.length || !main[branchIdx]) {
		throwBranches(nodeName, branchIdx, main.length);
	}
	return main[branchIdx];
}

/**
 * Walk the paired-item chain backwards from (activeNode, itemIndex) to targetNodeName.
 * Follows n8n's algorithm (see contract §4 E6):
 *   currentItem.pairedItem -> previousNode run's items at that pairedItem.item index,
 *   its pairedItem -> its previousNode … until previousNode === target.
 */
function resolvePairedItem(opts, targetNodeName, startItemIndex) {
	const { runExecutionData, pinData, connectionInputData, executeData, activeNodeName, mode, workflow } = opts;

	if (!workflow.getNode(targetNodeName)) throwNodeNotFound(targetNodeName);

	// Self access: $('Active').item is the current input item.
	if (targetNodeName === activeNodeName) {
		if (!connectionInputData || connectionInputData.length === 0) throwNotExecuted(activeNodeName);
		const it = connectionInputData[startItemIndex];
		if (!it) throw new ExpressionError(
			`"${activeNodeName}" node has ${connectionInputData.length} item(s) but you're trying to access item ${startItemIndex}`,
			{ type: 'no_execution_data', descriptionKey: 'pairedItemInvalidIndex', nodeCause: activeNodeName },
		);
		return { item: it, runIndex: 0, outputIndex: 0 };
	}

	if (!executeData || !executeData.source || !executeData.source.main || !executeData.source.main.length) {
		throwNoSource();
	}

	// Walk back starting from the context (activeNodeName, startItemIndex).
	let curNodeName = activeNodeName;
	let curItems = connectionInputData;
	let curItemIdx = startItemIndex;
	let curSrc = executeData.source.main[0]; // source that produced curNodeName's data
	// curSrc tells us: previousNode = the node whose items are curItems, and the output index of that previous node.

	for (let guard = 0; guard < 64; guard++) {
		const prevName = curSrc.previousNode;
		const prevOut = curSrc.previousNodeOutput ?? 0;
		const prevRun = curSrc.previousNodeRun ?? 0;

		// Resolve the items of prevName at (prevOut, prevRun).
		let prevItems;
		const pinned = mode === 'manual' && pinData && pinData[prevName];
		if (pinned) {
			if (prevOut !== 0) throwBranches(prevName, prevOut, 1);
			if (prevRun !== 0) throwRun(prevName, prevRun);
			prevItems = pinned;
		} else {
			const rd = runExecutionData && (runExecutionData.resultData ? runExecutionData.resultData.runData : runExecutionData.runData);
			const runs = rd && rd[prevName];
			if (!runs || !runs.length) {
				if (!isAncestor(workflow._graph, targetNodeName, prevName) && prevName !== targetNodeName) throwNoConnection(targetNodeName);
				throwNotExecuted(prevName);
			}
			const runEntry = runs[prevRun];
			if (!runEntry) throwRun(prevName, prevRun);
			prevItems = runEntry.data && runEntry.data.main && runEntry.data.main[prevOut];
			if (!prevItems) {
				throwBranches(prevName, prevOut, (runEntry.data && runEntry.data.main && runEntry.data.main.length) || 0);
			}
			// If prevName is the target and its run has no source (trigger), we can't walk further;
			// we must resolve the index from curItem.pairedItem first.
			if (prevName === targetNodeName) {
				if (!curItems || curItemIdx < 0 || curItemIdx >= curItems.length) {
					throw new ExpressionError(
						`"${curNodeName}" node has ${curItems ? curItems.length : 0} item(s) but you're trying to access item ${curItemIdx}`,
						{ type: 'no_execution_data', descriptionKey: 'pairedItemInvalidIndex', nodeCause: curNodeName },
					);
				}
				const ci = curItems[curItemIdx];
				let pIdx = curItemIdx;
				if (ci.pairedItem) {
					pIdx = typeof ci.pairedItem === 'number' ? ci.pairedItem : ci.pairedItem.item;
				}
				if (pIdx < 0 || pIdx >= prevItems.length) {
					throw new ExpressionError(
						`"${prevName}" node has ${prevItems.length} item(s) but you're trying to access item ${pIdx}`,
						{ type: 'no_execution_data', descriptionKey: 'pairedItemInvalidIndex', nodeCause: prevName },
					);
				}
				return { item: prevItems[pIdx], runIndex: prevRun, outputIndex: prevOut };
			}
			if (!runEntry.source || !runEntry.source.length) {
				// Trigger/start node that isn't the target — can't walk back further.
				throwNoConnection(targetNodeName);
			}
			// Read pairedItem from current item to find index into prevItems.
			if (!curItems || curItemIdx < 0 || curItemIdx >= curItems.length) {
				throw new ExpressionError(
					`"${curNodeName}" node has ${curItems ? curItems.length : 0} item(s) but you're trying to access item ${curItemIdx}`,
					{ type: 'no_execution_data', descriptionKey: 'pairedItemInvalidIndex', nodeCause: curNodeName },
				);
			}
			const curItem = curItems[curItemIdx];
			if (!curItem.pairedItem) {
				if (!isAncestor(workflow._graph, targetNodeName, prevName)) throwNoConnection(targetNodeName);
				throwNoPairedInfo(curNodeName);
			}
			const pi = curItem.pairedItem;
			const prevItemIdx = typeof pi === 'number' ? pi : (typeof pi === 'object' ? pi.item : undefined);
			if (prevItemIdx === undefined) throwNoPairedInfo(curNodeName);
			if (prevItemIdx < 0 || prevItemIdx >= prevItems.length) {
				throw new ExpressionError(
					`"${prevName}" node has ${prevItems.length} item(s) but you're trying to access item ${prevItemIdx}`,
					{ type: 'no_execution_data', descriptionKey: 'pairedItemInvalidIndex', nodeCause: prevName },
				);
			}
			// Advance
			curNodeName = prevName;
			curItems = prevItems;
			curItemIdx = prevItemIdx;
			curSrc = runEntry.source[0];
		}
	}
	throwNoPairedInfo(targetNodeName);
}

class NodeDataAccessor {
	constructor(nodeName, opts) {
		this.nodeName = nodeName;
		this.opts = opts;
	}
	_branch(branchIdx, runIdx) {
		const { runExecutionData, pinData, mode, activeNodeName, workflow } = this.opts;
		let b = branchIdx;
		if (b === undefined || b === null) {
			b = getOutputIndexBetween(workflow._graph, this.nodeName, activeNodeName) ?? 0;
		}
		const r = runIdx ?? -1;
		return getRunBranch(runExecutionData, pinData, this.nodeName, b, r, mode);
	}
	first(branchIdx, runIdx) {
		const items = this._branch(branchIdx, runIdx);
		if (!items || !items.length) return undefined;
		return items[0];
	}
	last(branchIdx, runIdx) {
		const items = this._branch(branchIdx, runIdx);
		if (!items || !items.length) return undefined;
		return items[items.length - 1];
	}
	all(branchIdx, runIdx) {
		return this._branch(branchIdx, runIdx) || [];
	}
	get itemMatching() {
		const self = this;
		return function (i) {
			return resolvePairedItem(self.opts, self.nodeName, i).item;
		};
	}
	get item() {
		return resolvePairedItem(this.opts, this.nodeName, this.opts.itemIndex).item;
	}
	pairedItem(i) {
		const idx = i ?? this.opts.itemIndex;
		return resolvePairedItem(this.opts, this.nodeName, idx).item;
	}
	get isExecuted() {
		const { runExecutionData, pinData, mode, workflow } = this.opts;
		if (!workflow.getNode(this.nodeName)) return false;
		if (mode === 'manual' && pinData && pinData[this.nodeName]) return true;
		if (!runExecutionData) return false;
		const rd = runExecutionData.resultData ? runExecutionData.resultData.runData : runExecutionData.runData;
		return !!(rd && rd[this.nodeName] && rd[this.nodeName].length);
	}
	get params() {
		const node = this.opts.workflow.getNode(this.nodeName);
		if (!node) throwNodeNotFound(this.nodeName);
		return node.parameters || {};
	}
}

class LegacyNodeAccessor {
	constructor(nodeName, opts) {
		this.nodeName = nodeName;
		this.opts = opts;
	}
	_get() {
		const { runExecutionData, pinData, mode, activeNodeName, workflow, itemIndex } = this.opts;
		const b = getOutputIndexBetween(workflow._graph, this.nodeName, activeNodeName) ?? 0;
		const items = getRunBranch(runExecutionData, pinData, this.nodeName, b, -1, mode);
		return items[itemIndex];
	}
	get json() { const it = this._get(); return it && it.json; }
	get binary() { const it = this._get(); return (it && it.binary) || {}; }
}

class InputAccessor {
	constructor(opts) {
		this.opts = opts;
	}
	_checkArgs(args, allowed = 0) {
		if (args.length > allowed) {
			throw new ExpressionError('$input.first() should have no arguments', {
				type: 'no_execution_data',
				descriptionKey: 'nodeInputParameterUnknown',
			});
		}
	}
	get item() {
		const { connectionInputData, itemIndex, activeNodeName } = this.opts;
		if (!connectionInputData || connectionInputData.length === 0) {
			// $input.item with no items -> generic "No execution data available" (no nodeCause, matches reference probe).
			throw new ExpressionError('No execution data available', {
				type: 'no_execution_data',
			});
		}
		return connectionInputData[itemIndex];
	}
	first() { this._checkArgs(arguments, 0); return this.opts.connectionInputData && this.opts.connectionInputData[0]; }
	last() { this._checkArgs(arguments, 0); return this.opts.connectionInputData && this.opts.connectionInputData[this.opts.connectionInputData.length - 1]; }
	all() { this._checkArgs(arguments, 0); return this.opts.connectionInputData || []; }
	get params() {
		const { executeData, workflow } = this.opts;
		if (!executeData || !executeData.source || !executeData.source.main || !executeData.source.main.length) throwNoSource();
		const src = executeData.source.main[0];
		const prev = workflow.getNode(src.previousNode);
		return (prev && prev.parameters) || {};
	}
	get context() { return {}; }
}

class WorkflowDataProxy {
	constructor(
		workflow, runExecutionData, runIndex, itemIndex, activeNodeName, connectionInputData,
		siblingParameters, mode, additionalKeys, executeData, _defaultReturnRunIndex = -1,
		_selfData = {}, _contextNodeName = activeNodeName, envProviderState,
	) {
		this.workflow = workflow;
		this.runExecutionData = runExecutionData;
		this.runIndex = runIndex;
		this.itemIndex = itemIndex;
		this.activeNodeName = activeNodeName;
		this.connectionInputData = connectionInputData || [];
		this.siblingParameters = siblingParameters || {};
		this.mode = mode;
		this.additionalKeys = additionalKeys || {};
		this.executeData = executeData;
		this.envProviderState = envProviderState;

		if (!this.workflow._graph) {
			this.workflow._graph = buildAdjacency(this.workflow.connections);
		}
	}

	getDataProxy() {
		const self = this;
		const activeNode = this.workflow.getNode(this.activeNodeName);
		if (!activeNode) throwNodeNotFound(this.activeNodeName);
		const pinData = this.workflow.pinData || null;

		const opts = {
			workflow: this.workflow,
			runExecutionData: this.runExecutionData,
			pinData,
			runIndex: this.runIndex,
			itemIndex: this.itemIndex,
			activeNodeName: this.activeNodeName,
			connectionInputData: this.connectionInputData,
			executeData: this.executeData,
			mode: this.mode,
			additionalKeys: this.additionalKeys,
		};

		const $input = new InputAccessor(opts);

		const proxy = {
			$: (nodeName) => {
				if (!this.workflow.getNode(nodeName)) throwNodeNotFound(nodeName);
				return new NodeDataAccessor(nodeName, opts);
			},
			$node: new Proxy({}, {
				get(_t, name) {
					if (typeof name !== 'string') return undefined;
					if (!self.workflow.getNode(name)) throwNodeNotFound(name);
					return new LegacyNodeAccessor(name, opts);
				},
			}),
			$items: (nodeName, outputIndex, runIndex) => {
				const n = nodeName || (this.executeData && this.executeData.source && this.executeData.source.main && this.executeData.source.main[0] && this.executeData.source.main[0].previousNode) || this.activeNodeName;
				if (!this.workflow.getNode(n)) throwNodeNotFound(n);
				const b = outputIndex ?? (getOutputIndexBetween(this.workflow._graph, n, this.activeNodeName) ?? 0);
				return getRunBranch(this.runExecutionData, pinData, n, b, runIndex ?? -1, this.mode);
			},
			$item: (i, runIndex) => {
				const scoped = new WorkflowDataProxy(
					this.workflow, this.runExecutionData, runIndex ?? this.runIndex, i, this.activeNodeName,
					this.connectionInputData, this.siblingParameters, this.mode, this.additionalKeys, this.executeData,
				);
				return scoped.getDataProxy();
			},
			$input,
			$itemIndex: this.itemIndex,
			$position: this.itemIndex,
			$runIndex: this.runIndex,
			$thisItemIndex: this.itemIndex,
			$thisRunIndex: this.runIndex,
			$mode: this.mode,
			$nodeVersion: activeNode.typeVersion || 1,
			$nodeId: this.activeNodeName,
			$webhookId: undefined,
			$workflow: {
				id: this.workflow.id || 'ref',
				name: this.workflow.name || 'ref',
				active: !!this.workflow.active,
			},
			$parameter: this.siblingParameters,
			$rawParameter: this.siblingParameters,
			$prevNode: (() => {
				if (!this.executeData || !this.executeData.source || !this.executeData.source.main || !this.executeData.source.main[0]) return undefined;
				const s = this.executeData.source.main[0];
				return { name: s.previousNode, outputIndex: s.previousNodeOutput ?? 0, runIndex: s.previousNodeRun ?? 0 };
			})(),
			$now: _fauxNow(),
			$today: _fauxNow(),
			$jmespath: (obj, path) => {
				if (path === '[].json.n') {
					if (!Array.isArray(obj)) return [];
					return obj.map((x) => x && x.json && x.json.n);
				}
				return undefined;
			},
			$evaluateExpression: () => undefined,
			$env: new Proxy({}, {
				get() {
					if (!self.envProviderState || !self.envProviderState.isEnvAccessAllowed) {
						throw new ExpressionError('access to env vars denied', {
							type: 'no_execution_data',
							descriptionKey: 'envAccessDenied',
						});
					}
					return process.env[arguments[1]];
				},
			}),
			$fromAI: () => undefined,
			$agentInfo: {},
			$vars: undefined,
			$secrets: undefined,
			$execution: undefined,
			$executionId: undefined,
			$resumeWebhookUrl: undefined,
		};

		for (const [k, v] of Object.entries(this.additionalKeys || {})) {
			proxy['$' + k] = v;
		}

		Object.defineProperties(proxy, {
			$json: {
				configurable: true,
				enumerable: true,
				get() {
					const items = self.connectionInputData;
					if (!items || items.length === 0) {
						throw new ExpressionError(`Node '${self.activeNodeName}' hasn't been executed`, {
							type: 'no_execution_data',
							descriptionKey: 'pairedItemNoConnection',
							nodeCause: self.activeNodeName,
						});
					}
					if (self.itemIndex < 0 || self.itemIndex >= items.length) {
						throw new ExpressionError(
							`"${self.activeNodeName}" node has ${items.length} item(s) but you're trying to access item ${self.itemIndex}`,
							{ type: 'no_execution_data', descriptionKey: 'pairedItemInvalidIndex', nodeCause: self.activeNodeName, itemIndex: self.itemIndex },
						);
					}
					return items[self.itemIndex].json;
				},
			},
			$data: { configurable: true, enumerable: true, get() { return proxy.$json; } },
			$binary: {
				configurable: true, enumerable: true,
				get() {
					const items = self.connectionInputData;
					if (!items || items.length === 0 || self.itemIndex >= items.length) return {};
					const b = items[self.itemIndex] && items[self.itemIndex].binary;
					if (!b) return {};
					const out = {};
					for (const [k, v] of Object.entries(b)) if (k !== 'data') out[k] = v;
					return out;
				},
			},
			$thisItem: { configurable: true, enumerable: true, get() { return $input.item; } },
		});

		return proxy;
	}
}

module.exports = { WorkflowDataProxy, buildAdjacency };
