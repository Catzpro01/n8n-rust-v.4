// Webhook Engine — 1:1 port of the n8n 2.9.4 webhook layer.
//
// Reference sources (pinned, read-only):
//   * `n8n-workflow` `node-helpers.ts` — `getNodeWebhookPath` / `getNodeWebhookUrl`
//   * `n8n-workflow` `errors/webhook-path-taken.error.ts` — `WebhookPathTakenError`
//   * `cli/src/webhooks/webhook.service.ts` — `findStaticWebhook` / `findDynamicWebhook` /
//     `findCached` / `getWebhookMethods` / `isDynamicPath` / `getWebhookPath` / `getNodeWebhooks`
//   * `@n8n/db` `webhook-entity.ts` — `cacheKey`, `staticSegments`, `isDynamic`, `uniquePath`
//   * `cli/src/errors/response-errors/webhook-not-found.error.ts` — message + hint selection
//   * `cli/src/webhooks/webhook-request-sanitizer.ts` — `sanitizeWebhookRequest`
//   * `cli/src/webhooks/webhook-on-received-response-extractor.ts`
//   * `cli/src/webhooks/webhook-response-headers.ts` — `WebhookResponseHeaders`
//
// Deliberate deviations (recorded in `packages/webhook-lego/manifest/ownership.json`):
//   * the registry keeps its rows in memory (the reference reads a TypeORM table through a cache);
//   * `WebhookResponseHeaders` takes an injectable logger instead of `Container.get(Logger)`;
//   * express `Request`/`Response` are duck-typed (`{ headers }`, `{ setHeaders }`).
//
// Verified by `tools/webhook-isolation-gate.mjs` (`npm run webhook:check`, W01-W07): the path/URL
// helpers and `WebhookPathTakenError` are compared against the *executing* `n8n-workflow` build,
// while the CLI-only pieces are compared against a transcription of the reference source over a
// corpus (provenance is recorded in the evidence file).
//
// Owner: Agent 4 (webhook LEGO) — port + gate by Agent 3 (integration).
// Zero Rust, pure JS/TS, frontend UI untouched.

import { validateHeaderName, validateHeaderValue } from 'node:http';
import { WorkflowActivationError } from './trigger-engine.ts';

export { WorkflowActivationError } from './trigger-engine.ts';

export type HttpMethod = string;

export interface INodeShape {
	name: string;
	type?: string;
	typeVersion?: number;
	disabled?: boolean;
	webhookId?: string;
	parameters?: Record<string, any>;
}

/** A stored webhook row — the port of `WebhookEntity`. */
export interface WebhookRow {
	workflowId: string;
	webhookPath: string;
	method: HttpMethod;
	webhookId?: string;
	node?: string;
	pathLength?: number;
	staticSegments?: string[];
}

/** `IWebhookData` subset produced by `getNodeWebhooks`. */
export interface WebhookData {
	httpMethod: HttpMethod;
	node: string;
	path: string;
	workflowId: string;
	webhookId?: string;
	webhookDescription?: any;
}

/**
 * `IWebhookDescription` (n8n-workflow `interfaces.ts:2426`) — the reference allows strings *and*
 * booleans in several fields, which is why `isFullPath` / `restartWebhook` are compared with
 * values of both kinds.
 */
export interface WebhookDescription {
	path: string;
	name?: string;
	isFullPath?: boolean | string;
	restartWebhook?: boolean | string;
	httpMethod?: string;
	responseMode?: string;
	responseData?: string;
	[key: string]: any;
}

export const WEBHOOK_NODE_TYPE = 'n8n-nodes-base.webhook';
export const RESPOND_TO_WEBHOOK_NODE_TYPE = 'n8n-nodes-base.respondToWebhook';

/** `constants.ts` in the CLI — the cookie the API auth flow uses. */
export const AUTH_COOKIE_NAME = 'n8n-auth';
export const BROWSER_ID_COOKIE_NAME = 'n8n-browserId';

/** `webhook-request-sanitizer.ts` */
const DISALLOWED_COOKIES = new Set([AUTH_COOKIE_NAME, BROWSER_ID_COOKIE_NAME]);

/** `webhook-response-headers.ts` — headers users may not set. */
const PROTECTED_HEADERS = new Set(['content-security-policy']);

/* ------------------------------------------------------------------ */
/* path + URL (n8n-workflow `NodeHelpers`)                             */
/* ------------------------------------------------------------------ */

