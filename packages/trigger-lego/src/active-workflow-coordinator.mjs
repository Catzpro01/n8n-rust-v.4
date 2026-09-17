const NOOP_LOGGER = Object.freeze({ debug() {}, info() {}, error() {} });

const chunks = (items, size) => {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
};

/**
 * Instance-leadership coordinator around ActiveWorkflows.
 * Persistence, webhook registration, activation details, retries, and pub/sub remain injected ports.
 */
export class ActiveWorkflowCoordinator {
  constructor({
    workflowRepository,
    activeWorkflows,
    activate,
    instanceSettings = { isLeader: true },
    activationBatchSize = 100,
    errorReporter = { error() {} },
    logger = NOOP_LOGGER,
    onActivationError = async () => {},
    queueRetry = () => {},
  }) {
    if (!workflowRepository || !activeWorkflows || !activate) {
      throw new Error('ActiveWorkflowCoordinator requires workflowRepository, activeWorkflows, and activate');
    }
    this.workflowRepository = workflowRepository;
    this.activeWorkflows = activeWorkflows;
    this.activate = activate;
    this.instanceSettings = instanceSettings;
    this.activationBatchSize = activationBatchSize;
    this.errorReporter = errorReporter;
    this.logger = logger;
    this.onActivationError = onActivationError;
    this.queueRetry = queueRetry;
    this.isActivationInProgress = false;
  }

  shouldAddWebhooks(activationMode) {
    if (activationMode === 'init' || activationMode === 'leadershipChange') return true;
    return Boolean(this.instanceSettings.isLeader);
  }

  shouldAddTriggersAndPollers() { return Boolean(this.instanceSettings.isLeader); }

  async addActiveWorkflows(activationMode) {
    if (this.isActivationInProgress) {
      this.logger.debug(`Skipping activation - already in progress for mode: ${activationMode}`);
      return { skipped: true, activated: [] };
    }
    this.isActivationInProgress = true;
    const activated = [];
    try {
      const ids = await this.workflowRepository.getAllActiveIds();
      for (const batch of chunks(ids, this.activationBatchSize)) {
        const results = await Promise.all(batch.map((id) => this.activateWorkflow(id, activationMode)));
        activated.push(...results.filter(Boolean));
      }
      this.logger.debug('Finished activating all workflows');
      return { skipped: false, activated };
    } finally {
      this.isActivationInProgress = false;
    }
  }

  async activateWorkflow(workflowId, activationMode) {
    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow || workflow.active === false) return undefined;
    try {
      const added = await this.activate(workflow, activationMode, {
        addWebhooks: this.shouldAddWebhooks(activationMode),
        addTriggersAndPollers: this.shouldAddTriggersAndPollers(),
        shouldPublish: false,
      });
      if (added?.webhooks || added?.triggersAndPollers) {
        this.logger.info(`Activated workflow "${workflow.name}" (ID: ${workflow.id})`, { workflowId: workflow.id, workflowName: workflow.name });
      }
      return { workflowId: workflow.id, added: added ?? { webhooks: false, triggersAndPollers: false } };
    } catch (error) {
      this.errorReporter.error(error);
      const activeVersion = workflow.activeVersion;
      await this.onActivationError(error, activeVersion ? { ...workflow, nodes: activeVersion.nodes, connections: activeVersion.connections } : workflow);
      if (!String(error?.message).includes('Authorization')) this.queueRetry('init', workflow);
      return { workflowId: workflow.id, error };
    }
  }

  async onLeaderTakeover() { return this.addActiveWorkflows('leadershipChange'); }

  async onLeaderStepdown() {
    await this.activeWorkflows.removeAllTriggerAndPollerBasedWorkflows();
  }

  async onShutdown() { await this.onLeaderStepdown(); }
}
