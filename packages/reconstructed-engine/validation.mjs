/**
 * EXECUTION ENGINE LEGO — workflow definition validation surface.
 *
 * Pure, side-effect free and non-mutating: the caller's definition is never
 * touched.  Errors are *pre-execution* failures (mapped by the HTTP runtime to
 * 400/422); warnings describe things that are legal but suspicious (unknown
 * node type, dangling connection, ...) and are reported back to the caller so
 * the runtime can apply its own policy (`passthrough` vs `error`).
 *
 * Contract: contracts/runtime-api.contract.md §5
 */

/** Thrown by `runWorkflowDefinition` when the definition cannot be executed. */
export class WorkflowRunError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'WorkflowRunError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** Failure codes this module can produce (contract §4 pre-execution subset). */
export const RUN_ERROR_CODES = Object.freeze(['VALIDATION_ERROR', 'EMPTY_WORKFLOW', 'INVALID_WORKFLOW']);

/** Warning codes this module can produce. */
export const VALIDATION_WARNING_CODES = Object.freeze([
  'UNKNOWN_NODE_TYPE',
  'UNKNOWN_CONNECTION_TARGET',
  'UNKNOWN_CONNECTION_SOURCE',
]);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function error(code, message, path) {
  return { code, message, path };
}

function warning(code, message, extra = {}) {
  return { code, message, ...extra };
}

/**
 * Validate a workflow definition.
 *
 * @param {unknown} definition
 * @param {{ registry?: { has(type: string): boolean } }} [opts]
 * @returns {{ ok: boolean, errors: Array<{code:string,message:string,path:string}>,
 *             warnings: Array<{code:string,message:string,node?:string,type?:string}>,
 *             normalized: object | null }}
 */
export function validateWorkflowDefinition(definition, opts = {}) {
  const errors = [];
  const warnings = [];
  const registry = opts.registry ?? null;

  if (!isPlainObject(definition)) {
    return {
      ok: false,
      errors: [error('VALIDATION_ERROR', 'workflow definition must be a JSON object', 'workflow')],
      warnings,
      normalized: null,
    };
  }

  if (!Array.isArray(definition.nodes)) {
    return {
      ok: false,
      errors: [error('VALIDATION_ERROR', 'workflow.nodes must be an array', 'workflow.nodes')],
      warnings,
      normalized: null,
    };
  }

  if (definition.nodes.length === 0) {
    return {
      ok: false,
      errors: [error('EMPTY_WORKFLOW', 'workflow contains no nodes', 'workflow.nodes')],
      warnings,
      normalized: null,
    };
  }

  const nodeNames = new Set();
  definition.nodes.forEach((node, index) => {
    const path = `workflow.nodes[${index}]`;
    if (!isPlainObject(node)) {
      errors.push(error('INVALID_WORKFLOW', `node at index ${index} must be an object`, path));
      return;
    }
    if (typeof node.name !== 'string' || node.name.trim() === '') {
      errors.push(error('INVALID_WORKFLOW', `node at index ${index} needs a non-empty string "name"`, `${path}.name`));
      return;
    }
    if (typeof node.type !== 'string' || node.type.trim() === '') {
      errors.push(error('INVALID_WORKFLOW', `node "${node.name}" needs a non-empty string "type"`, `${path}.type`));
      return;
    }
    if (nodeNames.has(node.name)) {
      errors.push(error('INVALID_WORKFLOW', `duplicate node name "${node.name}"`, `${path}.name`));
      return;
    }
    nodeNames.add(node.name);
    if (node.parameters !== undefined && !isPlainObject(node.parameters)) {
      errors.push(error('INVALID_WORKFLOW', `node "${node.name}" parameters must be an object`, `${path}.parameters`));
    }
    if (registry && typeof registry.has === 'function' && !registry.has(node.type)) {
      warnings.push(
        warning('UNKNOWN_NODE_TYPE', `node type "${node.type}" is not registered in this runtime`, {
          node: node.name,
          type: node.type,
        }),
      );
    }
  });

  const connections = definition.connections ?? {};
  if (!isPlainObject(connections)) {
    errors.push(error('INVALID_WORKFLOW', 'workflow.connections must be an object', 'workflow.connections'));
  } else {
    for (const [sourceName, source] of Object.entries(connections)) {
      if (!nodeNames.has(sourceName)) {
        warnings.push(
          warning('UNKNOWN_CONNECTION_SOURCE', `connection source "${sourceName}" is not a node in this workflow`, {
            node: sourceName,
          }),
        );
        continue;
      }
      if (!isPlainObject(source)) {
        errors.push(
          error('INVALID_WORKFLOW', `connections["${sourceName}"] must be an object`, `workflow.connections.${sourceName}`),
        );
        continue;
      }
      for (const [outputType, outputs] of Object.entries(source)) {
        if (!Array.isArray(outputs)) {
          errors.push(
            error(
              'INVALID_WORKFLOW',
              `connections["${sourceName}"].${outputType} must be an array of output branches`,
              `workflow.connections.${sourceName}.${outputType}`,
            ),
          );
          continue;
        }
        outputs.forEach((branch, branchIndex) => {
          if (!Array.isArray(branch)) {
            errors.push(
              error(
                'INVALID_WORKFLOW',
                `connections["${sourceName}"].${outputType}[${branchIndex}] must be an array of connections`,
                `workflow.connections.${sourceName}.${outputType}[${branchIndex}]`,
              ),
            );
            return;
          }
          for (const connection of branch) {
            if (!isPlainObject(connection) || typeof connection.node !== 'string') {
              errors.push(
                error(
                  'INVALID_WORKFLOW',
                  `connection entries need a string "node" target`,
                  `workflow.connections.${sourceName}.${outputType}[${branchIndex}]`,
                ),
              );
              continue;
            }
            if (!nodeNames.has(connection.node)) {
              warnings.push(
                warning('UNKNOWN_CONNECTION_TARGET', `connection target "${connection.node}" is not a node in this workflow`, {
                  node: connection.node,
                }),
              );
            }
          }
        });
      }
    }
  }

  const ok = errors.length === 0;
  return { ok, errors, warnings, normalized: ok ? normalize(definition) : null };
}

/**
 * Deep-copy a definition into the canonical shape the engine consumes.
 * Never mutates the input.
 */
export function normalize(definition) {
  return {
    ...definition,
    nodes: (definition.nodes ?? []).map((node) => ({
      ...node,
      parameters: isPlainObject(node.parameters) ? { ...node.parameters } : {},
    })),
    connections: isPlainObject(definition.connections) ? structuredClone(definition.connections) : {},
  };
}

/**
 * Validate and throw `WorkflowRunError` on the first pre-execution failure.
 * Returns `{ definition, warnings }`.
 */
export function assertRunnableDefinition(definition, opts = {}) {
  const result = validateWorkflowDefinition(definition, opts);
  if (!result.ok) {
    const first = result.errors[0];
    throw new WorkflowRunError(first.code, first.message, { errors: result.errors });
  }
  return { definition: result.normalized, warnings: result.warnings };
}