/**
 * Port of `NodeHelpers.getNodeWebhookPath`. With no `webhookId` the path is namespaced by the
 * workflow id and the lower-cased, URL-encoded node name; a full path is returned untouched.
 */
export function getNodeWebhookPath(
	workflowId: string,
	node: { name: string; webhookId?: string },
	path: string,
	isFullPath?: boolean,
	restartWebhook?: boolean,
): string {
	let webhookPath = '';

	if (restartWebhook === true) {
		return path;
	}

	if (node.webhookId === undefined) {
		const nodeName = encodeURIComponent(node.name.toLowerCase());

		webhookPath = `${workflowId}/${nodeName}/${path}`;
	} else {
		if (isFullPath === true) {
			return path || node.webhookId;
		}

		webhookPath = `${node.webhookId}/${path}`;
	}
	return webhookPath;
}

/** Port of `NodeHelpers.getNodeWebhookUrl` (note the `:var` special case). */
export function getNodeWebhookUrl(
	baseUrl: string,
	workflowId: string,
	node: { name: string; webhookId?: string },
	path: string,
	isFullPath?: boolean,
): string {
	if ((path.startsWith(':') || path.includes('/:')) && node.webhookId) {
		// setting this to false to prefix the webhookId
		isFullPath = false;
	}
	if (path.startsWith('/')) {
		path = path.slice(1);
	}
	return `${baseUrl}/${getNodeWebhookPath(workflowId, node, path, isFullPath)}`;
}

/* ------------------------------------------------------------------ */
/* errors                                                              */
/* ------------------------------------------------------------------ */

export interface WebhookPathTakenErrorOptions {
	cause?: Error;
}

/**
 * Port of `n8n-workflow` `WebhookPathTakenError` — an activation error with level `warning`, and
 * (like every `ApplicationError` in this stack) no exposed `cause`.
 */
export class WebhookPathTakenError extends WorkflowActivationError {
	constructor(nodeName: string, cause?: Error) {
		super(`The URL path that the "${nodeName}" node uses is already taken. Please change it to something else.`, { level: 'warning', cause });
		this.name = 'WebhookPathTakenError';
	}
}

/** Message builder of `webhook-not-found.error.ts` (verbatim, pop-quirk included). */
export function webhookNotFoundErrorMessage({
	path,
	httpMethod,
	webhookMethods,
}: {
	path: string;
	httpMethod?: string;
	webhookMethods?: string[];
}): string {
	let webhookPath = path;

	if (httpMethod) {
		webhookPath = `${httpMethod} ${webhookPath}`;
	}

	if (webhookMethods?.length && httpMethod) {
		let methods = '';

		if (webhookMethods.length === 1) {
			methods = webhookMethods[0];
		} else {
			// NOTE: the reference *mutates* the caller's array here (`pop()`); reproduced verbatim.
			const lastMethod = webhookMethods.pop();

			methods = `${webhookMethods.join(', ')} or ${lastMethod as string}`;
		}

		return `This webhook is not registered for ${httpMethod} requests. Did you mean to make a ${methods} request?`;
	}

	return `The requested webhook "${webhookPath}" is not registered.`;
}

/**
 * Port of `WebhookNotFoundError`: the message plus the hint the API adds (the hint only exists when
 * no method matched at all — a wrong-method request gets the message alone).
 */
export function webhookNotFoundPayload(
	{ path, httpMethod, webhookMethods }: { path: string; httpMethod?: string; webhookMethods?: string[] },
	{ hint = 'default' }: { hint?: 'default' | 'production' } = {},
): { name: string; message: string; hint: string; httpStatusCode: number } {
	const message = webhookNotFoundErrorMessage({ path, httpMethod, webhookMethods: webhookMethods ? [...webhookMethods] : webhookMethods });

	let hintMessage = '';
	if (!webhookMethods?.length) {
		hintMessage =
			hint === 'default'
				? "Click the 'Execute workflow' button on the canvas, then try again. (In test mode, the webhook only works for one call after you click this button)"
				: "The workflow must be active for a production URL to run successfully. You can activate the workflow using the toggle in the top-right of the editor. Note that unlike test URL calls, production URL calls aren't shown on the canvas (only in the executions list)";
	}

	return { name: 'WebhookNotFoundError', message, hint: hintMessage, httpStatusCode: 404 };
}

/* ------------------------------------------------------------------ */
/* request / response helpers                                          */
/* ------------------------------------------------------------------ */

