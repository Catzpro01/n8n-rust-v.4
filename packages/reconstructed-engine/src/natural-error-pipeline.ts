// Natural Error Pipeline - Anti AI Slop Error Formatter
export interface NaturalErrorDetails {
  message: string;
  description?: string;
  httpCode?: number;
  itemIndex?: number;
}

export function formatNaturalError(rawError: any): NaturalErrorDetails {
  return {
    message: rawError.message || 'Node execution failed',
    description: rawError.description || undefined,
    httpCode: rawError.httpCode || 500,
    itemIndex: rawError.itemIndex ?? 0
  };
}
