import { WebhookError } from './errors.mjs';

export const FORM_NODE_TYPE = 'n8n-nodes-base.form';
export const WAIT_NODE_TYPE = 'n8n-nodes-base.wait';
export const WAITING_FORMS_EXECUTION_STATUS = 'n8n-execution-status';
export const WEBHOOK_SANDBOX_CSP = 'sandbox allow-downloads allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-popups allow-presentation allow-scripts allow-top-navigation allow-top-navigation-by-user-activation allow-top-navigation-to-custom-protocols';

const notFound = (message) => new WebhookError(message, { code: 404, statusCode: 404 });
const conflict = (message) => new WebhookError(message, { code: 409, statusCode: 409 });
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function sanitizeWaitingFormRequest(request) {
  const blocked = new Set(['n8n-auth', 'n8n-browserId']);
  const cookie = request.headers?.cookie;
  if (typeof cookie === 'string') {
    request.headers.cookie = cookie.split(';').map((item) => item.trim()).filter((item) => !blocked.has(item.split('=')[0])).join('; ');
  }
  if (request.cookies && typeof request.cookies === 'object') {
    for (const name of blocked) delete request.cookies[name];
  }
  return request;
}

/** Locate the nearest already-executed, enabled Form completion node. */
export function findCompletionPage(workflow, runData, lastNodeExecuted) {
  const lastNode = workflow.nodes[lastNodeExecuted];
  const isCompletion = (node) => !node?.disabled && node.type === FORM_NODE_TYPE && node.parameters?.operation === 'completion';
  if (isCompletion(lastNode)) return lastNodeExecuted;
  return [...workflow.getParentNodes(lastNodeExecuted)].reverse().find((nodeName) => isCompletion(workflow.nodes[nodeName]) && runData[nodeName]);
}

/** Framework-independent fallback matching form-trigger-completion's default state. */
export function renderDefaultFormCompletion({ title = 'Form Submitted', message = 'Your response has been recorded', formTitle = 'Form Submitted' } = {}) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(formTitle)}</title>
<style>body{font-family:Open Sans,sans-serif;background:#fbfcfe;margin:0}.container{margin:24px auto;width:min(448px,calc(100% - 32px));text-align:center}.card{padding:24px;background:#fff;border:1px solid #dbdfe7;border-radius:8px;box-shadow:0 4px 16px #634dff0f}h1{color:#525356;font-size:20px;font-weight:400;margin:0 0 8px}p{color:#7e8186;font-size:14px;white-space:pre-line;margin:0}</style></head>
<body><div class="container"><section><div class="card"><div class="header"><h1>${escapeHtml(title)}</h1><p>${message}</p></div></div></section></div></body></html>`;
}

/** Persistence- and execution-port based reconstruction of WaitingForms. */
export class WaitingFormManager {
  constructor({ executionRepository, getParentNodes, executeFormWebhook, logger = { debug() {} } }) {
    if (!executionRepository || !getParentNodes || !executeFormWebhook) throw new Error('WaitingFormManager requires executionRepository, getParentNodes, and executeFormWebhook');
    this.executionRepository = executionRepository;
    this.getParentNodes = getParentNodes;
    this.executeFormWebhook = executeFormWebhook;
    this.logger = logger;
  }

  getWebhookMethods() { return []; }
  findAccessControlOptions() { return { allowedOrigins: '*' }; }

  async executeWebhook(request) {
    const [executionId, ...suffixParts] = String(request.path ?? '').replace(/^\/+|\/+$/g, '').split('/');
    const suffix = suffixParts.join('/') || undefined;
    this.logger.debug(`Received waiting-form "${request.method}" for execution "${executionId}"`);
    sanitizeWaitingFormRequest(request);
    request.params = {};
    const execution = await this.executionRepository.findSingleExecution(executionId, { includeData: true, unflattenData: true });

    if (suffix === WAITING_FORMS_EXECUTION_STATUS) {
      let status = execution?.status ?? 'null';
      const node = execution?.data?.executionData?.nodeExecutionStack?.[0]?.node;
      if (node && status === 'waiting' && (node.type === FORM_NODE_TYPE || (node.type === WAIT_NODE_TYPE && node.parameters?.resume === 'form'))) status = 'form-waiting';
      return { noWebhookResponse: true, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' }, body: status };
    }
    if (!execution) throw notFound(`The execution "${executionId}" does not exist.`);
    if (execution.data?.resultData?.error) throw conflict(`The execution "${executionId}" has finished with error.`);
    if (execution.status === 'running') return { noWebhookResponse: true, body: undefined };

    let lastNodeExecuted = execution.data?.resultData?.lastNodeExecuted;
    if (execution.finished) {
      const nodes = Object.fromEntries((execution.workflowData?.nodes ?? []).map((node) => [node.name, node]));
      const workflow = { nodes, getParentNodes: (nodeName) => this.getParentNodes(execution.workflowData, nodeName) };
      const completionPage = findCompletionPage(workflow, execution.data?.resultData?.runData ?? {}, lastNodeExecuted);
      if (!completionPage) {
        return {
          noWebhookResponse: true,
          headers: { 'content-security-policy': WEBHOOK_SANDBOX_CSP, 'content-type': 'text/html; charset=utf-8' },
          body: renderDefaultFormCompletion(),
        };
      }
      lastNodeExecuted = completionPage;
    }

    if (String(request.method).toUpperCase() === 'POST') {
      const stackNode = execution.data?.executionData?.nodeExecutionStack?.[0]?.node;
      if (stackNode) stackNode.disabled = true;
    }
    const response = await this.executeFormWebhook({ execution, request, executionId, suffix, lastNodeExecuted });
    return { ...response, headers: { 'access-control-allow-origin': '*', ...(response?.headers ?? {}) } };
  }
}
