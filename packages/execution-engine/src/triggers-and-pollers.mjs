/**
 * TriggersAndPollers — runs a trigger or poller node so it can start a workflow.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/core/src/execution-engine/triggers-and-pollers.ts
 *     - runTrigger  L29-101 (missing-trigger ApplicationError, manual-mode
 *                           `manualTriggerResponse` + emit/emitError/saveFailedExecution
 *                           overrides bound to the lifecycle hooks)
 *     - runPoll     L103-111
 *   Oracle: .../execution-engine/__tests__/triggers-and-pollers.test.ts (6 behaviours)
 *
 * Boundaries: node types come from the workflow model (`getByNameAndVersion`), the
 * trigger/poll function objects are produced by the caller through the injected
 * `getTriggerFunctions` / `getPollFunctions` factories — this module never builds them
 * (the caller owns credentials, binary helpers and request helpers, exactly as in the
 * reference where `ExecuteContext`/`TriggerContext` are constructed by the caller).
 */

import assert from 'node:assert';

import { ApplicationError } from './errors.mjs';

export class TriggersAndPollers {
	/**
	 * Runs the given trigger node so that it can trigger the workflow when the node
	 * has data.
	 */
	async runTrigger(workflow, node, getTriggerFunctions, additionalData, mode, activation) {
		const triggerFunctions = getTriggerFunctions(workflow, node, additionalData, mode, activation);

		const nodeType = workflow.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);

		if (!nodeType.trigger) {
			throw new ApplicationError('Node type does not have a trigger function defined', {
				extra: { nodeName: node.name },
				tags: { nodeType: node.type },
			});
		}

		if (mode === 'manual') {
			// In manual mode we do not just start the trigger function we also
			// want to be able to get informed as soon as the first data got emitted
			const triggerResponse = await nodeType.trigger.call(triggerFunctions);

			// Add the manual trigger response which resolves when the first time data got emitted
			triggerResponse.manualTriggerResponse = new Promise((resolve, reject) => {
				const { hooks } = additionalData;
				// Verbatim from the reference (triggers-and-pollers.ts L50): a node:assert
				// assertion inside the executor — so the failure is an AssertionError that
				// rejects `manualTriggerResponse`, never a synchronous throw from runTrigger.
				assert.ok(hooks, 'Execution lifecycle hooks are not defined');

				triggerFunctions.emit = (data, responsePromise, donePromise) => {
					if (responsePromise) {
						hooks.addHandler('sendResponse', (response) => responsePromise.resolve(response));
					}

					if (donePromise) {
						hooks.addHandler('workflowExecuteAfter', (runData) => donePromise.resolve(runData));
					}

					resolve(data);
				};

				triggerFunctions.emitError = (error, responsePromise) => {
					if (responsePromise) {
						hooks.addHandler('sendResponse', () => responsePromise.reject(error));
					}
					reject(error);
				};

				triggerFunctions.saveFailedExecution = (error) => {
					reject(error);
				};
			});

			return triggerResponse;
		}
		// In all other modes simply start the trigger
		return await nodeType.trigger.call(triggerFunctions);
	}

	/** Runs the given poller node so that it can trigger the workflow when the node has data. */
	async runPoll(workflow, node, pollFunctions) {
		const nodeType = workflow.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);

		if (!nodeType.poll) {
			throw new ApplicationError('Node type does not have a poll function defined', {
				extra: { nodeName: node.name },
				tags: { nodeType: node.type },
			});
		}

		return await nodeType.poll.call(pollFunctions);
	}
}
