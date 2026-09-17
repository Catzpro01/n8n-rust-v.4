import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookError } from './errors.mjs';

export function generateWaitingWebhookSignature(url, secret) {
  return createHmac('sha256', secret).update(`${url.host}${url.pathname}${url.search}`).digest('hex');
}

export function validateWaitingWebhookSignature(request, secret) {
  try {
    const query = request.query ?? {};
    const headers = request.headers ?? {};
    const token = query.signature;
    if (typeof token !== 'string') return false;
    const url = request.url ?? request.request?.url;
    const host = request.host ?? request.request?.headers?.host ?? headers.host;
    const parsed = new URL(url, `http://${host}`);
    parsed.searchParams.delete('signature');
    const expected = generateWaitingWebhookSignature(parsed, secret);
    const actualBuffer = Buffer.from(token);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  } catch { return false; }
}

const notFound = (message) => new WebhookError(message, { code: 404, statusCode: 404 });
const conflict = (message) => new WebhookError(message, { code: 409, statusCode: 409 });

/** Persistence- and execution-port based reconstruction of WaitingWebhooks. */
export class WaitingWebhookManager {
  constructor({ executionRepository, resolveWebhook, resumeExecution, signingSecret = '', logger = { debug() {} } }) {
    if (!executionRepository || !resolveWebhook || !resumeExecution) throw new Error('WaitingWebhookManager requires executionRepository, resolveWebhook, and resumeExecution');
    this.executionRepository = executionRepository;
    this.resolveWebhook = resolveWebhook;
    this.resumeExecution = resumeExecution;
    this.signingSecret = signingSecret;
    this.logger = logger;
    this.inFlight = new Set();
  }

  getWebhookMethods() { return []; }

  findAccessControlOptions() { return { allowedOrigins: '*' }; }

  async executeWebhook(request) {
    const [executionId, ...suffixParts] = String(request.path ?? '').replace(/^\/+|\/+$/g, '').split('/');
    const suffix = suffixParts.join('/') || undefined;
    this.logger.debug(`Received waiting-webhook "${request.method}" for execution "${executionId}"`);
    const execution = await this.executionRepository.findSingleExecution(executionId, { includeData: true, unflattenData: true });
    if (!execution) throw notFound(`The execution "${executionId}" does not exist.`);

    if (execution.data?.validateSignature) {
      const nodeName = execution.data.resultData?.lastNodeExecuted;
      const node = execution.workflowData?.nodes?.find((candidate) => candidate.name === nodeName);
      if (node?.parameters?.operation === 'sendAndWait' && !validateWaitingWebhookSignature(request, this.signingSecret)) {
        return { statusCode: 401, body: { error: 'Invalid token' } };
      }
    }

    if (execution.status === 'running' || this.inFlight.has(executionId)) throw conflict(`The execution "${executionId}" is running already.`);
    if (execution.data?.resultData?.error) throw conflict(`The execution "${executionId}" has finished with error.`);
    if (execution.finished) {
      const sendAndWait = suffix && execution.workflowData?.nodes?.some(
        (node) => node.id === suffix && node.parameters?.operation === 'sendAndWait',
      );
      if (sendAndWait) return { body: { message: 'No action is required.' } };
      throw conflict(`The execution "${executionId} has finished already.`);
    }

    const lastNodeExecuted = execution.data?.resultData?.lastNodeExecuted;
    const stackEntry = execution.data?.executionData?.nodeExecutionStack?.[0];
    if (!lastNodeExecuted || !stackEntry) throw notFound('Could not find node to process webhook.');
    const webhook = await this.resolveWebhook({ execution, method: request.method, suffix, finished: false });
    if (!webhook?.restartWebhook) {
      throw notFound(`The workflow for execution "${executionId}" does not contain a waiting webhook with a matching path/method.`);
    }

    stackEntry.node.disabled = true;
    if (stackEntry.node.type?.endsWith('HitlTool')) stackEntry.node.rewireOutputLogTo = 'ai_tool';
    execution.data.waitTill = undefined;
    const runData = execution.data.resultData.runData?.[lastNodeExecuted];
    if (Array.isArray(runData) && runData.length) {
      const removed = runData.pop();
      if (removed?.inputOverride) runData.push({ startTime: 0, executionTime: 0, executionIndex: 0, source: removed.source ?? [], inputOverride: removed.inputOverride });
    }

    this.inFlight.add(executionId);
    try {
      return await this.resumeExecution({ execution, executionId, webhook, request: { ...request, params: {} }, suffix });
    } finally {
      this.inFlight.delete(executionId);
    }
  }
}
