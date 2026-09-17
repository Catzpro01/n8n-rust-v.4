import { createServer } from 'node:http';
import { parseWebhookBody } from './body-parser.mjs';

function writeResponse(response, result) {
  response.statusCode = result.statusCode ?? 200;
  for (const [name, value] of Object.entries(result.headers ?? {})) {
    if (value !== undefined) response.setHeader(name, value);
  }
  if (result.body === undefined || response.statusCode === 204 || response.statusCode === 304) {
    response.end();
    return;
  }
  if (Buffer.isBuffer(result.body) || typeof result.body === 'string') {
    response.end(result.body);
    return;
  }
  if (result.body && typeof result.body.pipe === 'function') {
    result.body.pipe(response);
    return;
  }
  if (!response.hasHeader('content-type')) response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(result.body));
}

async function readBody(request, limit, parserOptions) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error(`Webhook request body exceeds ${limit} bytes`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks);
  const parsed = await parseWebhookBody(rawBody, request.headers['content-type'], parserOptions);
  return { rawBody, ...parsed };
}

/** Native HTTP transport around the framework-independent WebhookRequestHandler. */
export class WebhookHttpServer {
  constructor({ handler, manager, basePath = '', bodyLimit = 16 * 1024 * 1024, maxFileSize = bodyLimit, storeFile, serverFactory = createServer } = {}) {
    if (!handler || !manager) throw new Error('WebhookHttpServer requires handler and manager');
    this.handler = handler;
    this.manager = manager;
    this.basePath = String(basePath).replace(/^\/+|\/+$/g, '');
    this.bodyLimit = bodyLimit;
    this.parserOptions = { maxFileSize, storeFile };
    this.server = serverFactory((request, response) => { void this.handle(request, response); });
  }

  async handle(request, response) {
    try {
      const origin = new URL(request.url ?? '/', 'http://webhook.local');
      let path = decodeURIComponent(origin.pathname).replace(/^\/+|\/+$/g, '');
      if (this.basePath) {
        if (path === this.basePath) path = '';
        else if (path.startsWith(`${this.basePath}/`)) path = path.slice(this.basePath.length + 1);
        else {
          writeResponse(response, { statusCode: 404, body: { code: 0, message: 'Webhook path is outside the configured base path.' } });
          return;
        }
      }
      const { body, files, rawBody } = await readBody(request, this.bodyLimit, this.parserOptions);
      const result = await this.handler.handle({
        method: request.method,
        path,
        headers: request.headers,
        query: Object.fromEntries(origin.searchParams),
        body,
        files,
        rawBody,
        request,
        response,
      }, this.manager);
      if (!response.writableEnded) writeResponse(response, result);
    } catch (error) {
      if (response.writableEnded) return;
      writeResponse(response, {
        statusCode: error.statusCode ?? 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: { code: 0, message: error.message ?? 'Webhook request failed' },
      });
    }
  }

  listen({ port = 0, host = '0.0.0.0' } = {}) {
    return new Promise((resolve, reject) => {
      const onError = (error) => { this.server.off('listening', onListening); reject(error); };
      const onListening = () => { this.server.off('error', onError); resolve(this.address()); };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(port, host);
    });
  }

  address() { return this.server.address(); }

  close() {
    if (!this.server.listening) return Promise.resolve(false);
    return new Promise((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve(true)));
  }
}
