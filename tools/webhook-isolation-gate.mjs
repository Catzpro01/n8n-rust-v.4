#!/usr/bin/env node
/**
 * Webhook LEGO — Phase 5 differential gate.
 *
 * Two evidence classes, and the evidence file says which is which:
 *
 *   EXECUTED ORACLE (`.runtime/node_modules/n8n-workflow`, pinned 2.9.1)
 *     W02 `getNodeWebhookPath`   W03 `getNodeWebhookUrl`   W04 `WebhookPathTakenError`
 *     W05 header validation against `node:http`
 *
 *   REFERENCE TRANSCRIPTION (the CLI module is DI + TypeORM bound and cannot be imported offline)
 *     W05 registry matching (`findStaticWebhook` / `findDynamicWebhook` / `findCached` /
 *         `getWebhookMethods`, `WebhookEntity.cacheKey|staticSegments`)
 *     W06 request/response helpers (`sanitizeWebhookRequest`, `extractWebhookOnReceivedResponse`,
 *         `webhookNotFoundErrorMessage`), `getNodeWebhooks` collection
 *
 *   W01 declared surface   W07 `packages/webhook-lego/test/*.test.mjs`
 *
 * usage: node tools/webhook-isolation-gate.mjs [--quiet]
 * evidence: docs/isolation/evidence/webhook-lego-gate.json
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateHeaderName, validateHeaderValue } from 'node:http';

const REPO = process.cwd();
const args = process.argv.slice(2);
const EVIDENCE = join(REPO, 'docs/isolation/evidence/webhook-lego-gate.json');
const WEBHOOK_PKG = join(REPO, 'packages/webhook-lego');

/* ---------------------------------------------------------------- */
/* reference runtime (executed oracle)                               */
/* ---------------------------------------------------------------- */
function findRuntime() {
	for (const dir of [process.env.LEGO_LIVE_RUNTIME, join(REPO, '.runtime/node_modules'), '/home/user/.n8n-live/node_modules']) {
		if (dir && existsSync(join(dir, 'n8n-workflow/package.json'))) return dir;
	}
	return null;
}
const runtimeDir = findRuntime();
if (!runtimeDir) {
	console.error('reference runtime not found — run scripts/setup-reference-runtime.sh (or set LEGO_LIVE_RUNTIME)');
	process.exit(2);
}
const workflowPackage = join(runtimeDir, 'n8n-workflow');
const reqWorkflow = createRequire(join(workflowPackage, 'package.json'));
const { NodeHelpers, WebhookPathTakenError, WEBHOOK_NODE_TYPE, RESPOND_TO_WEBHOOK_NODE_TYPE, WorkflowActivationError } = reqWorkflow(workflowPackage);

const candidate = await import(pathToFileURL(join(REPO, 'packages/reconstructed-engine/src/webhook-engine.ts')).href);

/* ---------------------------------------------------------------- */
/* comparison plumbing                                               */
/* ---------------------------------------------------------------- */
const norm = (value) => {
	if (value === undefined) return '<undefined>';
	if (value instanceof Map) return [...value.entries()].map(([key, val]) => [key, norm(val)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
	if (Array.isArray(value)) return value.map(norm);
	if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, norm(value[key])]));
	return value;
};
const show = (value, max = 220) => {
	const text = JSON.stringify(norm(value)) ?? 'undefined';
	return text.length > max ? `${text.slice(0, max)}…` : text;
};

const differences = [];
const comparisons = { total: 0, byCheck: {} };
function compare(check, scenario, call, referenceValue, candidateValue) {
	comparisons.total++;
	comparisons.byCheck[check] = (comparisons.byCheck[check] ?? 0) + 1;
	const a = JSON.stringify(norm(referenceValue));
	const b = JSON.stringify(norm(candidateValue));
	if (a === b) return;
	differences.push({ check, scenario, call, reference: show(referenceValue), candidate: show(candidateValue) });
}
const assertSame = (check, scenario, call, referenceValue, candidateValue) => {
	compare(check, scenario, call, referenceValue, candidateValue);
	return differences.find((diff) => diff.check === check && diff.scenario === scenario && diff.call === call);
};

/* ---------------------------------------------------------------- */
/* REFERENCE TRANSCRIPTION — cli/src/webhooks/webhook.service.ts      */
/* ---------------------------------------------------------------- */
//
// Verbatim transcription of the reference algorithm. It is NOT an executed oracle (the CLI module
// needs DI, TypeORM and Redis); it is compared against the port so both implementations must agree
// over the corpus. Any change to one side without the other fails the gate.

