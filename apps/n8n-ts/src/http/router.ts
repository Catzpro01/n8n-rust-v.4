/**
 * Minimal zero-dependency router: exact segments plus `:param` placeholders.
 * It also reports *which* methods a known path supports so the server can answer
 * `405` with a correct `Allow` header (contract §3 row 17).
 */
export type RouteParams = Record<string, string>;

export type RouteMatch =
  | { kind: 'match'; handler: RouteHandler; params: RouteParams }
  | { kind: 'method-not-allowed'; allowed: string[] };

export type RouteHandler = (context: RouteContext) => Promise<void> | void;

export type RouteContext = {
  request: import('node:http').IncomingMessage;
  response: import('node:http').ServerResponse;
  params: RouteParams;
  query: URLSearchParams;
  requestId: string;
};

type Route = {
  method: string;
  segments: string[];
  path: string;
  handler: RouteHandler;
};

export class Router {
  readonly #routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler): this {
    this.#routes.push({
      method: method.toUpperCase(),
      path,
      segments: path.split('/').filter((segment) => segment !== ''),
      handler,
    });
    return this;
  }

  get(path: string, handler: RouteHandler): this {
    return this.add('GET', path, handler);
  }

  post(path: string, handler: RouteHandler): this {
    return this.add('POST', path, handler);
  }

  put(path: string, handler: RouteHandler): this {
    return this.add('PUT', path, handler);
  }

  delete(path: string, handler: RouteHandler): this {
    return this.add('DELETE', path, handler);
  }

  options(path: string, handler: RouteHandler): this {
    return this.add('OPTIONS', path, handler);
  }

  /** Path templates that are registered, useful for diagnostics and tests. */
  routes(): { method: string; path: string }[] {
    return this.#routes.map(({ method, path }) => ({ method, path }));
  }

  match(method: string, pathname: string): RouteMatch | null {
    const parts = pathname.split('/').filter((segment) => segment !== '');
    const allowed = new Set<string>();
    let pathMatched = false;

    for (const route of this.#routes) {
      const params = matchSegments(route.segments, parts);
      if (params === null) continue;
      pathMatched = true;
      allowed.add(route.method);
      if (route.method === method.toUpperCase()) return { kind: 'match', handler: route.handler, params };
    }

    if (pathMatched) return { kind: 'method-not-allowed', allowed: [...allowed].sort() };
    return null;
  }
}

function matchSegments(routeSegments: string[], pathSegments: string[]): RouteParams | null {
  if (routeSegments.length !== pathSegments.length) return null;
  const params: RouteParams = {};
  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index] as string;
    const pathSegment = pathSegments[index] as string;
    if (routeSegment.startsWith(':')) {
      params[routeSegment.slice(1)] = decodeURIComponent(pathSegment);
      continue;
    }
    if (routeSegment !== pathSegment) return null;
  }
  return params;
}
