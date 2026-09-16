/**
 * Port adapter — `reference` mode (default).
 *
 * Binds every port to the pinned reference runtime: `n8n-workflow@2.9.1`,
 * which is exactly the artifact shipped by n8n 2.9.4
 * (see reference/n8n/packages/workflow, REFERENCE_VERSION.md).
 *
 * Consequence: with this adapter the isolated model is behaviorally identical
 * to n8n by construction — which is what the equivalence digest verifies
 * (tools/model-digest.mjs → packages/workflow-lego/test).
 *
 * Not in the package barrel and therefore loaded through a deep path:
 *   connections-diff, graph/graph-utils (partial), utils.isObject,
 *   node-parameters/rename-node-utils
 */
import { join } from 'node:path';
import type { WorkflowLegoPorts } from '../../ports/contracts';
import { referencePackage, referenceRequire } from '../../ports/runtime';

const req = referenceRequire();
const pkgDir = referencePackage();

function deep(relativePath: string): Record<string, unknown> {
	const abs = join(pkgDir, relativePath);
	try {
		return req(abs) as Record<string, unknown>;
	} catch (error) {
		throw new Error(
			`reference port adapter: cannot load ${abs} from the reference runtime. ` +
				`Set LEGO_REFERENCE_PKG to a complete n8n-workflow package. (${(error as Error).message})`,
		);
	}
}

const barrel = req(pkgDir) as Record<string, any>;
const utils = deep('dist/cjs/utils.js');
const renameUtils = deep('dist/cjs/node-parameters/rename-node-utils.js');

export const ports: WorkflowLegoPorts = {
	vocabulary: {
		NodeConnectionTypes: barrel.NodeConnectionTypes,
	},
	constants: {
		STARTING_NODE_TYPES: barrel.STARTING_NODE_TYPES,
		MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE: barrel.MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE,
		NODES_WITH_RENAMABLE_CONTENT: barrel.NODES_WITH_RENAMABLE_CONTENT,
		NODES_WITH_RENAMABLE_FORM_HTML_CONTENT: barrel.NODES_WITH_RENAMABLE_FORM_HTML_CONTENT,
		NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT: barrel.NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT,
	},
	errors: {
		ApplicationError: barrel.ApplicationError,
		UserError: barrel.UserError,
	},
	utils: {
		dedupe: barrel.dedupe,
		isObject: utils.isObject as WorkflowLegoPorts['utils']['isObject'],
	},
	observableObject: {
		create: barrel.ObservableObject.create,
	},
	config: {
		getGlobalState: barrel.getGlobalState,
	},
	nodeModel: {
		getNodeParameters: barrel.NodeHelpers.getNodeParameters,
		getNodeOutputs: barrel.NodeHelpers.getNodeOutputs,
	},
	nodeRename: {
		renameFormFields: renameUtils.renameFormFields as WorkflowLegoPorts['nodeRename']['renameFormFields'],
	},
	nodeReference: {
		applyAccessPatterns: barrel.applyAccessPatterns,
	},
	expressionRuntime: {
		Expression: barrel.Expression,
	},
	checksumDigest: {
		jsSHA: req('jssha').default ?? req('jssha'),
	},
};

/** Provenance of this adapter, for evidence files. */
export const referenceProvenance = {
	package: referencePackage(),
	path: pkgDir,
	version: (req(join(pkgDir, 'package.json')) as { version: string }).version,
};

export default ports;
