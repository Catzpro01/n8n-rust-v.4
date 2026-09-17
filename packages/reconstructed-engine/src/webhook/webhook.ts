/**
 * Webhook LEGO — Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/cli/src/webhooks/
 */

export interface IWebhookData {
  workflowId: string;
  workflowName?: string;
  nodeName: string;
  webhookId: string;
  method: string;
  path: string;
  isFullPath?: boolean;
}

export interface IWebhookResponse {
  status: number;
  headers?: Record<string, string>;
  body?: any;
}

export class WebhookManager {
  private webhooks: Map<string, IWebhookData> = new Map();
  private handlers: Map<string, Function> = new Map();

  registerWebhook(data: IWebhookData, handler: Function): void {
    const key = `${data.method}:${data.path}`;
    this.webhooks.set(key, data);
    this.handlers.set(key, handler);
  }

  unregisterWebhook(method: string, path: string): void {
    const key = `${method}:${path}`;
    this.webhooks.delete(key);
    this.handlers.delete(key);
  }

  async handleRequest(method: string, path: string, req: any, res: any): Promise<IWebhookResponse> {
    const key = `${method}:${path}`;
    const handler = this.handlers.get(key);
    if (!handler) {
      return { status: 404, body: { message: 'Webhook not found' } };
    }

    try {
      const result = await handler(req);
      return { status: 200, body: result };
    } catch (error: any) {
      return { status: 500, body: { message: error.message } };
    }
  }

  getWebhookMethods(): string[] {
    return [...this.webhooks.values()].map((w) => w.method);
  }

  sanitizeWebhookPath(path: string): string {
    return path.replace(/[^a-zA-Z0-9-_\/]/g, '').replace(/\/+/g, '/');
  }
}

export function isWebhookNode(nodeType: string): boolean {
  return nodeType.toLowerCase().includes('webhook');
}
