/**
 * Workflow Model — Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/workflow/src/workflow.ts
 *
 * This is a pure TypeScript reconstruction with clear boundary.
 * Owns: node collection, connections, adjacency indexes, graph traversal, renaming, checksum, diffing
 * Does NOT own: execution, expression runtime, persistence, webhook runtime, scheduler
 */

export interface INode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, any>;
  credentials?: Record<string, { id: string; name: string }>;
  disabled?: boolean;
  notes?: string;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  alwaysOutputData?: boolean;
  executeOnce?: boolean;
  onError?: 'continueErrorOutput' | 'continueRegularOutput' | 'stopWorkflow';
  continueOnFail?: boolean;
  webhookId?: string;
}

export interface IConnection {
  node: string;
  type: string;
  index: number;
}

export type NodeConnectionType =
  | 'main'
  | 'ai_agent'
  | 'ai_chain'
  | 'ai_document'
  | 'ai_embedding'
  | 'ai_languageModel'
  | 'ai_memory'
  | 'ai_outputParser'
  | 'ai_retriever'
  | 'ai_reranker'
  | 'ai_textSplitter'
  | 'ai_tool'
  | 'ai_vectorStore';

export interface IConnections {
  [sourceNodeName: string]: {
    [type: string]: Array<Array<IConnection | null>>;
  };
}

export interface INodes {
  [name: string]: INode;
}

export interface IWorkflowSettings {
  timezone?: string;
  saveExecutionProgress?: boolean;
  saveManualExecutions?: boolean;
  saveDataErrorExecution?: string;
  saveDataSuccessExecution?: string;
  executionTimeout?: number;
  timezone2?: string;
  callerPolicy?: string;
  executionOrder?: 'v0' | 'v1';
  binaryMode?: 'default' | 'filesystem' | 'filesystem-v2';
}

export interface WorkflowParameters {
  id?: string;
  name?: string;
  nodes: INode[];
  connections: IConnections;
  active: boolean;
  settings?: IWorkflowSettings;
  staticData?: Record<string, any>;
  pinData?: Record<string, any[]>;
}

function mapConnectionsByDestination(connections: IConnections): IConnections {
  const returnConnection: IConnections = {};
  for (const sourceNode in connections) {
    if (!connections.hasOwnProperty(sourceNode)) continue;
    for (const type of Object.keys(connections[sourceNode])) {
      if (!connections[sourceNode].hasOwnProperty(type)) continue;
      for (const inputIndex in connections[sourceNode][type]) {
        if (!connections[sourceNode][type].hasOwnProperty(inputIndex)) continue;
        for (const connectionInfo of connections[sourceNode][type][inputIndex] ?? []) {
          if (!returnConnection.hasOwnProperty(connectionInfo.node)) {
            returnConnection[connectionInfo.node] = {};
          }
          if (!returnConnection[connectionInfo.node].hasOwnProperty(connectionInfo.type)) {
            returnConnection[connectionInfo.node][connectionInfo.type] = [];
          }
          const maxIndex = returnConnection[connectionInfo.node][connectionInfo.type].length - 1;
          for (let j = maxIndex; j < connectionInfo.index; j++) {
            returnConnection[connectionInfo.node][connectionInfo.type].push([]);
          }
          returnConnection[connectionInfo.node][connectionInfo.type][connectionInfo.index]?.push({
            node: sourceNode,
            type,
            index: parseInt(inputIndex, 10),
          });
        }
      }
    }
  }
  return returnConnection;
}

function getConnectedNodes(
  connections: IConnections,
  nodeName: string,
  connectionType: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = 'main',
  depth = -1,
  checkedNodesIncoming?: string[]
): string[] {
  const newDepth = depth === -1 ? depth : depth - 1;
  if (depth === 0) return [];
  if (!connections.hasOwnProperty(nodeName)) return [];

  let types: string[];
  if (connectionType === 'ALL') {
    types = Object.keys(connections[nodeName]);
  } else if (connectionType === 'ALL_NON_MAIN') {
    types = Object.keys(connections[nodeName]).filter((type) => type !== 'main');
  } else {
    types = [connectionType];
  }

  const returnNodes: string[] = [];
  types.forEach((type) => {
    if (!connections[nodeName].hasOwnProperty(type)) return;
    const checkedNodes = checkedNodesIncoming ? [...checkedNodesIncoming] : [];
    if (checkedNodes.includes(nodeName)) return;
    checkedNodes.push(nodeName);

    connections[nodeName][type].forEach((connectionsByIndex) => {
      connectionsByIndex?.forEach((connection) => {
        if (checkedNodes.includes(connection.node)) return;
        returnNodes.unshift(connection.node);
        const addNodes = getConnectedNodes(connections, connection.node, connectionType, newDepth, checkedNodes);
        for (let i = addNodes.length; i--; i > 0) {
          const parentNodeName = addNodes[i];
          const nodeIndex = returnNodes.indexOf(parentNodeName);
          if (nodeIndex !== -1) {
            returnNodes.splice(nodeIndex, 1);
          }
          returnNodes.unshift(parentNodeName);
        }
      });
    });
  });

  return returnNodes;
}

export class Workflow {
  id: string;
  name: string | undefined;
  nodes: INodes = {};
  connectionsBySourceNode: IConnections = {};
  connectionsByDestinationNode: IConnections = {};
  active: boolean;
  settings: IWorkflowSettings = {};
  readonly timezone: string;
  staticData: Record<string, any>;
  pinData?: Record<string, any[]>;

