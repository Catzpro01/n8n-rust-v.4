import { getConnectedNodes } from './get-connected-nodes.ts';
import { NodeConnectionTypes } from '../../../kernel/vocabulary.ts';
import type { IConnections, NodeConnectionType } from '../../../kernel/vocabulary.ts';

export function getChildNodes(
	connectionsBySourceNode: IConnections,
	nodeName: string,
	type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = NodeConnectionTypes.Main,
	depth = -1,
): string[] {
	return getConnectedNodes(connectionsBySourceNode, nodeName, type, depth);
}
