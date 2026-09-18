/**
 * Oracle wiring for the Workflow LEGO reconstruction.
 *
 * Two registries are provided, and which one is used is always recorded in the
 * golden file so a recorded value can never be mistaken for a hand-written one:
 *
 *   buildRealNodeTypes()   loads the real node classes from the pinned
 *                          n8n-nodes-base@2.9.1 install, so `trigger` / `poll`
 *                          are the genuine class properties (this is what makes
 *                          `__getStartNode`'s trigger scan meaningful).
 *   registryFromIndex()    rebuilds an equivalent registry from the serialised
 *                          index recorded inside the golden file — no runtime
 *                          install needed, which is what the offline test uses.
 *
 * The registry itself is Node Model LEGO (02) territory; it is shared by BOTH
 * sides of every comparison here, so it can never be the cause of a divergence.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const REPO = join(PKG, '..', '..');

/** Node type -> published class file, for the types the golden corpus uses. */
const NODE_CLASS_FILES = {
	'n8n-nodes-base.manualTrigger': 'dist/nodes/ManualTrigger/ManualTrigger.node.js',
	'n8n-nodes-base.scheduleTrigger': 'dist/nodes/Schedule/ScheduleTrigger.node.js',
	'n8n-nodes-base.code': 'dist/nodes/Code/Code.node.js',
	'n8n-nodes-base.filter': 'dist/nodes/Filter/Filter.node.js',
	'n8n-nodes-base.set': 'dist/nodes/Set/Set.node.js',
	'n8n-nodes-base.noOp': 'dist/nodes/NoOp/NoOp.node.js',
};

export function repoRoot() {
	return REPO;
}

/** Locate the pinned reference runtime installed by scripts/setup-reference-runtime.sh. */
export function findRuntime(explicit) {
	const candidates = [
		explicit,
		process.env.LEGO_LIVE_RUNTIME,
		join(REPO, '.runtime', 'node_modules'),
		'/home/user/.n8n-live/node_modules',
	].filter(Boolean);

	for (const dir of candidates) {
		const wf = join(dir, 'n8n-workflow', 'package.json');
		if (existsSync(wf)) {
			return {
				dir,
				workflowVersion: JSON.parse(readFileSync(wf, 'utf8')).version,
				nodesBase: existsSync(join(dir, 'n8n-nodes-base', 'package.json'))
					? JSON.parse(readFileSync(join(dir, 'n8n-nodes-base', 'package.json'), 'utf8')).version
					: undefined,
			};
		}
	}
	return null;
}

/** Load the real `Workflow` class + vocabulary from the pinned n8n-workflow. */
export function loadReference(runtime) {
	const pkgPath = join(runtime.dir, 'n8n-workflow');
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const mod = require(pkgPath);
	return {
		Workflow: mod.Workflow,
		NodeConnectionTypes: mod.NodeConnectionTypes,
		STARTING_NODE_TYPES: mod.STARTING_NODE_TYPES,
		MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE: mod.MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE,
		mapConnectionsByDestination: mod.mapConnectionsByDestination,
		getParentNodes: mod.getParentNodes,
		getChildNodes: mod.getChildNodes,
		getConnectedNodes: mod.getConnectedNodes,
		getNodeByName: mod.getNodeByName,
	};
}

function instantiate(mod) {
	const keys = Object.keys(mod).filter((k) => k !== '__esModule' && k !== 'default');
	const Ctor = mod.default ?? mod[keys[0]];
	return typeof Ctor === 'function' ? new Ctor() : Ctor;
}

/**
 * Versioned node types (`set`, `filter`) extend n8n-workflow's
 * `VersionedNodeType`: the wrapper carries `nodeVersions` and no `properties`
 * itself, and `getNodeType(version)` returns the concrete implementation
 * (`versioned-node-type.js`). Upstream `NodeTypes.getByNameAndVersion` resolves
 * through it, so this registry does the same.
 */
function resolveVersion(instance, version) {
	if (typeof instance.getNodeType === 'function') {
		return instance.getNodeType(version) ?? instance.getNodeType();
	}
	return instance;
}

