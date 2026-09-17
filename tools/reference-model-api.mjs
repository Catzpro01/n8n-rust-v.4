import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export function loadReferenceModelApi(referencePackage = process.env.LEGO_REFERENCE_PKG ?? 'n8n-workflow') {
	// Find n8n-workflow package.json in known locations
	const candidates = [
		join(process.cwd(), 'packages/workflow-lego/node_modules', referencePackage, 'package.json'),
		join(process.cwd(), 'node_modules', referencePackage, 'package.json'),
		join(process.cwd(), 'packages/workflow-lego/node_modules/n8n-workflow/package.json'),
	];
	let pkgPath = null;
	for (const c of candidates) {
		if (existsSync(c)) { pkgPath = c; break; }
	}
	if (!pkgPath) {
		try { pkgPath = require.resolve(`${referencePackage}/package.json`); } catch {}
	}
	if (!pkgPath) pkgPath = join(referencePackage, 'package.json');
	const req = createRequire(pkgPath);
	let barrel, graphUtils, connectionsDiff;
	try { barrel = req(referencePackage); } catch { barrel = req(join(pkgPath, '..', 'dist/cjs/index.js')); }
	try { graphUtils = req(join(referencePackage, 'dist/cjs/graph/graph-utils.js')); } catch { try { graphUtils = req(join(pkgPath, '..', 'dist/cjs/graph/graph-utils.js')); } catch { graphUtils = {}; } }
	try { connectionsDiff = req(join(referencePackage, 'dist/cjs/connections-diff.js')); } catch { try { connectionsDiff = req(join(pkgPath, '..', 'dist/cjs/connections-diff.js')); } catch { connectionsDiff = {}; } }
	let version = 'unknown';
	try { version = req(pkgPath).version ?? 'unknown'; } catch {}
	return {
		Workflow: barrel.Workflow,
		getChildNodes: barrel.getChildNodes,
		getParentNodes: barrel.getParentNodes,
		getConnectedNodes: barrel.getConnectedNodes,
		getNodeByName: barrel.getNodeByName,
		mapConnectionsByDestination: barrel.mapConnectionsByDestination,
		buildAdjacencyList: barrel.buildAdjacencyList ?? graphUtils.buildAdjacencyList,
		parseExtractableSubgraphSelection: barrel.parseExtractableSubgraphSelection ?? graphUtils.parseExtractableSubgraphSelection,
		getRootNodes: graphUtils.getRootNodes,
		getLeafNodes: graphUtils.getLeafNodes,
		hasPath: graphUtils.hasPath,
		getInputEdges: graphUtils.getInputEdges,
		getOutputEdges: graphUtils.getOutputEdges,
		calculateWorkflowChecksum: barrel.calculateWorkflowChecksum,
		compareConnections: connectionsDiff.compareConnections,
		__provenance: { package: referencePackage, version },
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
