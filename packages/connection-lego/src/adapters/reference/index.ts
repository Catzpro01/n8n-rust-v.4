/**
 * Port adapter — reference mode (default).
 * Binds every port to pinned reference runtime n8n-workflow@2.9.1 (n8n 2.9.4 artifact).
 */

import { join } from 'node:path';
import type { ConnectionLegoPorts } from '../../ports/contracts';
import { referencePackage, referenceRequire } from '../../ports/runtime';

const req = referenceRequire();
const pkgDir = referencePackage();

function deep(relativePath: string): Record<string, unknown> {
  const abs = join(pkgDir, relativePath);
  try {
    return req(abs) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `reference port adapter: cannot load ${abs} from reference runtime. ` +
        `Set LEGO_REFERENCE_PKG to a complete n8n-workflow package. (${(error as Error).message})`,
    );
  }
}

const barrel = req(pkgDir) as Record<string, any>;
const common = deep('dist/cjs/common/index.js') as any;
const graphUtils = deep('dist/cjs/graph/graph-utils.js') as any;
const connectionsDiff = deep('dist/cjs/connections-diff.js') as any;

export const ports: ConnectionLegoPorts = {
  graph: {
    buildAdjacencyList: graphUtils.buildAdjacencyList,
    getRootNodes: graphUtils.getRootNodes,
    getLeafNodes: graphUtils.getLeafNodes,
    getInputEdges: graphUtils.getInputEdges,
    getOutputEdges: graphUtils.getOutputEdges,
    hasPath: graphUtils.hasPath,
    parseExtractableSubgraphSelection: graphUtils.parseExtractableSubgraphSelection,
    getChildNodes: common.getChildNodes,
    getParentNodes: common.getParentNodes,
    getConnectedNodes: common.getConnectedNodes,
    getNodeByName: common.getNodeByName,
    mapConnectionsByDestination: common.mapConnectionsByDestination,
  },
  diff: {
    compareConnections: connectionsDiff.compareConnections,
  },
  common: {
    buildAdjacencyList: graphUtils.buildAdjacencyList,
    getRootNodes: graphUtils.getRootNodes,
    getLeafNodes: graphUtils.getLeafNodes,
    getInputEdges: graphUtils.getInputEdges,
    getOutputEdges: graphUtils.getOutputEdges,
    hasPath: graphUtils.hasPath,
    parseExtractableSubgraphSelection: graphUtils.parseExtractableSubgraphSelection,
    getChildNodes: common.getChildNodes,
    getParentNodes: common.getParentNodes,
    getConnectedNodes: common.getConnectedNodes,
    getNodeByName: common.getNodeByName,
    mapConnectionsByDestination: common.mapConnectionsByDestination,
  },
  vocabulary: {
    NodeConnectionTypes: barrel.NodeConnectionTypes,
  },
};

export const referenceProvenance = {
  package: referencePackage(),
  path: pkgDir,
  version: (req(join(pkgDir, 'package.json')) as { version: string }).version,
};

export default ports;
