/**
 * Reconstructed n8n workflow execution engine.
 *
 * This module deliberately stays independent from `reference/n8n`.  It owns the
 * runtime orchestration seam only: node handlers are supplied by the host,
 * while workflow/node data keeps the wire shape documented in
 * `contracts/execution-data.contract.md`.
 */

const MAIN_CONNECTION = 'main';
const DEFAULT_MAX_NODE_EXECUTIONS = 1000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 5000;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const isObject = (value) => value !== null && typeof value === 'object';

const cloneValue = (value) => {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Values such as functions and streams are intentionally kept by
      // reference.  Parameter values in a workflow are normally cloneable.
    }
  }

  if (Array.isArray(value)) return value.map(cloneValue);
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
};

const getByPath = (value, path) => {
  if (!path) return value;
  const parts = String(path)
    .replace(/\[(['"])(.*?)\1\]/g, '.$2')
    .split('.')
    .filter(Boolean);

  let current = value;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
};

const setByPath = (value, path, nextValue) => {
  const parts = String(path)
    .replace(/\[(['"])(.*?)\1\]/g, '.$2')
    .split('.')
    .filter(Boolean);
  if (parts.length === 0) return value;

  let current = value;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(current[part])) current[part] = {};
    current = current[part];
  }
  current[parts.at(-1)] = nextValue;
  return value;
};

const toError = (error) => {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : JSON.stringify(error));
};

const serializeError = (error) => {
  const normalized = toError(error);
  const serialized = {
    name: normalized.name || 'Error',
    message: normalized.message || String(normalized),
  };

  if (normalized.stack) serialized.stack = normalized.stack;
  if ('code' in normalized && normalized.code !== undefined) serialized.code = normalized.code;
  if ('cause' in normalized && normalized.cause !== undefined) serialized.cause = serializeError(normalized.cause);

  return serialized;
};

const normalizeItem = (item) => {
  if (isObject(item) && hasOwn(item, 'json')) return item;
  if (item === undefined || item === null) return { json: {} };
  if (isObject(item)) return { json: item };
  return { json: { value: item } };
};

/**
 * Normalize the permissive values accepted from a node into execution items.
 * The function intentionally does not mutate a returned item or its `json`.
 */
export const normalizeItems = (items) => {
  if (items === undefined || items === null) return [];
  const list = Array.isArray(items) ? items : [items];
  return list.map((item) => {
    const normalized = normalizeItem(item);
    return {
      ...normalized,
      json: isObject(normalized.json) ? cloneValue(normalized.json) : {},
    };
  });
};

/**
 * A NodeOutput is `main[outputIndex][itemIndex]`.  A one-dimensional array is
 * treated as the main output for compatibility with the small handler API used
 * by the original reconstructed engine.
 */
export const normalizeNodeOutput = (output) => {
  if (output === undefined || output === null) return [[]];
  if (!Array.isArray(output)) return [[normalizeItem(output)]];
  if (output.length === 0) return [[]];

  const isMultiOutput = output.every((branch) => Array.isArray(branch));
  return isMultiOutput ? output.map((branch) => normalizeItems(branch)) : [normalizeItems(output)];
};

const countItems = (branches) => branches.reduce((count, branch) => count + branch.length, 0);

/**
 * Implements the item-pairing defaults from the execution-data contract.
 * Explicit pairing is never overwritten.
 */
export const assignPairedItems = (branch, inputItems) => {
  if (branch.length === 0) return branch;

  return branch.map((item, itemIndex) => {
    if (hasOwn(item, 'pairedItem')) return item;

    let pairedItem;
    if (inputItems.length === 1) {
      pairedItem = { item: 0 };
    } else if (inputItems.length > 1 && branch.length === inputItems.length) {
      pairedItem = { item: itemIndex };
    } else if (inputItems.length > 1 && branch.length === 1) {
      pairedItem = { item: 0 };
    }

    return pairedItem ? { ...item, pairedItem } : item;
  });
};

const errorItem = (error, inputItems) => {
  const serialized = serializeError(error);
  const item = {
    json: { error: serialized.message },
    error: serialized,
  };

  if (inputItems.length === 1) item.pairedItem = { item: 0 };
  else if (inputItems.length > 1) {
    item.pairedItem = inputItems.map((_input, itemIndex) => ({ item: itemIndex }));
  }

  return item;
};

const sleep = (milliseconds, signal) => {
  if (milliseconds <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Execution canceled'));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Execution canceled'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
};

const normalizeRetryCount = (node) => {
  if (node.retryOnFail !== true) return 1;
  return Math.min(MAX_RETRIES, Math.max(2, Number(node.maxTries) || DEFAULT_MAX_RETRIES));
};

const normalizeRetryDelay = (node) => {
  if (node.retryOnFail !== true) return 0;
  const configuredDelay = node.waitBetweenTries === undefined ? DEFAULT_RETRY_DELAY : Number(node.waitBetweenTries);
  return Math.min(MAX_RETRY_DELAY, Math.max(0, Number.isFinite(configuredDelay) ? configuredDelay : DEFAULT_RETRY_DELAY));
};

const isTriggerLike = (node) => {
  const type = String(node.type ?? '').toLowerCase();
  return type.includes('trigger') || type.includes('manual') || type.includes('start');
};

const flattenInputSlots = (inputSlots) => {
  const flattened = [];
  for (const items of inputSlots.values()) flattened.push(...items);
  return flattened;
};

const copySlots = (slots) => new Map([...slots.entries()].map(([index, items]) => [index, items.slice()]));

const parseExpression = (value) => {
  if (typeof value !== 'string' || !value.startsWith('=')) return null;
  if (value.startsWith('={{') && value.endsWith('}}')) return value.slice(3, -2).trim();
  return value.slice(1).trim();
};

/**
 * Small, dependency-free data proxy for handlers.  It intentionally exposes
 * only the execution-context surface needed by the reconstructed engine; the
 * full expression sandbox remains owned by the reference Expression LEGO.
 */
export class WorkflowDataProxy {
  constructor({ items, inputSlots, runData, currentNodeName, executionId, itemIndex = 0 }) {
    this.items = items;
    this.inputSlots = inputSlots;
    this.runData = runData;
    this.currentNodeName = currentNodeName;
    this.executionId = executionId;
    this.itemIndex = itemIndex;
  }

  get $json() {
    return this.items[this.itemIndex]?.json ?? {};
  }

  get $binary() {
    return this.items[this.itemIndex]?.binary;
  }

  get $item() {
    return this.items[this.itemIndex];
  }

  get $input() {
    const items = this.items;
    return {
      all: () => items,
      first: () => items[0],
      last: () => items.at(-1),
      item: items[this.itemIndex],
      params: this.items[this.itemIndex]?.json ?? {},
    };
  }

  get $execution() {
    return { id: this.executionId, mode: 'manual' };
  }

  getNodeItems(nodeName, outputIndex = 0, runIndex = -1) {
    const runs = this.runData[nodeName];
    if (!runs?.length) return [];
    const run = runs.at(runIndex);
    return run?.data?.main?.[outputIndex] ?? [];
  }

  node(nodeName, outputIndex = 0, runIndex = -1) {
    const nodeItems = this.getNodeItems(nodeName, outputIndex, runIndex);
    return {
      all: () => nodeItems,
      first: () => nodeItems[0],
      last: () => nodeItems.at(-1),
      item: nodeItems[0],
    };
  }

  $(nodeName, outputIndex = 0, runIndex = -1) {
    return this.node(nodeName, outputIndex, runIndex);
  }

  resolve(expression, itemIndex = this.itemIndex) {
    const text = parseExpression(expression);
    if (text === null) return expression;

    const current = new WorkflowDataProxy({
      items: this.items,
      inputSlots: this.inputSlots,
      runData: this.runData,
      currentNodeName: this.currentNodeName,
      executionId: this.executionId,
      itemIndex,
    });

    if (text === '$json') return current.$json;
    if (text === '$binary') return current.$binary;
    if (text === '$input.item') return current.$input.item;
    if (text === '$input.first()') return current.$input.first();
    if (text === '$input.last()') return current.$input.last();
    if (text === '$input.all()') return current.$input.all();
    if (text === '$execution.id') return current.$execution.id;

    const jsonMatch = text.match(/^\$json(?:\.(.+))?$/);
    if (jsonMatch) return getByPath(current.$json, jsonMatch[1]);

    const inputMatch = text.match(/^\$input\.(?:first|last)\(\)\.?(.*)$/);
    if (inputMatch) {
      const source = text.startsWith('$input.first') ? current.$input.first() : current.$input.last();
      return getByPath(source, inputMatch[1]);
    }

    const nodeMatch = text.match(/^\$\(['"](.+?)['"]\)\.(?:first|last)\(\)\.?(.*)$/);
    if (nodeMatch) {
      const source = text.includes('.last()')
        ? current.node(nodeMatch[1]).last()
        : current.node(nodeMatch[1]).first();
      return getByPath(source, nodeMatch[2]);
    }

    const nodePropertyMatch = text.match(/^\$node\[['"](.+?)['"]\]\.(.+)$/);
    if (nodePropertyMatch) {
      return getByPath(current.node(nodePropertyMatch[1]).first(), nodePropertyMatch[2]);
    }

    if (/^(true|false|null)$/.test(text)) return JSON.parse(text);
    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return Number(text);
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      return text.slice(1, -1);
    }

    throw new Error(`Unsupported expression: ${text}`);
  }
}

const resolveParameterValue = (value, proxy, itemIndex) => {
  if (typeof value === 'string') return proxy.resolve(value, itemIndex);
  if (Array.isArray(value)) return value.map((item) => resolveParameterValue(item, proxy, itemIndex));
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveParameterValue(item, proxy, itemIndex)]),
    );
  }
  return value;
};

/**
 * Context handed to every registered handler.  The class is intentionally
 * public so a host can build adapters without importing the execution loop.
 */
export class NodeExecutionContext {
  constructor({ engine, node, inputSlots, runData, runIndex, executionIndex, executionId, signal }) {
    this.engine = engine;
    this.node = node;
    this.inputSlots = inputSlots;
    this.runData = runData;
    this.runIndex = runIndex;
    this.executionIndex = executionIndex;
    this.executionId = executionId;
    this.signal = signal;
    this.items = flattenInputSlots(inputSlots);
    this.inputData = this.items;
    this.data = this.getWorkflowDataProxy();
  }

  getInputData(inputIndex = 0) {
    return this.inputSlots.get(inputIndex) ?? [];
  }

  getNodeParameter(parameterName, fallbackValue, itemIndex = 0) {
    const value = getByPath(this.node.parameters ?? {}, parameterName);
    if (value === undefined) return fallbackValue;
    return resolveParameterValue(value, this.getWorkflowDataProxy(itemIndex), itemIndex);
  }

  getWorkflowDataProxy(itemIndex = 0) {
    return new WorkflowDataProxy({
      items: this.items,
      inputSlots: this.inputSlots,
      runData: this.runData,
      currentNodeName: this.node.name,
      executionId: this.executionId,
      itemIndex,
    });
  }

  getWorkflowStaticData() {
    return this.engine.staticData;
  }

  getExecutionData() {
    return this.runData;
  }

  setExecutionData(path, value) {
    setByPath(this.engine.executionContextData, path, value);
    return value;
  }
}

export class WorkflowValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

export class WorkflowExecutionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'WorkflowExecutionError';
    Object.assign(this, details);
  }
}

const edgeId = (source, outputIndex, target, inputIndex, ordinal) =>
  `${source}\u0000${outputIndex}\u0000${target}\u0000${inputIndex}\u0000${ordinal}`;

/**
 * Execution loop for workflow definitions using the n8n connection shape.
 *
 * A handler may be either:
 *   - `(node, items, context) => NodeOutput`
 *   - `{ execute(context) { return NodeOutput } }`
 *
 * The first form keeps compatibility with the original reconstructed-engine
 * example.  The second form mirrors an n8n node type's context-oriented API.
 */
export class WorkflowExecutionEngine {
  constructor(workflowDefinition, options = {}) {
    if (!isObject(workflowDefinition)) throw new WorkflowValidationError('Workflow definition must be an object');
    if (!Array.isArray(workflowDefinition.nodes)) {
      throw new WorkflowValidationError('Workflow definition must contain a nodes array');
    }

    this.nodes = new Map();
    for (const node of workflowDefinition.nodes) {
      if (!isObject(node) || typeof node.name !== 'string' || node.name.length === 0) {
        throw new WorkflowValidationError('Every workflow node must have a non-empty name');
      }
      if (this.nodes.has(node.name)) throw new WorkflowValidationError(`Duplicate node name: ${node.name}`);
      this.nodes.set(node.name, {
        parameters: {},
        ...node,
        parameters: isObject(node.parameters) ? node.parameters : {},
      });
    }

    this.connections = workflowDefinition.connections ?? {};
    this.nodeTypes = new Map();
    this.staticData = workflowDefinition.staticData ?? {};
    this.executionContextData = {};
    this.maxNodeExecutions = Math.max(1, Number(options.maxNodeExecutions) || DEFAULT_MAX_NODE_EXECUTIONS);
    this._executionId = options.executionId ?? `reconstructed-${Date.now().toString(36)}`;
    this._buildConnectionIndex();
    this.abortController = null;
    this.lastRun = null;
  }

  _buildConnectionIndex() {
    this.outgoing = new Map([...this.nodes.keys()].map((name) => [name, []]));
    this.incoming = new Map([...this.nodes.keys()].map((name) => [name, []]));

    for (const [source, byType] of Object.entries(this.connections)) {
      if (!this.nodes.has(source)) throw new WorkflowValidationError(`Unknown connection source node: ${source}`);
      if (!isObject(byType)) continue;

      for (const [connectionType, outputSlots] of Object.entries(byType)) {
        if (!Array.isArray(outputSlots)) continue;
        for (let outputIndex = 0; outputIndex < outputSlots.length; outputIndex += 1) {
          const slot = outputSlots[outputIndex];
          if (slot === null || slot === undefined) continue;
          if (!Array.isArray(slot)) {
            throw new WorkflowValidationError(`${source}.${connectionType}[${outputIndex}] must be an array or null`);
          }

          slot.forEach((connection, ordinal) => {
            if (!isObject(connection) || typeof connection.node !== 'string') {
              throw new WorkflowValidationError(`Invalid connection from ${source} at output ${outputIndex}`);
            }
            if (!this.nodes.has(connection.node)) {
              throw new WorkflowValidationError(`Unknown connection target node: ${connection.node}`);
            }
            const inputIndex = Number.isInteger(connection.index) && connection.index >= 0 ? connection.index : 0;
            const edge = {
              id: edgeId(source, outputIndex, connection.node, inputIndex, ordinal),
              source,
              type: connectionType,
              outputIndex,
              target: connection.node,
              inputIndex,
            };
            this.outgoing.get(source).push(edge);
            this.incoming.get(connection.node).push(edge);
          });
        }
      }
    }
  }

  registerNodeType(typeName, handler) {
    if (typeof typeName !== 'string' || typeName.length === 0) throw new TypeError('typeName must be a non-empty string');
    if (typeof handler !== 'function' && !(isObject(handler) && typeof handler.execute === 'function')) {
      throw new TypeError('handler must be a function or an object with execute()');
    }
    this.nodeTypes.set(typeName, handler);
    return this;
  }

  unregisterNodeType(typeName) {
    return this.nodeTypes.delete(typeName);
  }

  cancel(reason = new Error('Execution canceled')) {
    this.abortController?.abort(reason);
  }

  _findStartNode(startNodeName) {
    if (startNodeName !== null && startNodeName !== undefined) {
      if (!this.nodes.has(startNodeName)) throw new WorkflowExecutionError(`Unknown start node: ${startNodeName}`);
      return startNodeName;
    }

    const enabledNodes = [...this.nodes.values()].filter((node) => node.disabled !== true);
    const trigger = enabledNodes.find(isTriggerLike);
    if (trigger) return trigger.name;

    const root = enabledNodes.find((node) =>
      !this.incoming.get(node.name).some((connection) => connection.type === MAIN_CONNECTION),
    );
    // A disabled trigger can still be the structural parent of the first
    // executable node. Do not fall back to that disabled node; choose the
    // first enabled definition instead, matching Workflow.getStartNode's
    // disabled-node guard and avoiding an execution users explicitly turned off.
    return root?.name ?? enabledNodes[0]?.name;
  }

  _handlerFor(node) {
    return this.nodeTypes.get(node.type);
  }

  async _invokeHandler(handler, node, inputItems, context) {
    if (handler === undefined) return inputItems;
    if (typeof handler === 'function') return handler.call(context, node, inputItems, context);
    return handler.execute.call(context, context);
  }

  async _executeNode({ node, inputSlots, runData, runIndex, executionIndex, signal }) {
    const inputItems = flattenInputSlots(inputSlots);
    const context = new NodeExecutionContext({
      engine: this,
      node,
      inputSlots,
      runData,
      runIndex,
      executionIndex,
      executionId: this._executionId,
      signal,
    });

    if (node.disabled === true) {
      return {
        branches: [assignPairedItems(inputItems, inputItems)],
        attempts: 1,
        status: 'success',
      };
    }

    const handler = this._handlerFor(node);
    const effectiveItems = node.executeOnce === true ? inputItems.slice(0, 1) : inputItems;
    const maxTries = normalizeRetryCount(node);
    const waitBetweenTries = normalizeRetryDelay(node);
    let lastError;
    let attempts = 0;
    let rawOutput;

    for (attempts = 1; attempts <= maxTries; attempts += 1) {
      if (signal.aborted) throw signal.reason ?? new Error('Execution canceled');
      try {
        rawOutput = await this._invokeHandler(handler, node, effectiveItems, context);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = toError(error);
        if (attempts < maxTries) await sleep(waitBetweenTries, signal);
      }
    }

    if (lastError) {
      const serialized = serializeError(lastError);
      const failedItem = errorItem(lastError, inputItems);
      const policy = node.onError ?? (node.continueOnFail === true ? 'continueRegularOutput' : 'stopWorkflow');

      if (policy === 'continueRegularOutput') {
        return {
          branches: [[failedItem]],
          attempts,
          status: 'success',
          continued: true,
          error: serialized,
        };
      }
      if (policy === 'continueErrorOutput') {
        return {
          branches: [[], [failedItem]],
          attempts,
          status: 'success',
          continued: true,
          error: serialized,
        };
      }

      return {
        branches: [[]],
        attempts,
        status: 'error',
        error: serialized,
        fatal: true,
      };
    }

    let branches = normalizeNodeOutput(rawOutput);
    if (countItems(branches) === 0 && node.alwaysOutputData === true) {
      const item = { json: {} };
      if (inputItems.length === 1) item.pairedItem = { item: 0 };
      else if (inputItems.length > 1) item.pairedItem = inputItems.map((_input, index) => ({ item: index }));
      branches = [[item]];
    }
    branches = branches.map((branch) => assignPairedItems(branch, inputItems));

    return { branches, attempts, status: 'success' };
  }

  _publicData(branches) {
    return branches.length === 1 ? branches[0] : branches;
  }

  _makeState(nodeName) {
    return {
      nodeName,
      inputSlots: new Map(),
      inputSources: new Map(),
      receivedEdges: new Set(),
      queued: false,
      executionCount: 0,
    };
  }

  /**
   * Execute a workflow.  The legacy `(startNodeName, initialData)` signature is
   * retained; an options object is also accepted as the first argument.
   */
  async runWorkflow(startNodeName = null, initialData = [{}], runOptions = {}) {
    let selectedStart = startNodeName;
    let startData = initialData;
    let options = runOptions;

    if (isObject(startNodeName) && !Array.isArray(startNodeName)) {
      options = startNodeName;
      selectedStart = options.startNodeName ?? null;
      startData = options.initialData ?? [{}];
    }

    if (this.nodes.size === 0) throw new WorkflowExecutionError('No nodes found in workflow definition');

    const maxNodeExecutions = Math.max(
      1,
      Number(options.maxNodeExecutions) || this.maxNodeExecutions,
    );
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const startNode = this._findStartNode(selectedStart);
    if (!startNode) throw new WorkflowExecutionError('No enabled node to start the workflow from could be found');
    const initialItems = normalizeItems(startData);
    if (initialItems.length === 0) initialItems.push({ json: {} });

    const states = new Map([...this.nodes.keys()].map((name) => [name, this._makeState(name)]));
    const queue = [];
    const runData = {};
    const data = {};
    const outputs = {};
    const executionLog = [];
    let executionIndex = 0;
    let fatalError;
    let canceled = false;
    let lastNodeExecuted;

    const queueNode = (nodeName, inputSlots, inputSources = new Map(), source = null) => {
      const state = states.get(nodeName);
      if (!state || state.queued) return;
      state.queued = true;
      queue.push({ nodeName, inputSlots: copySlots(inputSlots), inputSources: new Map(inputSources), source });
    };

    const consumeReadyState = (state) => {
      const incoming = this.incoming.get(state.nodeName).filter((connection) => connection.type === MAIN_CONNECTION);
      if (incoming.length === 0 || state.queued) return;
      if (!incoming.every((connection) => state.receivedEdges.has(connection.id))) return;

      const inputSlots = copySlots(state.inputSlots);
      const inputSources = new Map(state.inputSources);
      state.inputSlots.clear();
      state.inputSources.clear();
      state.receivedEdges.clear();

      if (flattenInputSlots(inputSlots).length > 0) queueNode(state.nodeName, inputSlots, inputSources);
    };

    const deliverOutputs = (nodeName, branches) => {
      for (const connection of this.outgoing.get(nodeName)) {
        if (connection.type !== MAIN_CONNECTION) continue;
        const targetState = states.get(connection.target);
        const items = (branches[connection.outputIndex] ?? []).slice();
        const existing = targetState.inputSlots.get(connection.inputIndex) ?? [];
        targetState.inputSlots.set(connection.inputIndex, existing.concat(items));
        targetState.inputSources.set(connection.inputIndex, {
          previousNode: nodeName,
          previousNodeOutput: connection.outputIndex,
          previousNodeRun: (runData[nodeName]?.length ?? 1) - 1,
        });
        targetState.receivedEdges.add(connection.id);
        consumeReadyState(targetState);
      }
    };

    const startState = states.get(startNode);
    startState.inputSlots.set(0, initialItems);
    startState.inputSources.set(0, null);
    queueNode(startNode, startState.inputSlots, startState.inputSources);

    while (queue.length > 0) {
      if (signal.aborted) {
        canceled = true;
        break;
      }

      const execution = queue.shift();
      const state = states.get(execution.nodeName);
      state.queued = false;
      state.executionCount += 1;
      const node = this.nodes.get(execution.nodeName);
      const nodeRunIndex = runData[node.name]?.length ?? 0;
      const startedAt = Date.now();
      const source = [...execution.inputSources.values()].filter(Boolean);

      if (state.executionCount > maxNodeExecutions) {
        fatalError = new WorkflowExecutionError(
          `Maximum node executions exceeded for '${node.name}' (${maxNodeExecutions})`,
          { nodeName: node.name, code: 'MAX_NODE_EXECUTIONS' },
        );
        executionLog.push({
          node: node.name,
          type: node.type,
          inputCount: flattenInputSlots(execution.inputSlots).length,
          outputCount: 0,
          durationMs: 0,
          attempts: 0,
          status: 'error',
          error: serializeError(fatalError),
        });
        break;
      }

      let result;
      try {
        result = await this._executeNode({
          node,
          inputSlots: execution.inputSlots,
          runData,
          runIndex: nodeRunIndex,
          executionIndex,
          signal,
        });
      } catch (error) {
        if (signal.aborted) {
          canceled = true;
          break;
        }
        result = {
          branches: [[]],
          attempts: 1,
          status: 'error',
          fatal: true,
          error: serializeError(error),
        };
      }

      const durationMs = Date.now() - startedAt;
      const inputItems = flattenInputSlots(execution.inputSlots);
      const task = {
        startTime: startedAt,
        executionIndex,
        executionTime: durationMs,
        source,
        executionStatus: result.status,
        data: { main: result.branches },
      };
      if (result.error) task.error = result.error;
      runData[node.name] ??= [];
      runData[node.name].push(task);
      executionIndex += 1;
      lastNodeExecuted = node.name;

      outputs[node.name] = result.branches;
      data[node.name] = this._publicData(result.branches);
      executionLog.push({
        node: node.name,
        type: node.type,
        inputCount: inputItems.length,
        outputCount: countItems(result.branches),
        outputCounts: result.branches.map((branch) => branch.length),
        durationMs,
        attempts: result.attempts,
        status: result.status,
        ...(result.continued ? { continued: true } : {}),
        ...(result.error ? { error: result.error } : {}),
      });

      if (result.fatal) {
        fatalError = result.error ?? new WorkflowExecutionError(`Node '${node.name}' failed`);
        break;
      }

      deliverOutputs(node.name, result.branches);
    }

    const status = canceled ? 'CANCELED' : fatalError ? 'ERROR' : 'COMPLETED';
    const result = {
      status,
      finished: status === 'COMPLETED',
      executionLog,
      data,
      outputs,
      runData,
      lastNodeExecuted,
    };
    if (fatalError) result.error = fatalError instanceof Error ? serializeError(fatalError) : fatalError;
    if (canceled) result.error = serializeError(signal.reason ?? new Error('Execution canceled'));

    this.lastRun = result;
    return result;
  }
}