/** Port of `sanitizeWebhookRequest` — strips the auth + browser-id cookies, in place. */
export function sanitizeWebhookRequest(request: { headers: Record<string, any>; cookies?: any }): void {
	const cookiesHeader = request.headers?.cookie;

	if (typeof cookiesHeader === 'string') {
		const cookies = cookiesHeader.split(';').map((cookie) => cookie.trim());
		const filteredCookies = cookies.filter((cookie) => {
			const cookieName = cookie.split('=')[0];
			return !DISALLOWED_COOKIES.has(cookieName);
		});

		if (filteredCookies.length !== cookies.length) {
			request.headers.cookie = filteredCookies.join('; ');
		}
	}

	if (request.cookies !== null && typeof request.cookies === 'object') {
		for (const cookieName of DISALLOWED_COOKIES) {
			delete request.cookies[cookieName];
		}
	}
}

/** Port of `extractWebhookOnReceivedResponse` (the `onReceived` response mode). */
export function extractWebhookOnReceivedResponse(responseData: string | undefined, webhookResultData: { webhookResponse?: unknown }): unknown {
	if (responseData === 'noData') {
		return undefined;
	}

	if (responseData) {
		return responseData;
	}

	if (webhookResultData?.webhookResponse !== undefined) {
		return webhookResultData.webhookResponse;
	}

	return { message: 'Workflow was started' };
}

export interface LoggerLike {
	warn(message: string, meta?: unknown): void;
}

/**
 * Port of `WebhookResponseHeaders`. Keys are always lower-cased; protected headers
 * (`content-security-policy`) and values rejected by `node:http` are silently dropped.
 */
export class WebhookResponseHeaders {
	private headers = new Map<string, string>();

	private readonly logger: LoggerLike;

	constructor(logger: LoggerLike = { warn: () => {} }) {
		this.logger = logger;
	}

	static fromObject(object: object, logger?: LoggerLike): WebhookResponseHeaders {
		const instance = new WebhookResponseHeaders(logger);
		instance.addFromObject(object);
		return instance;
	}

	set(name: string, value: string): void {
		const lowerName = name.toLowerCase();
		if (PROTECTED_HEADERS.has(lowerName)) return;
		try {
			validateHeaderName(lowerName);
			validateHeaderValue(lowerName, value);
		} catch (error) {
			this.logger.warn('Dropping invalid webhook response header', { headerName: name, error: error instanceof Error ? error.message : `${error}` });
			return;
		}
		this.headers.set(lowerName, value);
	}

	addFromObject(object: object): void {
		for (const [name, value] of Object.entries(object)) {
			this.set(name, String(value));
		}
	}

	addFromNodeHeaders(nodeHeaders: { entries?: Array<{ name: string; value: string }> }): void {
		if (nodeHeaders.entries === undefined) return;

		for (const entry of nodeHeaders.entries) {
			this.set(entry.name, entry.value);
		}
	}

	/** Duck-typed `applyToResponse` (`res.setHeaders(map)` in express). */
	applyToResponse(response: { setHeaders(headers: Map<string, string>): void }): void {
		if (this.headers.size === 0) return;

		response.setHeaders(this.headers);
	}

	toMap(): Map<string, string> {
		return new Map(this.headers);
	}
}

/* ------------------------------------------------------------------ */
/* webhook rows — WebhookEntity + WebhookService                       */
/* ------------------------------------------------------------------ */

const uniquePathOf = (row: { webhookPath: string; webhookId?: string }): string =>
	row.webhookPath.includes(':') ? [row.webhookId, row.webhookPath].join('/') : row.webhookPath;

/** Port of `WebhookEntity.staticSegments` — the path segments that are not `:parameters`. */
export const staticSegmentsOf = (webhookPath: string): string[] => webhookPath.split('/').filter((segment) => !segment.startsWith(':'));

/** Port of `WebhookEntity.isDynamic`. */
export const isDynamicWebhookPath = (webhookPath: string): boolean => webhookPath.split('/').some((segment) => segment.startsWith(':'));

/**
 * Port of `WebhookService.isDynamicPath` — true when the path carries a `:param` after the first
 * segment (the first segment is the webhook id), with the reference's short-circuits reproduced.
 */
export function isDynamicPath(rawPath: string): boolean {
	const firstSlashIndex = rawPath.indexOf('/');
	const path = firstSlashIndex !== -1 ? rawPath.substring(firstSlashIndex + 1) : rawPath;

	// if dynamic, first segment is webhook ID so disregard it

	if (path === '' || path === ':' || path === '/:') return false;

	return path.startsWith(':') || path.includes('/:');
}

