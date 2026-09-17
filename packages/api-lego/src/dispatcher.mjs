import {
	formatSuccessResponse,
	formatErrorResponse,
	formatUnauthenticatedResponse,
	formatPublicApiError,
} from './envelope.mjs';
import { validateDto } from './validation.mjs';

export class ApiDispatcher {
	constructor(options = {}) {
		this.routes = [];
		this.authValidator = options.authValidator ?? (() => true);
		this.publicApiKeys = options.publicApiKeys ?? new Set();
	}

	register(method, path, handler, options = {}) {
		this.routes.push({
			method: method.toUpperCase(),
			path,
			handler,
			options,
		});
	}

	get(path, handler, options) {
		this.register('GET', path, handler, options);
	}

	post(path, handler, options) {
		this.register('POST', path, handler, options);
	}

	patch(path, handler, options) {
		this.register('PATCH', path, handler, options);
	}

	put(path, handler, options) {
		this.register('PUT', path, handler, options);
	}

	delete(path, handler, options) {
		this.register('DELETE', path, handler, options);
	}

	matchRoute(method, pathname) {
		for (const route of this.routes) {
			if (route.method !== method) continue;

			// Handle path patterns with :param
			const paramNames = [];
			const regexPath = route.path.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
				paramNames.push(name);
				return '([^/]+)';
			});

			const match = new RegExp(`^${regexPath}$`).exec(pathname);
			if (match) {
				const params = {};
				paramNames.forEach((name, i) => {
					params[name] = match[i + 1];
				});
				return { route, params };
			}
		}
		return null;
	}

	async handleRequest(req) {
		const method = (req.method ?? 'GET').toUpperCase();
		const pathname = req.path ?? '/';
		const headers = req.headers ?? {};

		// 1. Health endpoints
		if (method === 'GET' && (pathname === '/healthz' || pathname === '/healthz/readiness')) {
			return {
				status: 200,
				body: { status: 'ok' },
			};
		}

		// 2. Public API (/api/v1/*)
		if (pathname.startsWith('/api/v1/')) {
			const apiKey = headers['x-n8n-api-key'] || headers['X-N8N-API-KEY'];
			if (!apiKey) {
				return formatPublicApiError("'X-N8N-API-KEY' header required", 401);
			}
			if (this.publicApiKeys.size > 0 && !this.publicApiKeys.has(apiKey)) {
				return formatPublicApiError('unauthorized', 401);
			}
		}

		// 3. Match defined routes
		const matched = this.matchRoute(method, pathname);
		if (matched) {
			const { route, params } = matched;

			// Auth check
			if (!route.options.skipAuth && !pathname.startsWith('/api/v1/')) {
				const isAuthenticated = this.authValidator(req);
				if (!isAuthenticated) {
					return formatUnauthenticatedResponse();
				}
			}

			// DTO validation
			if (route.options.schema && req.body) {
				const validationResult = validateDto(route.options.schema, req.body);
				if (!validationResult.valid) {
					return {
						status: 400,
						body: validationResult.error,
					};
				}
			}

			// Execution ID number check quirk
			if (pathname.startsWith('/rest/executions/') && params.id) {
				if (isNaN(Number(params.id))) {
					return {
						status: 400,
						body: {
							code: 400,
							message: 'Execution ID is not a number',
						},
					};
				}
			}

			try {
				const result = await route.handler({
					...req,
					params,
				});

				// Resource specific quirks
				if (pathname.startsWith('/rest/executions/') && result === null) {
					return {
						status: 200,
						body: {},
					};
				}

				return formatSuccessResponse(result, route.options.raw);
			} catch (err) {
				return formatErrorResponse(err);
			}
		}

		// 4. SPA Fallback: unmatched /rest/* routes return 404 with text/html
		if (method === 'GET' && pathname.startsWith('/rest/')) {
			return {
				status: 404,
				contentType: 'text/html; charset=utf-8',
				body: '<!DOCTYPE html><html><head><title>n8n</title></head><body><div id="app"></div></body></html>',
				isHtml: true,
			};
		}

		return {
			status: 404,
			body: { code: 404, message: 'Not Found' },
		};
	}
}