/**
 * Build the node type registries from the real node classes.
 *
 * Returns
 *   realRegistry  hands out the *actual* node class instances — this is what the
 *                 reference `Workflow` constructor needs, because it resolves
 *                 parameter defaults from `description.properties` (workflow.ts:98).
 *   index         the JSON-serialisable subset the Workflow LEGO actually reads
 *                 (versions, `trigger`, `poll`, `description.name`). `properties`
 *                 is deliberately not recorded: parameter defaults are Node Model
 *                 LEGO territory and the reconstruction takes them through a port.
 *   registry      the offline registry rebuilt from `index` (used by the recon side).
 *
 * Both registries agree on every field the Workflow LEGO consults, so they cannot
 * be the source of a divergence in the compared surface.
 */
export function buildRealNodeTypes(runtime, typeNames) {
	const nodesJsonPath = join(runtime.dir, 'n8n-nodes-base', 'dist', 'types', 'nodes.json');
	// A node name can appear more than once (versioned node types: `set` ships a
	// v1/v2 description *and* a v3+ one, `filter` a v1 and a v2+). Upstream resolves
	// per version, so the merged version list is what a lookup must accept.
	const descriptions = new Map();
	if (existsSync(nodesJsonPath)) {
		for (const entry of JSON.parse(readFileSync(nodesJsonPath, 'utf8'))) {
			const type = `n8n-nodes-base.${entry.name}`;
			const versions = (Array.isArray(entry.version) ? entry.version : [entry.version]).map(Number);
			descriptions.set(
				type,
				[...(descriptions.get(type) ?? []), ...versions].sort((a, b) => a - b),
			);
		}
	}

	const index = {};
	const instances = {};
	for (const type of typeNames) {
		const classFile = NODE_CLASS_FILES[type];
		const versions = descriptions.get(type);
		if (!classFile || !versions) continue;

		let instance;
		try {
			instance = instantiate(require(join(runtime.dir, 'n8n-nodes-base', classFile)));
		} catch {
			continue;
		}

		const concrete = resolveVersion(instance, undefined);
		instances[type] = { instance, versions };
		index[type] = {
			versions,
			trigger: concrete.trigger !== undefined,
			poll: concrete.poll !== undefined,
			descriptionName: concrete.description?.name ?? type.replace('n8n-nodes-base.', ''),
			classFile,
		};
	}

	const realRegistry = {
		getByNameAndVersion(type, version) {
			const entry = instances[type];
			if (!entry) return undefined;
			if (version !== undefined) {
				const wanted = Number(version);
				if (!entry.versions.some((v) => Number(v) === wanted)) return undefined;
			}
			return resolveVersion(entry.instance, version);
		},
		getByName(type) {
			return instances[type]?.instance;
		},
		getKnownTypes() {
			return Object.fromEntries(Object.entries(instances).map(([k, v]) => [k, v.instance]));
		},
	};

	return { realRegistry, registry: registryFromIndex(index), index };
}

/** Rebuild an equivalent registry from a recorded index (offline-safe). */
export function registryFromIndex(index) {
	const stub = (type, entry) => ({
		trigger: entry.trigger ? function trigger() {} : undefined,
		poll: entry.poll ? function poll() {} : undefined,
		description: { name: entry.descriptionName, version: entry.versions },
		__type: type,
	});

	return {
		getByNameAndVersion(type, version) {
			const entry = index[type];
			if (!entry) return undefined;
			if (version === undefined) return stub(type, entry);
			const wanted = Number(version);
			return entry.versions.some((v) => Number(v) === wanted) ? stub(type, entry) : undefined;
		},
		getByName(type) {
			const entry = index[type];
			return entry ? stub(type, entry) : undefined;
		},
		getKnownTypes() {
			return { ...index };
		},
	};
}

/** Every node type referenced by a workflow fixture. */
export function nodeTypesOf(workflow) {
	return [...new Set(workflow.nodes.map((n) => n.type))];
}

export function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}
