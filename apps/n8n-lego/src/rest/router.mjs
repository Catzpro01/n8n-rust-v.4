/**
 * Tiny REST router — method + path pattern, `:param` capture, JSON envelopes.
 *
 * n8n's REST conventions are preserved:
 *   success -> `{ data: ... }`            (see ResponseHelper)
 *   failure -> `{ message, code?, meta? }` with the matching status code
 * A 404 on `/rest/*` is never silent: every miss is logged with the method and
 * path so an unimplemented part of the reference API is visible in the log
 * instead of showing up as a mystery spinner in the browser.
 */

export class HttpError extends Error {
  constructor(status, message, { code = undefined, meta = undefined } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.meta = meta;
  }
}

export const unauthorized = () => new HttpError(401, 'Unauthorized');
export const forbidden = (message = 'Forbidden') => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const badRequest = (message, meta) => new HttpError(400, message, { meta });

export function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

/**
 * The editor reads almost every `/rest` response through `makeRestApiRequest`,
 * which does `return response.data` with the comment "All cli rest api endpoints
 * return data wrapped in `data` key" — so the wrapper is part of the contract.
 */
export function sendData(res, data, { status = 200, headers = {} } = {}) {
  sendJson(res, status, { data }, headers);
}

/**
 * Bare payload, for the handful of endpoints the editor reads with
 * `getFullApiResponse` (`GET /workflows`, `POST /workflows/with-node-types`, …).
 * Those return `{ count, data }` themselves and must NOT be wrapped again.
 */
export function sendBare(res, payload, { status = 200, headers = {} } = {}) {
  sendJson(res, status, payload, headers);
}

export function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const body = {
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof HttpError && error.code ? { code: error.code } : {}),
    ...(error instanceof HttpError && error.meta ? { meta: error.meta } : {}),
  };
  sendJson(res, status, body);
}

/**
 * @param {Array<{ method: string|string[], path: string, handler: Function, public?: boolean }>} routes
 */
export function createRouter(routes) {
  const compiled = routes.map((route) => compile(route));

  return {
    routes: compiled,
    /**
     * Resolves a method + path to a route without running it, so the caller can
     * enforce authentication before reading a request body.
     * @returns {{ handler: Function, params: Record<string,string>, public: boolean } | null}
     */
    match(method, path) {
      const upper = method.toUpperCase();
      for (const route of compiled) {
        if (!route.methods.includes(upper)) continue;
        const params = route.match(path);
        if (params === null) continue;
        return { handler: route.handler, params, public: route.public };
      }
      return null;
    },
  };
}

function compile(route) {
  const methods = (Array.isArray(route.method) ? route.method : [route.method]).map((m) => m.toUpperCase());
  const segments = route.path.split('/').filter((segment) => segment !== '');
  return {
    methods,
    public: route.public ?? false,
    handler: route.handler,
    match(path) {
      const parts = path.split('/').filter((segment) => segment !== '');
      if (parts.length !== segments.length) return null;
      const params = {};
      for (let i = 0; i < segments.length; i += 1) {
        const expected = segments[i];
        const actual = parts[i];
        if (expected.startsWith(':')) {
          params[expected.slice(1)] = decodeURIComponent(actual);
          continue;
        }
        if (expected !== actual) return null;
      }
      return params;
    },
  };
}

export async function readBody(req, { limit }) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body is too large');
    chunks.push(chunk);
  }
  if (size === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  const contentType = String(req.headers['content-type'] ?? '');
  if (contentType.includes('application/json') || raw.trimStart().startsWith('{') || raw.trimStart().startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw badRequest(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return raw;
}
