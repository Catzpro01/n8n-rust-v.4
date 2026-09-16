#!/usr/bin/env node
/**
 * Workflow LEGO — model digest.
 *
 * Computes a canonical, deterministic fingerprint of everything the Workflow
 * Model answers: structure, adjacency indexes, traversals, diffing, checksum and
 * graph validation.
 *
 * The SAME function is run against
 *   (a) the reference runtime (`n8n-workflow`, the artifact n8n 2.9.4 ships)  → "before"
 *   (b) the isolated unit built from the pinned reference sources            → "after"
 * so any behavioral difference shows up as a digest diff. No expectations are
 * hand-written: the reference is the oracle.
 *
 * Usage (CLI, for capturing evidence):
 *   node tools/model-digest.mjs --source reference|isolated --out <file>
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { REPO } from './workflow-boundary-map.mjs';

/* ------------------------------------------------------------------ */
/* corpus                                                              */
/* ------------------------------------------------------------------ */
const GOLDEN = [
	'tests/reference/01-empty-workflow/workflow.json',
	'tests/reference/02-one-node/workflow.json',
	'tests/reference/03-linear/workflow.json',
];
const CORPUS_DIRS = [
	'reference/n8n/packages/@n8n/ai-workflow-builder.ee/evaluations/fixtures/reference-workflows',
	'reference/n8n/packages/@n8n/workflow-sdk/test-fixtures/committed-workflows',
];

