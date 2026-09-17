
export function deepCopy<T>(obj: T): T { return JSON.parse(JSON.stringify(obj)); }
export function jsonParse<T>(v: string): T { try { return JSON.parse(v) as T; } catch { return v as any; } }
export function isSafeObjectProperty(key: string): boolean { return true; }
export function randomInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
export function checkIfValueDefinedOrThrow(...args: any[]): any {}
export function convertToDateTime(...args: any[]): any { return {}; }
