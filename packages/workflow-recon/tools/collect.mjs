/**
 * The comparison surface. One function produces the full answer set of a
 * Workflow implementation; the recorder, the differential test and the golden
 * test all call it, so a divergence cannot hide behind a hand-picked assertion.
 *
 * Keys are stable strings so the golden file stays diff-friendly.
 */

const TRAVERSAL_DEPTHS = [-1, 0, 1, 2];

/**
 * @param {any} wf       any Workflow-shaped implementation
 * @param {any} fixture  the workflow fixture the calls are derived from
 * @returns {Record<string, unknown>}
 */
export function collectCalls(wf, fixture) {
	const names = fixture.nodes.map((n) => n.name);
	const calls = {};

	calls['connectionsByDestinationNode'] = wf.connectionsByDestinationNode;

	for (const name of names) {
		calls[`getHighestNode(${name})`] = wf.getHighestNode(name);
		calls[`getParentNodes(${name})`] = wf.getParentNodes(name);
		calls[`getChildNodes(${name})`] = wf.getChildNodes(name);
		calls[`getStartNode(${name})`] = wf.getStartNode(name)?.name ?? null;
		for (const depth of TRAVERSAL_DEPTHS) {
			calls[`getParentNodes(${name},main,${depth})`] = wf.getParentNodes(name, 'main', depth);
			calls[`getChildNodes(${name},main,${depth})`] = wf.getChildNodes(name, 'main', depth);
		}
		calls[`getParentNodes(${name},ALL)`] = wf.getParentNodes(name, 'ALL');
		calls[`getParentNodesByDepth(${name})`] = wf.getParentNodesByDepth(name);
	}

	calls['getStartNode()'] = wf.getStartNode()?.name ?? null;
	calls['getTriggerNodes()'] = wf.getTriggerNodes().map((n) => n.name);
	calls['getPollNodes()'] = wf.getPollNodes().map((n) => n.name);

	// connection indexes: every node against each of its parents
	for (const name of names) {
		for (const parent of wf.getParentNodes(name)) {
			calls[`getNodeConnectionIndexes(${name},${parent})`] =
				wf.getNodeConnectionIndexes(name, parent) ?? null;
		}
	}

	// multi-output routing: which edges run from the first two sources into the rest
	if (names.length > 1) {
		calls[`getConnectionsBetweenNodes(${names[0]}|${names[1]},rest)`] = wf.getConnectionsBetweenNodes(
			[names[0], names[1]],
			names.slice(2),
		);
	}

	return calls;
}
