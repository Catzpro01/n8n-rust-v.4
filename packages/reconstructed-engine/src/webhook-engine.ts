// Webhook Engine — 1:1 dari n8n 2.9.4 webhooks/* + webhook-not-found.error.ts
// Owner: Agent 4 (spec) — webhook LEGO, Phase 4-13
// Zero Rust, pure JS/TS. Method guard, route match, response-mode.

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
