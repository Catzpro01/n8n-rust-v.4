/**
 * Framework-neutral REST client — the "UI → frontend contract → compatibility
 * boundary" arrow, in code.
 *
 * A component never builds a URL, unwraps an envelope, or guesses what a status
 * means: it asks this client, receives `{ ok, status, data, error }`, and renders
 * the state model. Swapping the UI implementation changes who calls this module,
 * not what it guarantees.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */
import { ENVELOPES, answersEmptyBody, resolveListShape, SESSION } from './contract.mjs';

/**
 * `Response.headers` is a `Headers` instance, but a test double or a polyfill may
 * hand over a plain object or an array of pairs. Normalizing here keeps the
 * client usable with any spec-compatible fetch.
 */
function headersToObject(headers) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  if (typeof headers.forEach === 'function') {
    const out = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  return { ...headers };
}
import { FrontendError, normalizeError } from './errors.mjs';

/** The state model every surface renders: no component invents its own. */
export const STATE_STATUSES = Object.freeze(['idle', 'loading', 'ready', 'empty', 'error']);

/**
 * Creates a client bound to one instance.
 *
 * @param {object} [init]
 * @param {string} [init.baseUrl] e.g. '' (same origin) or 'https://host/base'
 * @param {string} [init.restEndpoint] bare segment, default 'rest' (n8n contract)
 * @param {typeof fetch} [init.fetchImpl]
 * @param {(error: FrontendError) => void} [init.onAuthRequired] called on the first 401
 * @param {(input: unknown, options?: object) => FrontendError} [init.normalize]
 */
