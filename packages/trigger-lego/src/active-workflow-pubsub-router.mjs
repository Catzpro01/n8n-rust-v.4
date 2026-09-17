const NOOP_REPORTER = Object.freeze({ error() {} });

/**
 * Multi-main workflow activation command choreography from ActiveWorkflowManager.
 * Transport, persistence, webhook cleanup, in-memory teardown, and UI push remain explicit ports.
 */
export class ActiveWorkflowPubSubRouter {
  constructor({
    publisher,
    activate,
    clearWebhooks,
    removeTriggersAndPollers,
    updateInactive,
    removeActivationError = async () => {},
    push = { broadcast() {} },
    errorReporter = NOOP_REPORTER,
  }) {
    if (!publisher || !activate || !clearWebhooks || !removeTriggersAndPollers || !updateInactive) {
      throw new Error('ActiveWorkflowPubSubRouter requires publisher, activate, clearWebhooks, removeTriggersAndPollers, and updateInactive');
    }
    this.publisher = publisher;
    this.activate = activate;
    this.clearWebhooks = clearWebhooks;
    this.removeTriggersAndPollers = removeTriggersAndPollers;
    this.updateInactive = updateInactive;
    this.removeActivationError = removeActivationError;
    this.push = push;
    this.errorReporter = errorReporter;
  }

  async requestActivation(workflow) {
    if (!workflow?.activeVersionId) throw new Error('Active version ID not found for workflow');
    await this.publisher.publishCommand({
      command: 'add-webhooks-triggers-and-pollers',
      payload: { workflowId: workflow.id, activeVersionId: workflow.activeVersionId },
    });
    return { webhooks: false, triggersAndPollers: false };
  }

  async handleAddWebhooksTriggersAndPollers({ workflowId, activeVersionId }) {
    try {
      await this.activate(workflowId, 'activate', { shouldPublish: false });
      this.displayActivation({ workflowId, activeVersionId });
      await this.publisher.publishCommand({ command: 'display-workflow-activation', payload: { workflowId, activeVersionId } });
      return { activated: true };
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      await this.updateInactive(workflowId, { active: false, activeVersionId: null });
      this.displayActivationError({ workflowId, errorMessage: normalized.message });
      await this.publisher.publishCommand({ command: 'display-workflow-activation-error', payload: { workflowId, errorMessage: normalized.message } });
      return { activated: false, error: normalized };
    }
  }

  async requestDeactivation(workflowId) {
    try { await this.clearWebhooks(workflowId); } catch (error) { this.errorReporter.error(error); }
    await this.publisher.publishCommand({ command: 'remove-triggers-and-pollers', payload: { workflowId } });
  }

  async handleRemoveTriggersAndPollers({ workflowId }) {
    await this.removeActivationError(workflowId);
    await this.removeTriggersAndPollers(workflowId);
    this.displayDeactivation({ workflowId });
    await this.publisher.publishCommand({ command: 'display-workflow-deactivation', payload: { workflowId } });
  }

  displayActivation({ workflowId, activeVersionId }) {
    this.push.broadcast({ type: 'workflowActivated', data: { workflowId, activeVersionId } });
  }

  displayDeactivation({ workflowId }) {
    this.push.broadcast({ type: 'workflowDeactivated', data: { workflowId } });
  }

  displayActivationError({ workflowId, errorMessage }) {
    this.push.broadcast({ type: 'workflowFailedToActivate', data: { workflowId, errorMessage } });
  }

  getHandlers() {
    return [
      { eventName: 'add-webhooks-triggers-and-pollers', filter: { instanceType: 'main', instanceRole: 'leader' }, handler: (payload) => this.handleAddWebhooksTriggersAndPollers(payload) },
      { eventName: 'remove-triggers-and-pollers', filter: { instanceType: 'main', instanceRole: 'leader' }, handler: (payload) => this.handleRemoveTriggersAndPollers(payload) },
      { eventName: 'display-workflow-activation', filter: { instanceType: 'main' }, handler: (payload) => this.displayActivation(payload) },
      { eventName: 'display-workflow-deactivation', filter: { instanceType: 'main' }, handler: (payload) => this.displayDeactivation(payload) },
      { eventName: 'display-workflow-activation-error', filter: { instanceType: 'main' }, handler: (payload) => this.displayActivationError(payload) },
    ];
  }
}
