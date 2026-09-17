export const WebhookResponseTag = Symbol('WebhookResponse');

export const createNoResponse = () => ({ [WebhookResponseTag]: 'noResponse' });
export const createStaticResponse = (body, code, headers) => ({ [WebhookResponseTag]: 'static', body, code, headers });
export const createStreamResponse = (stream, code, headers) => ({ [WebhookResponseTag]: 'stream', stream, code, headers });

export const isWebhookResponse = (response) => typeof response === 'object' && response !== null && WebhookResponseTag in response;
export const isWebhookNoResponse = (response) => isWebhookResponse(response) && response[WebhookResponseTag] === 'noResponse';
export const isWebhookStaticResponse = (response) => isWebhookResponse(response) && response[WebhookResponseTag] === 'static';
export const isWebhookStreamResponse = (response) => isWebhookResponse(response) && response[WebhookResponseTag] === 'stream';

/** Convert the Respond-to-Webhook result into the explicit response algebra. */
export async function extractResponseNodeResult(response, { getBinaryStream } = {}) {
  const binaryData = response?.body?.binaryData;
  if (binaryData?.id) {
    if (!getBinaryStream) throw new Error('A binary stream port is required for persisted webhook response data');
    return createStreamResponse(await getBinaryStream(binaryData.id), response.statusCode, response.headers);
  }
  return createStaticResponse(response?.body, response?.statusCode, response?.headers);
}
