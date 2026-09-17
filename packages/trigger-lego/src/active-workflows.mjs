import {
  TriggerCloseError,
  UserError,
  WorkflowActivationError,
  WorkflowDeactivationError,
} from './errors.mjs';
import { ScheduledTaskManager } from './scheduled-task-manager.mjs';
import { TriggersAndPollers } from './triggers-and-pollers.mjs';

const NOOP_LOGGER = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });

function defaultToCronExpression(triggerTime) {
  if (triggerTime.mode === 'custom') return triggerTime.cronExpression;
  if (triggerTime.mode === 'everyMinute') return '0 * * * * *';
  if (triggerTime.mode === 'everyHour') return `0 ${triggerTime.minute ?? 0} * * * *`;
  if (triggerTime.mode === 'everyDay') return `0 ${triggerTime.minute ?? 0} ${triggerTime.hour ?? 0} * * *`;
  throw new UserError(`Unsupported poll mode: ${triggerTime.mode}`);
}

export class ActiveWorkflows {
  constructor({
    logger = NOOP_LOGGER,
    scheduledTaskManager = new ScheduledTaskManager(),
    triggersAndPollers = new TriggersAndPollers(),
    errorReporter = { error() {} },
    toCronExpression = defaultToCronExpression,
  } = {}) {
    this.logger = logger;
    this.scheduledTaskManager = scheduledTaskManager;
    this.triggersAndPollers = triggersAndPollers;
    this.errorReporter = errorReporter;
    this.toCronExpression = toCronExpression;
    this.activeWorkflows = Object.create(null);
  }

  isActive(workflowId) { return Object.hasOwn(this.activeWorkflows, workflowId); }
  allActiveWorkflows() { return Object.keys(this.activeWorkflows); }
  get(workflowId) { return this.activeWorkflows[workflowId]; }

  async add(workflowId, workflow, additionalData, mode, activation, getTriggerFunctions, getPollFunctions) {
    const triggerResponses = [];
    const triggerNodes = workflow.getTriggerNodes().filter((node) => node.disabled !== true);
    for (const node of triggerNodes) {
      try {
        const response = await this.triggersAndPollers.runTrigger(
          workflow, node, getTriggerFunctions, additionalData, mode, activation,
        );
        if (response !== undefined) triggerResponses.push(response);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        throw new WorkflowActivationError(`There was a problem activating the workflow: "${error.message}"`, {
          node,
          // Upstream folds the cause into the message and does not expose Error.cause.
          activationCause: error,
        });
      }
    }

    this.activeWorkflows[workflowId] = { triggerResponses };
    const pollNodes = workflow.getPollNodes().filter((node) => node.disabled !== true);
    for (const node of pollNodes) {
      try {
        await this.activatePolling(node, workflow, additionalData, getPollFunctions, mode, activation);
      } catch (cause) {
        if (triggerResponses.length === 0) delete this.activeWorkflows[workflowId];
        const error = cause instanceof Error ? cause : new Error(String(cause));
        throw new WorkflowActivationError(`There was a problem activating the workflow: "${error.message}"`, {
          node,
          activationCause: error,
        });
      }
    }
  }

  async activatePolling(node, workflow, additionalData, getPollFunctions, mode, activation) {
    const pollFunctions = getPollFunctions(workflow, node, additionalData, mode, activation);
    const pollTimes = pollFunctions.getNodeParameter('pollTimes') ?? { item: [] };
    const expressions = (pollTimes.item ?? []).map(this.toCronExpression);
    const execute = this.createPollExecuteFn(workflow, node, pollFunctions);
    await execute(true);

    for (const expression of expressions) {
      if (expression.split(' ')[0]?.includes('*')) {
        throw new UserError('The polling interval is too short. It has to be at least a minute.');
      }
      this.scheduledTaskManager.registerCron({
        workflowId: workflow.id,
        timezone: workflow.timezone,
        nodeId: node.id,
        expression,
      }, execute);
    }
  }

  createPollExecuteFn(workflow, node, pollFunctions) {
    return async (testingTrigger = false) => {
      try {
        const response = await this.triggersAndPollers.runPoll(workflow, node, pollFunctions);
        if (response !== null) pollFunctions.__emit(response);
      } catch (error) {
        if (testingTrigger) throw error;
        pollFunctions.__emitError(error);
      }
    };
  }

  async remove(workflowId) {
    if (!this.isActive(workflowId)) {
      this.logger.warn(`Cannot deactivate already inactive workflow ID "${workflowId}"`);
      return false;
    }
    this.scheduledTaskManager.deregisterCrons(workflowId);
    for (const response of this.activeWorkflows[workflowId].triggerResponses ?? []) {
      await this.closeTrigger(response, workflowId);
    }
    delete this.activeWorkflows[workflowId];
    return true;
  }

  async closeTrigger(response, workflowId) {
    if (!response.closeFunction) return;
    try {
      await response.closeFunction();
    } catch (cause) {
      if (cause instanceof TriggerCloseError) {
        this.logger.error(`There was a problem calling "closeFunction" on "${cause.node?.name}" in workflow "${workflowId}"`);
        this.errorReporter.error(cause, { extra: { workflowId } });
        return;
      }
      const error = cause instanceof Error ? cause : new Error(String(cause));
      throw new WorkflowDeactivationError(
        `Failed to deactivate trigger of workflow ID "${workflowId}": "${error.message}"`,
        { workflowId, cause: error },
      );
    }
  }

  async removeAllTriggerAndPollerBasedWorkflows() {
    const workflowIds = this.allActiveWorkflows();
    for (const workflowId of workflowIds) await this.remove(workflowId);
    if (workflowIds.length) this.logger.debug('Deactivated all trigger- and poller-based workflows', { workflowIds });
  }
}
