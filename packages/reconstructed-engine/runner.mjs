/**
 * Reconstructed n8n Workflow Execution Engine (Node.js/ESM).
 * Keeps scheduling, execution data, and node context behind explicit boundaries.
 */
import { NodeExecutionContext } from './execution-context.mjs';
import {
  isSoftFailure,
  mergeErrorInfo,
  retryPlanFor,
  shouldContinueOnError,
  sleep,
  splitErrorOutput,
  toErrorRecord,
} from './error-policy.mjs';

function normalizeItems(data) {
  const values = Array.isArray(data) ? data : [data];
  return values.map((item) => {
    if (item && typeof item === 'object' && item.json && typeof item.json === 'object') {
      return structuredClone(item);
    }
    return { json: item && typeof item === 'object' ? structuredClone(item) : { value: item } };
  });
}

function normalizeOutputs(output) {
  if (output == null) return [[]];
  if (!Array.isArray(output)) throw new TypeError('Node output must be an array');
  // Handlers may return n8n's branch array or the legacy single item array.
  if (output.length > 0 && Array.isArray(output[0])) return output.map(normalizeItems);
  return [normalizeItems(output)];
}

function prepareInput(items, inputIndex = 0) {
  return normalizeItems(items).map((item, itemIndex) => ({
    ...item,
    pairedItem: { item: itemIndex, ...(inputIndex ? { input: inputIndex } : {}) },
  }));
}

function assignPairedItems(outputs, inputItems) {
  return outputs.map((branch) => branch.map((item, itemIndex) => {
    if (item.pairedItem !== undefined) return item;
    if (inputItems.length === 1) return { ...item, pairedItem: { item: 0 } };
    if (outputs.length === 1 && branch.length === inputItems.length) {
      return { ...item, pairedItem: { item: itemIndex } };
    }
    return item;
  }));
}

export class WorkflowExecutionEngine {
  constructor(workflowDefinition) {
    this.workflow = workflowDefinition;
    this.nodes = new Map((workflowDefinition.nodes ?? []).map((node) => [node.name, node]));
    this.connections = workflowDefinition.connections ?? {};
    this.nodeTypes = new Map();
  }

  registerNodeType(typeName, handler) {
    if (typeof handler !== 'function') throw new TypeError('Node handler must be a function');
    this.nodeTypes.set(typeName, handler);
    return this;
  }