const uniquePathOf = (row) => (row.webhookPath.includes(':') ? [row.webhookId, row.webhookPath].join('/') : row.webhookPath);
const cacheKeyOf = (method, row) => `webhook:${method}-${uniquePathOf(row)}`;
const staticSegmentsOf = (webhookPath) => webhookPath.split('/').filter((segment) => !segment.startsWith(':'));

/** cli `WebhookService.findStaticWebhook` */
const refFindStaticWebhook = (rows, method, path) => rows.find((row) => row.webhookPath === path && row.method === method) ?? null;

/** cli `WebhookService.findDynamicWebhook` */
function refFindDynamicWebhook(rows, path, method) {
	const [uuidSegment, ...otherSegments] = path.split('/');

	const dynamicWebhooks = rows.filter(
		(row) => row.webhookId === uuidSegment && (method === undefined || row.method === method) && row.pathLength === otherSegments.length,
	);

	if (dynamicWebhooks.length === 0) return null;

	const requestSegments = new Set(otherSegments);

	const { webhook } = dynamicWebhooks.reduce(
		(acc, dw) => {
			const allStaticSegmentsMatch = dw.staticSegments.every((s) => requestSegments.has(s));

			if (allStaticSegmentsMatch && dw.staticSegments.length > acc.maxMatches) {
				acc.maxMatches = dw.staticSegments.length;
				acc.webhook = dw;
				return acc;
			} else if (dw.staticSegments.length === 0 && !acc.webhook) {
				acc.webhook = dw; // edge case: if path is `:var`, match on anything
			}

			return acc;
		},
		{ webhook: null, maxMatches: 0 },
	);

	return webhook;
}

/** cli `WebhookService.getWebhookMethods` */
function refGetWebhookMethods(rows, rawPath) {
	const staticMethods = rows.filter((row) => row.webhookPath === rawPath).map((row) => row.method);

	if (staticMethods.length > 0) return staticMethods;

	const dynamicWebhook = refFindDynamicWebhook(rows, rawPath);
	return dynamicWebhook ? [dynamicWebhook.method] : [];
}

/** cli `WebhookService.findCached` (cache → static → dynamic) */
function refFindWebhook(rows, method, path) {
	const cache = new Map();
	const cached = cache.get(`webhook:${method}-${path}`);
	if (cached) return cached;

	const staticRow = refFindStaticWebhook(rows, method, path);
	if (staticRow) {
		cache.set(`webhook:${method}-${path}`, staticRow);
		return staticRow;
	}

	return refFindDynamicWebhook(rows, path, method);
}

/** cli `WebhookService.isDynamicPath` */
function refIsDynamicPath(rawPath) {
	const firstSlashIndex = rawPath.indexOf('/');
	const path = firstSlashIndex !== -1 ? rawPath.substring(firstSlashIndex + 1) : rawPath;

	if (path === '' || path === ':' || path === '/:') return false;

	return path.startsWith(':') || path.includes('/:');
}

/** cli `WebhookService.getWebhookPath` */
const refGetWebhookPath = (webhook) => [webhook.path.includes(':') ? webhook.webhookId : undefined, webhook.path].filter((part) => !!part).join('/');

/** cli `webhook-request-sanitizer.ts` */
function refSanitizeWebhookRequest(request) {
	const DISALLOWED = new Set(['n8n-auth', 'n8n-browserId']);

	const cookiesHeader = request.headers.cookie;
	if (typeof cookiesHeader === 'string') {
		const cookies = cookiesHeader.split(';').map((cookie) => cookie.trim());
		const filteredCookies = cookies.filter((cookie) => !DISALLOWED.has(cookie.split('=')[0]));
		if (filteredCookies.length !== cookies.length) request.headers.cookie = filteredCookies.join('; ');
	}

	if (request.cookies !== null && typeof request.cookies === 'object') {
		for (const cookieName of DISALLOWED) delete request.cookies[cookieName];
	}
}

/** cli `webhook-on-received-response-extractor.ts` */
function refExtractWebhookOnReceivedResponse(responseData, webhookResultData) {
	if (responseData === 'noData') return undefined;
	if (responseData) return responseData;
	if (webhookResultData.webhookResponse !== undefined) return webhookResultData.webhookResponse;
	return { message: 'Workflow was started' };
}

