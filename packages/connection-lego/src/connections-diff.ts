import type { IConnection, IConnections } from './interfaces';

/**
 * 1:1 reconstruction of `reference/n8n/packages/workflow/src/connections-diff.ts`
 * (n8n 2.9.4, commit `b6dc2787c45677a29a9612cd27eb911302961a83`).
 *
 * Frozen surface symbol #15 of the Workflow contract (`contracts/workflow.contract.md` §6),
 * owned by the Connection LEGO (`contracts/connection.contract.md` §7).
 *
 * Acceptance: the 6 `compareConnections` cases in `tests/reference/workflow-rust/fixtures.json`
 * and `tests/reference/connection/05-connections-diff`.
 *
 * Semantics that are part of the contract, not incidental:
 *
 * - **identity is `JSON.stringify(connection)`**, so key order inside an `IConnection` decides
 *   equality. Two connections that differ only in key order count as *different*;
 * - comparison is **per slot (source index)** but **set-based within a slot**: reordering the
 *   connections inside one slot is *not* a change (`slot-shifted` → `{added:{},removed:{}}`),
 *   while moving a connection between slots *is* reported as a removal plus an addition
 *   (`second-output-added` → removal at `sourceIndex: 1`);
 * - three distinct indexes are reported and must not be conflated (`empty-to-one`):
 *   `sourceIndex` = the slot, `value.index` = the position inside the slot,
 *   `value.connection.index` = the destination input index;
 * - node names and input names are visited as the union of both sides, so nodes present on only
 *   one side are fully reported (`empty-to-one`), and a changed input/type name shows up as an
 *   add under the new key and a removal under the old one (`connection-type-changed`);
 * - the emitted object only gains a key when there is something to report: no empty `{}` leaves.
 */

type ConnectionEntry = {
	sourceIndex: number;
	value: { index: number; connection: IConnection } | null;
};

export type INodeConnectionsDiff = Record<string, ConnectionEntry[]>;

export type ConnectionsDiff = {
	added: Record<string, INodeConnectionsDiff>;
	removed: Record<string, INodeConnectionsDiff>;
};

export function compareConnections(prev: IConnections, next: IConnections): ConnectionsDiff {
	const added: Record<string, INodeConnectionsDiff> = {};
	const removed: Record<string, INodeConnectionsDiff> = {};

	// Get all unique node names from both connection objects
	const allNodeNames = new Set([...Object.keys(prev), ...Object.keys(next)]);

	for (const nodeName of allNodeNames) {
		const prevNodeConnections = prev[nodeName] ?? {};
		const nextNodeConnections = next[nodeName] ?? {};

		// Get all unique input names for this node
		const allInputNames = new Set([
			...Object.keys(prevNodeConnections),
			...Object.keys(nextNodeConnections),
		]);

		for (const inputName of allInputNames) {
			const prevInputConnections = prevNodeConnections[inputName] ?? [];
			const nextInputConnections = nextNodeConnections[inputName] ?? [];

			// Compare each source index
			const maxLength = Math.max(prevInputConnections.length, nextInputConnections.length);

			for (let sourceIndex = 0; sourceIndex < maxLength; sourceIndex++) {
				const prevConnections = prevInputConnections[sourceIndex] ?? [];
				const nextConnections = nextInputConnections[sourceIndex] ?? [];

				// Build maps for easier comparison
				const prevMap = new Map(
					prevConnections.map((conn, idx) => [
						JSON.stringify(conn),
						{ index: idx, connection: conn },
					]),
				);
				const nextMap = new Map(
					nextConnections.map((conn, idx) => [
						JSON.stringify(conn),
						{ index: idx, connection: conn },
					]),
				);

				// Find added connections
				for (const [key, value] of nextMap) {
					if (!prevMap.has(key)) {
						if (!added[nodeName]) added[nodeName] = {};
						if (!added[nodeName][inputName]) added[nodeName][inputName] = [];

						added[nodeName][inputName].push({
							sourceIndex,
							value,
						});
					}
				}

				// Find removed connections
				for (const [key, value] of prevMap) {
					if (!nextMap.has(key)) {
						if (!removed[nodeName]) removed[nodeName] = {};
						if (!removed[nodeName][inputName]) removed[nodeName][inputName] = [];

						removed[nodeName][inputName].push({
							sourceIndex,
							value,
						});
					}
				}
			}
		}
	}

	return { added, removed };
}
