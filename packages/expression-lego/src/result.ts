
export function createResultOk<T>(value: T): any { return { ok: true, result: value }; }
export function createResultError(error: any): any { return { ok: false, error }; }