/** cli `errors/response-errors/webhook-not-found.error.ts` (message builder) */
function refWebhookNotFoundMessage({ path, httpMethod, webhookMethods }) {
	let webhookPath = path;
	if (httpMethod) webhookPath = `${httpMethod} ${webhookPath}`;

	if (webhookMethods?.length && httpMethod) {
		let methods = '';
		if (webhookMethods.length === 1) {
			methods = webhookMethods[0];
		} else {
			const lastMethod = webhookMethods.pop();
			methods = `${webhookMethods.join(', ')} or ${lastMethod}`;
		}
		return `This webhook is not registered for ${httpMethod} requests. Did you mean to make a ${methods} request?`;
	}
	return `The requested webhook "${webhookPath}" is not registered.`;
}

/** cli `webhook-response-headers.ts` (transcription; the reference logs through `Container.get(Logger)`). */
function refWebhookResponseHeaders(operations) {
	const PROTECTED = new Set(['content-security-policy']);
	const headers = new Map();
	const warnings = [];

	for (const operation of operations) {
		const entries =
			operation.type === 'object'
				? Object.entries(operation.value)
				: operation.type === 'node'
					? (operation.value.entries ?? []).map((entry) => [entry.name, entry.value])
					: [[operation.value.name, operation.value.value]];
		for (const [rawName, rawValue] of entries.map(([name, value]) => [name, String(value)])) {
			const lowerName = rawName.toLowerCase();
			if (PROTECTED.has(lowerName)) continue;
			try {
				validateHeaderName(lowerName);
				validateHeaderValue(lowerName, rawValue);
			} catch (error) {
				warnings.push(`Dropping invalid webhook response header:${lowerName}`);
				continue;
			}
			headers.set(lowerName, rawValue);
		}
	}

	return { headers, warnings };
}

/** cli `WebhookService.getNodeWebhooks` */
function refCollectNodeWebhooks({ workflowId, node, webhooks, resolveParameter, ignoreRestartWebhooks = false }) {
	if (node.disabled === true) return [];

	const resolvedWorkflowId = workflowId || '__UNSAVED__';
	const mode = 'internal';
	const returnData = [];

	for (const webhookDescription of webhooks) {
		if (ignoreRestartWebhooks && webhookDescription.restartWebhook === true) continue;

		let nodeWebhookPath = resolveParameter(node, webhookDescription.path, mode, {}, undefined);
		if (nodeWebhookPath === undefined) continue;
		nodeWebhookPath = nodeWebhookPath.toString();
		if (nodeWebhookPath.startsWith('/')) nodeWebhookPath = nodeWebhookPath.slice(1);
		if (nodeWebhookPath.endsWith('/')) nodeWebhookPath = nodeWebhookPath.slice(0, -1);

		const isFullPath = resolveParameter(node, webhookDescription.isFullPath, mode, {}, undefined, false);
		const restartWebhook = resolveParameter(node, webhookDescription.restartWebhook, mode, {}, undefined, false);
		const path = NodeHelpers.getNodeWebhookPath(resolvedWorkflowId, node, nodeWebhookPath, isFullPath, restartWebhook);

		const webhookMethods = resolveParameter(node, webhookDescription.httpMethod, mode, {}, undefined, 'GET');
		if (webhookMethods === undefined) continue;

		let webhookId;
		if (refIsDynamicPath(path) && node.webhookId) webhookId = node.webhookId;

		String(webhookMethods)
			.split(',')
			.forEach((httpMethod) => {
				if (!httpMethod) return;
				returnData.push({ httpMethod: httpMethod.trim(), node: node.name, path, webhookId });
			});
	}

	return returnData;
}

/* ---------------------------------------------------------------- */
/* fixtures                                                          */
/* ---------------------------------------------------------------- */
const NODES = [
	{ name: 'Plain Node', type: WEBHOOK_NODE_TYPE },
	{ name: 'Node With ID', type: WEBHOOK_NODE_TYPE, webhookId: 'uuid-1' },
	{ name: 'Ünïcode NODE', type: WEBHOOK_NODE_TYPE, webhookId: 'uuid-2' },
	{ name: 'Disabled', type: WEBHOOK_NODE_TYPE, disabled: true },
];
const PATHS = ['', 'simple', 'a/b', 'a/:id/posts', ':id', 'user/:id/posts/:postId', '/trimmed/', 'with space'];
const BOOLEANS = [undefined, true, false];
const WORKFLOW_IDS = ['wf-1', '__UNSAVED__', ''];

