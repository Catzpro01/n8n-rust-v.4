/**
 * Validation LEGO — Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/workflow/src/type-validation.ts, schemas.ts, type-guards.ts
 */

export type FieldType =
  | 'string'
  | 'string-alphanumeric'
  | 'number'
  | 'boolean'
  | 'dateTime'
  | 'time'
  | 'array'
  | 'object'
  | 'options'
  | 'url'
  | 'jwt'
  | 'binary'
  | 'json'
  | 'form-fields';

export interface ValidationResult {
  valid: boolean;
  newValue?: any;
  errorMessage?: string;
}

export function getValueDescription(value: any): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'object') return 'object';
  return `'${String(value)}'`;
}

export function tryToParseNumber(value: unknown): number {
  const num = Number(value);
  if (isNaN(num)) throw new Error('Failed to parse value to number');
  return num;
}

export function tryToParseString(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

export function tryToParseAlphanumericString(value: unknown): string {
  const str = String(value);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(str)) {
    throw new Error('Value is not a valid alphanumeric string, only letters, numbers and underscore allowed');
  }
  return str;
}

export function tryToParseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  throw new Error('Failed to parse value as boolean');
}

export function tryToParseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  throw new Error('Value is not a valid array');
}

export function tryToParseObject(value: unknown): object {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as object;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  throw new Error('Value is not a valid object');
}

export function tryToParseUrl(value: unknown): string {
  let str = String(value);
  if (!str.includes('://')) {
    str = `https://${str}`;
  }
  try {
    const url = new URL(str);
    const allowed = ['http:', 'https:', 'ftp:', 'ftps:', 'ws:', 'wss:'];
    if (!allowed.includes(url.protocol)) {
      throw new Error();
    }
    return str;
  } catch {
    throw new Error(`The value "${str}" is not a valid url.`);
  }
}

export function tryToParseJwt(value: unknown): string {
  const str = String(value);
  if (!/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/.test(str)) {
    throw new Error(`The value "${str}" is not a valid JWT token.`);
  }
  return str;
}

export function validateFieldType(
  fieldName: string,
  value: unknown,
  type: FieldType,
  options: { strict?: boolean; valueOptions?: Array<{ value: any }>; parseStrings?: boolean } = {}
): ValidationResult {
  if (value === null || value === undefined) {
    return { valid: true };
  }

  const lowerType = type.toLowerCase() as FieldType;

  switch (lowerType) {
    case 'string': {
      if (typeof value === 'string') return { valid: true, newValue: value };
      if (options.strict) {
        return { valid: false, errorMessage: `'${fieldName}' expects a string but we got ${getValueDescription(value)}` };
      }
      return { valid: true, newValue: String(value) };
    }
    case 'string-alphanumeric': {
      try {
        const parsed = tryToParseAlphanumericString(value);
        return { valid: true, newValue: parsed };
      } catch {
        return { valid: false, errorMessage: 'Value is not a valid alphanumeric string, only letters, numbers and underscore allowed' };
      }
    }
    case 'number': {
      if (typeof value === 'number') return { valid: true, newValue: value };
      if (options.strict) {
        return { valid: false, errorMessage: `'${fieldName}' expects a number but we got ${getValueDescription(value)}` };
      }
      try {
        return { valid: true, newValue: tryToParseNumber(value) };
      } catch {
        return { valid: false, errorMessage: `'${fieldName}' expects a number but we got ${getValueDescription(value)}` };
      }
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { valid: true, newValue: value };
      if (options.strict) {
        return { valid: false, errorMessage: `'${fieldName}' expects a boolean but we got ${getValueDescription(value)}` };
      }
      try {
        return { valid: true, newValue: tryToParseBoolean(value) };
      } catch {
        return { valid: false, errorMessage: `'${fieldName}' expects a boolean but we got ${getValueDescription(value)}` };
      }
    }
    case 'array': {
      if (Array.isArray(value)) return { valid: true, newValue: value };
      if (options.strict) {
        return { valid: false, errorMessage: `'${fieldName}' expects an array but we got ${getValueDescription(value)}` };
      }
      try {
        return { valid: true, newValue: tryToParseArray(value) };
      } catch {
        return { valid: false, errorMessage: `'${fieldName}' expects an array but we got ${getValueDescription(value)}` };
      }
    }
    case 'object': {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) return { valid: true, newValue: value };
      if (options.strict) {
        return { valid: false, errorMessage: `'${fieldName}' expects an object but we got ${getValueDescription(value)}` };
      }
      try {
        return { valid: true, newValue: tryToParseObject(value) };
      } catch {
        return { valid: false, errorMessage: `'${fieldName}' expects an object but we got ${getValueDescription(value)}` };
      }
    }
    case 'options': {
      const validValues = options.valueOptions?.map((o) => o.value) || [];
      if (validValues.includes(value)) {
        return { valid: true, newValue: value };
      }
      return {
        valid: false,
        errorMessage: `'${fieldName}' expects one of the following values: [${validValues.join(', ')}] but we got ${getValueDescription(value)}`,
      };
    }
    case 'url': {
      try {
        return { valid: true, newValue: tryToParseUrl(value) };
      } catch (e: any) {
        return { valid: false, errorMessage: e.message };
      }
    }
    case 'jwt': {
      try {
        return { valid: true, newValue: tryToParseJwt(value) };
      } catch (e: any) {
        return { valid: false, errorMessage: e.message };
      }
    }
    default:
      return { valid: true, newValue: value };
  }
}

