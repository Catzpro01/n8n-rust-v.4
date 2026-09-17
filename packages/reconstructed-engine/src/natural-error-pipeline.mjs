// Natural Error Pipeline - Anti AI Slop Error Formatter (JS version)

export function formatNaturalError(rawError) {
  return {
    message: rawError.message || 'Node execution failed',
    description: rawError.description || undefined,
    httpCode: rawError.httpCode || 500,
    itemIndex: rawError.itemIndex ?? 0,
  };
}