export function loadCorpus() {
	const files = [...GOLDEN];
	for (const dir of CORPUS_DIRS) {
		const abs = join(REPO, dir);
		if (!existsSync(abs)) continue;
		for (const f of readdirSync(abs).sort()) {
			if (f.endsWith('.json') && f !== 'manifest.json') files.push(join(dir, f));
		}
	}
	return files.map((rel) => {
		const json = JSON.parse(readFileSync(join(REPO, rel), 'utf8'));
		return { id: rel.replace(/^reference\/n8n\/packages\/@n8n\//, '').replace(/\.json$/, ''), file: rel, workflow: json };
	});
}

/* ------------------------------------------------------------------ */
/* canonicalisation                                                    */
/* ------------------------------------------------------------------ */
export const canonical = (value) => {
	const seen = new WeakSet();
	const walk = (v) => {
		if (v === null || typeof v !== 'object') {
			if (typeof v === 'function') return `[function ${v.name || 'anonymous'}]`;
			if (typeof v === 'number' && Number.isNaN(v)) return '[NaN]';
			return v;
		}
		if (v instanceof Set) return { __set: [...v].map(walk).sort() };
		if (v instanceof Map) return { __map: [...v.entries()].map(([k, x]) => [k, walk(x)]).sort() };
		if (seen.has(v)) return '[circular]';
		seen.add(v);
		if (Array.isArray(v)) return v.map(walk);
		const out = {};
		for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
		if (v instanceof Error) return { __error: v.name, message: v.message, ...out };
		return out;
	};
	return walk(value);
};

/** Run a probe, capturing thrown errors as data (they are part of the behavior). */
const probe = (fn) => {
	try {
		const value = fn();
		return { ok: true, value: canonical(value) };
	} catch (error) {
		return {
			ok: false,
			error: { name: error?.constructor?.name ?? 'unknown', message: String(error?.message ?? error) },
		};
	}
};

/**
 * Registry over real node descriptions. n8n's own `/types/nodes.json` ships one
 * entry PER VERSION, so descriptions are indexed by type@version; a lookup falls
 * back to the highest known version (same as n8n's "closest version" behavior).
 */
const nodeTypesRegistry = (index) => ({
	getByNameAndVersion(type, version) {
		const byVersion = index[type];
		if (!byVersion) return undefined;
		const exact = version !== undefined ? byVersion.versions[version] : undefined;
		const d = exact ?? byVersion.latest;
		if (!d) return undefined;
		const isTrigger = (d.group ?? []).includes('trigger');
		const isSchedule = (d.group ?? []).includes('schedule');
		return {
			description: { ...d, name: type, properties: d.properties ?? [] },
			trigger: isTrigger ? async () => undefined : undefined,
			poll: isSchedule ? async () => undefined : undefined,
		};
	},
});

/** Build a version-aware registry from the real node descriptions shipped with n8n-nodes-base. */
export function buildNodeTypes(nodesJsonPath) {
	const index = {};
	if (existsSync(nodesJsonPath)) {
		const numeric = (v) => (typeof v === 'number' ? v : Number.parseFloat(String(v)));
		for (const entry of JSON.parse(readFileSync(nodesJsonPath, 'utf8'))) {
			const versions = Array.isArray(entry.version) ? entry.version : [entry.version];
			for (const prefix of ['n8n-nodes-base.', '@n8n/n8n-nodes-langchain.']) {
				const type = prefix + entry.name;
				const slot = (index[type] ??= { versions: {}, latest: undefined, latestVersion: -Infinity });
				for (const v of versions) slot.versions[v] = entry;
				const top = numeric(versions[versions.length - 1]);
				if (top >= slot.latestVersion) {
					slot.latestVersion = top;
					slot.latest = entry;
				}
			}
		}
	}
	return nodeTypesRegistry(index);
}

/* ------------------------------------------------------------------ */
/* digest                                                              */
/* ------------------------------------------------------------------ */
const TYPES = ['main', 'ALL', 'ALL_NON_MAIN'];
const DEPTHS = [-1, 0, 1, 2, 3];

/**
 * @param api       the model API (reference runtime or isolated unit)
 * @param workflows corpus entries
 * @param options   { nodeTypes }
 */
export async function computeDigests(api, workflows, options = {}) {
	const nodeTypes = options.nodeTypes ?? nodeTypesRegistry({});
	const digests = {};

	for (const { id, workflow } of workflows) {
		const d = {};
		const build = () =>
			new api.Workflow({
				id: workflow.id ?? id,
				name: workflow.name,
				nodes: JSON.parse(JSON.stringify(workflow.nodes ?? [])),
				connections: JSON.parse(JSON.stringify(workflow.connections ?? {})),
				active: workflow.active ?? false,
				nodeTypes,
				settings: workflow.settings,
				staticData: workflow.staticData,
				pinData: workflow.pinData,
			});
		// Construction itself is part of the model's contract (defaults are applied
		// here through the node-model port), so its outcome is captured as data.
		const construction = probe(build);
		if (!construction.ok) {
			digests[id] = { constructionFailed: true, construction };
			continue;
		}
		const wf = build();
		const names = Object.keys(wf.nodes);
		d.construction = canonical({ ok: true });
		const allTypes = [
			...new Set([
				...TYPES,
				...Object.values(wf.connectionsBySourceNode).flatMap((byType) => Object.keys(byType)),
				...Object.values(wf.connectionsByDestinationNode).flatMap((byType) => Object.keys(byType)),
			]),
		];

		/* 1. structure ------------------------------------------------- */
		d.structure = canonical({
			id: wf.id,
			name: wf.name,
			active: wf.active,
			timezone: wf.timezone,
			settings: wf.settings,
			nodeOrder: names,
			nodes: names.map((n) => {
				const node = wf.nodes[n];
				return { name: node.name, type: node.type, typeVersion: node.typeVersion, disabled: node.disabled ?? null, position: node.position };
			}),
		});

		d.nodeParameters = canonical(
			names.map((n) => ({ name: n, parameters: wf.nodes[n].parameters, onError: wf.nodes[n].onError ?? null })),
		);

		d.connections = canonical({
			bySource: wf.connectionsBySourceNode,
			byDestination: wf.connectionsByDestinationNode,
		});

		d.pinData = canonical(names.map((n) => [n, wf.getPinDataOfNode(n)]));

		d.staticData = canonical({
			global: wf.getStaticData('global'),
			perNode: names.map((n) => [n, Object.keys(wf.getStaticData('node', wf.nodes[n]))]),
			errorOnUnknown: probe(() => wf.getStaticData('nope')),
			errorWithoutNode: probe(() => wf.getStaticData('node')),
		});

		/* 2. traversal ------------------------------------------------- */
		const traversal = {};
		for (const n of names) {
			for (const type of allTypes) {
				for (const depth of DEPTHS) {
					traversal[`child|${n}|${type}|${depth}`] = probe(() => wf.getChildNodes(n, type, depth));
					traversal[`parent|${n}|${type}|${depth}`] = probe(() => wf.getParentNodes(n, type, depth));
					traversal[`connected|${n}|${type}|${depth}`] = probe(() =>
						wf.getConnectedNodes(wf.connectionsBySourceNode, n, type, depth),
					);
					traversal[`parentByDepth|${n}|${depth}`] = probe(() => wf.getParentNodesByDepth(n, depth));
					traversal[`bfs|${n}|${depth}`] = probe(() => wf.searchNodesBFS(wf.connectionsByDestinationNode, n, depth));
				}
			}
			traversal[`highest|${n}`] = probe(() => wf.getHighestNode(n));
		}
		// module-level graph helpers
		for (const n of names) {
			traversal[`module.child|${n}`] = probe(() => api.getChildNodes(wf.connectionsBySourceNode, n));
			traversal[`module.parent|${n}`] = probe(() => api.getParentNodes(wf.connectionsByDestinationNode, n));
		}
		d.traversal = canonical(traversal);

		/* 3. node classification / start node -------------------------- */
		d.triggers = canonical({
			triggerNodes: wf.getTriggerNodes().map((n) => n.name),
			pollNodes: wf.getPollNodes().map((n) => n.name),
			queryAll: wf.queryNodes(() => true).map((n) => n.name),
			startNode: probe(() => wf.getStartNode()?.name ?? null),
			startNodePerDestination: Object.fromEntries(names.map((n) => [n, probe(() => wf.getStartNode(n)?.name ?? null)])),
			parentMainInput: Object.fromEntries(names.map((n) => [n, probe(() => wf.getParentMainInputNode(wf.nodes[n])?.name ?? null)])),
		});

		/* 4. connection indexes ---------------------------------------- */
		const indexes = {};
		for (const n of names) {
			for (const p of names) {
				if (n === p) continue;
				for (const type of allTypes.filter((t) => t !== 'ALL' && t !== 'ALL_NON_MAIN')) {
					indexes[`${n}<-${p}|${type}`] = probe(() => wf.getNodeConnectionIndexes(n, p, type));
					indexes[`between|${n}|${p}`] = probe(() => wf.getConnectionsBetweenNodes([n], [p]));
				}
			}
		}
		d.indexes = canonical(indexes);

		/* 5. renaming -------------------------------------------------- */
		const renameSamples = [null, 1, true, 'plain', '={{ $json.x }}', `={{ $('Manual Trigger').item.json }}`, { a: ['={{ $node["Manual Trigger"].json }}'] }];
		d.rename = canonical({
			samples: renameSamples.map((v) => probe(() => wf.renameNodeInParameterValue(v, 'Manual Trigger', 'Renamed'))),
			afterRename: (() => {
				const wf2 = build();
				const node = Object.values(wf2.nodes)[0];
				return node
					? probe(() => {
							wf2.renameNode(node, 'Renamed Node');
							return { names: Object.keys(wf2.nodes), connections: wf2.connectionsBySourceNode };
						})
					: null;
			})(),
		});

		/* 6. setters / re-entry ---------------------------------------- */
		d.setters = canonical(
			probe(() => {
				const wf3 = build();
				wf3.setNodes(Object.values(wf3.nodes));
				wf3.setConnections(JSON.parse(JSON.stringify(workflow.connections ?? {})));
				wf3.setSettings({ timezone: 'Europe/Berlin', executionOrder: 'v1' });
				wf3.setPinData({ 'Manual Trigger': [{ json: { pinned: true } }] });
				wf3.overrideStaticData({ custom: 1 });
				const wf4 = build();
				return {
					timezone: wf4.timezone,
					nodes: Object.keys(wf3.nodes),
					byDestination: wf3.connectionsByDestinationNode,
					pinData: wf3.pinData,
					staticData: { keys: Object.keys(wf3.staticData), changed: wf3.staticData.__dataChanged },
					settings: wf3.settings,
				};
			}),
		);

		/* 7. content: checksum + diff ---------------------------------- */
		const snapshots = [
			{ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings },
			{ name: 'renamed', nodes: workflow.nodes, connections: workflow.connections ?? {}, settings: { timezone: 'UTC' } },
			{ name: 'empty', nodes: [], connections: {} },
		];
		d.checksum = await Promise.all(snapshots.map(async (s) => probeAsync(() => api.calculateWorkflowChecksum(s))));
		d.diff = canonical(
			compareAll(api, [
				[workflow.connections ?? {}, workflow.connections ?? {}],
				[{ A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } }, { A: { main: [[{ node: 'C', type: 'main', index: 0 }]] } }],
				[{ A: { main: [[{ node: 'B', type: 'main', index: 0 }], [{ node: 'C', type: 'main', index: 0 }]] } }, { A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } }],
				[{}, { A: { main: [[{ node: 'B', type: 'main', index: 1 }]] } }],
			]),
		);

		/* 8. graph validation ------------------------------------------ */
		const adjacency = api.buildAdjacencyList(wf.connectionsBySourceNode);
		const subsets = [
			[],
			...names.map((n) => [n]),
			...names.flatMap((n, i) => names.slice(i + 1).map((m) => [n, m])),
			names,
		];
		d.graphValidation = canonical({
			adjacency: [...adjacency.entries()].map(([k, v]) => [k, [...v]]),
			selections: subsets.map((subset) => ({
				subset,
				result: probe(() => api.parseExtractableSubgraphSelection(new Set(subset), adjacency)),
				rootNodes: probe(() => [...api.getRootNodes(new Set(subset), adjacency)]),
				leafNodes: probe(() => [...api.getLeafNodes(new Set(subset), adjacency)]),
				hasPath: subset.length === 2 ? probe(() => api.hasPath(subset[0], subset[1], adjacency)) : null,
			})),
			mapByDestination: probe(() => api.mapConnectionsByDestination(wf.connectionsBySourceNode)),
			getNodeByName: probe(() => names.map((n) => api.getNodeByName(wf.nodes, n)?.name ?? null)),
		});

		digests[id] = d;
	}
	return digests;
}

