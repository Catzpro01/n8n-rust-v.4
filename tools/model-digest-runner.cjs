#!/usr/bin/env node
/**
 * Digest runner used by the isolation tests (CommonJS so it can inspect
 * require.cache and prove that strict mode never loaded the reference runtime).
 *
 * usage: node digest-runner.cjs --source reference|isolated [--mode reference|strict] --out <file>
 */
const { writeFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

const argv = process.argv.slice(2);
const argOf = (flag) => {
	const i = argv.indexOf(flag);
	return i === -1 ? null : argv[i + 1];
};

const source = argOf('--source') ?? 'isolated';
const mode = argOf('--mode') ?? 'reference';
process.env.LEGO_PORT_MODE = mode;

const REPO = resolve(__dirname, '..');

const loadedReferenceRuntime = () =>
	Object.keys(require.cache).some((p) => p.includes('n8n-workflow') || p.includes('n8n-live'));

(async () => {
	const digestTool = await import(join(REPO, 'tools/model-digest.mjs'));
	const corpus = digestTool.loadCorpus();

	let api;
	if (source === 'reference') {
		const { loadReferenceModelApi } = await import(join(REPO, 'tools/reference-model-api.mjs'));
		api = loadReferenceModelApi();
	} else {
		api = require(join(REPO, 'packages/workflow-lego/.extract/dist/model-api.js'));
	}

	const nodesJson = process.env.LEGO_NODES_JSON;
	const nodeTypes = nodesJson && existsSync(nodesJson) ? digestTool.buildNodeTypes(nodesJson) : digestTool.nodeTypesRegistry({});
	const digests = await digestTool.computeDigests(api, corpus, { nodeTypes });

	const payload = {
		source,
		portMode: mode,
		workflowCount: Object.keys(digests).length,
		loadedReferenceRuntime: loadedReferenceRuntime(),
		digests,
	};
	const out = argOf('--out');
	if (out) writeFileSync(out, JSON.stringify(payload, null, 2));
	else process.stdout.write(JSON.stringify(payload));
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
