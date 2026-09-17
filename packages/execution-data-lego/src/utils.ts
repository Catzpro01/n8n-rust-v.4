
export function jsonParse<T = any>(value: string, options: any = {}): T {
  try {
    return JSON.parse(value) as T;
  } catch (e) {
    return value as any;
  }
}
export function deepCopy<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
export function isObject(value: any): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