const ROW_CORPUS = [
	// static rows
	{ workflowId: 'wf1', webhookPath: 'simple', method: 'GET', node: 'A' },
	{ workflowId: 'wf1', webhookPath: 'simple', method: 'POST', node: 'A' },
	{ workflowId: 'wf1', webhookPath: 'user/profile', method: 'GET', node: 'B' },
	// dynamic rows: `<uuid>/...`
	{ workflowId: 'wf2', webhookPath: 'user/:id/posts', method: 'GET', node: 'C', webhookId: 'uuid-c' },
	{ workflowId: 'wf2', webhookPath: 'user/:id/comments', method: 'GET', node: 'D', webhookId: 'uuid-c' },
	{ workflowId: 'wf2', webhookPath: ':id/posts', method: 'GET', node: 'E', webhookId: 'uuid-c' },
	{ workflowId: 'wf3', webhookPath: 'deep/a/b/:id', method: 'POST', node: 'F', webhookId: 'uuid-f' },
	{ workflowId: 'wf3', webhookPath: 'different/:id', method: 'POST', node: 'G', webhookId: 'uuid-g' },
	// a dynamic row of a different path length for the same webhook id
	{ workflowId: 'wf2', webhookPath: 'user/:id', method: 'GET', node: 'H', webhookId: 'uuid-c' },
];

const REQUESTS = [
	['GET', 'simple'],
	['POST', 'simple'],
	['PUT', 'simple'],
	['GET', 'user/profile'],
	['GET', 'uuid-c/user/123/posts'],
	['GET', 'uuid-c/user/123/comments'],
	['GET', 'uuid-c/anything/123'],
	['GET', 'uuid-c/user/123'],
	['GET', 'uuid-c/posts'],
	['POST', 'uuid-f/deep/a/b/999'],
	['POST', 'uuid-f/deep/b/a/999'],
	['POST', 'uuid-f/deep/a/999'],
	['POST', 'uuid-g/different/999'],
	['GET', 'uuid-unknown/user/123/posts'],
];

const materialiseRows = (rows) =>
	rows.map((row) => ({ ...row, pathLength: row.webhookPath.split('/').length, staticSegments: staticSegmentsOf(row.webhookPath) }));

/* ---------------------------------------------------------------- */
/* checks                                                            */
/* ---------------------------------------------------------------- */
const checks = [];
const gate = async (id, title, fn) => {
	let status = 'PASS';
	let detail = '';
	try {
		detail = (await fn()) ?? '';
	} catch (error) {
		status = 'FAIL';
		detail = error?.message ?? String(error);
	}
	checks.push({ id, title, status, detail: String(detail).trim().slice(0, 900) });
	console.log(`[${status}] ${id} ${title}${detail ? ` — ${String(detail).split('\n')[0]}` : ''}`);
};

await gate('W01', 'the port exports the reference surface', () => {
	const expected = [
		'WEBHOOK_NODE_TYPE', 'RESPOND_TO_WEBHOOK_NODE_TYPE', 'getNodeWebhookPath', 'getNodeWebhookUrl', 'WebhookPathTakenError',
		'WebhookRegistry', 'WebhookResponseHeaders', 'sanitizeWebhookRequest', 'extractWebhookOnReceivedResponse',
		'webhookNotFoundErrorMessage', 'webhookNotFoundPayload', 'collectNodeWebhooks', 'isDynamicPath', 'getWebhookPath',
		'staticSegmentsOf', 'isDynamicWebhookPath',
	];
	const missing = expected.filter((name) => candidate[name] === undefined);
	if (missing.length) throw new Error(`missing exports: ${missing.join(', ')}`);
	if (candidate.WEBHOOK_NODE_TYPE !== WEBHOOK_NODE_TYPE) throw new Error(`WEBHOOK_NODE_TYPE mismatch: ${candidate.WEBHOOK_NODE_TYPE}`);
	if (candidate.RESPOND_TO_WEBHOOK_NODE_TYPE !== RESPOND_TO_WEBHOOK_NODE_TYPE) throw new Error('RESPOND_TO_WEBHOOK_NODE_TYPE mismatch');
	return `${expected.length} exports (constants compared against the executed oracle)`;
});

