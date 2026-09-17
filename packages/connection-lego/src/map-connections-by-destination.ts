import type { IConnection, IConnections, NodeConnectionType } from './interfaces';

/**
 * Inverts the source-keyed connection map into a destination-keyed one, so that
 * `getParentNodes` can run the same traversal in the other direction.
 *
 * 1:1 reconstruction of
 * `reference/n8n/packages/workflow/src/common/map-connections-by-destination.ts`
 * (n8n 2.9.4, commit `b6dc2787c45677a29a9612cd27eb911302961a83`).
 *
 * Invariants pinned by `tests/reference/connection/01-linear` … `04-cycle` and by the
 * `toJSON.*.connectionsByDestinationNode` fixtures:
 *
 * - the emitted connection records the **source** node, the **source-side** type, and the
 *   **source-side** output index (`parseInt(inputIndex, 10)`) — not the destination index;
 * - sparse destination slots are preserved: the `for (let j = maxIndex; j < connectionInfo.index; j++)`
 *   loop pads with empty arrays so index N always lands at position N;
 * - the push is guarded by `?.`, exactly as in the reference. It is defensive: the padding loop
 *   above has already ensured the slot exists, so the guard is not reachable in practice. It is
 *   reproduced verbatim rather than "cleaned up";
 * - iteration order follows `for…in` over the source map plus `Object.keys` over the types,
 *   so the key order of the result is deterministic for a given input.
 */
export function mapConnectionsByDestination(connections: IConnections): IConnections {
	const returnConnection: IConnections = {};

	let connectionInfo: IConnection;
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
					if (!returnConnection.hasOwnProperty(connectionInfo.node)) {
						returnConnection[connectionInfo.node] = {};
					}
					if (!returnConnection[connectionInfo.node].hasOwnProperty(connectionInfo.type)) {
						returnConnection[connectionInfo.node][connectionInfo.type] = [];
					}

					maxIndex = returnConnection[connectionInfo.node][connectionInfo.type].length - 1;
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
