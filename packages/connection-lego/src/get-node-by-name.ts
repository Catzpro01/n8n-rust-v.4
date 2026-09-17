import type { INode, INodes } from './interfaces';

/**
 * Returns the node with the given name if it exists else null.
 *
 * 1:1 reconstruction of `reference/n8n/packages/workflow/src/common/get-node-by-name.ts`
 * (n8n 2.9.4, commit `b6dc2787c45677a29a9612cd27eb911302961a83`).
 *
 * Behaviour that must not be "improved":
 * - the array branch returns the **first** match (`Array.prototype.find`);
 * - the map branch uses `hasOwnProperty`, so a node literally named `__proto__` is **not**
 *   found — it never becomes an own key of the map in the first place (pinned by the
 *   `toJSON/wf-proto` fixture in `tests/reference/workflow-rust/fixtures.json`).
 */
export function getNodeByName(nodes: INodes | INode[], name: string): INode | null {
	if (Array.isArray(nodes)) {
		return nodes.find((node) => node.name === name) || null;
	}

	if (nodes.hasOwnProperty(name)) {
		return nodes[name];
	}

	return null;
}