  #findStartNode() {
    const connectedDestinations = new Set();
    for (const outputs of Object.values(this.connections)) {
      for (const branches of Object.values(outputs ?? {})) {
        for (const branch of branches ?? []) for (const connection of branch ?? []) connectedDestinations.add(connection.node);
      }
    }
    return [...this.nodes.values()].find((node) =>
      node.type.includes('trigger') || node.type.includes('Manual') || node.type.includes('Start'))?.name
      ?? [...this.nodes.keys()].find((name) => !connectedDestinations.has(name))
      ?? this.nodes.keys().next().value;
  }

  async runWorkflow(startNodeName = null, initialData = [{}], options = {}) {
    const mode = options.mode ?? 'manual';
    const runData = {};
    const executionData = new Map();
    const executionLog = [];
    const start = startNodeName ?? this.#findStartNode();
    if (!start) throw new Error('No nodes found in workflow definition');
    if (!this.nodes.has(start)) throw new Error(`Start node "${start}" does not exist`);

    const queue = [{ nodeName: start, inputData: normalizeItems(initialData), source: [] }];
    let executionIndex = 0;
    const maxExecutions = options.maxExecutions ?? 10_000;

    while (queue.length > 0) {
      if (executionIndex >= maxExecutions) throw new Error(`Execution limit of ${maxExecutions} reached`);
      const queued = queue.shift();
      const node = this.nodes.get(queued.nodeName);
      if (!node || node.disabled) continue;

      const inputData = prepareInput(queued.inputData);
      // R5 passthrough uses the items AS RECEIVED (upstream pairedItems intact),
      // not the re-stamped inputData.
      const receivedItems = normalizeItems(queued.inputData);
      const runIndex = runData[node.name]?.length ?? 0;
      const context = new NodeExecutionContext({
        engine: this, node, inputData, runData, runIndex, source: queued.source, mode,
      });
      const handler = this.nodeTypes.get(node.type);
      const startedAt = Date.now();
      const { maxTries, waitBetweenTries } = retryPlanFor(node); // R1
      const sleepFn = options.sleep ?? sleep;

      // R1+R2+R3 — retry loop. Reference: for (tryIndex...) with pre-retry wait
      // and error reset, plus the inner soft-fail (`json.error`) re-run loop.
      // `rawOutputs` (pre-paired-assignment) is kept: R7 splits BEFORE the
      // engine assigns paired items, exactly like the reference.
      let executionError;
      let outputs;
      let rawOutputs;
      const invoke = () => (handler ? handler(node, context.getInputData(), context) : context.getInputData());
      for (let tryIndex = 0; tryIndex < maxTries; tryIndex++) {
        if (tryIndex !== 0) {
          executionError = undefined;
          if (waitBetweenTries !== 0) await sleepFn(waitBetweenTries);
        }
        try {
          rawOutputs = normalizeOutputs(await invoke());
          outputs = assignPairedItems(rawOutputs, inputData);
          while (isSoftFailure(rawOutputs) && tryIndex !== maxTries - 1) {
            await sleepFn(waitBetweenTries);
            rawOutputs = normalizeOutputs(await invoke());
            outputs = assignPairedItems(rawOutputs, inputData);
            tryIndex++;
          }
          break;
        } catch (error) {
          executionError = toErrorRecord(error); // R4 (Sentry reporting has no equivalent here)
        }
      }

      if (executionError !== undefined) {
        // R5 — stop path: task WITHOUT data, execution ends with the error.
        // (Reference also re-queues the node for restart; this engine has no
        // restart API yet — deferred to the persistence LEGO, see ERROR-POLICY.md.)
        if (!shouldContinueOnError(node)) {
          const task = {
            startTime: startedAt,
            executionIndex,
            executionTime: Date.now() - startedAt,
            source: queued.source,
            executionStatus: 'error',
            error: executionError,
          };
          (runData[node.name] ??= []).push(task);
          executionLog.push({ node: node.name, type: node.type, durationMs: task.executionTime, status: 'error', error: executionError });
          return {
            status: 'ERROR', finished: false, lastNodeExecuted: node.name,
            error: executionError, executionLog, runData, data: Object.fromEntries(executionData),
          };
        }
        // R5 — continue path: the node's input becomes its output.
        outputs = [receivedItems];
      }

      if (executionError === undefined && node.onError === 'continueErrorOutput') {
        // R7 — success-path split only (the reference splits inside the try
        // block, BEFORE paired assignment and BEFORE the R6 merge).
        outputs = assignPairedItems(
          splitErrorOutput(rawOutputs, inputData, (this.connections[node.name]?.main ?? []).length),
          inputData,
        );
      }
      outputs = mergeErrorInfo(outputs); // R6 — runs on success AND continue paths
      if (node.alwaysOutputData && outputs.every((branch) => branch.length === 0)) {
        outputs = [[{ json: {}, pairedItem: inputData.map((_item, item) => ({ item })) }]];
      }

      const task = {
        startTime: startedAt,
        executionIndex,
        executionTime: Date.now() - startedAt,
        source: queued.source,
        executionStatus: executionError !== undefined ? 'error' : 'success',
        ...(executionError !== undefined ? { error: executionError } : {}),
        data: { main: outputs },
      };
      (runData[node.name] ??= []).push(task);
      executionData.set(node.name, outputs[0] ?? []);
      executionLog.push({
        node: node.name,
        type: node.type,
        inputCount: inputData.length,
        outputCount: outputs.reduce((total, branch) => total + branch.length, 0),
        durationMs: task.executionTime,
        status: executionError !== undefined ? 'error' : 'success',
        ...(executionError !== undefined ? { error: executionError } : {}),
      });

      const mainConnections = this.connections[node.name]?.main ?? [];
      outputs.forEach((branchItems, outputIndex) => {
        if (branchItems.length === 0) return;
        for (const connection of mainConnections[outputIndex] ?? []) {
          queue.push({
            nodeName: connection.node,
            inputData: branchItems,
            source: [{ previousNode: node.name, previousNodeOutput: outputIndex, previousNodeRun: runIndex }],
          });
        }
      });
      executionIndex += 1;
    }

    return {
      status: 'COMPLETED', finished: true,
      lastNodeExecuted: executionLog.at(-1)?.node,
      executionLog, runData, data: Object.fromEntries(executionData),
    };
  }
}