export function createRestClient(init = {}) {
  const baseUrl = (init.baseUrl ?? '').replace(/\/$/, '');
  const restEndpoint = init.restEndpoint ?? 'rest';
  const fetchImpl = init.fetchImpl ?? globalThis.fetch;
  const normalize = init.normalize ?? normalizeError;
  let authRequiredNotified = false;

  if (typeof fetchImpl !== 'function') {
    throw new Error('createRestClient needs a fetch implementation (expected the platform fetch)');
  }

  function restPath(path) {
    const clean = path.startsWith('/') ? path : `/${path}`;
    return clean.startsWith(`/${restEndpoint}/`) || clean === `/${restEndpoint}` ? clean : `/${restEndpoint}${clean}`;
  }

  function url(path) {
    return `${baseUrl}${restPath(path)}`;
  }

  /**
   * Unwraps a response body according to the contract.
   *
   * @param {unknown} body parsed JSON (or undefined for an empty body)
   * @param {{ path: string, status: number }} context
   * @returns {{ shape: string, data: unknown, count: number|null, estimated: number|null, items: unknown[]|null }}
   */
  function unwrap(body, { path, status }) {
    if (body === undefined || body === null) {
      return { shape: answersEmptyBody(path) ? ENVELOPES.empty.id : 'empty-body', data: null, count: null, estimated: null, items: null };
    }
    if (typeof body !== 'object' || Array.isArray(body)) {
      return { shape: 'raw', data: body, count: null, estimated: null, items: Array.isArray(body) ? body : null };
    }
    const keys = Object.keys(body);
    if (status === 200 && keys.length === 0 && answersEmptyBody(path)) {
      return { shape: ENVELOPES.empty.id, data: null, count: null, estimated: null, items: null };
    }
    // `{ count, results, estimated }` — the executions list (contract §9).
    if (Array.isArray(body.results) && typeof body.count === 'number') {
      // `estimated` is a boolean in n8n's execution list (false = exact count),
      // so both a flag and a number are accepted and passed through unchanged.
      const estimated = typeof body.estimated === 'boolean' || typeof body.estimated === 'number' ? body.estimated : null;
      return {
        shape: ENVELOPES.bare.id,
        data: body.results,
        count: body.count,
        estimated,
        items: body.results,
      };
    }
    // `{ count, data }` — the bare list envelope of getFullApiResponse endpoints.
    if ('data' in body && typeof body.count === 'number') {
      return {
        shape: ENVELOPES.bare.id,
        data: body.data,
        count: body.count,
        estimated: null,
        items: Array.isArray(body.data) ? body.data : null,
      };
    }
    if ('data' in body) {
      const data = body.data;
      return {
        shape: ENVELOPES.data.id,
        data,
        count: typeof body.count === 'number' ? body.count : null,
        estimated: null,
        items: Array.isArray(data) ? data : null,
      };
    }
    return { shape: 'raw', data: body, count: null, estimated: null, items: null };
  }

  /**
   * Performs one request.
   *
   * Never throws for HTTP or transport failures: the caller gets `{ ok: false,
   * error }` and renders the error surface. Throwing is reserved for programmer
   * errors (a missing fetch implementation, an invalid method).
   *
   * @returns {Promise<{ ok: boolean, status: number, body: unknown, data: unknown, count: number|null, estimated: number|null, items: unknown[]|null, shape: string, error: FrontendError|null, headers: object }>}
   */
  async function request(method, path, { body, query, surface = null, signal } = {}) {
    const upper = String(method ?? 'GET').toUpperCase();
    let target = url(path);
    if (query && Object.keys(query).length > 0) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        search.set(key, String(value));
      }
      const serialized = search.toString();
      if (serialized.length > 0) target += `${target.includes('?') ? '&' : '?'}${serialized}`;
    }

    let response;
    try {
      response = await fetchImpl(target, {
        method: upper,
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(init.headers ?? {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal ? { signal } : {}),
      });
    } catch (cause) {
      const error = normalize(cause, { surface, aborted: cause?.name === 'AbortError' });
      return { ok: false, status: 0, body: undefined, data: null, count: null, estimated: null, items: null, shape: 'error', error, headers: {} };
    }

    const raw = await response.text().catch(() => undefined);
    let parsed;
    if (raw !== undefined && raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }

    if (!response.ok) {
      const error = normalize({ status: response.status, body: parsed }, { surface });
      if (error.kind === 'auth' && !authRequiredNotified) {
        authRequiredNotified = true;
        init.onAuthRequired?.(error);
      }
      return { ok: false, status: response.status, body: parsed, data: null, count: null, estimated: null, items: null, shape: ENVELOPES.error.id, error, headers: headersToObject(response.headers) };
    }

    const unwrapped = unwrap(parsed, { path: restPath(path), status: response.status });
    // `200 {}` for a missing entity: honest signal, not a silent empty object.
    if (unwrapped.shape === ENVELOPES.empty.id) {
      const error = normalize({ status: 404, body: { message: 'Not found' } }, { surface });
      return { ok: false, status: response.status, body: parsed, data: null, count: null, estimated: null, items: null, shape: unwrapped.shape, error, headers: headersToObject(response.headers) };
    }
    return { ok: true, status: response.status, body: parsed, data: unwrapped.data, count: unwrapped.count, estimated: unwrapped.estimated, items: unwrapped.items, shape: unwrapped.shape, error: null, headers: headersToObject(response.headers) };
  }

  const get = (path, options) => request('GET', path, options);
  const post = (path, body, options) => request('POST', path, { ...options, body });
  const patch = (path, body, options) => request('PATCH', path, { ...options, body });
  const put = (path, body, options) => request('PUT', path, { ...options, body });
  const del = (path, options) => request('DELETE', path, options);

  /**
   * Collects a paginated list following the n8n list contract (`limit`, `filter`).
   *
   * @param {string} path
   * @param {{ limit?: number, pageSize?: number, query?: object, maxPages?: number, surface?: string }} [options]
   */
  async function paginate(path, options = {}) {
    const { limit = 100, pageSize = Math.min(limit, 100), query = {}, maxPages = 50, surface = null } = options;
    const items = [];
    let page = 0;
    let last = null;
    while (items.length < limit && page < maxPages) {
      const result = await request('GET', path, {
        query: { ...query, limit: Math.min(pageSize, limit - items.length) },
        surface,
      });
      last = result;
      if (!result.ok) return { ok: false, items, count: null, error: result.error, pages: page + 1 };
      const batch = result.items ?? [];
      items.push(...batch);
      page += 1;
      if (batch.length < pageSize) break;
    }
    return { ok: true, items: items.slice(0, limit), count: last?.count ?? items.length, error: null, pages: page };
  }

  return {
    baseUrl,
    restEndpoint,
    url,
    request,
    get,
    post,
    patch,
    put,
    del,
    paginate,
    unwrap,
    listShape: resolveListShape,
    session: SESSION,
    /** Reset the "session expired" latch after a successful sign-in. */
    resetAuthState() {
      authRequiredNotified = false;
    },
  };
}

/**
 * State model for a component: one place that decides between loading, ready,
 * empty and error (contract §9). `empty` is never an error.
 */
export function createStateStore({ initialData = null } = {}) {
  let status = initialData === null ? 'idle' : 'ready';
  let data = initialData;
  let error = null;

  function isListEmpty(value) {
    if (Array.isArray(value)) return value.length === 0;
    if (value && typeof value === 'object' && Array.isArray(value.items)) return value.items.length === 0;
    return false;
  }

  return {
    get status() {
      return status;
    },
    get data() {
      return data;
    },
    get error() {
      return error;
    },
    snapshot() {
      return { status, data, error, isEmpty: status === 'empty' };
    },
    start() {
      status = 'loading';
      error = null;
      return this.snapshot();
    },
    /**
     * Applies a client result.
     * @param {{ ok: boolean, data?: unknown, items?: unknown[], error?: FrontendError|null }} result
     */
    apply(result) {
      if (result?.ok) {
        data = result.data ?? (result.items ?? null);
        error = null;
        status = isListEmpty(data) ? 'empty' : 'ready';
      } else {
        error = result?.error ?? normalizeError(result);
        data = null;
        status = 'error';
      }
      return this.snapshot();
    },
    setData(value) {
      data = value;
      error = null;
      status = isListEmpty(value) ? 'empty' : 'ready';
      return this.snapshot();
    },
    reset() {
      data = null;
      error = null;
      status = 'idle';
      return this.snapshot();
    },
  };
}