await gate('W02', 'getNodeWebhookPath differential over node x path x mode matrix', () => {
	for (const workflowId of WORKFLOW_IDS) {
		for (const node of NODES) {
			for (const path of PATHS) {
				for (const isFullPath of BOOLEANS) {
					for (const restartWebhook of BOOLEANS) {
						const scenario = `workflowId=${JSON.stringify(workflowId)} node=${node.name} path=${JSON.stringify(path)}`;
						const call = `isFullPath=${isFullPath} restartWebhook=${restartWebhook}`;
						compare('W02', scenario, call, NodeHelpers.getNodeWebhookPath(workflowId, node, path, isFullPath, restartWebhook), candidate.getNodeWebhookPath(workflowId, node, path, isFullPath, restartWebhook));
					}
				}
			}
		}
	}
	const failed = differences.filter((diff) => diff.check === 'W02');
	if (failed.length) throw new Error(`${failed.length}/${comparisons.byCheck.W02} path calls diverge; first: ${failed[0].scenario} ${failed[0].call}\n  reference: ${failed[0].reference}\n  candidate: ${failed[0].candidate}`);
	return `${comparisons.byCheck.W02} path calls identical (${WORKFLOW_IDS.length} workflow ids x ${NODES.length} nodes x ${PATHS.length} paths x ${BOOLEANS.length}^2 modes)`;
});

await gate('W03', 'getNodeWebhookUrl differential (base URL, slash trimming, `:var` rule)', () => {
	const BASES = ['http://localhost:5678', 'https://example.test/n8n/', ''];
	for (const baseUrl of BASES) {
		for (const workflowId of WORKFLOW_IDS) {
			for (const node of NODES) {
				for (const path of PATHS) {
					for (const isFullPath of BOOLEANS) {
						const scenario = `baseUrl=${JSON.stringify(baseUrl)} node=${node.name}`;
						const call = `path=${JSON.stringify(path)} isFullPath=${isFullPath}`;
						compare('W03', scenario, call, NodeHelpers.getNodeWebhookUrl(baseUrl, workflowId, node, path, isFullPath), candidate.getNodeWebhookUrl(baseUrl, workflowId, node, path, isFullPath));
					}
				}
			}
		}
	}
	const failed = differences.filter((diff) => diff.check === 'W03');
	if (failed.length) throw new Error(`${failed.length}/${comparisons.byCheck.W03} URL calls diverge; first: ${failed[0].scenario} ${failed[0].call}\n  reference: ${failed[0].reference}\n  candidate: ${failed[0].candidate}`);
	return `${comparisons.byCheck.W03} URL calls identical (${BASES.length} base URLs x ${WORKFLOW_IDS.length} workflow ids x ${NODES.length} nodes x ${PATHS.length} paths x ${BOOLEANS.length} modes)`;
});

await gate('W04', 'WebhookPathTakenError matches the executed reference class', () => {
	const referenceError = new WebhookPathTakenError('Node X');
	const candidateError = new candidate.WebhookPathTakenError('Node X');

	compare('W04', 'error', 'message', referenceError.message, candidateError.message);
	compare('W04', 'error', 'name', referenceError.name, candidateError.name);
	compare('W04', 'error', 'level', referenceError.level, candidateError.level);
	compare('W04', 'error', 'cause visibility', referenceError.cause, candidateError.cause);
	compare('W04', 'error', 'instanceof base', referenceError instanceof WorkflowActivationError, candidateError instanceof candidate.WorkflowActivationError);
	compare('W04', 'error', 'prototype chain', Object.getPrototypeOf(Object.getPrototypeOf(referenceError)).constructor.name, Object.getPrototypeOf(Object.getPrototypeOf(candidateError)).constructor.name);

	const failed = differences.filter((diff) => diff.check === 'W04');
	if (failed.length) throw new Error(`error shape diverges: ${failed.map((diff) => `${diff.call} (${diff.reference} vs ${diff.candidate})`).join('; ')}`);
	return `message, name, level (warning), hidden cause and prototype chain identical — "${referenceError.message}"`;
});

