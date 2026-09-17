export class WebhookError extends Error {
  constructor(message, { code = 0, statusCode = 500, hint } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    if (hint) this.hint = hint;
  }
}

export class WebhookNotFoundError extends WebhookError {
  constructor({ method, path, registeredMethods = [], test = false }) {
    const upper = method.toUpperCase();
    if (registeredMethods.length) {
      const suggested = registeredMethods[0];
      super(`This webhook is not registered for ${upper} requests. Did you mean to make a ${suggested} request?`, {
        code: 404, statusCode: 404,
      });
    } else {
      super(`The requested webhook "${test ? '' : `${upper} `}${path}" is not registered.`, {
        code: 404,
        statusCode: 404,
        hint: test
          ? "Click the 'Execute workflow' button on the canvas, then try again."
          : 'The workflow must be active for a production URL to run successfully. You can activate the workflow using the toggle in the top-right of the editor.',
      });
    }
  }
}

export class WebhookConflictError extends WebhookError {
  constructor(hint) {
    super('There is a conflict with one of the webhooks.', { code: 409, statusCode: 409, hint });
  }
}
