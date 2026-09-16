# TASK RESULT: TASK-301-workflow-isolation

- **STATUS**: `SUCCESS`
- **AGENT**: `agent-1`
- **LEGO COMPONENT**: `workflow`
- **EXIT CODE**: `0`
- **TIMESTAMP**: `2026-09-16 22:11:38 UTC`

---

### Pipeline Operations Summary

| Operation | Status | Exit Code |
| :--- | :--- | :--- |
| `read_file` | ✓ SUCCESS | `0` |
| `write_file` | ✓ SUCCESS | `0` |
| `send_message` | ✓ SUCCESS | `0` |
| `send_message` | ✓ SUCCESS | `0` |
| `git_commit` | ✓ SUCCESS | `0` |
| `git_push` | ✓ SUCCESS | `0` |

### Detailed Logs

#### Operation: `read_file`

```text
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-for-in-array */
import {
	getConnectedNodes,
	getChildNodes,
	getParentNodes,
	mapConnectionsByDestination,
} from './common';

import {
	MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE,
	NODES_WITH_RENAMABLE_CONTENT,
	NODES_WITH_RENAMABLE_FORM_HTML_CONTENT,
	NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT,
	STARTING_NODE_TYPES,
} from './constants';
import { UserError } from './errors';
import { ApplicationError } from '@n8n/errors';
import { Expression } from './expression';
import { getGlobalState } from './global-state';
import type {
	IConnections,
	INode,
	INodeExecutionData,
	INodeParameters,
	INodes,
	INodeType,
	INodeTypes,
	IPinData,
	IWorkflowSettings,
	IConnection,
	IConnectedNode,
	IDataObject,
	INodeConnection,
	IObservableObject,
	NodeParameterValueType,
	NodeConnectionType,
} from './interfaces';
import { NodeConnectionTypes } from './interfaces';
import * as NodeHelpers from './node-helpers';
import { renameFormFields } from './node-parameters/rename-node-utils';
import { applyAccessPatterns } from './node-reference-parser-utils';
import * as ObservableObject from './observable-object';
import { dedupe } from './utils';

export interface WorkflowParameters {
	id?: string;
	name?: string;
	nodes: INode[];
	connections: IConnections;
	active: boolean;
	nodeTypes: INodeTypes;
	staticData?: IDataObject;
	settings?: IWorkflowSettings;
	pinData?: IPinData;
}

export class Workflow {
	id: string;

	name: string | undefined;

	nodes: INodes = {};

	connectionsBySourceNode: IConnections = {};

	connectionsByDestinationNode: IConnections = {};

	nodeTypes: INodeTypes;

	expression: Expression;

	active: boolean;

	settings: IWorkflowSettings = {};

	readonly timezone: string;

	// To save workflow specific static data like for example
	// ids of registered webhooks of nodes
	staticData: IDataObject;

	testStaticData: IDataObject | undefined;

	pinData?: IPinData;

	constructor(parameters: WorkflowParameters) {
		this.id = parameters.id as string; // @tech_debt Ensure this is not optional
		this.name = parameters.name;
		this.nodeTypes = parameters.nodeTypes;

		let nodeType: INodeType | undefined;
		for (const node of parameters.nodes) {
			nodeType = this.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);

			if (nodeType === undefined) {
				// Go on to next node when its type is not known.
				// For now do not error because that causes problems with
				// expression resolution also then when the unknown node
				// does not get used.
				continue;
				// throw new ApplicationError(`Node with unknown node type`, {
				// 	tags: { nodeType: node.type },
				// 	extra: { node },
				// });
			}

			// Add default values
			const nodeParameters = NodeHelpers.getNodeParameters(
				nodeType.description.properties,
				node.parameters,
				true,
				false,
				node,
				nodeType.description,
			);
			node.parameters = nodeParameters !== null ? nodeParameters : {};
		}

		this.setNodes(parameters.nodes);
		this.setConnections(parameters.connections);
		this.setPinData(parameters.pinData);
		this.setSettings(parameters.settings ?? {});

		this.active = parameters.active || false;

		this.staticData = ObservableObject.create(parameters.staticData || {}, undefined, {
			ignoreEmptyOnFirstChild: true,
		});

		this.timezone = this.settings.timezone ?? getGlobalState().defaultTimezone;

		this.expression = new Expression(this);
	}

	// Save nodes in workflow as object to be able to get the nodes easily by their name.
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

	setPinData(pinData: IPinData | undefined) {
		this.pinData = pinData;
	}

	setSettings(settings: IWorkflowSettings) {
		this.settings = settings;
	}

	overrideStaticData(staticData?: IDataObject) {
		this.staticData = ObservableObject.create(staticData || {}, undefined, {
			ignoreEmptyOnFirstChild: true,
		});
		this.staticData.__dataChanged = true;
	}

	static getConnectionsByDestination(connections: IConnections): IConnections {
		const returnConnection: IConnections = {};

		let connectionInfo;
		let maxIndex: number;
		for (const sourceNode in connections) {
			if (!connections.hasOwnProperty(sourceNode)) {
				continue;
			}

			for (const type of Object.keys(connections[sourceNode]) as NodeConnectionType[]) {
				if (!connections[sourceNode].hasOwnProperty(type)) {
					continue;
				}
				for (const inputIndex in connections[sourceNode][type]) {
					if (!connections[sourceNode][type].hasOwnProperty(inputIndex)) {
						continue;
					}

					for (connectionInfo of connections[sourceNode][type][inputIndex] ?? []) {
						if (!
```

#### Operation: `write_file`

```text
Successfully wrote 1721 bytes to docs/isolation/workflow_spec.md
```

#### Operation: `send_message`

```text
Message 3 sent to agent-2 [CONTRACT_INTERFACE_PROPOSAL]
```

#### Operation: `send_message`

```text
Message 4 sent to agent-5 [SPECIFICATION_READY]
```

#### Operation: `git_commit`

```text
[agent-1 ad7a690e] feat(agent-1): complete pure workflow domain model isolation spec
 1 file changed, 33 insertions(+)
 create mode 100644 docs/isolation/workflow_spec.md
```

#### Operation: `git_push`

```text
To https://github.com/Catzpro01/n8n-rust-v.4.git
   e65a2f38..ad7a690e  agent-1 -> agent-1
```
