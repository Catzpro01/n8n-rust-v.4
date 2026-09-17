/**
 * @lego/validation — Validation LEGO (Phase 2 structural isolation)
 *
 * OWNERSHIP:
 *   owns         : schemas.ts, type-validation.ts, type-guards.ts, workflow-validation.ts, node-validation.ts
 *   does NOT own : workflow.ts, interfaces.ts (shared kernel), execution, persistence
 *
 * This LEGO implements:
 * - Type coercion & validation of parameter values (validateFieldType, tryToParse*)
 * - Runtime ↔ static parity via zod schemas
 * - Type guards for composite parameter values
 * - Rule enforcement (NEW CAPABILITY): NodeUniqueness, DanglingConnections, CycleDetection
 *
 * Reference: n8n 2.9.4, n8n-workflow@2.9.1
 */

// Core validation exports (from reference)
export * from './type-validation';
export * from './type-guards';
export * from './schemas';
export { validateWorkflow, validateWorkflowHasTriggerLikeNode } from './workflow-validation';
export { validateNodeCredentials, isNodeConnected, isTriggerLikeNode } from './node-validation';

// New capability: workflow structural validation (additive, opt-in)
export interface ValidationError {
  code: 'DUPLICATE_NODE_NAME' | 'DANGLING_CONNECTION' | 'INVALID_CONNECTION_TYPE' | 'CYCLE_DETECTED' | 'INVALID_INPUT';
  message: string;
  node?: string;
  path?: string[];
}

export interface WorkflowContract {
  id?: string;
  name?: string;
  nodes: Array<{ name: string; type: string; [k: string]: any }>;
  connections: Record<string, Record<string, Array<Array<{ node: string; type: string; index: number } | null>>>>;
  settings?: Record<string, any>;
}

export function checkNodeUniqueness(workflow: WorkflowContract): ValidationError[] {
  const seen = new Set<string>();
  const errors: ValidationError[] = [];
  for (const node of workflow.nodes || []) {
    if (seen.has(node.name)) {
      errors.push({
        code: 'DUPLICATE_NODE_NAME',
        message: `Duplicate node name: ${node.name}`,
        node: node.name,
      });
    }
    seen.add(node.name);
  }
  return errors;
}

export function checkDanglingConnections(workflow: WorkflowContract): ValidationError[] {
  const nodeNames = new Set((workflow.nodes || []).map((n) => n.name));
  const errors: ValidationError[] = [];
  for (const [source, byType] of Object.entries(workflow.connections || {})) {
    if (!nodeNames.has(source)) {
      errors.push({
        code: 'DANGLING_CONNECTION',
        message: `Source node does not exist: ${source}`,
        node: source,
      });
    }
    for (const [type, outputs] of Object.entries(byType)) {
      for (const output of outputs) {
        if (!output) continue;
        for (const conn of output) {
          if (!conn) continue;
          if (!nodeNames.has(conn.node)) {
            errors.push({
              code: 'DANGLING_CONNECTION',
              message: `Destination node does not exist: ${conn.node} (from ${source})`,
              node: conn.node,
              path: [source, type],
            });
          }
        }
      }
    }
  }
  return errors;
}

export function detectCycles(workflow: WorkflowContract): ValidationError[] {
  const graph = new Map<string, string[]>();
  for (const node of workflow.nodes || []) {
    graph.set(node.name, []);
  }
  for (const [source, byType] of Object.entries(workflow.connections || {})) {
    const main = byType.main;
    if (!main) continue;
    for (const output of main) {
      if (!output) continue;
      for (const conn of output) {
        if (!conn) continue;
        if (conn.type !== 'main') continue;
        if (!graph.has(source)) graph.set(source, []);
        graph.get(source)!.push(conn.node);
      }
    }
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];
  const errors: ValidationError[] = [];

  function dfs(node: string): boolean {
    if (recStack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cyclePath = [...path.slice(cycleStart), node];
      errors.push({
        code: 'CYCLE_DETECTED',
        message: `Cycle detected: ${cyclePath.join(' -> ')}`,
        path: cyclePath,
      });
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
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return errors;
}

export function validateWorkflow(
  workflow: WorkflowContract,
  options: { allowCycles?: boolean } = {}
): { valid: boolean; errors: ValidationError[] } {
  if (!workflow || typeof workflow !== 'object' || !Array.isArray((workflow as any).nodes)) {
    return {
      valid: false,
      errors: [{ code: 'INVALID_INPUT', message: 'Invalid workflow input: nodes must be an array' }],
    };
  }

  const errors: ValidationError[] = [
    ...checkNodeUniqueness(workflow),
    ...checkDanglingConnections(workflow),
  ];

  if (options.allowCycles === false) {
    errors.push(...detectCycles(workflow));
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export const LEGO_PROVENANCE = {
  lego: 'validation',
  phase: 'phase-2-isolation',
  referenceVersion: '2.9.4',
  referenceCommit: 'b6dc2787c45677a29a9612cd27eb911302961a83',
  behaviorChange: 'new-capability-additive',
  rustImplementation: 'not-started',
} as const;
