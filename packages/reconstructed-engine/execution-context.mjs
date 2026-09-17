const BLOCKED_EXPRESSION_TOKENS = /(?:\.\s*constructor\b|\b__proto__\b|\.\s*prototype\b|\bprocess\b|\bglobalThis\b|\brequire\s*\(|\bimport\s*\()/;

export class ExpressionError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'ExpressionError';
    Object.assign(this, context);
  }
}

function assertNoArguments(name, args) {
  if (args.length > 0) throw new ExpressionError(`${name}() should have no arguments`);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function itemAt(items, index, nodeName) {
  if (items.length === 0) {
    throw new ExpressionError('No execution data available', { type: 'no_execution_data', nodeCause: nodeName });
  }
  if (!items[index]) {
    throw new ExpressionError(`"${nodeName}" node has ${items.length} item(s) but you're trying to access item ${index}`, {
      type: 'no_execution_data',
      descriptionKey: 'pairedItemInvalidIndex',
      nodeCause: nodeName,
    });
  }
  return items[index];
}

function readPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

/** A compact NodeExecutionContext boundary modelled after n8n 2.9.4. */
export class NodeExecutionContext {
  constructor({ engine, node, inputData, runData, runIndex = 0, source = [], mode = 'manual' }) {
    this.engine = engine;
    this.node = node;
    this.inputData = inputData;
    this.runData = runData;
    this.runIndex = runIndex;
    this.source = source;
    this.mode = mode;
  }

  getInputData(inputIndex = 0) {
    if (inputIndex !== 0) return [];
    return clone(this.inputData);
  }

  getNodeParameter(path, itemIndex = 0, defaultValue) {
    const value = readPath(this.node.parameters ?? {}, path);
    if (value === undefined) return defaultValue;
    return this.resolveParameterValue(value, itemIndex);
  }

  resolveParameterValue(value, itemIndex = 0) {
    if (Array.isArray(value)) return value.map((entry) => this.resolveParameterValue(entry, itemIndex));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, this.resolveParameterValue(entry, itemIndex)]));
    }
    if (typeof value !== 'string' || !value.startsWith('=')) return value;
    if (value === '=') return '';
    if (!value.includes('{{')) return value.slice(1);

    const template = value.slice(1);
    const exact = template.match(/^\s*{{([\s\S]*?)}}\s*$/);
    if (exact) return this.evaluateExpression(exact[1], itemIndex);

    return template.replace(/{{([\s\S]*?)}}/g, (_match, expression) => {
      const result = this.evaluateExpression(expression, itemIndex);
      return result == null ? '' : String(result);
    });
  }

  evaluateExpression(expression, itemIndex = 0) {
    if (BLOCKED_EXPRESSION_TOKENS.test(expression)) {
      throw new ExpressionError('Expression contains a forbidden property or global access');
    }
    const data = this.getWorkflowDataProxy(itemIndex);
    const names = Object.keys(data);
    try {
      return Function(...names, `'use strict'; return (${expression});`)(...names.map((name) => data[name]));
    } catch (error) {
      if (error instanceof ExpressionError) throw error;
      if (error instanceof SyntaxError) throw new ExpressionError('invalid syntax');
      if (error instanceof ReferenceError || error instanceof TypeError) return undefined;
      throw error;
    }
  }

  getWorkflowDataProxy(itemIndex = 0) {
    const currentItem = itemAt(this.inputData, itemIndex, this.node.name);
    const nodeAccessor = (nodeName) => this.#nodeAccessor(nodeName, itemIndex);
    const input = this.inputData;
    const source = this.source[0];
    const previousParameters = source ? this.engine.nodes.get(source.previousNode)?.parameters ?? {} : undefined;

    return {
      $json: clone(currentItem.json),
      $data: clone(currentItem.json),
      $binary: clone(currentItem.binary ?? {}),
      $input: {
        item: clone(currentItem),
        all: (...args) => { assertNoArguments('$input.all', args); return clone(input); },
        first: (...args) => { assertNoArguments('$input.first', args); return clone(itemAt(input, 0, this.node.name)); },
        last: (...args) => { assertNoArguments('$input.last', args); return clone(itemAt(input, input.length - 1, this.node.name)); },
        get params() {
          if (!source) throw new ExpressionError('Can’t get data for expression');
          return clone(previousParameters);
        },
      },
      $: nodeAccessor,
      $node: new Proxy({}, { get: (_target, name) => nodeAccessor(String(name)).item }),
      $itemIndex: itemIndex,
      $position: itemIndex,
      $runIndex: this.runIndex,
      $mode: this.mode,
      $nodeId: this.node.id,
      $nodeVersion: this.node.typeVersion,
      $workflow: {
        id: this.engine.workflow.id,
        name: this.engine.workflow.name,
        active: Boolean(this.engine.workflow.active),
      },
      $prevNode: source ? {
        name: source.previousNode,
        outputIndex: source.previousNodeOutput ?? 0,
        runIndex: source.previousNodeRun ?? 0,
      } : undefined,
    };
  }

  #nodeAccessor(nodeName, itemIndex) {
    if (!this.engine.nodes.has(nodeName)) {
      throw new ExpressionError("Referenced node doesn't exist", {
        descriptionKey: 'nodeNotFound', nodeCause: nodeName,
      });
    }
    const runs = this.runData[nodeName];
    const getItems = (branch = 0, run = runs?.length - 1) => {
      const task = runs?.[run];
      if (!task) {
        throw new ExpressionError(`Node '${nodeName}' hasn't been executed`, {
          type: 'no_execution_data', descriptionKey: 'pairedItemNoConnection', nodeCause: nodeName,
        });
      }
      const branches = task.data?.main ?? [];
      if (!branches[branch]) throw new ExpressionError(`Node "${nodeName}" has no branch with index ${branch}.`);
      return branches[branch];
    };
    const nodeParameters = this.engine.nodes.get(nodeName)?.parameters ?? {};
    return {
      get item() { return clone(itemAt(getItems(), itemIndex, nodeName)); },
      first: (branch = 0, run) => clone(itemAt(getItems(branch, run), 0, nodeName)),
      last: (branch = 0, run) => {
        const items = getItems(branch, run);
        return clone(itemAt(items, items.length - 1, nodeName));
      },
      all: (branch = 0, run) => clone(getItems(branch, run)),
      get isExecuted() { return Boolean(runs); },
      get params() { return clone(nodeParameters); },
    };
  }
}