/** Port of `WebhookService.getWebhookPath`. */
export function getWebhookPath(webhook: { path: string; webhookId?: string }): string {
	return [webhook.path.includes(':') ? webhook.webhookId : undefined, webhook.path].filter((part) => !!part).join('/');
}

export interface WebhookParameterResolver {
	(node: INodeShape, parameter: string, mode: string, runData: Record<string, unknown>, fallbackValue?: unknown, defaultValue?: unknown): unknown;
}

/**
 * Port of `WebhookService.getNodeWebhooks`: turns a webhook node + its `description.webhooks`
 * entries into the `IWebhookData[]` the CLI registers. The expression layer is injected as
 * `resolveParameter` (this reconstruction evaluates no expressions inside the engine).
 */
export function collectNodeWebhooks({
	workflowId,
	node,
	webhooks,
	resolveParameter,
	ignoreRestartWebhooks = false,
	logger = { error: () => {} },
}: {
	workflowId?: string;
	node: INodeShape;
	webhooks: WebhookDescription[];
	resolveParameter: WebhookParameterResolver;
	ignoreRestartWebhooks?: boolean;
	logger?: { error(message: string): void };
}): WebhookData[] {
	if (node.disabled === true) {
		// Node is disabled so webhooks will also not be enabled
		return [];
	}

	const resolvedWorkflowId = workflowId || '__UNSAVED__';
	const mode = 'internal';

	const returnData: WebhookData[] = [];
	for (const webhookDescription of webhooks) {
		if (ignoreRestartWebhooks && webhookDescription.restartWebhook === true) {
			continue;
		}

		const resolvedPath = resolveParameter(node, webhookDescription.path, mode, {});
		if (resolvedPath === undefined) {
			logger.error(`No webhook path could be found for node "${node.name}" in workflow "${resolvedWorkflowId}".`);
			continue;
		}

		let nodeWebhookPath = `${resolvedPath}`;

		if (nodeWebhookPath.startsWith('/')) {
			nodeWebhookPath = nodeWebhookPath.slice(1);
		}
		if (nodeWebhookPath.endsWith('/')) {
			nodeWebhookPath = nodeWebhookPath.slice(0, -1);
		}

		const isFullPath = resolveParameter(node, webhookDescription.isFullPath as string, mode, {}, undefined, false) as boolean;
		const restartWebhook = resolveParameter(node, webhookDescription.restartWebhook as string, mode, {}, undefined, false) as boolean;
		const path = getNodeWebhookPath(resolvedWorkflowId, node, nodeWebhookPath, isFullPath, restartWebhook);

		const webhookMethods = resolveParameter(node, webhookDescription.httpMethod as string, mode, {}, undefined, 'GET');

		if (webhookMethods === undefined) {
			logger.error(`The webhook "${path}" for node "${node.name}" in workflow "${resolvedWorkflowId}" could not be added because the httpMethod is not defined.`);
			continue;
		}

		let webhookId: string | undefined;

		if (isDynamicPath(path) && node.webhookId) {
			webhookId = node.webhookId;
		}

		String(webhookMethods)
			.split(',')
			.forEach((httpMethod) => {
				if (!httpMethod) return;
				returnData.push({
					httpMethod: httpMethod.trim(),
					node: node.name,
					path,
					webhookDescription,
					workflowId: resolvedWorkflowId,
					webhookId,
				});
			});
	}

	return returnData;
}

/**
 * In-memory port of `WebhookService` (rows instead of a TypeORM table, a `Map` instead of Redis).
 * `findWebhook` is static-cache-then-dynamic, exactly like `findCached`.
 */
export class WebhookRegistry {
	private rows: WebhookRow[] = [];

	/** Cache view, keyed like `WebhookEntity.cacheKey` (`webhook:${method}-${uniquePath}`). */
	readonly webhooks = new Map<string, WebhookRow>();

	private readonly logger: LoggerLike;

	constructor(logger: LoggerLike = { warn: () => {} }) {
		this.logger = logger;
	}

	private materialise(row: WebhookRow): WebhookRow {
		return { ...row, pathLength: row.pathLength ?? row.webhookPath.split('/').length, staticSegments: staticSegmentsOf(row.webhookPath) };
	}

