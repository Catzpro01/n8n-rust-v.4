
export function isExpression(value: any): boolean { return typeof value === 'string' && value.includes('{{'); }
