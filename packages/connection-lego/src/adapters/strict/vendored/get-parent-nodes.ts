import { getConnectedNodes } from './get-connected-nodes.ts';
import { NodeConnectionTypes } from '../../../kernel/vocabulary.ts';
import type { IConnections, NodeConnectionType } from '../../../kernel/vocabulary.ts';

/**
 * Returns all the nodes before the given one
 *
 * @param {NodeConnectionType} [type='main']
 * @param {*} [depth=-1]
 */
export function getParentNodes(
	connectionsByDestinationNode: IConnections,
	nodeName: string,
	type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = NodeConnectionTypes.Main,
	depth = -1,
): string[] {
	return getConnectedNodes(connectionsByDestinationNode, nodeName, type, depth);
}
