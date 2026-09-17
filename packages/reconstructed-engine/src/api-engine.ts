// API Engine — 1:1 dari abstract-server + controller.registry + response-helper (n8n 2.9.4)
// Owner: Agent 4

export class ResponseHelper {
  static sendSuccessResponse(data: any) {
    return { data };
  }

  static sendErrorResponse(error: any) {
    const isResponseError = error.httpStatusCode !== undefined;
    if (isResponseError) {
      return {
        code: error.errorCode || error.httpStatusCode,
        message: error.message,
        hint: error.hint,
        stacktrace: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
      };
    }
    return { code: 0, message: error.message || 'Unknown error' };
  }
}

export class ApiEngine {
  private routes = new Map();

  registerController(basePath: any, methods: any) {
    for (const m of methods) {
      const key = `${m.method}:${basePath}${m.path}`;
      this.routes.set(key, m);
    }
  }

  handleRequest(method: any, path: any, body: any, auth: any) {
    if (!auth) {
      return { status: 401, body: { status: 'error', message: 'Unauthorized' } };
    }
    const key = `${method}:${path}`;
    const route = this.routes.get(key);
    if (!route) {
      // SPA fallback — 404 html in real n8n
      return { status: 404, body: '<html>Editor</html>', headers: { 'content-type': 'text/html' } };
    }
    try {
      const result = route.handler({ body, auth });
      return { status: 200, body: ResponseHelper.sendSuccessResponse(result) };
    } catch (e: any) {
      const errBody = ResponseHelper.sendErrorResponse(e);
      return { status: e.httpStatusCode || 500, body: errBody };
    }
  }

  healthCheck() {
    return { status: 'ok' };
  }

  readinessCheck(dbConnected: any) {
    if (!dbConnected) return { status: 503, body: { status: 'error' } };
    return { status: 200, body: { status: 'ok' } };
  }
}
