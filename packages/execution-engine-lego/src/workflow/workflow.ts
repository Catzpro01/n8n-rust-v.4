
export class Workflow {
  [key: string]: any;
  constructor(...args: any[]) {}
  getNode(...args: any[]): any { return {}; }
  getStartNode(...args: any[]): any { return {}; }
  getPinDataOfNode(...args: any[]): any { return {}; }
  connectionsBySourceNode: any = {};
}
export type WorkflowParameters = any;
