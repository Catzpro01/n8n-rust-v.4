
export class Expression {
  [key: string]: any;
  constructor(...args: any[]) {}
  getParameterValue(...args: any[]): any { return {}; }
}
export function isExpression(value: any): boolean { return typeof value === 'string' && value.includes('{{'); }