const probeAsync = async (fn) => {
	try {
		return { ok: true, value: canonical(await fn()) };
	} catch (error) {
		return { ok: false, error: { name: error?.constructor?.name ?? 'unknown', message: String(error?.message ?? error) } };
	}
};

const compareAll = (api, pairs) =>
	pairs.map(([prev, next]) => {
		try {
			return { ok: true, value: canonical(api.compareConnections(prev, next)) };
		} catch (error) {
			return { ok: false, error: { name: error?.constructor?.name ?? 'unknown', message: String(error?.message ?? error) } };
		}
	});

export const digestSections = [
	'structure',
	'nodeParameters',
	'connections',
	'pinData',
	'staticData',
	'traversal',
	'triggers',
	'indexes',
	'rename',
	'setters',
	'checksum',
	'diff',
	'graphValidation',
];

/**
 * Sections whose answers legitimately depend on a port implementation and are
 * therefore not required to match between reference and strict port modes.
 * They MUST still match between reference and the isolated unit (reference mode).
 */
export const portDependentSections = new Set(['nodeParameters', 'triggers', 'rename']);

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */
const isMain = process.argv[1] && process.argv[1].endsWith('model-digest.mjs');
if (isMain) {
	const args = process.argv.slice(2);
	const argOf = (f) => {
		const i = args.indexOf(f);
		return i === -1 ? null : args[i + 1];
	};
	const source = argOf('--source') ?? 'reference';

	let api;
	if (source === 'reference') {
		const { loadReferenceModelApi } = await import('./reference-model-api.mjs');
		api = loadReferenceModelApi();
	} else if (source === 'isolated') {
		api = (await import(join(REPO, 'packages/workflow-lego/.extract/dist/model-api.js'))).default;
	} else {
		throw new Error(`unknown --source ${source}`);
	}

	const nodesJson = process.env.LEGO_NODES_JSON;
	const nodeTypes = nodesJson ? buildNodeTypes(nodesJson) : nodeTypesRegistry({});
	const digests = await computeDigests(api, loadCorpus(), { nodeTypes });

	const payload = {
		generatedAt: new Date().toISOString(),
		source,
		referencePackage: process.env.LEGO_REFERENCE_PKG ?? 'n8n-workflow',
		nodeTypeRegistry: nodesJson ? basename(nodesJson) : 'empty',
		workflowCount: Object.keys(digests).length,
		digests,
	};
	if (argOf('--out')) {
		const { writeFileSync } = await import('node:fs');
		writeFileSync(argOf('--out'), JSON.stringify(payload, null, 2));
		console.log(`digest written to ${argOf('--out')} (${payload.workflowCount} workflows, ${Object.keys(digests[Object.keys(digests)[0]]).length} sections)`);
	} else {
		console.log(JSON.stringify(payload, null, 2));
	}
}
