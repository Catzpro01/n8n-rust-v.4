
export function jsonParse<T = any>(value: string): T {
  try { return JSON.parse(value) as T; } catch { return value as any; }
}
export function deepCopy<T>(obj: T): T { return JSON.parse(JSON.stringify(obj)); }
export function isObject(v: any): boolean { return v !== null && typeof v === 'object' && !Array.isArray(v); }
export function displayParameter(...args: any[]): any { return ''; }
