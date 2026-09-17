import { validateHeaderName, validateHeaderValue } from 'node:http';

const PROTECTED_HEADERS = new Set(['content-security-policy']);
const NOOP_LOGGER = Object.freeze({ warn() {} });

/** Validated response headers. Names are lower-cased; invalid and protected values are dropped. */
export class WebhookResponseHeaders {
  constructor({ logger = NOOP_LOGGER } = {}) {
    this.headers = new Map();
    this.logger = logger;
  }

  static fromObject(object, options) {
    const instance = new WebhookResponseHeaders(options);
    instance.addFromObject(object);
    return instance;
  }

  set(name, value) {
    const lowerName = String(name).toLowerCase();
    if (PROTECTED_HEADERS.has(lowerName)) return;
    try {
      validateHeaderName(lowerName);
      validateHeaderValue(lowerName, value);
    } catch (error) {
      this.logger.warn('Dropping invalid webhook response header', { headerName: name, error: error.message });
      return;
    }
    this.headers.set(lowerName, value);
  }

  addFromObject(object) {
    for (const [name, value] of Object.entries(object ?? {})) this.set(name, String(value));
  }

  addFromNodeHeaders(nodeHeaders) {
    if (!nodeHeaders?.entries) return;
    for (const entry of nodeHeaders.entries) this.set(entry.name, entry.value);
  }

  toObject() { return Object.fromEntries(this.headers); }

  applyToResponse(response) {
    if (this.headers.size === 0) return;
    if (typeof response.setHeaders === 'function') response.setHeaders(this.headers);
    else for (const [name, value] of this.headers) response.setHeader(name, value);
  }
}

export function normalizeResponseHeaders(headers) {
  return headers instanceof WebhookResponseHeaders ? headers.toObject() : (headers ?? {});
}