	private cacheKeyOf(row: WebhookRow): string {
		return `webhook:${row.method}-${uniquePathOf(row)}`;
	}

	private findByPath(method: HttpMethod, path: string): WebhookRow | undefined {
		return this.rows.find((row) => row.webhookPath === path && row.method === method);
	}

	/** Port of `findStaticWebhook`. */
	findStaticWebhook(method: HttpMethod, path: string): WebhookRow | null {
		return this.findByPath(method, path) ?? null;
	}

	/** Port of `findDynamicWebhook` (`<uuid>/user/:id/posts` matching). */
	findDynamicWebhook(path: string, method?: HttpMethod): WebhookRow | null {
		const [uuidSegment, ...otherSegments] = path.split('/');

		const dynamicWebhooks = this.rows.filter(
			(row) => row.webhookId === uuidSegment && (method === undefined || row.method === method) && row.pathLength === otherSegments.length,
		);

		if (dynamicWebhooks.length === 0) return null;

		const requestSegments = new Set(otherSegments);

		const { webhook } = dynamicWebhooks.reduce<{ webhook: WebhookRow | null; maxMatches: number }>(
			(accumulator, dynamicWebhook) => {
				const allStaticSegmentsMatch = dynamicWebhook.staticSegments!.every((segment) => requestSegments.has(segment));

				if (allStaticSegmentsMatch && dynamicWebhook.staticSegments!.length > accumulator.maxMatches) {
					accumulator.maxMatches = dynamicWebhook.staticSegments!.length;
					accumulator.webhook = dynamicWebhook;
					return accumulator;
				} else if (dynamicWebhook.staticSegments!.length === 0 && !accumulator.webhook) {
					accumulator.webhook = dynamicWebhook; // edge case: if path is `:var`, match on anything
				}

				return accumulator;
			},
			{ webhook: null, maxMatches: 0 },
		);

		return webhook;
	}

	/** Port of `findCached`: cache hit, then static row, then dynamic row. */
	findWebhook(method: HttpMethod, path: string): WebhookRow | null {
		const cacheKey = `webhook:${method}-${path}`;
		const cached = this.webhooks.get(cacheKey);
		if (cached) return cached;

		const staticRow = this.findStaticWebhook(method, path);
		if (staticRow) {
			this.webhooks.set(cacheKey, staticRow);
			return staticRow;
		}

		return this.findDynamicWebhook(path, method);
	}

	/** Port of `getWebhookMethods`. */
	getWebhookMethods(rawPath: string): HttpMethod[] {
		const staticMethods = this.rows.filter((row) => row.webhookPath === rawPath).map((row) => row.method);

		if (staticMethods.length > 0) {
			return staticMethods;
		}

		const dynamicWebhook = this.findDynamicWebhook(rawPath);
		return dynamicWebhook ? [dynamicWebhook.method] : [];
	}

	/** Port of `WebhookService.storeWebhook` (upsert by method + webhookPath). */
	storeWebhook(row: WebhookRow): WebhookRow {
		const materialised = this.materialise(row);

		this.webhooks.set(this.cacheKeyOf(materialised), materialised);

		const existingIndex = this.rows.findIndex((candidate) => candidate.method === materialised.method && candidate.webhookPath === materialised.webhookPath);
		if (existingIndex === -1) this.rows.push(materialised);
		else this.rows[existingIndex] = materialised;

		return materialised;
	}

	/** Port of `deleteWorkflowWebhooks`. */
	deleteWorkflowWebhooks(workflowId: string): number {
		const doomed = this.rows.filter((row) => row.workflowId === workflowId);
		for (const row of doomed) this.webhooks.delete(this.cacheKeyOf(row));
		this.rows = this.rows.filter((row) => row.workflowId !== workflowId);
		return doomed.length;
	}

	/** Facade-level alias kept from the Phase 4 surface. */
	deleteWebhooksByWorkflow(workflowId: string): number {
		return this.deleteWorkflowWebhooks(workflowId);
	}

	allWebhooks(): WebhookRow[] {
		return [...this.rows];
	}
}

/* ------------------------------------------------------------------ */
/* Phase 4-13 spec surface (other agent's track) — preserved verbatim  */
/* ------------------------------------------------------------------ */
//
// These exports come from the concurrent "webhook spec" track (invariants W1-W9, see
// `packages/webhook-lego/src/model-surface.ts`). They are kept so that track keeps compiling; the
// reference-exact registry above (`WebhookRegistry`) is what the facade uses and what
// `npm run webhook:check` verifies.

