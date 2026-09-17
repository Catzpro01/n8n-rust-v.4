import { getConnectedNodes } from './get-connected-nodes';
import { NodeConnectionTypes } from './interfaces';
import type { IConnections, NodeConnectionType } from './interfaces';

/**
 * Returns all the nodes before the given one.
 *
 * 1:1 reconstruction of `reference/n8n/packages/workflow/src/common/get-parent-nodes.ts`
 * (n8n 2.9.4). Note the first parameter is the **destination-keyed** map — i.e. what
 * `mapConnectionsByDestination` produced — which is exactly why defect **D-08** is
 * observable: `Workflow.renameNode` rewrites the source map but never rebuilds the
 * destination map, so parent queries keep answering under the old name.
 * See `contracts/workflow.contract.md` §7 (`D-08`) and the
 * `rename/d-08-stale-destination-index` fixture.
 */
export function getParentNodes(
	connectionsByDestinationNode: IConnections,
	nodeName: string,
	type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = NodeConnectionTypes.Main,
	depth = -1,
): string[] {
	return getConnectedNodes(connectionsByDestinationNode, nodeName, type, depth);
}