  constructor(parameters: WorkflowParameters) {
    this.id = parameters.id as string;
    this.name = parameters.name;
    this.setNodes(parameters.nodes);
    this.setConnections(parameters.connections);
    this.setPinData(parameters.pinData);
    this.setSettings(parameters.settings ?? {});
    this.active = parameters.active || false;
    this.staticData = parameters.staticData || {};
    this.timezone = this.settings.timezone ?? 'UTC';
  }

  setNodes(nodes: INode[]) {
    this.nodes = {};
    for (const node of nodes) {
      this.nodes[node.name] = node;
    }
  }

  setConnections(connections: IConnections) {
    this.connectionsBySourceNode = connections;
    this.connectionsByDestinationNode = mapConnectionsByDestination(this.connectionsBySourceNode);
  }

  setPinData(pinData: Record<string, any[]> | undefined) {
    this.pinData = pinData;
  }

  setSettings(settings: IWorkflowSettings) {
    this.settings = settings;
  }

  getNode(name: string): INode | null {
    return this.nodes[name] ?? null;
  }

  getNodes(): INode[] {
    return Object.values(this.nodes);
  }

  getChildNodes(nodeName: string, type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = 'main', depth = -1): string[] {
    return getConnectedNodes(this.connectionsBySourceNode, nodeName, type, depth);
  }

  getParentNodes(nodeName: string, type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = 'main', depth = -1): string[] {
    return getConnectedNodes(this.connectionsByDestinationNode, nodeName, type, depth);
  }

  getConnectedNodes(nodeName: string, type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = 'main', depth = -1): string[] {
    const childNodes = this.getChildNodes(nodeName, type, depth);
    const parentNodes = this.getParentNodes(nodeName, type, depth);
    const connectedNodes = [...new Set([...childNodes, ...parentNodes])];
    return connectedNodes;
  }

  getStartNode(destinationNode?: string): INode | undefined {
    if (destinationNode) {
      const parentNodes = this.getParentNodes(destinationNode, 'main', -1);
      if (parentNodes.length === 0) {
        return this.getNode(destinationNode) ?? undefined;
      }
    }

    for (const node of Object.values(this.nodes)) {
      if (node.disabled) continue;
      if (node.type.includes('trigger') || node.type.includes('Trigger') || node.type.includes('Manual') || node.type.includes('Start')) {
        return node;
      }
    }

    const firstNode = Object.values(this.nodes)[0];
    return firstNode;
  }

  checkIfNodeExists(nodeName: string): boolean {
    return this.nodes.hasOwnProperty(nodeName);
  }

  getParentMainInputNode(nodeName: string): INode | undefined {
    const parentNodes = this.getParentNodes(nodeName, 'main', 1);
    if (parentNodes.length === 0) return undefined;
    return this.getNode(parentNodes[0]) ?? undefined;
  }

  getNodeConnectionIndexes(nodeName: string, parentNodeName: string): { sourceIndex: number; destinationIndex: number } | undefined {
    const connections = this.connectionsBySourceNode[parentNodeName];
    if (!connections || !connections.main) return undefined;

    for (let sourceIndex = 0; sourceIndex < connections.main.length; sourceIndex++) {
      const connectionsByIndex = connections.main[sourceIndex];
      if (!connectionsByIndex) continue;
      for (const connection of connectionsByIndex) {
        if (connection && connection.node === nodeName) {
          return {
            sourceIndex,
            destinationIndex: connection.index,
          };
        }
      }
    }
    return undefined;
  }

  renameNode(currentName: string, newName: string): void {
    if (!this.nodes[currentName]) return;
    if (this.nodes[newName]) return;

    this.nodes[newName] = { ...this.nodes[currentName], name: newName };
    delete this.nodes[currentName];

    if (this.connectionsBySourceNode[currentName]) {
      this.connectionsBySourceNode[newName] = this.connectionsBySourceNode[currentName];
      delete this.connectionsBySourceNode[currentName];
    }

    for (const sourceNode of Object.keys(this.connectionsBySourceNode)) {
      for (const type of Object.keys(this.connectionsBySourceNode[sourceNode])) {
        for (let i = 0; i < this.connectionsBySourceNode[sourceNode][type].length; i++) {
          const connections = this.connectionsBySourceNode[sourceNode][type][i];
          if (!connections) continue;
          for (const connection of connections) {
            if (connection && connection.node === currentName) {
              connection.node = newName;
            }
          }
        }
      }
    }

    this.connectionsByDestinationNode = mapConnectionsByDestination(this.connectionsBySourceNode);
  }

  getPinDataOfNode(nodeName: string): any[] | undefined {
    return this.pinData?.[nodeName];
  }

  getStaticData(type: string, nodeName?: string): Record<string, any> {
    if (nodeName) {
      if (!this.staticData[nodeName]) {
        this.staticData[nodeName] = {};
      }
      if (!this.staticData[nodeName][type]) {
        this.staticData[nodeName][type] = {};
      }
      return this.staticData[nodeName][type];
    }
    return this.staticData;
  }

  calculateWorkflowChecksum(): string {
    const nodes = Object.values(this.nodes)
      .map((n) => ({ name: n.name, type: n.type, typeVersion: n.typeVersion, parameters: n.parameters }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const connections = this.connectionsBySourceNode;
    const data = JSON.stringify({ nodes, connections });
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}
