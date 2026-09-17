// Subworkflow Context & Parent-Child Data Propagation
export interface SubworkflowContextData {
  parentExecutionId: string;
  parentWorkflowId: string;
  callerNodeName: string;
}

export function createSubworkflowContext(parentExecId: string, parentWfId: string, nodeName: string): SubworkflowContextData {
  return {
    parentExecutionId: parentExecId,
    parentWorkflowId: parentWfId,
    callerNodeName: nodeName
  };
}