await gate('W05', 'registry matching differential vs the transcribed WebhookService', () => {
	const rows = materialiseRows(ROW_CORPUS);
	const registry = new candidate.WebhookRegistry();
	for (const row of rows) registry.storeWebhook(row);

	for (const [method, path] of REQUESTS) {
		compare('W05', `findWebhook(${method}, ${path})`, 'row', refFindWebhook(rows, method, path)?.node ?? null, registry.findWebhook(method, path)?.node ?? null);
		// `findCached` caches only static hits, under `webhook:${method}-${requestPath}`.
		compare('W05', `findWebhook(${method}, ${path})`, 'static hit cached', refFindStaticWebhook(rows, method, path) !== null, registry.webhooks.has(`webhook:${method}-${path}`));
		compare('W05', `getWebhookMethods(${path})`, 'methods', refGetWebhookMethods(rows, path), registry.getWebhookMethods(path));
		compare('W05', `findDynamicWebhook(${path})`, 'row', refFindDynamicWebhook(rows, path)?.node ?? null, registry.findDynamicWebhook(path)?.node ?? null);
		compare('W05', `findStaticWebhook(${method}, ${path})`, 'row', refFindStaticWebhook(rows, method, path)?.node ?? null, registry.findStaticWebhook(method, path)?.node ?? null);
	}

	for (const rawPath of ['uuid-c/user/123/posts', 'uuid-c', 'uuid-c/:id', ':id', 'simple', 'uuid-c/user/123']) {
		compare('W05', `isDynamicPath(${rawPath})`, 'boolean', refIsDynamicPath(rawPath), candidate.isDynamicPath(rawPath));
	}
	for (const webhook of [{ path: 'a/:id', webhookId: 'uuid-x' }, { path: 'a/b', webhookId: 'uuid-x' }, { path: ':id', webhookId: undefined }]) {
		compare('W05', `getWebhookPath(${webhook.path})`, 'path', refGetWebhookPath(webhook), candidate.getWebhookPath(webhook));
	}
	for (const webhookPath of ['a/:id/b', 'a/b', ':id', 'user/:id/posts/:postId']) {
		compare('W05', `staticSegmentsOf(${webhookPath})`, 'segments', staticSegmentsOf(webhookPath), candidate.staticSegmentsOf(webhookPath));
		compare('W05', `isDynamicWebhookPath(${webhookPath})`, 'boolean', webhookPath.split('/').some((segment) => segment.startsWith(':')), candidate.isDynamicWebhookPath(webhookPath));
	}

	// upsert + delete semantics of the row store
	const upsertRegistry = new candidate.WebhookRegistry();
	upsertRegistry.storeWebhook({ workflowId: 'wf1', webhookPath: 'x', method: 'GET', node: 'first' });
	upsertRegistry.storeWebhook({ workflowId: 'wf2', webhookPath: 'x', method: 'GET', node: 'second' });
	compare('W05', 'storeWebhook upsert', 'row count', 1, upsertRegistry.allWebhooks().length);
	compare('W05', 'storeWebhook upsert', 'row node', 'second', upsertRegistry.findWebhook('GET', 'x')?.node ?? null);
	compare('W05', 'deleteWorkflowWebhooks', 'deleted count', 1, upsertRegistry.deleteWorkflowWebhooks('wf2'));
	compare('W05', 'deleteWorkflowWebhooks', 'remaining rows', 0, upsertRegistry.allWebhooks().length);
	compare('W05', 'deleteWorkflowWebhooks', 'cache cleared', false, upsertRegistry.webhooks.has('webhook:GET-x'));

	const failed = differences.filter((diff) => diff.check === 'W05');
	if (failed.length) throw new Error(`${failed.length}/${comparisons.byCheck.W05} registry calls diverge; first: ${failed[0].scenario} ${failed[0].call}\n  reference: ${failed[0].reference}\n  candidate: ${failed[0].candidate}`);
	return `${comparisons.byCheck.W05} registry calls identical (transcribed findStatic/findDynamic/findCached/getWebhookMethods over ${ROW_CORPUS.length} rows x ${REQUESTS.length} requests)`;
});

