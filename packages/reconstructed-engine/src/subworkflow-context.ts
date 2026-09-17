/**
 * Subworkflow Context & Parent-Child Data Propagation
 * Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/workflow/src/execution-context.ts
 *         reference/n8n/packages/workflow/src/node-helpers.ts:getSubworkflowId
 *         reference/n8n/packages/core/src/execution-engine/workflow-execute.ts (sub-workflow handling)
 *
 * Contract: contracts/subworkflow.contract.md
 */

export type WorkflowExecuteMode =
  | 'cli'
  | 'error'
  | 'integrated'
  | 'internal'
  | 'manual'
  | 'retry'
  | 'trigger'
  | 'webhook'
  | 'evaluation'
  | 'chat';

export interface ICredentialContextV1 {
  version: 1;
  identity: string;
  metadata?: Record<string, unknown>;
}

export type ICredentialContext = ICredentialContextV1;

export interface IExecutionContextV1 {
  version: 1;
  establishedAt: number;
  source: WorkflowExecuteMode;
  triggerNode?: { name: string; type: string };
  parentExecutionId?: string;
  credentials?: string; // encrypted when stored
}

export type IExecutionContext = IExecutionContextV1;

export type PlaintextExecutionContext = Omit<IExecutionContext, 'credentials'> & {
  credentials?: ICredentialContext;
};

export interface SubworkflowContextData {
  parentExecutionId: string;
  parentWorkflowId: string;
  callerNodeName: string;
}

export interface INodeParameterResourceLocator {
  __rl: true;
  mode: string;
  value: unknown;
  cachedResultName?: string;
  cachedResultUrl?: string;
  __regex?: string;
}

export interface INode {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
}

export function createSubworkflowContext(
  parentExecId: string,
  parentWfId: string,
  nodeName: string,
): SubworkflowContextData {
  return {
    parentExecutionId: parentExecId,
    parentWorkflowId: parentWfId,
    callerNodeName: nodeName,
  };
}

export function createExecutionContext(
  mode: WorkflowExecuteMode,
  parentExecutionId?: string,
  triggerNode?: { name: string; type: string },
): IExecutionContext {
  return {
    version: 1,
    establishedAt: Date.now(),
    source: mode,
    parentExecutionId,
    triggerNode,
  };
}

export function propagateToSubworkflow(
  parentContext: IExecutionContext,
  subworkflowId: string,
  callerNodeName: string,
): { context: IExecutionContext; subworkflowContext: SubworkflowContextData } {
  const childContext: IExecutionContext = {
    version: 1,
    establishedAt: Date.now(),
    source: parentContext.source,
    parentExecutionId: (parentContext as any).executionId || parentContext.parentExecutionId || 'unknown',
    triggerNode: parentContext.triggerNode,
  };

  const subworkflowContext: SubworkflowContextData = {
    parentExecutionId: childContext.parentExecutionId || 'unknown',
    parentWorkflowId: subworkflowId,
    callerNodeName,
  };

  return { context: childContext, subworkflowContext };
}

export function isResourceLocatorValue(value: unknown): value is INodeParameterResourceLocator {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rl' in (value as any) &&
    (value as any).__rl === true &&
    'mode' in (value as any) &&
    'value' in (value as any)
  );
}

export function getSubworkflowId(node: INode): string | undefined {
  if (
    node.parameters &&
    isResourceLocatorValue(node.parameters.workflowId)
  ) {
    return node.parameters.workflowId.value as string;
  }
  // Also support direct string workflowId for backward compatibility
  if (typeof node.parameters.workflowId === 'string') {
    return node.parameters.workflowId;
  }
  return undefined;
}

export function safeParse(value: string | object): unknown {
  try {
    if (typeof value === 'string') {
      return JSON.parse(value);
    }
    return value;
  } catch {
    return value;
  }
}

export function encryptCredentials(context?: ICredentialContext): string | undefined {
  if (!context) return undefined;
  // Stub: in real n8n this encrypts with AES, here we base64 encode for reconstruction
  return Buffer.from(JSON.stringify(context)).toString('base64');
}

export function decryptCredentials(encrypted?: string): ICredentialContext | undefined {
  if (!encrypted) return undefined;
  try {
    const decoded = Buffer.from(encrypted, 'base64').toString('utf-8');
    return JSON.parse(decoded) as ICredentialContext;
  } catch {
    return undefined;
  }
}

export function toPlaintextContext(context: IExecutionContext): PlaintextExecutionContext {
  const { credentials, ...rest } = context;
  return {
    ...rest,
    credentials: decryptCredentials(credentials),
  };
}

export function toStorableContext(context: PlaintextExecutionContext): IExecutionContext {
  const { credentials, ...rest } = context;
  return {
    ...rest,
    credentials: encryptCredentials(credentials),
  };
}
