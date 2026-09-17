export class TriggerLifecycleError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    Object.assign(this, options);
  }
}

export class WorkflowActivationError extends TriggerLifecycleError {}
export class WorkflowDeactivationError extends TriggerLifecycleError {}
export class TriggerCloseError extends TriggerLifecycleError {}
export class UserError extends TriggerLifecycleError {}