await gate('W06', 'request/response helpers + getNodeWebhooks vs the transcription', () => {
	const cases = [
		{ headers: { cookie: 'n8n-auth=abc; other=1' }, cookies: { 'n8n-auth': 'abc', other: '1' } },
		{ headers: { cookie: 'n8n-browserId=x; n8n-auth=y' }, cookies: { 'n8n-browserId': 'x', 'n8n-auth': 'y' } },
		{ headers: { cookie: 'a=1; b=2' }, cookies: { a: '1', b: '2' } },
		{ headers: {}, cookies: null },
		{ headers: { cookie: 42 }, cookies: { 'n8n-auth': 'z' } },
		{ headers: { cookie: 'n8n-auth=' }, cookies: {} },
	];
	for (const [index, input] of cases.entries()) {
		const referenceRequest = { headers: { ...input.headers }, cookies: input.cookies === null ? null : { ...input.cookies } };
		const candidateRequest = { headers: { ...input.headers }, cookies: input.cookies === null ? null : { ...input.cookies } };
		refSanitizeWebhookRequest(referenceRequest);
		candidate.sanitizeWebhookRequest(candidateRequest);
		compare('W06', `sanitizeWebhookRequest #${index}`, 'request', referenceRequest, candidateRequest);
	}

	const responseCases = [
		['noData', {}],
		['payload', {}],
		[undefined, { webhookResponse: { ok: true } }],
		[undefined, {}],
		['', { webhookResponse: 'text' }],
	];
	for (const [responseData, webhookResultData] of responseCases) {
		compare('W06', `extractWebhookOnReceivedResponse(${JSON.stringify(responseData)})`, 'body', refExtractWebhookOnReceivedResponse(responseData, webhookResultData), candidate.extractWebhookOnReceivedResponse(responseData, webhookResultData));
	}

	const notFoundCases = [
		{ path: 'x', httpMethod: undefined, webhookMethods: undefined },
		{ path: 'x', httpMethod: 'GET', webhookMethods: [] },
		{ path: 'x', httpMethod: 'GET', webhookMethods: ['POST'] },
		{ path: 'x', httpMethod: 'PUT', webhookMethods: ['GET', 'POST'] },
		{ path: 'x', httpMethod: 'DELETE', webhookMethods: ['GET', 'POST', 'PATCH'] },
	];
	for (const [index, input] of notFoundCases.entries()) {
		compare('W06', `webhookNotFoundErrorMessage #${index}`, 'message', refWebhookNotFoundMessage({ ...input, webhookMethods: input.webhookMethods ? [...input.webhookMethods] : undefined }), candidate.webhookNotFoundErrorMessage({ ...input, webhookMethods: input.webhookMethods ? [...input.webhookMethods] : undefined }));
		compare('W06', `webhookNotFoundPayload #${index}`, 'hint', index <= 1 ? candidate.webhookNotFoundPayload(input).hint.length > 0 : candidate.webhookNotFoundPayload(input).hint === '', true);
	}
	// the reference *mutates* the caller's array through pop()
	const referenceMethods = ['GET', 'POST', 'PATCH'];
	const candidateMethods = ['GET', 'POST', 'PATCH'];
	refWebhookNotFoundMessage({ path: 'x', httpMethod: 'DELETE', webhookMethods: referenceMethods });
	candidate.webhookNotFoundErrorMessage({ path: 'x', httpMethod: 'DELETE', webhookMethods: candidateMethods });
	compare('W06', 'webhookNotFoundErrorMessage', 'caller array mutation', referenceMethods, candidateMethods);

	// getNodeWebhooks collection
	const resolveFromParameters = (node, parameter, _mode, _runData, _fallback, defaultValue) =>
		parameter === undefined ? defaultValue : (node.parameters?.[parameter] ?? defaultValue);
	const webhookNodes = [
		{ name: 'Simple', parameters: { path: 'my-path', httpMethod: 'GET' } },
		{ name: 'Multi', parameters: { path: 'multi', httpMethod: 'GET,POST' } },
		{ name: 'Defaulted', parameters: { path: 'defaulted' } },
		{ name: 'Slashed', parameters: { path: '/slashed/' } },
		{ name: 'Full', webhookId: 'uuid-f', parameters: { path: 'full/:id', isFullPath: true } },
		{ name: 'Dynamic', webhookId: 'uuid-d', parameters: { path: 'user/:id/posts' } },
		{ name: 'Restart', webhookId: 'uuid-r', parameters: { path: 'restart', restartWebhook: true } },
		{ name: 'Disabled', disabled: true, parameters: { path: 'nope' } },
		{ name: 'NoPath', parameters: {} },
	];
	const webhookDescriptions = [{ path: 'path', httpMethod: 'httpMethod', isFullPath: 'isFullPath', restartWebhook: 'restartWebhook' }];
	for (const node of webhookNodes) {
		for (const ignoreRestartWebhooks of [false, true]) {
			const referenceData = refCollectNodeWebhooks({ workflowId: 'wf', node, webhooks: webhookDescriptions, resolveParameter: resolveFromParameters, ignoreRestartWebhooks });
			const candidateData = candidate.collectNodeWebhooks({ workflowId: 'wf', node, webhooks: webhookDescriptions, resolveParameter: resolveFromParameters, ignoreRestartWebhooks });
			// The port also carries `workflowId` + `webhookDescription` (the reference does too); the
			// comparison covers the four fields the CLI derives here.
			const pick = (entry) => ({ httpMethod: entry.httpMethod, node: entry.node, path: entry.path, webhookId: entry.webhookId ?? null });
			compare('W06', `getNodeWebhooks(${node.name})`, `ignoreRestartWebhooks=${ignoreRestartWebhooks}`, referenceData.map(pick), candidateData.map(pick));
		}
	}

	// response headers: protected header dropped, invalid entries dropped, keys lower-cased
	const headerOperations = [
		{ type: 'object', value: { 'Content-Type': 'application/json', 'Content-Security-Policy': 'default-src none', 'X-Bad': 'ok' } },
		{ type: 'node', value: { entries: [{ name: 'X-Node', value: 'yes' }] } },
		{ type: 'set', value: { name: 'X-With-Spaces', value: '   ' } },
		{ type: 'set', value: { name: 'X-Injected', value: 'a\r\nEvil: 1' } },
	];
	const referenceHeaders = refWebhookResponseHeaders(headerOperations);
	const warnings = [];
	const headers = new candidate.WebhookResponseHeaders({ warn: () => warnings.push('Dropping invalid webhook response header') });
	headers.addFromObject(headerOperations[0].value);
	headers.addFromNodeHeaders(headerOperations[1].value);
	headers.set(headerOperations[2].value.name, headerOperations[2].value.value);
	headers.set(headerOperations[3].value.name, headerOperations[3].value.value);

	compare('W06', 'WebhookResponseHeaders', 'headers', Object.fromEntries(referenceHeaders.headers), Object.fromEntries(headers.toMap()));
	compare('W06', 'WebhookResponseHeaders', 'protection / validation blocks', referenceHeaders.warnings.length, warnings.length);
	compare('W06', 'WebhookResponseHeaders', 'protected header dropped', true, !headers.toMap().has('content-security-policy'));

	const failed = differences.filter((diff) => diff.check === 'W06');
	if (failed.length) throw new Error(`${failed.length}/${comparisons.byCheck.W06} helper calls diverge; first: ${failed[0].scenario} ${failed[0].call}\n  reference: ${failed[0].reference}\n  candidate: ${failed[0].candidate}`);
	return `${comparisons.byCheck.W06} helper calls identical (sanitizer ${cases.length}, on-received ${responseCases.length}, not-found ${notFoundCases.length}, getNodeWebhooks ${webhookNodes.length}x2, response headers)`;
});

