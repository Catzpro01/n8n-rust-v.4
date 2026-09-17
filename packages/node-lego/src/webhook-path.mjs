/**
 * Webhook path/URL helpers of `node-helpers.ts`.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/node-helpers.ts
 *     - getNodeWebhookPath L1057-1084
 *     - getNodeWebhookUrl  L1087-1101
 *
 * Pinned behaviours (differentially verified, `N24`):
 *   - `restartWebhook === true` returns the incoming `path` unchanged
 *   - without a `webhookId` the path is `<workflowId>/<lower-cased, URI-encoded node name>/<path>`
 *   - with a `webhookId` and `isFullPath === true` the path is `path || node.webhookId`
 *   - `getNodeWebhookUrl` forces `isFullPath = false` for dynamic paths (`:id` or `/:`), strips a
 *     leading `/` and prefixes the base URL
 *
 * Boundaries: pure string helpers — no imports at all.
 */

/**
 * Returns the webhook path of a node.
 */
export function getNodeWebhookPath(workflowId, node, path, isFullPath, restartWebhook) {
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

/**
 * Returns the webhook URL
 */
export function getNodeWebhookUrl(baseUrl, workflowId, node, path, isFullPath) {
	if ((path.startsWith(':') || path.includes('/:')) && node.webhookId) {
		// setting this to false to prefix the webhookId
		isFullPath = false;
	}
	if (path.startsWith('/')) {
		path = path.slice(1);
	}
	return `${baseUrl}/${getNodeWebhookPath(workflowId, node, path, isFullPath)}`;
}
