// Webhook LEGO — model surface 1:1 dari n8n 2.9.4
// Owner: Agent 4 (spec) — implemented Phase 4-13, b104 track
// Provenance (read-only reference, DO NOT EDIT reference/):
//   R1 cli/src/webhooks/webhook-request-handler.ts:32-90  (method guard W1, CORS/OPTIONS W2)
//   R2 cli/src/webhooks/live-webhooks.ts:70-176            (lookup W3, sanitizer W9)
//   R3 cli/src/errors/response-errors/webhook-not-found.error.ts:29,31 (404s W4/W5)
//   R4 workflow/src/errors/webhook-taken.error.ts:6        (path-taken W6)
//   R5 cli/src/webhooks/webhook-on-received-response-extractor.ts:32 (default body W7)
//   R6 cli/src/webhooks/webhook-helpers.ts:412-925         (executeWebhook, invalid mode W8)
//   R7 cli/src/webhooks/test-webhooks.ts + waiting-*.ts    (test/waiting semantics W10)
//   R8 cli/src/webhooks/constants.ts                       (authAllowlistedNodes W9)
// Contract: contracts/webhook.contract.md §2-§11. Isolation: docs/isolation/webhook.md §2-§5.
// Zero Rust, pure TS, dependency-free.

/** R1 — method guard (W1). OPTIONS is preflight-only (W2). */
export const ALLOWED_METHODS = [
  'DELETE',
  'GET',
  'HEAD',
  'PATCH',
  'POST',
  'PUT',
  'OPTIONS',
] as const;
export type AllowedMethod = (typeof ALLOWED_METHODS)[number];

/** R1 webhook-request-handler.ts:44 — exact plain-Error message, rendered 500 (W1). */
export function buildMethodNotSupported(method: string): string {
  return `The method ${method} is not supported.`;
}

/** R1 — OPTIONS preflight: 204 empty, never executes (W2). */
export function isPreflight(method: string): boolean {
  return method === 'OPTIONS';
}

/** Isolation §3 — route table (express, registered before body-parser). */
export const WEBHOOK_ROUTES = [
  { route: 'ALL /webhook/*path', manager: 'LiveWebhooks' },
  { route: 'ALL /form/*path', manager: 'LiveWebhooks' },
  { route: 'ALL /mcp/*path', manager: 'LiveWebhooks' },
  { route: 'ALL /webhook-waiting/:path{/:suffix}', manager: 'WaitingWebhooks' },
  { route: 'ALL /form-waiting/:path{/:suffix}', manager: 'WaitingForms' },
  { route: 'ALL /webhook-test/*path', manager: 'TestWebhooks' },
  { route: 'ALL /form-test/*path', manager: 'TestWebhooks' },
  { route: 'ALL /mcp-test/*path', manager: 'TestWebhooks' },
] as const;

/** R3 webhook-not-found.error.ts:31 — unknown path 404 (W4). */
export function buildWebhookNotFound(webhookPath: string): string {
  return `The requested webhook "${webhookPath}" is not registered.`;
}

/** R3 — production hint shipped with the W4 404. */
export const WEBHOOK_NOT_FOUND_PRODUCTION_HINT =
  'The workflow must be active for a production URL to run successfully. ' +
  'Please activate your workflow.';

/** R3 webhook-not-found.error.ts:29 — known path, wrong method 404 (W5). */
export function buildWebhookWrongMethod(httpMethod: string, methods: string): string {
  return `This webhook is not registered for ${httpMethod} requests. Did you mean to make a ${methods} request?`;
}

/** R4 webhook-taken.error.ts:6 — exact WebhookPathTakenError message (W6). */
export function buildWebhookPathTaken(nodeName: string): string {
  return `The URL path that the "${nodeName}" node uses is already taken. Please change it to something else.`;
}
export const WEBHOOK_PATH_TAKEN_MESSAGE = buildWebhookPathTaken('<node>');

/** R5 — default onReceived body (W7). */
export const WORKFLOW_WAS_STARTED = { message: 'Workflow was started' } as const;

/** R6 — response modes (W7/W8). Default: onReceived. */
export const RESPONSE_MODES = [
  'onReceived',
  'lastNode',
  'responseNode',
  'streaming',
  'formPage',
  'hostedChat',
] as const;
export type WebhookResponseMode = (typeof RESPONSE_MODES)[number];

/** R6 — invalid responseMode error (W8). Throws-shaped: caller renders 500. */
export function resolveResponseMode(mode: string | undefined): WebhookResponseMode {
  if (mode === undefined || mode === 'onReceived') return 'onReceived';
  if ((RESPONSE_MODES as readonly string[]).includes(mode)) return mode as WebhookResponseMode;
  throw new Error(`The response mode '${mode}' is not valid!`);
}

export interface WebhookRow {
  webhookPath: string;
  method: string;
  webhookId?: string;
  pathLength?: number;
  staticSegments?: string[];
}

/**
 * R2 — findWebhook match order (W3): exact (method,path) first; else dynamic
 * candidates by webhookId, longest pathLength / most static matches wins.
 */
export function matchWebhook(
  rows: WebhookRow[],
  method: string,
  path: string,
): WebhookRow | null {
  const clean = path.replace(/\/+$/, '');
  const exact = rows.find((r) => r.method === method && r.webhookPath === clean);
  if (exact) return exact;
  const [head, ...rest] = clean.split('/');
  const candidates = rows.filter(
    (r) => r.method === method && r.webhookId !== undefined && r.webhookId === head,
  );
  let best: WebhookRow | null = null;
  let bestScore = -1;
  for (const row of candidates) {
    const statics = row.staticSegments ?? [];
    let score = 0;
    let ok = true;
    for (let i = 0; i < statics.length; i++) {
      if (rest[i] === statics[i]) score++;
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const total = score * 1000 + (row.pathLength ?? rest.length);
    if (total > bestScore) {
      bestScore = total;
      best = row;
    }
  }
  return best;
}

/** R2/R8 — strip n8n-auth cookies unless the node is allowlisted (W9). */
export function shouldSanitizeCookies(nodeType: string, allowlisted: readonly string[]): boolean {
  return !allowlisted.includes(nodeType);
}

/** R7 — test webhooks are single-shot with a 120s listener timeout (W10). */
export const TEST_WEBHOOK_TIMEOUT_MS = 120_000;

/** R7 — waiting-webhook terminal errors (W10). */
export function buildWaitingFinished(executionId: string): string {
  return `The execution "${executionId}" has finished already.`;
}
export function buildWaitingUnknown(executionId: string): string {
  return `The execution "${executionId}" does not exist.`;
}

export const WEBHOOK_PROVENANCE = {
  pinnedVersion: '2.9.4',
  pinnedCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  invariants: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10'],
} as const;