await gate('W07', 'Webhook LEGO unit suite PASS (packages/webhook-lego/test)', () => {
	const result = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], { cwd: WEBHOOK_PKG, encoding: 'utf8', timeout: 300_000 });
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	const pass = Number(/(?:^|\n)# pass (\d+)/.exec(output)?.[1] ?? 0);
	const fail = Number(/(^|\n)# fail (\d+)/.exec(output)?.[2] ?? 0);
	if (result.status !== 0 || fail !== 0 || pass === 0) throw new Error(`suite exited ${result.status} (${pass} pass / ${fail} fail)\n${output.slice(-700)}`);
	return `node --test test/*.test.mjs → ${pass}/${pass + fail} PASS`;
});

/* ---------------------------------------------------------------- */
/* evidence                                                          */
/* ---------------------------------------------------------------- */
const failedChecks = checks.filter((check) => check.status === 'FAIL');
const evidence = {
	generatedAt: new Date().toISOString(),
	phase: 'phase-5-webhook',
	lego: 'webhook',
	ports: ['P-WEBHOOK-REGISTRY', 'P-WEBHOOK-PATH', 'P-WEBHOOK-RESPONSE'],
	evidenceClasses: {
		executedOracle: {
			package: `${workflowPackage}`,
			version: reqWorkflow(join(workflowPackage, 'package.json')).version,
			checks: ['W02', 'W03', 'W04', 'W05 (header validation)', 'W01 (constants)'],
		},
		referenceTranscription: {
			source: 'reference/n8n/packages/cli/src/webhooks/webhook.service.ts + webhook-request-sanitizer.ts + webhook-on-received-response-extractor.ts + errors/response-errors/webhook-not-found.error.ts',
			reason: 'the CLI module needs DI/TypeORM/Redis and cannot be imported in the offline sandbox',
			checks: ['W05 (registry matching)', 'W06'],
		},
	},
	checks,
	comparisons,
	differences: differences.slice(0, 40),
	verdict: failedChecks.length === 0 ? 'PASS' : 'FAIL',
};
mkdirSync(join(REPO, 'docs/isolation/evidence'), { recursive: true });
writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
void assertSame;

if (!args.includes('--quiet')) {
	console.log(`\nwebhook lego: ${evidence.verdict} (${checks.length - failedChecks.length}/${checks.length} checks · ${comparisons.total} differential calls)`);
	if (differences.length) console.log(`first divergences: ${differences.slice(0, 3).map((diff) => `${diff.scenario} ${diff.call}`).join(' | ')}`);
	console.log('evidence: docs/isolation/evidence/webhook-lego-gate.json');
}
process.exit(failedChecks.length === 0 ? 0 : 1);
