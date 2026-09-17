/**
 * Node Model — Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/workflow/src/node-helpers.ts, interfaces.ts
 */

export interface INodeTypeDescription {
  displayName: string;
  name: string;
  group: string[];
  version: number | number[];
  description: string;
  defaults: { name: string; color?: string };
  inputs: Array<string | { type: string; displayName?: string }>;
  outputs: Array<string | { type: string; displayName?: string }>;
  properties: any[];
  credentials?: any[];
  webhooks?: any[];
}

export interface INodeType {
  description: INodeTypeDescription;
  execute?(this: any): Promise<any>;
  poll?(this: any): Promise<any>;
  trigger?(this: any): Promise<any>;
  webhook?(this: any): Promise<any>;
}

export class NodeHelpers {
  static getNodeParameters(
    properties: any[],
    nodeValues: Record<string, any>,
    returnDefaults: boolean,
    returnNoneDisplayed: boolean,
    node: any,
    nodeTypeDescription?: any
  ): Record<string, any> | null {
    const result: Record<string, any> = {};
    for (const prop of properties || []) {
      const value = nodeValues[prop.name];
      if (value !== undefined) {
        result[prop.name] = value;
      } else if (returnDefaults && prop.default !== undefined) {
        result[prop.name] = prop.default;
      }
    }
    return result;
  }

  static getNodeInputs(workflow: any, node: any, nodeTypeData: any): any[] {
    const description = nodeTypeData?.description;
    if (!description) return [{ type: 'main' }];
    if (Array.isArray(description.inputs)) {
      return description.inputs.map((input: any) => {
        if (typeof input === 'string') return { type: input };
        return input;
      });
    }
    return [{ type: 'main' }];
  }

  static getNodeOutputs(workflow: any, node: any, nodeTypeData: any): any[] {
    const description = nodeTypeData?.description;
    if (!description) return [{ type: 'main' }];
    if (Array.isArray(description.outputs)) {
      return description.outputs.map((output: any) => {
        if (typeof output === 'string') return { type: output };
        return output;
      });
    }
    return [{ type: 'main' }];
  }

  static getConnectionTypes(inputs: any[]): string[] {
    return inputs.map((input: any) => (typeof input === 'string' ? input : input.type));
  }

  static isTriggerNode(nodeType: any): boolean {
    return nodeType?.group?.includes('trigger') || nodeType?.description?.group?.includes('trigger');
  }

  static displayParameter(nodeValues: any, parameter: any, node: any): boolean {
    if (!parameter.displayOptions) return true;
    const show = parameter.displayOptions.show;
    if (!show) return true;
    for (const [key, values] of Object.entries(show)) {
      const nodeValue = nodeValues[key];
      if (!Array.isArray(values)) continue;
      if (!values.includes(nodeValue)) return false;
    }
    return true;
  }
}

export class VersionedNodeType {
  private nodeVersions: Record<string, INodeType>;
  private description: any;
  private currentVersion: number;

  constructor(nodeVersions: Record<string, INodeType>, description: any) {
    this.nodeVersions = nodeVersions;
    this.description = description;
    const versions = Object.keys(nodeVersions).map(Number);
    this.currentVersion = description.defaultVersion ?? Math.max(...versions);
  }

  getNodeType(version?: number): INodeType | undefined {
    const v = version ?? this.currentVersion;
    return this.nodeVersions[v.toString()];
  }
}

export function validateNodeCredentials(node: any, credentials: any): boolean {
  return true;
}

export function isNodeConnected(nodeName: string, connections: any): boolean {
  return !!connections[nodeName];
}

export function isTriggerLikeNode(node: any): boolean {
  return node.type.includes('trigger') || node.type.includes('Trigger');
}
