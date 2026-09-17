// Webhook Stream Sanitizer & Standard Error Payload (JS version)

export function createWebhookError(statusCode, code, message) {
  return {
    statusCode,
    error: {
      code,
      message,
      details: { timestamp: new Date().toISOString() },
    },
  };
}