export const ALLOWED_METHODS = ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS'] as const;

export type WebhookResponseMode =
	| 'onReceived' | 'lastNode' | 'responseNode' | 'streaming' | 'formPage' | 'hostedChat';

export interface RegisteredWebhook {
	webhookPath: string; // tanpa leading/trailing '/'
	method: string;
	webhookId?: string;
	pathLength?: number;
	staticSegments?: string[];
}

export function methodNotSupported(method: string): { httpStatus: 500; code: 0; message: string } {
	return { httpStatus: 500, code: 0, message: `The method ${method} is not supported.` };
}

export function webhookNotFound(webhookPath: string): { httpStatus: 404; code: 404; message: string; hint: string } {
	return {
		httpStatus: 404,
		code: 404,
		message: `The requested webhook "${webhookPath}" is not registered.`,
		hint: 'The workflow must be active for a production URL to run successfully. Please activate your workflow.',
	};
}

export function webhookWrongMethod(httpMethod: string, methods: string): { httpStatus: 404; code: 404; message: string } {
	return {
		httpStatus: 404,
		code: 404,
		message: `This webhook is not registered for ${httpMethod} requests. Did you mean to make a ${methods} request?`,
	};
}

export function webhookPathTaken(nodeName: string): Error {
	const err = new Error(`The URL path that the "${nodeName}" node uses is already taken. Please change it to something else.`);
	err.name = 'WebhookPathTakenError';
	return err;
}

/** W3: exact (method,path) dulu; lalu kandidat dinamis, longest-pathLength menang. */
export function findWebhook(rows: RegisteredWebhook[], method: string, path: string): RegisteredWebhook | null {
	const clean = path.replace(/\/+$/, '');
	const exact = rows.find((r) => r.method === method && r.webhookPath === clean);
	if (exact) return exact;
	const [head, ...rest] = clean.split('/');
	let best: RegisteredWebhook | null = null;
	let bestScore = -1;
	for (const row of rows.filter((r) => r.method === method && r.webhookId === head)) {
		const statics = row.staticSegments ?? [];
		let score = 0;
		for (let i = 0; i < statics.length; i++) {
			if (rest[i] === statics[i]) score++;
			else { score = -1; break; }
		}
		if (score < 0) continue;
		const total = score * 1000 + (row.pathLength ?? rest.length);
		if (total > bestScore) { bestScore = total; best = row; }
	}
	return best;
}

/** W6: (webhookPath, method) unik instance-wide. */
export function storeWebhook(rows: RegisteredWebhook[], row: RegisteredWebhook, nodeName: string): void {
	const clean = { ...row, webhookPath: row.webhookPath.replace(/^\/+|\/+$/g, '') };
	const taken = rows.some((r) => r.method === clean.method && r.webhookPath === clean.webhookPath);
	if (taken) throw webhookPathTaken(nodeName);
	rows.push(clean);
}

/** W7/W8: default onReceived; mode tidak dikenal = 500 exact message. */
export function resolveResponseMode(mode: string | undefined): WebhookResponseMode {
	const modes: readonly string[] = ['onReceived', 'lastNode', 'responseNode', 'streaming', 'formPage', 'hostedChat'];
	if (mode === undefined || mode === 'onReceived') return 'onReceived';
	if (modes.includes(mode)) return mode as WebhookResponseMode;
	throw new Error(`The response mode '${mode}' is not valid!`);
}

export function onReceivedDefaultBody(): { message: string } {
	return { message: 'Workflow was started' };
}

/** W2: preflight OPTIONS = 204 kosong, tanpa eksekusi. */
export function handlePreflight(method: string): { httpStatus: 204; body: '' } | null {
	return method === 'OPTIONS' ? { httpStatus: 204, body: '' } : null;
}

/** W9: strip cookie n8n-auth kecuali node allowlisted (chat trigger). */
export function sanitizeCookies(headers: Record<string, string>, nodeType: string, allowlisted: readonly string[]): Record<string, string> {
	if (allowlisted.includes(nodeType)) return headers;
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		if (k.toLowerCase() === 'cookie') {
			const kept = v.split(';').map((c) => c.trim()).filter((c) => !/^n8n-(auth|browserid)=/i.test(c));
			if (kept.length > 0) out[k] = kept.join('; ');
		} else {
			out[k] = v;
		}
	}
	return out;
}

