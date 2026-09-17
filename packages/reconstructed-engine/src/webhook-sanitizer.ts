// Webhook Stream Sanitizer & Standard Error Payload
export interface WebhookStandardResponse {
  statusCode: number;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function createWebhookError(statusCode: number, code: string, message: string): WebhookStandardResponse {
  return {
    statusCode,
    error: {
      code,
      message,
      details: { timestamp: new Date().toISOString() }
    }
  };
}
