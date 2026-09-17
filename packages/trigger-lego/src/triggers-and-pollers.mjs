import { TriggerLifecycleError } from './errors.mjs';

export class TriggersAndPollers {
  async runTrigger(workflow, node, getTriggerFunctions, additionalData, mode, activation) {
    const triggerFunctions = getTriggerFunctions(workflow, node, additionalData, mode, activation);
    const nodeType = workflow.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);
    if (typeof nodeType?.trigger !== 'function') {
      throw new TriggerLifecycleError('Node type does not have a trigger function defined', {
        nodeName: node.name,
        nodeType: node.type,
      });
    }

    const response = await nodeType.trigger.call(triggerFunctions);
    if (mode !== 'manual') return response;
    if (!response) throw new TriggerLifecycleError('Trigger returned no response in manual mode');

    response.manualTriggerResponse = new Promise((resolve, reject) => {
      const hooks = additionalData?.hooks;
      if (!hooks) {
        reject(new TriggerLifecycleError('Execution lifecycle hooks are not defined'));
        return;
      }
      triggerFunctions.emit = (data, responsePromise, donePromise) => {
        if (responsePromise) hooks.addHandler('sendResponse', (value) => responsePromise.resolve(value));
        if (donePromise) hooks.addHandler('workflowExecuteAfter', (value) => donePromise.resolve(value));
        resolve(data);
      };
      triggerFunctions.emitError = (error, responsePromise) => {
        if (responsePromise) hooks.addHandler('sendResponse', () => responsePromise.reject(error));
        reject(error);
      };
      triggerFunctions.saveFailedExecution = reject;
    });
    return response;
  }

  async runPoll(workflow, node, pollFunctions) {
    const nodeType = workflow.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);
    if (typeof nodeType?.poll !== 'function') {
      throw new TriggerLifecycleError('Node type does not have a poll function defined', {
        nodeName: node.name,
        nodeType: node.type,
      });
    }
    return await nodeType.poll.call(pollFunctions);
  }
}
