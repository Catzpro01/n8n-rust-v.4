
export function validateFieldType(...args: any[]): any { return { valid: true }; }
export function tryToParseNumber(value: any): number { return Number(value); }
export function tryToParseString(value: any): string { return String(value); }
export function tryToParseBoolean(value: any): boolean { return Boolean(value); }
export function tryToParseDateTime(value: any): any { return value; }
