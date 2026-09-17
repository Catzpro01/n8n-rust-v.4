// Webhook Engine — 1:1 dari WebhookService + TestWebhooks (n8n 2.9.4)
// Owner: Agent 4 + Agent 3 support

export interface WebhookData {
  webhookPath: string;
  method: string;
  node: string;
  workflowId: string;
  webhookId?: string;
}

export class WebhookEngine {
  private webhooks = new Map(); // key: `${method}:${path}`

  storeWebhook(data: any) {
    const key = `${data.method}:${data.webhookPath}`;
    if (this.webhooks.has(key)) {
      throw new Error('There is a conflict with one of the webhooks.');
    }
    this.webhooks.set(key, data);
    return data;
  }

  findWebhook(method: any, path: any) {
    const exact = this.webhooks.get(`${method}:${path}`);
    if (exact) return exact;
    // Dynamic matching by webhookId + pathLength longest first
    const candidates = [...this.webhooks.values()]
      .filter(w => w.method === method && path.includes(w.webhookId || ''))
      .sort((a,b) => (b.pathLength||0) - (a.pathLength||0));
    return candidates[0] || null;
  }

  deleteWebhooksByWorkflow(workflowId: any) {
    for (const [key, wh] of this.webhooks.entries()) {
      if (wh.workflowId === workflowId) this.webhooks.delete(key);
    }
  }

  buildWebhookPayload(request: any) {
    return {
      headers: request.headers,
      params: request.params,
      query: request.query,
      body: request.body,
      webhookUrl: request.url,
      executionMode: 'production',
    };
  }
}
