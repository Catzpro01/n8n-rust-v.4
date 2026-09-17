import { WebhookError, WebhookNotFoundError } from './errors.mjs';

export const ALLOWED_METHODS = new Set(['OPTIONS', 'DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT']);

function errorResponse(error) {
  return {
    statusCode: error.statusCode ?? 500,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: {
      code: error.code ?? 0,
      message: error.message,
      ...(error.hint ? { hint: error.hint } : {}),
    },
  };
}

export class WebhookRequestHandler {
  async handle(request, manager) {
    const method = String(request.method ?? 'GET').toUpperCase();
    const path = String(request.path ?? '').replace(/^\/+|\/+$/g, '');
    if (!ALLOWED_METHODS.has(method)) {
      return errorResponse(new WebhookError(`The method ${method} is not supported.`));
    }

    const methods = await manager.getWebhookMethods(path);
    const origin = request.headers?.origin;
    const cors = origin ? {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': `OPTIONS${methods.length ? `, ${methods.join(', ')}` : ''}`,
      'access-control-max-age': '300',
    } : {};
    if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: undefined };

    try {
      const response = await manager.executeWebhook({ ...request, method, path });
      return {
        statusCode: response?.statusCode ?? response?.responseCode ?? 200,
        headers: { ...cors, ...(response?.headers ?? {}) },
        body: response?.body ?? response?.data ?? { message: 'Workflow was started' },
      };
    } catch (error) {
      const response = errorResponse(error);
      response.headers = { ...cors, ...response.headers };
      return response;
    }
  }
}

export class LiveWebhookManager {
  constructor({ service, execute }) { this.service = service; this.execute = execute; }
  getWebhookMethods(path) { return this.service.getWebhookMethods(path); }
  async executeWebhook(request) {
    const webhook = await this.service.findWebhook(request.method, request.path);
    if (!webhook) {
      const methods = await this.service.getWebhookMethods(request.path);
      throw new WebhookNotFoundError({ method: request.method, path: request.path, registeredMethods: methods });
    }
    request.params = { ...(request.params ?? {}), ...this.service.extractPathParameters(webhook, request.path) };
    return await this.execute({ request, webhook });
  }
}