export interface WorkflowValidationError {
  code: 'DUPLICATE_NODE_NAME' | 'DANGLING_CONNECTION' | 'INVALID_CONNECTION_TYPE' | 'CYCLE_DETECTED' | 'INVALID_INPUT';
  message: string;
  node?: string;
  path?: string[];
}

export function validateWorkflowStructure(workflow: any, options: { allowCycles?: boolean } = {}): { valid: boolean; errors: WorkflowValidationError[] } {
  const errors: WorkflowValidationError[] = [];

  if (!workflow || typeof workflow !== 'object' || !Array.isArray(workflow.nodes)) {
    return { valid: false, errors: [{ code: 'INVALID_INPUT', message: 'Invalid workflow: nodes must be array' }] };
  }

  const seen = new Set<string>();
  for (const node of workflow.nodes) {
    if (seen.has(node.name)) {
      errors.push({ code: 'DUPLICATE_NODE_NAME', message: `Duplicate node name: ${node.name}`, node: node.name });
    }
    seen.add(node.name);
  }

  const nodeNames = new Set(workflow.nodes.map((n: any) => n.name));
  for (const [source, byType] of Object.entries(workflow.connections || {})) {
    if (!nodeNames.has(source)) {
      errors.push({ code: 'DANGLING_CONNECTION', message: `Source node does not exist: ${source}`, node: source });
    }
    for (const [, outputs] of Object.entries(byType as any)) {
      for (const output of outputs as any[]) {
        if (!output) continue;
        for (const conn of output) {
          if (!conn) continue;
          if (!nodeNames.has(conn.node)) {
            errors.push({ code: 'DANGLING_CONNECTION', message: `Destination node does not exist: ${conn.node}`, node: conn.node });
          }
        }
      }
    }
  }

  if (options.allowCycles === false) {
    const graph = new Map<string, string[]>();
    for (const node of workflow.nodes) graph.set(node.name, []);
    for (const [source, byType] of Object.entries(workflow.connections || {})) {
      const main = (byType as any).main;
      if (!main) continue;
      for (const output of main) {
        if (!output) continue;
        for (const conn of output) {
          if (!conn) continue;
          if (conn.type !== 'main') continue;
          graph.get(source)?.push(conn.node);
        }
      }
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    function dfs(node: string): boolean {
      if (recStack.has(node)) {
        const cycleStart = path.indexOf(node);
        const cyclePath = [...path.slice(cycleStart), node];
        errors.push({ code: 'CYCLE_DETECTED', message: `Cycle detected: ${cyclePath.join(' -> ')}`, path: cyclePath });
        return true;
      }
      if (visited.has(node)) return false;
      visited.add(node);
      recStack.add(node);
      path.push(node);
      for (const neighbor of graph.get(node) || []) {
        if (dfs(neighbor)) return true;
      }
      path.pop();
      recStack.delete(node);
      return false;
    }

    for (const node of graph.keys()) {
      if (!visited.has(node)) dfs(node);
    }
  }

  return { valid: errors.length === 0, errors };
}
