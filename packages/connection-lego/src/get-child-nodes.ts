import { getConnectedNodes } from './get-connected-nodes';
import { NodeConnectionTypes } from './interfaces';
import type { IConnections, NodeConnectionType } from './interfaces';

/**
 * 1:1 reconstruction of `reference/n8n/packages/workflow/src/common/get-child-nodes.ts`
 * (n8n 2.9.4). Children are the same traversal as `getConnectedNodes` over the
 * **source-keyed** map.
 */
export function getChildNodes(
	connectionsBySourceNode: IConnections,
	nodeName: string,
	type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = NodeConnectionTypes.Main,
	depth = -1,
): string[] {
	return getConnectedNodes(connectionsBySourceNode, nodeName, type, depth);
}
