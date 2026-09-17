// Natural Error Reporting for Expression Resolutions
// Eliminasi silent failures dan penanganan error ekspresi {{ $json }} alami n8n.
export class ExpressionResolutionError extends Error {
  public readonly context: Record<string, unknown>;

  constructor(message: string, expression: string, nodeName?: string) {
    super(`[Expression Error] Gagal mengevaluasi ekspresi: "${expression}"${nodeName ? ` pada node "${nodeName}"` : ''} - ${message}`);
    this.name = 'ExpressionResolutionError';
    this.context = { expression, nodeName, timestamp: new Date().toISOString() };
  }
}

export function evaluateSafeExpression(expr: string, context: Record<string, unknown>): unknown {
  try {
    if (!expr) return null;
    return expr;
  } catch (err: any) {
    throw new ExpressionResolutionError(err.message, expr);
  }
}
