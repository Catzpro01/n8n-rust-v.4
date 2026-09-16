#!/usr/bin/env node
/**
 * Workflow LEGO — reference model API assembly.
 *
 * The Workflow Model surface is not entirely reachable through n8n's package
 * barrel: `compareConnections`, `getRootNodes`, `getLeafNodes`, `hasPath`,
 * `getInputEdges` and `getOutputEdges` are only exported from deep paths.
 *
 * Both the LEGO facade (packages/workflow-lego/src/model-surface.ts) and the
 * equivalence harness must assemble the SAME surface, otherwise a digest diff
 * would report an artifact of the harness instead of a behavior change.
 *
 * This module is the JS twin of the facade and is used by:
 *   - tools/model-digest.mjs --source reference   (the "before" side)
 *   - the surface-parity test                    (facade == isolated unit == reference)
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

export function loadReferenceModelApi(referencePackage = process.env.LEGO_REFERENCE_PKG ?? 'n8n-workflow') {
	const req = createRequire(join(referencePackage, 'package.json'));
	const barrel = req(referencePackage);
	const graphUtils = req(join(referencePackage, 'dist/cjs/graph/graph-utils.js'));
	const connectionsDiff = req(join(referencePackage, 'dist/cjs/connections-diff.js'));

	return {
		// aggregate + traversal
		Workflow: barrel.Workflow,
		getChildNodes: barrel.getChildNodes,
		getParentNodes: barrel.getParentNodes,
		getConnectedNodes: barrel.getConnectedNodes,
		getNodeByName: barrel.getNodeByName,
		mapConnectionsByDestination: barrel.mapConnectionsByDestination,
		// graph validation (deep path: not in the barrel)
		buildAdjacencyList: barrel.buildAdjacencyList ?? graphUtils.buildAdjacencyList,
		parseExtractableSubgraphSelection: barrel.parseExtractableSubgraphSelection ?? graphUtils.parseExtractableSubgraphSelection,
		getRootNodes: graphUtils.getRootNodes,
		getLeafNodes: graphUtils.getLeafNodes,
		hasPath: graphUtils.hasPath,
		getInputEdges: graphUtils.getInputEdges,
		getOutputEdges: graphUtils.getOutputEdges,
		// workflow content
		calculateWorkflowChecksum: barrel.calculateWorkflowChecksum,
		compareConnections: connectionsDiff.compareConnections,
		// provenance
		__provenance: {
			package: referencePackage,
			version: req(join(referencePackage, 'package.json')).version,
		},
	};
}

/** Names of the Workflow Model public surface (must match manifest.publicSurface). */
export const MODEL_SURFACE_NAMES = [
	'Workflow',
	'getChildNodes',
	'getParentNodes',
	'getConnectedNodes',
	'getNodeByName',
	'mapConnectionsByDestination',
	'buildAdjacencyList',
	'parseExtractableSubgraphSelection',
	'getRootNodes',
	'getLeafNodes',
	'hasPath',
	'getInputEdges',
	'getOutputEdges',
	'calculateWorkflowChecksum',
	'compareConnections',
];
