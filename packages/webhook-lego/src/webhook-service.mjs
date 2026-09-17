function normalizePath(path) { return String(path).replace(/^\/+|\/+$/g, ''); }

export class WebhookEntity {
  constructor(data = {}) { Object.assign(this, data); }
  get isDynamic() { return this.webhookPath.split('/').some((segment) => segment.startsWith(':')); }
  get staticSegments() { return this.webhookPath.split('/').filter((segment) => segment && !segment.startsWith(':')); }
  get uniquePath() { return [this.webhookId, this.webhookPath].filter(Boolean).join('/'); }
  get cacheKey() { return `webhook:${this.method}-${this.uniquePath}`; }
  display() { return `${this.method} ${this.uniquePath}`; }
}

export class InMemoryWebhookRepository {
  constructor() { this.rows = []; }
  create(data) { return new WebhookEntity(data); }
  async find() { return [...this.rows]; }
  async findOne(method, path) { return this.rows.find((row) => row.method === method && row.webhookPath === path) ?? null; }
  async upsert(entity) {
    const index = this.rows.findIndex((row) => row.method === entity.method && row.webhookPath === entity.webhookPath);
    if (index < 0) this.rows.push(this.create(entity)); else this.rows[index] = this.create(entity);
  }
  async byWorkflow(workflowId) { return this.rows.filter((row) => row.workflowId === workflowId); }
  async remove(entities) {
    const remove = new Set(entities);
    this.rows = this.rows.filter((row) => !remove.has(row));
  }
}

export class WebhookService {
  constructor({ repository = new InMemoryWebhookRepository(), cache = new Map() } = {}) {
    this.repository = repository;
    this.cache = cache;
  }

  createWebhook(data) {
    const webhookPath = normalizePath(data.webhookPath ?? data.path);
    const dynamic = this.isDynamicPath(webhookPath);
    return this.repository.create({
      ...data,
      method: String(data.method ?? data.httpMethod).toUpperCase(),
      webhookPath,
      ...(dynamic && data.webhookId ? { webhookId: data.webhookId, pathLength: webhookPath.split('/').length } : {}),
    });
  }

  isDynamicPath(rawPath) {
    const firstSlash = rawPath.indexOf('/');
    const path = firstSlash === -1 ? rawPath : rawPath.slice(firstSlash + 1);
    return path !== '' && path !== ':' && path !== '/:' && (path.startsWith(':') || path.includes('/:'));
  }

  getWebhookPath(webhook) {
    return [String(webhook.path).includes(':') ? webhook.webhookId : undefined, normalizePath(webhook.path)].filter(Boolean).join('/');
  }

  async storeWebhook(webhook) {
    const entity = webhook instanceof WebhookEntity ? webhook : this.createWebhook(webhook);
    this.cache.set(entity.cacheKey, entity);
    await this.repository.upsert(entity);
    return entity;
  }

  async findWebhook(method, rawPath) {
    const upper = method.toUpperCase();
    const path = normalizePath(rawPath);
    const cached = this.cache.get(`webhook:${upper}-${path}`);
    if (cached) return cached;
    const exact = await this.repository.findOne(upper, path);
    if (exact) { this.cache.set(exact.cacheKey, exact); return exact; }
    return this.findDynamicWebhook(path, upper);
  }

  async findDynamicWebhook(path, method) {
    const [webhookId, ...segments] = path.split('/');
    const rows = (await this.repository.find()).filter((row) =>
      row.webhookId === webhookId && (!method || row.method === method) && row.pathLength === segments.length,
    );
    const requestSegments = new Set(segments);
    return rows.reduce((best, row) => {
      const matches = row.staticSegments.every((segment) => requestSegments.has(segment));
      if (matches && (!best || row.staticSegments.length > best.staticSegments.length)) return row;
      return best;
    }, null);
  }

  async getWebhookMethods(path) {
    const normalized = normalizePath(path);
    const rows = (await this.repository.find()).filter((row) => row.webhookPath === normalized);
    if (rows.length) return rows.map((row) => row.method);
    const dynamic = await this.findDynamicWebhook(normalized);
    return dynamic ? [dynamic.method] : [];
  }

  async deleteWorkflowWebhooks(workflowId) {
    const rows = await this.repository.byWorkflow(workflowId);
    for (const row of rows) this.cache.delete(row.cacheKey);
    await this.repository.remove(rows);
    return rows;
  }

  extractPathParameters(webhook, requestPath) {
    const pattern = webhook.webhookPath.split('/');
    const path = normalizePath(requestPath).split('/').slice(webhook.webhookId ? 1 : 0);
    return Object.fromEntries(pattern.flatMap((segment, index) => segment.startsWith(':') ? [[segment.slice(1), path[index]]] : []));
  }

  async findConflicts(webhooks, workflowId) {
    const conflicts = [];
    const seen = new Map();
    for (const webhook of webhooks) {
      const path = this.getWebhookPath(webhook);
      const key = `${webhook.httpMethod} ${path}`;
      const existing = seen.get(key) ?? await this.findWebhook(webhook.httpMethod, path);
      if (existing && existing.workflowId !== workflowId) conflicts.push({ webhook, conflict: existing });
      else if (seen.has(key)) conflicts.push({ webhook, conflict: seen.get(key) });
      else seen.set(key, webhook);
    }
    return conflicts;
  }
}
