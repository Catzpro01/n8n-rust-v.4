/**
 * Minimal node:http helpers for the baseline server.
 */

/**
 * Read request body with size limit.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Buffer>}
 */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      reject(err);
    };

    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('Payload too large');
        err.code = 413;
        // Stop reading; destroy socket
        req.destroy();
        fail(err);
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    };

    const onError = (err) => fail(err);

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} html
 */
export function sendHtml(res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(html);
}

/**
 * Baseline error envelope — contracts/ts-runtime-baseline.contract.md §4.4
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} message
 * @param {{ hint?: string, details?: unknown, stack?: string, code?: number }} [extra]
 */
export function sendError(res, status, message, extra = {}) {
  const body = {
    code: extra.code ?? status,
    message,
  };
  if (extra.hint) body.hint = extra.hint;
  if (extra.details !== undefined) body.details = extra.details;
  if (extra.stack) body.stacktrace = extra.stack;
  sendJson(res, status, body);
}

/**
 * Strip base path prefix from URL pathname.
 * @param {string} urlPath
 * @param {string} basePath
 */
export function stripBasePath(urlPath, basePath) {
  if (!basePath) return urlPath || '/';
  if (urlPath === basePath) return '/';
  if (urlPath.startsWith(basePath + '/')) return urlPath.slice(basePath.length) || '/';
  return null; // outside base
}

/**
 * @returns {string}
 */
export function nextExecutionId() {
  // Monotonic-ish id without external deps
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `exec-${t}-${r}`;
}
